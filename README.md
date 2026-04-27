# Remote Desktop

Self-hosted system that lets you remotely view and control up to 10 Android phones from a browser. Any small Linux/Windows host runs the backend, brokers SignalR control, and relays WebRTC signaling — it does **not** transcode video. The phone encodes H.264 in hardware via `MediaProjection` + `ScreenCapturerAndroid` and ships the track straight to the browser's `<video>` element.

See [remote-desktop-plan.md](remote-desktop-plan.md) for the full architecture.

## Status

**Phases 1–6 complete (Phase 6: TLS termination shipped; deployment-side bits — Cloudflare records, WAF/rate-limiting at the edge, port-forwarding — still require a real domain).** End-to-end working:

- Browser logs in, picks a device from the dashboard, hits **Connect**
- Backend tells the agent to start capturing; phone surfaces a one-time `MediaProjection` consent dialog (per agent process) and acquires a screen wake lock
- WebRTC handshake (phone-initiated offer, browser answer, ICE) flows through `/hubs/agent` ↔ `/hubs/control`
- Live H.264 video plays in the browser, capped at 1.5 Mbps per stream
- Mouse drag → swipe, mouse click → tap, navigation buttons → `KEYCODE_*` global actions, all dispatched on the phone via an `AccessibilityService`
- Per-device live metrics (fps / bitrate / latency / dropped) reported by the agent via WebRTC `getStats()`, aggregated by `ObservabilityService`, and pushed to viewers via `MetricsUpdated`
- Admin can rotate or revoke a device's trust key from the device detail view; revoke pushes a `Revoked` signal to the agent which unpairs and stops itself
- Admin pairs a phone via a QR code rendered in the web UI (`rdpair://host:port/pair?token=<uuid>`); the agent app scans with CameraX + ML Kit, calls `/api/agent/pair`, and the admin's QR card auto-advances on the `PairingCompleted` SignalR event
- TURN ephemeral credentials minted server-side (HMAC-SHA1 over coturn's static-auth-secret) and shipped over the SignalR control plane: the browser receives them inside the `WatchDevice` response, the agent receives them as the `StartCapture` payload — both feed straight into their `RTCPeerConnection`/`PeerConnection` config
- Frontend nginx auto-switches to TLS termination on port 443 when a Cloudflare Origin Certificate is dropped into [certs/](certs/) — `origin.pem` + `origin-key.pem`. With no certs the container stays on plain HTTP/80 (dev mode). Behind Cloudflare's Full (Strict) mode, the edge speaks HTTPS to this origin.

## Layout

```
.
├── docker-compose.yml
├── .env.example
├── backend/                  # ASP.NET Core 10 + SignalR + EF Core (Postgres)
│   ├── Dockerfile
│   └── RemoteDesktop/
├── frontend/                 # Vite + React + TypeScript
│   ├── Dockerfile
│   ├── nginx.conf
│   └── src/
└── android/                  # Kotlin + stream-webrtc-android
    └── app/
```

## How the pieces fit together

- **Backend** (`/hubs/control` for browsers, `/hubs/agent` for devices)
  - `WebRtcSignalingService` (singleton) tracks `viewerOf(deviceId)` ↔ `agentOf(deviceId)` so each hub can forward SDP/ICE messages to the other side via `IHubContext<TOtherHub>`
  - `InputRelayService` per-device bounded channel (DropOldest @ 64); `AgentHub` runs a background drain loop per connection that forwards events to the agent over SignalR
  - JWT auth for both browsers (user role) and agents (device role); pairing tokens are issued by admins via `/api/devices/pair/start` (rendered as a QR code in the web UI) and consumed by the phone via `/api/agent/pair`
- **Frontend** — single-page React app. The `RemoteView` component owns one `RTCPeerConnection`, registers WebRTC handlers on the SignalR hub, paints the inbound track into a `<video>` element, and translates click/drag/wheel/key events into `tap` / `swipe` / `scroll` / `key` `InputEvent` payloads (mapped from overlay coordinates into the phone's native pixel space).
- **Android agent** — foreground service that holds the SignalR connection forever, plus a long-lived `WebRtcCaptureSession` that keeps the `MediaProjection` warm between viewer sessions (so the consent dialog only appears once per agent process). Each viewer connect attaches a fresh `PeerConnection` to the live video track. See [android/README.md](android/README.md) for the full component map.

## Run with Docker

```bash
cp .env.example .env
docker compose up --build
```

- Frontend: <http://localhost:3000>
- Backend API: <http://localhost:5000>
- Postgres: `localhost:5432`

The default `docker compose up` only starts `db`, `backend`, and `frontend` — fine for LAN-only dev. `coturn` and `cloudflare-ddns` live behind the `prod` Compose profile:

```bash
docker compose --profile prod up -d
```

Before enabling the `prod` profile, fill in `TURN_SECRET` / `TURN_HOSTNAME` / `TURN_REALM` / `TURN_EXTERNAL_IP` and the `CLOUDFLARE_*` vars in `.env`, then edit [turnserver.conf](turnserver.conf) so its `static-auth-secret` matches `TURN_SECRET` and `realm` matches `TURN_REALM`. Forward TCP/UDP 3478 + UDP 49152–49252 on your router to the host. See the [Network & Connectivity](remote-desktop-plan.md#network--connectivity) section of the plan for the full deployment story.

For HTTPS, drop the Cloudflare Origin Certificate into [certs/](certs/) as `origin.pem` + `origin-key.pem` (see [certs/README.md](certs/README.md)) and forward TCP 443 on your router to the host. The frontend container's startup script detects the cert files and switches nginx to the TLS config automatically — no separate prod compose override needed.

## Local dev (no Docker)

Backend:

```bash
cd backend/RemoteDesktop
dotnet run
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` and `/hubs` to `http://localhost:5000` (configured in [frontend/vite.config.ts](frontend/vite.config.ts)).

Android agent — see [android/README.md](android/README.md) for SDK setup and pairing.

## Demo accounts

| Username | Password | Role  |
|----------|----------|-------|
| admin    | admin    | admin |
| user1    | user1    | user  |
| user2    | user2    | user  |

Admins can pair devices and force-disconnect viewers; regular users can connect to any device and end their own session.
