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

export default defineConfig(() => {
  return {
    // The renderer's start-up (the old src/main.js), awaited before Quasar mounts the app.
    boot: ['jv'],

    // The app's stylesheets (src/styles/; Quasar resolves these names from src/css/). Here, not
    // imported by the boot file: Quasar puts these in the entry stylesheet, while a boot file's
    // CSS is preloaded with its chunk — and a stylesheet that fails to load (styles.css
    // @imports Google Fonts, which the CSP blocks) would then fail the whole start-up.
    css: [ '../styles/tokens.css', '../styles/styles.css' ],

    // No Quasar icon font or Roboto: JustVoice's look is its own tokens; it uses no Quasar
    // component yet — the family theme and icon set come with the kit's UI on Quasar.
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
        win: { target: 'nsis', executableName: 'justvoice' },
        nsis: {
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
          extendInfo: { NSMicrophoneUsageDescription: 'JustVoice records your voice when you clone it.' }
        },
        linux: { target: [ 'AppImage', 'deb' ], category: 'AudioVideo' }
      }
    }
  }
})
