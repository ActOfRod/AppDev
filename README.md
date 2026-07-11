# appdev

Desktop apps built for a Steam Big Picture / living-room PC setup.

Each app lives in its own folder under `apps/`. Apps are meant to be launched from Steam (as non-Steam games or shortcuts) and navigated primarily with a game controller.

## Layout

```
apps/
  jellyfin/     # Windows Electron Jellyfin client (ElegantFin-inspired)
```

## Goals

- Controller-first UI (D-pad / stick focus, large hit targets, Big Picture friendly)
- One folder per app so projects stay independent
- Easy to add as a Steam shortcut on a Windows PC

## Apps

| App | Path | Status |
|-----|------|--------|
| Jellyfin Living Room | [`apps/jellyfin`](apps/jellyfin) | Electron MVP — sign-in, browse, controller nav |

## Adding a new app

1. Create `apps/<app-name>/`
2. Add a short `README.md` in that folder describing purpose and how to run it
3. Keep dependencies and build tooling scoped to that app folder
