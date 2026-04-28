# RemoteDesktop Agent (Android)

Android agent that connects to the backend via SignalR, reports device status, dispatches input events from remote viewers via an AccessibilityService, and streams the screen to viewers as an H.264 WebRTC video track.

When a viewer hits **Connect** in the web UI, the backend pushes `StartCapture` over SignalR. The agent surfaces the system MediaProjection consent dialog, elevates the foreground service to `mediaProjection`, and creates a `PeerConnection` (`stream-webrtc-android`) wired to a `ScreenCapturerAndroid`. SDP offer/answer and ICE candidates flow through the same SignalR hubs (`/hubs/agent` ↔ `/hubs/control`). When the viewer disconnects, the hub pushes `StopCapture` and the session is torn down.

## Requirements

- **Android Studio** Hedgehog (2023.1) or newer, OR
- **Command-line build:** Android SDK with platform 35, Build Tools 35, JDK 17, and a system Gradle 8.10 (used once to bootstrap `gradlew`).
- A physical Android device running Android 10 (API 29) or later. Emulators work for input/control, but `MediaProjection` performance is poor in emulators.

## First-time setup

```bash
# (one-time) generate the Gradle wrapper jar — only needed if you don't
# open the project in Android Studio (which generates it for you).
cd c:/dev/rdp/android
gradle wrapper --gradle-version 8.10.2

# create local.properties pointing at your Android SDK
echo "sdk.dir=C:\\Users\\$env:UserName\\AppData\\Local\\Android\\Sdk" > local.properties
```

## Build

From Android Studio: open `c:/dev/rdp/android` and Run.

From CLI:

```bash
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Pairing a phone

1. **In the web UI**: log in as admin → click "Pair new device". The page renders a QR code that encodes `rdpair://<host>:<port>/pair?token=<uuid>`. The token expires after 5 minutes.
   - The host/port the QR points at comes from the backend's `Pairing__BaseUrl` env var (e.g. `http://192.168.1.10:5000`). Without it the backend falls back to the request `Host` header, which only works when the admin's browser is on the same LAN segment as the server.
2. **On the phone:** open the RemoteDesktop Agent app → tap **Scan QR to pair** → grant camera permission → point the camera at the QR. The agent parses the URI, calls `POST /api/agent/pair` with the token plus auto-detected metadata (`Build.MODEL`, OS version), and on success stores the trust key in `EncryptedSharedPreferences` and starts the foreground service.
3. **Enable input injection:** the app will surface a banner. Tap **Enable input injection** → toggle on the "RemoteDesktop Input Bridge" service in Android Settings → Accessibility.
4. The web UI's QR card switches to a green "Paired" state and auto-advances to the new device's detail page (driven by the `PairingCompleted` SignalR event broadcast from the agent's pair call).

After pairing, the phone reconnects automatically on every boot until you tap **Unpair (forget keys)**.

## What runs where

| Component | File | Role |
|-----------|------|------|
| `AgentService` | `control/AgentService.kt` | Foreground service. Reconnects forever; runs the 30 s status reporter. |
| `SignalRClient` | `control/SignalRClient.kt` | Coroutine wrapper around `com.microsoft.signalr`. |
| `AgentApi` | `control/AgentApi.kt` | OkHttp + kotlinx.serialization REST client for `/api/agent/pair` and `/api/agent/connect`. |
| `PairScannerActivity` | `pair/PairScannerActivity.kt` | CameraX preview + ML Kit barcode scanner. Returns `{ baseUrl, token }` to MainActivity via `setResult`. |
| `PairUri` | `pair/PairUri.kt` | Parser for the `rdpair://host:port/pair?token=...` QR payload. |
| `DeviceIdentity` | `identity/DeviceIdentity.kt` | EncryptedSharedPreferences-backed identity storage. |
| `InputAccessibilityService` | `input/InputAccessibilityService.kt` | The only component that can inject taps/swipes; wired via `InputDispatcher` to the SignalR receive callback. |
| `WebRtcCaptureSession` | `webrtc/WebRtcCaptureSession.kt` | Long-lived `ScreenCapturerAndroid` + `MediaProjection` pipeline. Each viewer attaches/detaches a fresh `PeerConnection` against the live video track — capture stays warm so the consent prompt only appears once per agent process. |
| `MediaProjectionPermissionActivity` | `webrtc/MediaProjectionPermission.kt` | Transparent shim that pops the system consent dialog and feeds the result back to the service via a CompletableDeferred. |
| `ScreenUnlockActivity` | `control/ScreenUnlockActivity.kt` | Transparent shim launched on viewer attach: surfaces over the lock screen, wakes the display, and asks the system to dismiss the keyguard (effective only for swipe-to-unlock devices). |
| `StatusReporter` | `status/StatusReporter.kt` | Battery / wifi-bars / orientation snapshot. |

## Backend hub surface

- `POST /api/agent/pair` — pairing-token-authed (token from the QR); returns `{ deviceId, trustKey, token }`.
- `POST /api/agent/connect` — trustKey-authed; returns a fresh device JWT (60 min).
- `/hubs/agent` — device-side SignalR hub (`role=device`).
  - device → server: `RegisterDevice`, `ReportStatus`, `SendSdpOffer`, `SendIceCandidate`
  - server → device: `ReceiveInput`, `StartCapture(iceServers)` (carries fresh ephemeral TURN/STUN creds, empty array for LAN-only), `StopCapture`, `ReceiveSdpAnswer`, `ReceiveIceCandidate`, `Revoked`

## Phase 6 hand-off notes

- **TURN/STUN** — the backend mints fresh ephemeral creds (HMAC-SHA1 over `<expiry>:<subject>`) and ships them as the payload of every `StartCapture` SignalR push. `AgentService.handleStartCapture(servers)` latches them into `iceServers` and passes the list to `WebRtcCaptureSession.attachPeer(...)`. When the backend's `Turn:*` config is unset, the array is empty and the agent uses host candidates only (LAN-only).
- **Adaptive bitrate** — the WebRTC stack adapts down on congestion automatically and `WebRtcCaptureSession` caps the outbound at 1.5 Mbps via `RtpSender.parameters`. Phase 6 could expose the cap per-device via config.
- **Audio** — capture is video-only. To add audio, you'll need `MediaProjection.createAudioRecord` (API 29+) and an `AudioTrack` on the peer connection.

## Known limitations

- WiFi RSSI may report `null` on Android 12+ unless the user grants location permission. The backend treats this as "unknown" rather than zero.
- Key injection beyond the system navigation set (Home/Back/Recents/Power/Volume) requires `INJECT_INPUT_EVENTS`, a system-level permission. Text typing is not implemented in this phase.
- Force-stop of the app cancels the foreground service. Android's auto-restart will re-bring it up only after the user opens the app again.
- The MediaProjection consent dialog appears once per agent process (on the first viewer connect). The capture pipeline stays warm between viewers, so subsequent connects skip the prompt. The popup will reappear after a device reboot, app force-stop, or if the user revokes via the system "Stop sharing" notification.
- On viewer connect the agent acquires a screen wake lock (so the captured surface keeps receiving fresh frames) and pops a transparent activity that asks the system to dismiss the keyguard. This only works for swipe-to-unlock devices — secured locks (PIN, pattern, password, biometric) can't be bypassed from a non-system app.
