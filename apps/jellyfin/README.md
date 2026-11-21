# ValveFin 0.3.0

Controller-first media launcher and native Jellyfin client for **Windows and Linux/SteamOS**, designed for Steam Big Picture and Game Mode. Visual language follows [ElegantFin](https://github.com/lscambo13/ElegantFin): dark slate, cinematic backdrops and highly visible white focus borders.

## Media launcher

ValveFin starts with Jellyfin, Netflix, Prime Video, Disney+, Hulu, Max, YouTube (`youtube.com/tv`) and Add custom service. Brand wordmarks are local text, not downloaded logos. Jellyfin opens the existing native client; its Launcher button returns here, including from login. Launcher settings show/hide/reorder tiles, edit/remove custom services, and choose **Start in: Launcher** (default) or **Jellyfin directly**. Custom services require a name and an HTTP(S) URL; embedded credentials and non-web URLs are rejected.

Web services run in sandboxed, isolated `WebContentsView`s using desktop Chrome user agents, with one persistent login partition per service (`persist:svc-<id>`). Logins survive closing a service and restarting ValveFin. Camera, microphone, geolocation and device access are denied. Web popups navigate the same service view; non-HTTP(S) navigation is blocked. HTML fullscreen stays inside the ValveFin window. Sign out / clear service data clears only the selected service, not Jellyfin or other services.

| Service controls | Action |
| --- | --- |
| A | Click virtual cursor; otherwise Enter on the focused element / click at the mouse position |
| B | Escape HTML fullscreen, otherwise history Back; at the start page return to Launcher |
| D-pad | Arrow keys |
| Left stick | Accelerating virtual cursor |
| Right stick / LT / RT | Scroll |
| X | Space (play/pause on compatible players) |
| Y | ValveFin on-screen keyboard; Done inserts text into the service's focused field |
| Start / hold B for ~1 second | ValveFin overlay menu |
| Keyboard F10 | Overlay menu (normal keyboard/mouse and Steam trackpad input remain available) |

The controller-navigable overlay is a separate trusted view above the website: Continue, Home/Launcher, Back, Forward, Reload, Zoom ±, Toggle cursor, OSK, confirmed Sign out/clear data and Exit ValveFin. Service sites still control their own navigation and player shortcuts; account, region and subscription requirements apply. **Netflix on Linux is typically limited to approximately 720p**; do not expect Windows-level resolutions or universal service support. Widevine availability does not override service policies.

The Castlabs ECS runtime prepares Widevine before loading services, with a Preparing DRM state and retryable errors. First-time Linux CDM installation can need a restart. See [ECS runtime / EVS signing](ECS.md) for the real EME/demo probe and CI secrets **`EVS_ACCOUNT_NAME` / `EVS_PASSWORD`**. Missing secrets warn and skip Windows VMP signing; services can reject unsigned builds. The afterPack preflight pairs with afterSign VMP finalization so subsequent executable editing / Authenticode signing cannot invalidate VMP.

Launcher/unit checks: `node scripts/check-launcher.mjs`, `node scripts/check-services-unit.mjs`. `node scripts/check-launcher-browser.mjs` uses a Vite server on port 5173 and a disposable browser debug page on port 29229 for settings, custom services and DRM error/retry UI. After `npm run build`, `node scripts/check-services.mjs` launches an isolated Linux desktop profile, local HTTP fixture and real service views, exercising controller input through isolated-preload gamepad simulation. It requires a display, `dbus-run-session` and ImageMagick `import`; screenshots go to `~/shots/0.3.0/`. No commercial login is required. Remove only deletes a custom tile; sign out / clear its service data first if you also want its saved login removed.

## Features

- Featured carousel; Continue Watching, Next Up, per-library Latest and Favorites. Toggle/reorder home rows.
- Paginated, virtualized libraries and collections with saved sorts/filters and A–Z navigation.
- Controller keyboard, grouped search, recent searches, favorites and watched-state controls.
- Details, seasons, people/filmography, similar titles, chapters, versions, media info, trailers and special features when supplied by the server. Remote trailers open in your browser.
- Capability-aware DirectPlay/remux/transcode, audio/subtitle selection, external text subtitles and bitmap burn-in. Windows HEVC support is probed at runtime and depends on OS/drivers.
- Resume/start over, skip segments, next-episode countdown, trickplay, speed/quality, subtitle styling/delay and playback information. Segments/trickplay require server-generated data.
- Music albums/artists/songs, background playback and queue.
- Dedicated Live TV: Programs, virtualized Guide, Channels, Recordings, Schedule and Series; recording/series timers, live channel switching and an optional Home On Now row.
- Manual login, LAN discovery, Quick Connect, multiple saved servers/users and avatars.
- Persistent settings, idle backdrop slideshow, fullscreen/window state and playback sleep inhibition.

## Live TV

Open your Live TV library. LB/RB switch tabs; in the Guide, D-pad/stick moves across programs/channels and scrolls the time axis. Up from the first channel reaches the day picker. A plays an airing program/channel or opens future-program recording controls. B closes details before leaving Live TV. Schedule and Series let you cancel recordings.

During live playback, LB/RB change channels; D-pad Up/Down also changes channels when the OSD is hidden. Hidden A/Enter immediately toggles play/pause and reveals controls; visible A/Enter activates the focused control. Other input reveals the OSD first; Start toggles pause, B reveals/exits and Y toggles fullscreen. The OSD shows current/next programs and broadcast progress, not an unsupported VOD seek range. Home On Now can be disabled in Settings.

The local development fixture requires Docker Jellyfin at `127.0.0.1:8096`, the existing `devin` test account, ffmpeg and Docker bridge networking. Run `node --experimental-strip-types scripts/setup-livetv.mjs` and leave it running. It serves four looping HLS channels, logos, an M3U and XMLTV with series/movie/sports/kids/news and NEW flags for at least the next two days, on the private Docker bridge only. Ctrl+C stops the fixture processes. Files stay in `/home/ubuntu/jellyfin-test/livetv`.

With the fixture running, use `node --experimental-strip-types scripts/check-livetv.mjs` for real API/DVR/HLS checks. The browser check, `node --experimental-strip-types scripts/check-livetv-browser.mjs`, expects Vite on 5173 and the existing Chrome CDP on 29229; it exercises virtual-pad navigation, real streaming/DVR and bounded/empty/error states, and writes screenshots to `/home/ubuntu/shots/livetv/`. DVR checks remove timers they create. Recordings are empty unless you have actually recorded content; no recordings are fabricated.

## Windows install

For Steam Big Picture, add the **installed NSIS app executable** to Steam. Windows fullscreen uses a borderless normal-z-order window, not Electron's native fullscreen; other windows can appear above it. Returning from playback only restores renderer focus if ValveFin is already the foreground window. A second launch does not raise an existing background window (select it in Steam or the taskbar instead). No focus-on-blur or always-on-top policy is used.

The portable `ValveFin.exe` is an NSIS launcher: it extracts the app into a temporary directory and waits for a child executable. Steam can attach to the launcher rather than the running app, so prefer the installed version for overlay compatibility. This is a separate caveat, **not an explanation for the reported installed-build overlay issue**. Native Windows/Steam overlay behavior still needs verification on the target machine.

Download from [Releases](https://github.com/ActOfRod/AppDev/releases) when available:

- **ValveFin.exe**: portable; keep it in a permanent, writable folder and run it.
- **ValveFin-Setup-0.3.0.exe**: optional NSIS installer.

Unsigned builds can trigger SmartScreen. Verify the source/download before choosing **More info → Run anyway**. Add the portable or installed executable with **Steam → Games → Add a Non-Steam Game**, then launch from Big Picture. Preferences live in your user profile, not beside the executable.

## SteamOS / Steam Deck install

1. Switch to **Desktop Mode** and download **ValveFin-0.3.0-x86_64.AppImage** to a permanent folder, e.g. `~/Applications/`.
2. Dolphin → Properties → Permissions → **Is executable**, or run:
   ```bash
   chmod +x ~/Applications/ValveFin-0.3.0-x86_64.AppImage
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

Or run `./ValveFin-0.3.0-x86_64.AppImage --appimage-extract-and-run` in Desktop Mode. No `sudo`, chrome-sandbox permission changes or read-only-root changes are needed.

The alternative **ValveFin-0.3.0-x64.tar.gz** contains an unpacked native app. Extract into a writable folder and run `ValveFin`. It uses Chromium's normal Linux sandbox; prefer the AppImage on SteamOS rather than modifying sandbox permissions.

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

Maintainers can publish all four packages by pushing **`valvefin-v0.3.0`** after checking the matching package version. Tag builds validate the version and publish packages plus `SHA256SUMS.txt` only after both platforms succeed. Builds are unsigned unless optional signing credentials are configured. SHA-256 checksums detect corrupt downloads; they are not code signatures.

## Client updates

Settings → Updates checks stable `valvefin-v*` releases from ActOfRod/AppDev. Startup checks default to On and announce available updates without moving focus; they never download or install automatically. Release notes are paged for gamepad use. Downloads show progress and can be cancelled before installation. Offline and GitHub rate-limit errors are shown in Settings.

Installed Windows NSIS builds download the matching Setup executable, verify SHA-256, then start the silent installer and quit. The installer restarts ValveFin. Linux AppImages download beside the current file, verify SHA-256, mark it executable and atomically replace the same path before relaunch, preserving the Steam shortcut. The AppImage and its containing directory must be writable; symlink targets are refused. Portable Windows, Linux tar/unpacked and development builds only open the release page. Releases without a matching checksums asset cannot be installed in-app. Network, filesystem and installer actions run only in the main process through validated IPC.

## 0.3.0

- Added the controller-first launcher, configurable/custom service tiles and a native Jellyfin return path.
- Switched to matching Castlabs Electron 37.10.3+wvcus, verified Widevine and added optional Windows EVS VMP signing.
- Added isolated persistent service views, virtual cursor, scrolling, keyboard and in-window overlay/fullscreen controls. Existing Windows Steam overlay mitigations and AppImage launch behavior are retained.

## 0.2.3

- Hidden player OSD: gamepad A or Enter immediately toggles play/pause and reveals controls, for both VOD and Live TV. Visible A/Enter still activates the focused control.
- Added verified, cancellable desktop updates and optional startup checks. Windows Steam overlay compatibility from 0.2.2 is retained.

Integration scripts in `scripts/check-phase*.mjs` expect the local test Jellyfin at port 8096 and, for browser/Electron checks, the debugging endpoints specified in each script. Run API checks with `node --experimental-strip-types scripts/check-phase3.mjs`. They mutate/restore test-user state; do not point them at production.

With the local `devin` test account and a desktop display running, `node scripts/check-phase4-appimage.mjs` launches the packaged AppImage twice using extraction mode, tests UI login and simulated controller navigation, and checks Game Mode fullscreen. It uses a separate profile/log directory at `~/.local/share/valvefin-phase4-smoke` and saves `~/shots/phase4/appimage.png`. It does not prove physical Steam Input or hardware decode support.

Session tokens (not passwords) are stored in your local user profile. Forget saved profiles from the account picker on shared machines. LAN discovery requires UDP 7359; manual URL entry works across subnets or when broadcast is blocked.

## 0.2.2

- Home episode cards use show artwork and show name, with season/episode and title underneath.
- Continue Watching opens full cinematic details rather than a standalone resume prompt. Details include media selectors carried into playback, cast, credits and external links.
- Caption, audio and fullscreen controls use clear inline SVG artwork without icon-font dependencies.
- Windows uses borderless display bounds rather than native fullscreen. Background screen transitions, fullscreen shortcuts and second launches never reclaim focus. Installed Steam builds remain recommended; native Steam overlay verification is still required.

## 0.2.1

- Bundled ElegantFin-inspired slate gradients, glass surfaces, white controller focus borders, cards, tabs and player OSD. No remote theme stylesheet is loaded. Custom accent preferences are preserved.
- Live TV Programs always orders On Now, Shows, Movies, Sports, Kids and News; program artwork falls back through backdrop and channel images, with channel labels and logos.
- Includes dedicated Live TV browsing, guide, channel switching and DVR timer support, plus live server-subpath, keyboard activation and sleep-blocker fixes.
