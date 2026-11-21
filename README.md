# appdev

Desktop apps built for a Steam Big Picture / living-room PC setup.

Each app lives in its own folder under `apps/`. Apps are meant to be launched from Steam (as non-Steam games or shortcuts) and navigated primarily with a game controller.

## Layout

```
apps/
  jellyfin/     # ValveFin — Windows + Linux/SteamOS Jellyfin client (ElegantFin-inspired)
```

## Goals

- Controller-first UI (D-pad / stick focus, large hit targets, Big Picture friendly)
- One folder per app so projects stay independent
- Easy to add as a Steam shortcut on Windows or SteamOS/Linux

## Apps

| App | Path | Status |
|-----|------|--------|
| ValveFin | [`apps/jellyfin`](apps/jellyfin) | v0.2 — Windows portable/NSIS, Linux AppImage/tar.gz |

## ValveFin

Cinematic browsing, paginated libraries/collections, controller search, favorites/watched state, capability-aware playback, subtitles, skip segments, next-episode autoplay, trickplay, background music and saved profiles/Quick Connect. See the [full features and requirements](apps/jellyfin/README.md).

- **Windows:** download `ValveFin-Setup-0.2.3.exe` (recommended for Steam) or portable `ValveFin.exe` from [Releases](https://github.com/ActOfRod/AppDev/releases) when available. Add the installed executable as a non-Steam game; the portable launcher extracts and runs a temporary child process that Steam may not hook. Builds are unsigned.
- **SteamOS:** Desktop Mode → download `ValveFin-0.2.3-x86_64.AppImage` → Properties → executable (or `chmod +x`) → Add to Steam as a non-Steam game → launch in Game Mode. Use a Steam Input **Gamepad** template, not keyboard/mouse; do not force Proton. Without FUSE, add `--appimage-extract-and-run` to launch options. No writable system partition or setuid sandbox setup is needed.
- **Controller:** D-pad/stick move; A selects; B backs out; X card actions (subtitles in player); Y fullscreen; Start navigation (play/pause in player); Select player info; LB/RB seek ±30s. See the [complete map](apps/jellyfin/README.md#controller-map).
- **Build:** Node 22+, `cd apps/jellyfin`, `npm ci`, then `npm run dev`, `npm run pack:win` or `npm run pack:linux`. Outputs are in `apps/jellyfin/release/`; build on the matching OS, or install Wine for Windows cross-builds.

The [Build ValveFin workflow](.github/workflows/build-jellyfin-windows.yml) builds Windows/Linux PR and main artifacts. Maintainer tags `valvefin-v*` publish a GitHub Release with all four packages after successful builds. A normal branch push creates no release.

## Adding a new app

1. Create `apps/<app-name>/`
2. Add a short `README.md` in that folder describing purpose and how to run it
3. Keep dependencies and build tooling scoped to that app folder
