# Sync — your projects on every computer

JustVoice keeps your projects on each of your computers, and sync carries your changes between
them. Every computer works with no network at all — sync catches it up the next time it can reach
another one. You'll find it in **Settings → Sync**.

**What syncs:** your projects — their chapters and script lines, the speakers and who plays them,
the corrections you made to who says what — and your personas and lexicons (their words and
pronunciations).

**What stays on each computer:** the audio — rendered takes, generations, exports and dictation
recordings; your voices; persona pictures; settings, AI providers and keys; the downloaded engines
and models. The audio is large and renders again from the script; voices travel by hand (see
*Voices* below).

When two computers change the same thing, the newer change wins, field by field: rename a speaker
on one computer and fix a line's text on the other, and both changes survive.

---

## Pick the way that suits you

| Way | When | What you do |
|---|---|---|
| **Cloud folder** | anywhere; the other computer can be off | On each computer, choose the same folder inside Dropbox, OneDrive or another sync app. |
| **Pairing** | same Wi-Fi, or over Tailscale / ZeroTier | Turn on *Let my other devices connect* on one computer, then pair the other with its code. |
| **By hand** | no network, no accounts | Export a file, carry it over (email, a USB stick, anything), import it on the other computer. |

You can use more than one: a cloud folder for everyday work and a file by hand when you're away
from both.

---

## Your computers

**This device** shows the name your other computers see (it starts as the computer's name — change
it to something like "Studio PC"), and how often JustVoice syncs on its own while it's open (every
5 minutes unless you change it; 0 means only when you press **Sync now**).

The line at the top tells you when this computer last synced, and with which one — for example
*"Synced 2 min ago · from Studio PC"*. **Devices** lists every computer this one has synced with,
and how: by hand, the cloud folder, or the network.

When another computer's changes arrive while JustVoice is open, a notice says *Changes from another
device arrived* — press **Reload** to see them.

---

## A cloud folder

1. On your first computer: **Settings → Sync → Cloud folder → Choose folder…**, and pick a folder
   inside your Dropbox or OneDrive (for example `Dropbox/JustVoice`).
2. Pair your second computer with the first (see *Pairing* below) — that gives it the library's
   key. If the first computer is off, pairing still works: the second one joins with the code and
   the folder carries the changes.
3. On the second computer, choose the same folder.

Each computer writes only its own files into the folder, and they're encrypted with your library's
key, so the folder's contents are unreadable to anyone without it. Dropbox or OneDrive moves the
files; JustVoice reads them shortly after it starts, every few minutes while it's open, and when
you press **Sync now**.

Your live database never goes into the cloud folder — only these change files do, which is why two
computers can't corrupt each other through it.

If the folder you choose already holds another library, JustVoice tells you which computers it
comes from: pair with a code from one of them first, so your projects join that library instead of
starting a second one beside it.

---

## Pairing

On the computer that has your projects:

1. **Settings → Sync → Other devices**: turn on **Let my other devices connect**. JustVoice then
   accepts connections from your other computers — restart it once for this to take effect, and
   allow it through Windows Firewall when Windows asks.
2. Press **Show pairing code**. You get a QR code and the same code as text.

On the other computer: **Settings → Sync → Pair with a code**, paste the code, press **Pair**. The
two sync at once, and again every few minutes while both are open.

The code carries your library's key and a password for this computer — share it only with your own
computers.

### Over the internet: Tailscale or ZeroTier

Pairing works across the same Wi-Fi out of the box. To pair a computer that's somewhere else,
install **[Tailscale](https://tailscale.com)** or **[ZeroTier](https://www.zerotier.com)** on both
and sign in to the same account. They give each computer a private address that works from
anywhere; JustVoice's pairing code includes that address when one is present. Nothing else to set
up.

### Without Dropbox or OneDrive: Syncthing

**[Syncthing](https://syncthing.net)** keeps a folder the same on several computers with no cloud
account at all. Point it at a folder, then choose that folder as JustVoice's cloud folder on each
computer.

---

## By hand

1. **Settings → Sync → By hand**. The projects that changed since your last export are already
   ticked.
2. Optional: tick **Encrypt the file with this library's key** if the file will travel somewhere
   you don't trust.
3. **Export…** saves a `.jvsync` file. Send it any way you like.
4. On the other computer: **Import…** and pick the file. It merges — importing the same file twice,
   or an older one, changes nothing that's newer.

A project's file holds the whole project: its chapters and lines, its speakers and corrections,
the personas that play it, the lexicons it and they use — and what you deleted from them, so a
deleted line goes on the other computer too. (When one of those personas reads with another
project's lexicon, that project comes along as an empty name, so the lexicon has somewhere to
belong; its chapters don't.)

If the file comes from a computer that hasn't synced with this one before, JustVoice asks whether
to join that computer's library. Say yes, and your projects on both become one library from then
on.

---

## Voices

Voices don't sync — a cloned voice is a recording, and every voice belongs to an engine this
computer may not have installed. A persona arrives with the voice it speaks in; when that voice
isn't on this computer yet, carry it over by hand: on the first computer, **Voices → ⤓ Export…**;
on this one, **⤒ Import voice…** ([Voices](voices.md)). The imported voice keeps its identity, so
the persona finds it straight away. The built-in voices come with their engine and need nothing.

---

## Good to know

- **A factory reset** starts a new library on this computer — pair your other computers with it
  again.
- **Restoring a backup** counts as an edit on this computer: the restored projects sync to your
  other computers like any other change.
- **Sync isn't a backup.** A deleted chapter is deleted everywhere. Keep using
  [Backups](backups-and-data.md).
- Sync needs JustVoice open on the computers taking part; the cloud folder lets them take turns.
