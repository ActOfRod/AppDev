# ValveFin 0.2

Controller-first Jellyfin client for **Windows and Linux/SteamOS**, designed for Steam Big Picture and Game Mode. Visual language follows [ElegantFin](https://github.com/lscambo13/ElegantFin): dark slate, cinematic backdrops and accent-colored focus.

## Features

- Featured carousel; Continue Watching, Next Up, per-library Latest and Favorites. Toggle/reorder home rows.
- Paginated, virtualized libraries and collections with saved sorts/filters and A–Z navigation.
- Controller keyboard, grouped search, recent searches, favorites and watched-state controls.
- Details, seasons, people/filmography, similar titles, chapters, versions, media info, trailers and special features when supplied by the server. Remote trailers open in your browser.
- Capability-aware DirectPlay/remux/transcode, audio/subtitle selection, external text subtitles and bitmap burn-in. Windows HEVC support is probed at runtime and depends on OS/drivers.
- Resume/start over, skip segments, next-episode countdown, trickplay, speed/quality, subtitle styling/delay and playback information. Segments/trickplay require server-generated data.
- Music albums/artists/songs, background playback and queue.
- Manual login, LAN discovery, Quick Connect, multiple saved servers/users and avatars.
- Persistent settings, idle backdrop slideshow, fullscreen/window state and playback sleep inhibition.

## Windows install

Download from [Releases](https://github.com/ActOfRod/AppDev/releases) when available:

- **ValveFin.exe**: portable; keep it in a permanent, writable folder and run it.
- **ValveFin-Setup-0.2.0.exe**: optional NSIS installer.

Unsigned builds can trigger SmartScreen. Verify the source/download before choosing **More info → Run anyway**. Add the portable or installed executable with **Steam → Games → Add a Non-Steam Game**, then launch from Big Picture. Preferences live in your user profile, not beside the executable.

## SteamOS / Steam Deck install

1. Switch to **Desktop Mode** and download **ValveFin-0.2.0-x86_64.AppImage** to a permanent folder, e.g. `~/Applications/`.
2. Dolphin → Properties → Permissions → **Is executable**, or run:
   ```bash
   chmod +x ~/Applications/ValveFin-0.2.0-x86_64.AppImage
   ```
3. Run it once; sign in using the controller keyboard, a physical keyboard or Quick Connect.
4. Steam → **Add a Non-Steam Game → Browse**, select the AppImage (show all files), and name it ValveFin. **Do not force Proton**: this is a native Linux app.
5. Return to **Game Mode** and launch. Game Mode/gamescope forces fullscreen; desktop launches default to fullscreen but respect Settings → Launch fullscreen.

Use Steam Input's **Gamepad** / **Gamepad with Joystick Trackpad** template, not a desktop keyboard/mouse layout. Keep ABXY, D-pad, left stick, bumpers, Start and Select mapped to standard gamepad controls. Press A once after launch if the browser has not exposed the controller yet. If you get double inputs, remove custom keyboard bindings or duplicate remappers. No special Chromium Gamepad API flags are required.

The AppImage stores data under your home directory (`~/.config/valvefin` by default) and needs neither root access nor a writable system partition. A Linux launcher passes the sandbox flag before Chromium starts **only for AppImage launches** to avoid SteamOS setuid/user-namespace restrictions; context isolation and disabled renderer Node integration remain enabled. Normal tar.gz launches keep Chromium's sandbox. Install only trusted builds and connect only to trusted servers.

Without FUSE, set the Steam shortcut's launch options to:

```text
--appimage-extract-and-run
```

Or run `./ValveFin-0.2.0-x86_64.AppImage --appimage-extract-and-run` in Desktop Mode. No `sudo`, chrome-sandbox permission changes or read-only-root changes are needed.

The alternative **ValveFin-0.2.0-x64.tar.gz** contains an unpacked native app. Extract into a writable folder and run `ValveFin`. It uses Chromium's normal Linux sandbox; prefer the AppImage on SteamOS rather than modifying sandbox permissions.

Linux VA-API decode is enabled where Electron/Mesa/drivers support it; unsupported codecs fall back to software decoding or Jellyfin transcoding. Hardware decode and physical-controller behavior should be checked on the target device.

## Controller map

| Input | Browsing / login | Player |
|---|---|---|
| D-pad / left stick | Move focus, navigate keyboard | Move OSD/menu focus; left/right adjust focused sliders; seek ±10s with controls hidden |
| A / South | Select, activate key/action | Activate focused control/prompt; otherwise play/pause |
| B / East | Back, dismiss keyboard/context menu | Cancel Up Next; close menu; hide controls; then leave player |
| X / West | Card context menu | Subtitle menu |
| Y / North | Toggle fullscreen | Toggle fullscreen |
| LB / RB | — | Seek −/+30s |
| Start / Menu | Focus navigation (dismiss modal/screensaver first) | Play/pause |
| Select / View | — | Playback information |

Audio tracks, quality, speed and subtitle settings are reachable through focused OSD buttons. Keyboard arrows/Enter navigate; Escape/Backspace go back; F11 toggles fullscreen. Player shortcuts: Space/K play/pause, A audio, C subtitles, `[`/`]` seek −/+30s. Physical typing works in search and controller-keyboard dialogs.

## Develop and build

Use **Node.js 22+** and npm. From the repository root:

```bash
cd apps/jellyfin
npm ci
npm run dev
npm run build
npm run pack:linux   # Linux x64: AppImage + tar.gz
npm run pack:win     # Windows x64: portable + NSIS
```

Build on the matching OS where possible. Windows cross-builds on Linux need Wine; electron-builder downloads packaging tools. Outputs are in `apps/jellyfin/release/`. `public/icon.png` (512×512) and `public/icon.ico` are the packaged/window icons; regenerate with `python scripts/generate-icons.py` (requires Pillow). Linux packages include a generated `.desktop` entry.

The [Build ValveFin workflow](../../.github/workflows/build-jellyfin-windows.yml) builds on `windows-latest` and `ubuntu-latest` for relevant PRs, main pushes and manual dispatch. Download `valvefin-windows` / `valvefin-linux` workflow artifacts for untagged builds.

Maintainers can publish all four packages by pushing **`valvefin-v0.2.0`** after checking the matching package version. Tag builds validate the version and create a GitHub Release only after both platforms succeed. Builds are unsigned; there is no automatic updater.

Integration scripts in `scripts/check-phase*.mjs` expect the local test Jellyfin at port 8096 and, for browser/Electron checks, the debugging endpoints specified in each script. Run API checks with `node --experimental-strip-types scripts/check-phase3.mjs`. They mutate/restore test-user state; do not point them at production.

With the local `devin` test account and a desktop display running, `node scripts/check-phase4-appimage.mjs` launches the packaged AppImage twice using extraction mode, tests UI login and simulated controller navigation, and checks Game Mode fullscreen. It uses a separate profile/log directory at `~/.local/share/valvefin-phase4-smoke` and saves `~/shots/phase4/appimage.png`. It does not prove physical Steam Input or hardware decode support.

Session tokens (not passwords) are stored in your local user profile. Forget saved profiles from the account picker on shared machines. LAN discovery requires UDP 7359; manual URL entry works across subnets or when broadcast is blocked.
