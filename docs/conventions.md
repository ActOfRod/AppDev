# App conventions

Shared expectations for apps in this repo. Individual apps may diverge when needed; document why in that app's README.

## Folder rules

- One app per `apps/<name>/` directory
- Keep install, build, and run commands local to that folder
- Do not share runtime dependencies across apps unless there is a clear shared package later

## Steam / controller UX

Apps should assume:

1. Launched from Steam Big Picture on Windows
2. Primary input is a gamepad (Xbox-style layout)
3. Viewing distance is couch / TV, not desk

Prefer:

- Large focusable controls
- Clear focus rings / highlight states
- Simple back-stack navigation (B / Circle = back)
- Fullscreen or borderless windowed by default

Avoid:

- Tiny click targets
- Hover-only interactions
- Dense desktop chrome (title bars, tiny menus)

## Secrets

Never commit Jellyfin URLs with credentials, API keys, or `.env` files. Use `.env.example` templates instead.
