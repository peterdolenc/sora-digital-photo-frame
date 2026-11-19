<div align="center">

<img src=".github/readme/banner.jpg" alt="Sora Frame — turn any screen into a living photo frame" width="100%">

<br>

**A self-hosted digital photo frame that runs in any browser.**<br>
Put an old tablet, laptop or smart TV on the shelf and fill it with your photos.

[Website](https://soraframe.online/) · [Quick start](https://docs-sora-frame.vercel.app/quickstart/) · [Docs](https://docs-sora-frame.vercel.app/) · [API](https://docs-sora-frame.vercel.app/api-reference/introduction)

![Node 18+](https://img.shields.io/badge/node-18%2B-d6336a?style=flat-square)
![Docker](https://img.shields.io/badge/docker-ready-a61e6e?style=flat-square)
![License AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-f6c56b?style=flat-square)

<br>

<img src=".github/readme/slideshow.webp" alt="Sora slideshow cross-fading between photos with the clock and weather widget" width="100%">

</div>

## Quick start

```bash
git clone https://github.com/Sorbh/sora-digital-photo-frame.git
cd sora-digital-photo-frame
npm install   # installs the server and creates server/.env
npm start
```

Set `ADMIN_PASSWORD` in `server/.env`, then open:

| | |
|---|---|
| **Slideshow** | `http://localhost:3000` |
| **Library** (admin) | `http://localhost:3000/admin` |

Prefer Docker? `ADMIN_PASSWORD=yourpassword docker compose up -d` — see [DOCKER.md](DOCKER.md).

## What it does

**🖼 The frame**
- Full-screen slideshow with soft cross-fades and a large clock, date and weather widget.
- Starts straight away, with no sign-in: the server decides which account (set of folders) is playing.
- Pick what plays: everything, or a single folder (nested folders included).
- Shuffle plays a short run of photos in date order (oldest first) from a random spot, then jumps to another spot. `SHUFFLE_PICK_AMOUNT` sets the run length.
- Under the photo it shows the date, place, the photo's own caption (EXIF description or XMP title) and a cleaned-up file name. The info overlay (`I`) shows camera, lens, aperture and ISO.
- Keeps the screen awake, including on iPads and phones.
- Install it to the home screen like an app.

**📁 The library**
- Upload by dropping photos anywhere on the page, or with the Upload button.
- Folders show covers from their own photos; nest them as deep as you like.
- Drag a photo onto a folder, a breadcrumb or the back button to move it.
- Select several photos and delete them in one go; right-click for more options.
- Optional Google Photos import.

**💌 Notes**
- Slip a note into the slideshow: "Ambika is visiting you", with up to four photos.
- It shows every few minutes between two dates, with an optional countdown to the event.
- Pick a memory-book layout, a theme, and which accounts see it.

**🔑 Accounts and control**
- An account is a named set of folders it may show. The server plays one account at a time, and remembers the last one across restarts (the first account on a fresh install).
- Other services, such as Home Assistant, switch the account, skip to the next photo or show the info overlay through a small HTTP API (see [Controlling the frame](#controlling-the-frame)).
- The slideshow, its photos and the control API are open to anyone who can reach the server: run it on a trusted local network only. The library (`/admin`) still needs the admin password.

## A closer look

<table>
  <tr>
    <td width="50%"><img src=".github/readme/library.jpg" alt="Library with folder covers"><br><sub><b>Library</b> — folders with photo covers</sub></td>
    <td width="50%"><img src=".github/readme/folder.jpg" alt="Inside a folder"><br><sub><b>Folders</b> — drop to upload, drag to move</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src=".github/readme/folders.jpg" alt="Choosing what the slideshow plays"><br><sub><b>Now playing</b> — choose a folder for the frame</sub></td>
    <td width="50%"><img src=".github/readme/access.jpg" alt="Access accounts"><br><sub><b>Access</b> — accounts with their own folders</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src=".github/readme/slideshow.jpg" alt="Slideshow controls"><br><sub><b>Slideshow</b> — controls appear on hover</sub></td>
    <td width="50%"><img src=".github/readme/login.jpg" alt="Sign-in page"><br><sub><b>Sign in</b> — admin password</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src=".github/readme/notes.jpg" alt="Notes list"><br><sub><b>Notes</b> — scheduled love notes and reminders</sub></td>
    <td width="50%"><img src=".github/readme/note-frame.jpg" alt="A note on the frame"><br><sub><b>On the frame</b> — a note between photos</sub></td>
  </tr>
</table>

<img src=".github/readme/notes-layouts.jpg" alt="Eight note layouts: cover, quote, remember, stack, collage, spine, gallery and auto" width="100%">

<img src=".github/readme/mobile.jpg" alt="Sora on a phone: library, folder and slideshow" width="100%">

## Controlling the frame

The server pushes commands to the open slideshow over a server-sent event stream (`/api/frame/events`). The commands are plain `GET` requests with no sign-in, so any service on your network can send them:

| Request | What it does |
|---|---|
| `GET /api/control/next` | Show the next photo |
| `GET /api/control/info/10` | Show the info overlay for 10 seconds (default 5, up to 600) |
| `GET /api/control/account/Kitchen` | Play another account, by name or id. URL-encode spaces, e.g. `Living%20room` |
| `GET /api/control/state` | The active account, all accounts and how many frames are connected |

`next` and `info` answer with `frames`, the number of open slideshows that heard the command. An unknown account gives `404` with `ACCOUNT_NOT_FOUND`. The slideshow reconnects by itself if the connection drops.

Home Assistant example:

```yaml
rest_command:
  frame_next:
    url: "http://frame.local:3000/api/control/next"
    method: GET
  frame_account_kids:
    url: "http://frame.local:3000/api/control/account/Kids"
    method: GET
```

An admin session in the same browser profile as the slideshow ignores the account's folder limits, so use a separate browser profile for the frame.

## Keyboard shortcuts

| Key | Slideshow |
|---|---|
| `Space` / `K` | Play or pause |
| `→` / `N` | Next photo |
| `F` | Fullscreen |
| `I` | Camera info (camera, lens, aperture, ISO) |
| `Esc` | Leave fullscreen |

## Configuration

Settings live in `server/.env` (created on first `npm install`).

| Variable | Default | What it does |
|---|---|---|
| `ADMIN_PASSWORD` | made up | Password for the library. Without it (or with the old default `admin123`) the server makes one up, keeps it in `data/admin-password` and prints it at start |
| `SESSION_SECRET` | made up | Signs session cookies. Without it (or with an example value) the server makes one up and keeps it in `data/session-secret` |
| `TRUST_PROXY` | `1` | Which `X-Forwarded-*` headers to believe, for the client address and https. `1` fits one reverse proxy; `false` if nothing sits in front, so nobody can pick their own address |
| `PORT` | `3000` | Port the server listens on |
| `UPLOAD_DIR` | `uploads` | Where photos are stored |
| `DEFAULT_SLIDESHOW_INTERVAL` | `15000` | Time per photo, in ms |
| `MAX_RECENT_IMAGES` | `10` | Shuffle does not start a new run on one of this many recently shown photos |
| `SHUFFLE_PICK_AMOUNT` | `6` | Shuffle plays this many photos in a row, oldest first, from a random spot, then picks another spot |
| `MAX_FILE_SIZE` | `26214400` | Upload limit per photo, in bytes (25 MB). Only the resized copy is stored |
| `ENABLE_GOOGLE_PHOTOS` | `false` | Turn on Google Photos import |
| `PUBLIC_PHOTOS` | — | No longer used: photos, thumbnails, folders and notes are always open to anyone who can reach the server |

Supported formats: JPEG, PNG, WebP, GIF and HEIC (iPhone photos).

## Development

```bash
npm run dev   # server with auto-reload
npm test      # API tests
```

Node.js + Express on the server, plain HTML, CSS and JavaScript in the browser. Photos are plain files in folders — no database.

## Translations

The browser UI supports English, Spanish, French, German, Brazilian Portuguese, Italian, Dutch, Hindi, Japanese, Simplified Chinese and Arabic. English lives in `server/public/locales/en.json` and is the source catalogue. Add a new string there first, then add the same key and placeholders to every locale (a language may add the plural forms it needs, such as `_few` or `_many`, next to `_one`/`_other`). Each frame can have its own language, set from Access or on the frame itself. Mark static HTML with `data-i18n`, attributes with `data-i18n-attr`, and browser-generated text with `i18n.t('area.key')`. Run `cd server && npx jest` to check catalogue keys and placeholders.

## Support

[Report an issue](https://github.com/Sorbh/sora-digital-photo-frame/issues) · [Discussions](https://github.com/Sorbh/sora-digital-photo-frame/discussions)

Licensed under [AGPL-3.0](LICENSE).

<p align="center"><sub>Built with ❤️ by Claude Code — monitored &amp; prompted by Saurabh K. Sharma</sub></p>
