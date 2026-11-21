# Castlabs Electron runtime

ValveFin uses `github:castlabs/electron-releases#v37.10.3+wvcus`, matching the previous Electron 37 line. Both the npm dependency and electron-builder download mirror must point to Castlabs: otherwise the packaged application can silently lose Widevine even when development works.

## Linux availability / playback probe

```sh
npm ci
npx electron scripts/probe-widevine.cjs --demo
```

The probe awaits `components.whenReady()`, requests `com.widevine.alpha`, creates MediaKeys, and optionally plays the Bitmovin DRM demo. `PASS WIDEVINE` verifies EME availability; the separate `PASS Bitmovin Widevine video plays with attached MediaKeys` requires actual advancing playback with attached MediaKeys. In a container without a usable sandbox, append `--no-sandbox --disable-gpu`; this is a test-host limitation, not a recommendation to disable the sandbox on desktop installations. The AppImage launcher retains its existing no-sandbox behavior. First-time Linux component installation can require restarting the application.

## Optional Windows EVS signing

Configure GitHub Actions secrets `EVS_ACCOUNT_NAME` and `EVS_PASSWORD` for an existing Castlabs EVS account. Never put them in a checked-in file. Windows CI installs `castlabs-evs==1.3.3` only when both secrets exist. The `afterPack` hook checks credentials and warns when signing is skipped. With credentials, the paired `afterSign` hook invokes:

```sh
python -m castlabs_evs.vmp sign-pkg <unpacked-app-directory>
```

`EVS_PASSWORD` is mapped to the client's `EVS_PASSWD`, and `EVS_NO_ASK=1` prevents interactive prompts. Signing errors fail packaging. The command deliberately runs in the **afterSign** stage, still before NSIS/portable targets: electron-builder edits resources and optionally Authenticode-signs the executable **after afterPack**, which would invalidate an earlier VMP signature. Do not disable `signAndEditExecutable` with EVS enabled. Linux does not require VMP signing. Unsigned Windows builds can be rejected by DRM services even though EME is exposed. EVS is not a substitute for an Authenticode certificate or a streaming-service agreement.

ECS/Widevine availability does not guarantee every commercial service accepts this client. Services control their own browser, account, region, resolution and DRM policies.
