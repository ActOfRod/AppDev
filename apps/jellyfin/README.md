# Jellyfin Living Room

Windows desktop Jellyfin client for Steam Big Picture. Sign in with keyboard/mouse, then browse with a controller.

Visual language follows [ElegantFin](https://github.com/lscambo13/ElegantFin) (dark slate + indigo accents).

## Features (v0.1)

- Electron desktop app (add the `.exe` as a non-Steam game)
- Sign in to your Jellyfin server (URL + username/password)
- Home: libraries, continue watching, recently added
- Library browse with poster grid
- In-app title details (seasons / episodes for shows)
- In-app video playback (direct play or Jellyfin transcode / HLS)
- Gamepad spatial navigation after login (D-pad / stick, A select, B back)
- Playback progress reported back to Jellyfin for Continue Watching

## Develop

```bash
cd apps/jellyfin
npm install
npm run dev
```

## Build a Windows app for Steam

### GitHub Actions (recommended)

The workflow [Build Jellyfin Windows](../../.github/workflows/build-jellyfin-windows.yml) builds portable + NSIS `.exe` files on `windows-latest`.

- Runs on pushes/PRs that touch `apps/jellyfin/`
- Can also be started manually via **Actions → Build Jellyfin Windows → Run workflow**
- Download the `jellyfin-living-room-windows` artifact from the finished run

### Local build

On a Windows machine:

```bash
cd apps/jellyfin
npm install
npm run pack:win
```

Artifacts land in `apps/jellyfin/release/`:

- Portable `.exe` — easiest to point Steam at
- NSIS installer — optional

### Add to Steam Big Picture

1. Steam → Games → Add a Non-Steam Game
2. Browse to the portable or installed `.exe`
3. In properties, enable Steam Input if you want Steam to manage the pad
4. Launch from Big Picture (borderless/fullscreen from the window controls or Alt+Enter)

## Controller map

| Input | Action |
|-------|--------|
| D-pad / left stick | Move focus |
| A (South) | Select / play-pause (in player) |
| B (East) | Back / hide player controls |
| X (West) | Subtitle menu (in player) |
| Y (North) | Toggle fullscreen |
| D-pad left / right | Seek −/+ 10s (in player) |
| LB / RB | Seek −/+ 30s (in player) |
| Keyboard arrows | Move focus (fallback) / seek ±10s in player |
| C | Subtitle menu (in player) |
| F11 | Toggle fullscreen |
| Esc / Backspace | Back |

Login fields stay mouse/keyboard oriented on purpose.

## Notes

- Session token is stored locally in Electron's renderer `localStorage`
- Server URL is remembered between launches
- No credentials are committed to the repo
