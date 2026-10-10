// SPDX-License-Identifier: MIT
// JustVoice's ONE build config (Quasar CLI, app-structure §Q) — the renderer for every mode, the
// desktop app (Electron mode on the kit's runDesktopApp) and the phone app (Capacitor mode).
// Written from the family template (../just-llm-runner/template/quasar.config.js); what differs
// is JustVoice's: the kit UI alias, the dev ports, the audio.cpp dev build, the installer.
// https://v2.quasar.dev/quasar-cli-vite/quasar-config-file

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineConfig } from '#q-app'

// `npm run` hands an `allow-scripts` setting from the user's .npmrc to every child process as
// npm_config_allow_scripts, and npm 11 refuses it in the project installs Quasar spawns
// (EALLOWSCRIPTS). Each project declares its own `allowScripts`, which npm uses instead.
delete process.env.npm_config_allow_scripts

const root = import.meta.dirname
const kitUi = path.resolve(root, '../just-llm-runner/ui')
// the audiocpp_dsp an installer carries (scripts/audiocpp-dsp-package.js stages it here)
const dspStage = path.join(root, 'dist', 'audiocpp-dsp')

export default defineConfig(() => {
  return {
    // vue-i18n first (as the CLI's i18n preset wires it), then the renderer's start-up (the old
    // src/main.js), awaited before Quasar mounts the app.
    boot: ['i18n', 'jv'],

    // The app's stylesheets (src/css/): the bundled fonts, the design tokens, then the app's own
    // styles — ahead of the kit's, which its modules import, the order JustVoice has always had.
    // Here, not imported by the boot file: Quasar puts these in the entry stylesheet, present at
    // first paint, while a boot file's CSS is preloaded with its chunk.
    css: [ 'fonts.css', 'tokens.css', 'app.scss' ],

    // No Quasar icon font or Roboto: JustVoice's look is its own tokens, and the icons Quasar's
    // components draw are the kit's line icons (its icon set).
    extras: [],

    build: {
      vueRouterMode: 'hash',

      alias: {
        '@renderer': path.join(root, 'src'),
        // The kit's UI, consumed from source (the sibling checkout) for the dev/HMR loop.
        '@delebash/llm-ui': path.join(kitUi, 'src'),
      },

      extendViteConf (viteConf) {
        viteConf.resolve = viteConf.resolve || {}
        // The aliased kit imports its peer packages by bare name from its own folder, which has
        // no node_modules: ONE copy of each comes from this app's (Vue's provide/inject and
        // reactivity, and Quasar's, break with two).
        viteConf.resolve.dedupe = [
          ...(viteConf.resolve.dedupe || []),
          'vue', 'quasar', '@floating-ui/dom', 'pinia', 'vue-router', 'vue-i18n', 'marked',
          '@vueuse/core', 'qrcode',
        ]
        viteConf.server = viteConf.server || {}
        // Never watched: the server, the development data folder (Chromium keeps its files
        // locked — EBUSY), build output, the frozen reference UI.
        const ignored = [].concat(viteConf.server.watch?.ignored || [])
        viteConf.server.watch = {
          ...(viteConf.server.watch || {}),
          ignored: [ ...ignored, '**/server/**', '**/data/**', '**/dist/**', '**/release/**', '**/preview/**', '**/legacy-gui/**' ]
        }
        // The dev server reads the repo and the sibling kit's UI, consumed from source.
        viteConf.server.fs = { ...(viteConf.server.fs || {}), allow: [ root, kitUi ] }
      },

      // `npm run dev` runs our audio.cpp checkout, not the release (since 2026-10-03; TASKS
      // "`npm run dev` always runs the latest audio.cpp"): before the desktop app starts, build
      // ../audio.cpp into build/jv-dev (only what changed) and name it to the server through
      // JUSTVOICE_AUDIOCPP_BUILD — this process starts Electron, which starts the server, so
      // the variable reaches it. A failed build stops `npm run dev` (decided D1). The module is
      // imported at run time, by path: Quasar bundles this file, which would move its
      // import.meta.url (the checkout it finds is relative to it).
      async beforeDev ({ quasarConf }) {
        if (!quasarConf.ctx.mode.electron) return
        const { CHECKOUT, ENV, prepareAudioCppDevBuild } = await import(pathToFileURL(path.join(root, 'scripts', 'audiocpp-dev.js')).href)
        const bin = prepareAudioCppDevBuild()
        if (bin) process.env[ENV] = bin
        else console.log(`[audio.cpp] no checkout at ${CHECKOUT} — the app runs the pinned speech runtime`)
      },

      // An installer carries audiocpp_dsp, the server's audio math, beside the executable
      // (decided 2026-10-07: shipped with the app, not downloaded): staged into
      // dist/audiocpp-dsp/ from the pinned audio.cpp release — or the local build
      // JUSTVOICE_DSP_EXE names — and copied by `extraFiles` below. Imported by path, as above.
      async beforeBuild ({ quasarConf }) {
        if (!quasarConf.ctx.mode.electron) return
        const { stageDsp } = await import(pathToFileURL(path.join(root, 'scripts', 'audiocpp-dsp-package.js')).href)
        await stageDsp()
      },
    },

    devServer: {
      // The kit's origin-aware resolver knows these ports (installLlmUi devPorts) and the
      // server's CSRF guard allows the first (server/src/models.js).
      host: '127.0.0.1',
      port: 1430,
      strictPort: true,
      hmr: { port: 1431 },
      open: false
    },

    framework: {
      // the family's Quasar settings (the kit's docs/app-structure.md §Q): no Material ripple
      config: { ripple: false },
      plugins: ['Notify']
    },

    animations: [],

    capacitor: {
      hideSplashscreen: true
    },

    electron: {
      // The main process's dependencies (src-electron/package.json) are local packages — the
      // app's server/ and the family kit — named by `file:` paths relative to src-electron/.
      // Quasar copies them unchanged into dist/electron/UnPackaged/package.json, two folders
      // further down, so they're made absolute here. The root's `workspaces` field is copied
      // too and means nothing there.
      extendElectronPackageJson (pkgJson) {
        delete pkgJson.workspaces
        for (const [name, spec] of Object.entries(pkgJson.dependencies || {})) {
          if (typeof spec === 'string' && spec.startsWith('file:')) {
            pkgJson.dependencies[name] = `file:${path.resolve(root, 'src-electron', spec.slice(5))}`
          }
        }
      },

      // …and installed as real copies with their production dependencies only — a `file:` link
      // would bring the linked folder's whole node_modules, development tools included
      unPackagedInstallParams: [ 'install', '--install-links' ],

      preloadScripts: [ 'electron-preload' ],

      inspectPort: 5858,

      // the family packages with electron-builder (installers: NSIS on Windows)
      bundler: 'builder',

      builder: {
        // https://www.electron.build/configuration
        appId: 'dev.justvoice.app',
        productName: 'JustVoice',
        // the updater's feed (https://www.electron.build/publish): app-update.yml in the app and
        // latest*.yml beside the installers, written even under -P never; the release workflow
        // uploads them
        publish: [ { provider: 'github', owner: 'delebash', repo: 'JustVoice' } ],
        files: [
          '**/*',
          '!**/node_modules/better-sqlite3/{deps,src,build/Release/obj,build/Release/obj.target,build/deps}/**',
          '!**/node_modules/better-sqlite3/build/Release/*.{pdb,iobj,ipdb,lib,exp}'
        ],
        // native modules can't load from inside the asar archive; the bundled samples stay
        // outside it, as they did before the move
        asarUnpack: [ '**/*.node', 'node_modules/justvoice-server/samples/**' ],
        // the headless launcher (justvoice-server.cmd) beside the exe
        extraResources: [ { from: path.join(root, 'build', 'launcher'), to: '..' } ],
        // audiocpp_dsp beside the executable (beforeBuild stages it): extraFiles lands in the
        // app's own folder on Windows and Linux, in Contents/ on macOS
        win: { target: 'nsis', executableName: 'justvoice', extraFiles: [ { from: dspStage, to: '.' } ] },
        nsis: {
          // no spaces: GitHub renames a spaced asset on upload (spaces → dots), and latest.yml names
          // electron-builder's dashed form — the updater would download a file that isn't there
          artifactName: '${productName}-Setup-${version}.${ext}',
          oneClick: false,
          perMachine: false,
          allowToChangeInstallationDirectory: true,
          include: path.resolve(root, '../just-llm-runner/server/src/shell/installer.nsh')
        },
        electronFuses: {
          runAsNode: true,
          enableCookieEncryption: true,
          enableNodeOptionsEnvironmentVariable: false,
          enableNodeCliInspectArguments: false,
          enableEmbeddedAsarIntegrityValidation: true,
          onlyLoadAppFromAsar: true,
          grantFileProtocolExtraPrivileges: false
        },
        // macOS: one universal .dmg (Intel and Apple silicon), as the release has shipped
        mac: {
          category: 'public.app-category.music',
          target: [ { target: 'dmg', arch: [ 'universal' ] } ],
          extendInfo: { NSMicrophoneUsageDescription: 'JustVoice records your voice when you clone it.' },
          extraFiles: [ { from: dspStage, to: 'MacOS' } ],
          // already universal (lipo'd when staged), so the same file in both builds is expected
          x64ArchFiles: 'Contents/MacOS/audiocpp_dsp'
        },
        linux: { target: [ 'AppImage', 'deb' ], category: 'AudioVideo', extraFiles: [ { from: dspStage, to: '.' } ] }
      }
    }
  }
})
