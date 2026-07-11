# ValveFin

Windows desktop Jellyfin client for Steam Big Picture. Sign in with keyboard/mouse, then browse with a controller.

Ships as **`ValveFin.exe`** so it looks clean when added as a non-Steam game.

Visual language follows [ElegantFin](https://github.com/lscambo13/ElegantFin) (dark slate + indigo accents).

## Features (v0.1)

- Electron desktop app packaged as `ValveFin.exe`
- Sign in to your Jellyfin server (URL + username/password)
- Home: libraries, continue watching, recently added
- Library browse with poster grid
- In-app title details (seasons / episodes for shows)
- In-app video playback with ElegantFin-style OSD (subtitles, Ends at, scrubber)
- Gamepad spatial navigation after login
- Playback progress reported back to Jellyfin for Continue Watching

## Develop

```bash
cd apps/jellyfin
npm install
npm run dev
```

## Build a Windows app for Steam

### GitHub Actions (recommended)

The workflow [Build Jellyfin Windows](../../.github/workflows/build-jellyfin-windows.yml) builds Windows packages on `windows-latest`.

- Runs on pushes/PRs that touch `apps/jellyfin/`
- Can also be started manually via **Actions → Build Jellyfin Windows → Run workflow**
- Download the `valvefin-windows` artifact from the finished run
- Point Steam at **`ValveFin.exe`** (portable build)

### Local build

On a Windows machine:

```bash
cd apps/jellyfin
npm install
npm run pack:win
```

Artifacts land in `apps/jellyfin/release/`:

- `ValveFin.exe` — portable build, easiest to add in Steam
- `ValveFin-Setup-<version>.exe` — optional NSIS installer

### Add to Steam Big Picture

1. Steam → Games → Add a Non-Steam Game
2. Browse to `ValveFin.exe`
3. In properties, enable Steam Input if you want Steam to manage the pad
4. Launch from Big Picture (Y toggles fullscreen)

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
