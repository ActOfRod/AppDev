# Jellyfin Living Room

Windows desktop Jellyfin client for Steam Big Picture. Sign in with keyboard/mouse, then browse with a controller.

Visual language follows [ElegantFin](https://github.com/lscambo13/ElegantFin) (dark slate + indigo accents).

## Features (v0.1)

- Electron desktop app (add the `.exe` as a non-Steam game)
- Sign in to your Jellyfin server (URL + username/password)
- Home: libraries, continue watching, recently added
- Library browse with poster grid
- Gamepad spatial navigation after login (D-pad / stick, A select, B back)
- Opens titles in the Jellyfin web client for playback (native player comes next)

## Develop

```bash
cd apps/jellyfin
npm install
npm run dev
```

## Build a Windows app for Steam

On a Windows machine (or CI with Windows targets):

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
| A (South) | Select |
| B (East) | Back |
| Keyboard arrows | Move focus (fallback) |
| Esc / Backspace | Back |

Login fields stay mouse/keyboard oriented on purpose.

## Notes

- Session token is stored locally in Electron's renderer `localStorage`
- Server URL is remembered between launches
- No credentials are committed to the repo
