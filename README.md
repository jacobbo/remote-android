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
- Admin can pair, **rename** (inline-edit on the device detail view; defaults to `Build.MODEL` from the agent), **revoke trust**, and **remove** a device entirely from the device detail view; revoke pushes a `Revoked` signal to the agent which unpairs and stops itself; remove also wipes the device row + its session history
- Offline devices stay clickable on the dashboard so an admin can drill in and delete stale entries — Connect is still gated by online status
- Admin pairs a phone via a QR code rendered in the web UI (`rdpair://host:port/pair?token=<uuid>`); the agent app scans with CameraX + ML Kit, calls `/api/agent/pair`, and the admin's QR card auto-advances on the `PairingCompleted` SignalR event
- TURN ephemeral credentials minted server-side (HMAC-SHA1 over coturn's static-auth-secret) and shipped over the SignalR control plane: the browser receives them inside the `WatchDevice` response, the agent receives them as the `StartCapture` payload — both feed straight into their `RTCPeerConnection`/`PeerConnection` config
- Frontend nginx auto-switches to TLS termination on port 443 when a Cloudflare Origin Certificate is dropped into [certs/](certs/) — `origin.pem` + `origin-key.pem`. With no certs the container stays on plain HTTP/80 (dev mode). Behind Cloudflare's Full (Strict) mode, the edge speaks HTTPS to this origin.
- Agent holds a `PARTIAL_WAKE_LOCK` for the foreground service's whole lifetime (not just during viewer sessions) so Android's App Standby + Doze can't suspend the SignalR socket. First launch after pairing prompts the user to whitelist the app from battery optimization — without that, Pixel/Samsung devices kill the network within ~5 minutes of screen-off.

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

## Run with Docker (dev / LAN)

```bash
cp .env.example .env
docker compose up --build
```

- Frontend: <http://localhost:3000>
- Backend API: <http://localhost:5000>
- Postgres: `localhost:5432`

The default `docker compose up` only starts `db`, `backend`, and `frontend` — fine for LAN-only dev. Pair a phone on the same WiFi by setting `PAIRING_BASE_URL=http://<your-LAN-ip>:5000` in `.env` and re-running compose; the QR code on the Pair Device page will then point at an address the phone can actually reach.

`coturn` and `cloudflare-ddns` live behind the `prod` Compose profile and require domain + cert + port-forwarding setup — see the next section.

## Deploy to a server (production)

End-to-end recipe for putting the system on a Linux host with a real domain, TLS, and a working TURN relay so remote browsers can reach phones on your home LAN.

### 1. Prerequisites

- A small Linux server reachable on your home LAN (Ubuntu / Debian / similar). 4 GB RAM is comfortable; ~500 MB for the container set at idle.
- Docker + Compose v2: `curl -fsSL https://get.docker.com | sh`.
- A domain on Cloudflare (free plan is fine). Examples below use `remote.example.com` for the web UI and `turn.example.com` for the TURN relay.
- Admin access to your home router (for port-forwarding and to look up your public IP).

### 2. Cloudflare setup

DNS → add two records pointing at your home's public IP:

| Name | Type | Proxy | Why |
|------|------|-------|-----|
| `remote.example.com` | A | **Proxied** (orange cloud) | Cloudflare terminates TLS, hides your home IP, and proxies HTTPS + WebSocket to the origin |
| `turn.example.com`   | A | **DNS-only** (grey cloud) | Cloudflare doesn't proxy UDP. TURN media must reach your IP directly |

SSL/TLS → set mode to **Full (Strict)**.

SSL/TLS → Origin Server → **Create Certificate** (15-year validity, default RSA-2048 is fine). Download the certificate as `origin.pem` and the private key as `origin-key.pem` and drop both into [certs/](certs/) on the server.

Optional but recommended: under Security → WAF, add a rate-limiting rule on `/api/auth/login` (e.g. 10 req/min per IP) and `/api/devices/pair/start` and `/api/agent/pair` (e.g. 30 req/min per IP). The app itself does not rate-limit — bcrypt naturally throttles login attempts and pairing tokens are 122-bit cryptographic UUIDs with a 5-minute TTL, so the edge is the right layer for any throttling you actually want.

### 3. Router port forwarding

Forward the following ports on your home router to the server's LAN IP:

| Port | Protocol | Service | Required |
|------|----------|---------|----------|
| 443 | TCP | HTTPS origin (Cloudflare proxies to this) | Yes |
| 3478 | TCP + UDP | TURN signaling | Yes (for remote WebRTC) |
| 49152–49252 | UDP | TURN relay range (configurable in `turnserver.conf`) | Yes (for remote WebRTC) |

Port 80 is **not** needed — Cloudflare handles HTTP→HTTPS redirect at the edge, and the Origin Certificate eliminates Let's Encrypt HTTP-01 challenges. Postgres (5432) is **never** exposed externally; Docker keeps it on the internal `app-net` bridge only.

### 4. Configure environment

```bash
git clone <this repo>
cd rdp
cp .env.example .env
```

Edit `.env`:

```bash
# Database + auth
DB_PASSWORD=<long random>
JWT_SECRET=<at least 32 random chars>
CORS_ORIGIN=https://remote.example.com

# QR pairing — phone-reachable LAN URL of the backend
PAIRING_BASE_URL=http://<server-LAN-ip>:5000

# TURN — secret must match turnserver.conf's static-auth-secret
TURN_SECRET=<long random, ≥32 chars>
TURN_HOSTNAME=turn.example.com
TURN_PORT=3478
TURN_REALM=remote.example.com
TURN_EXTERNAL_IP=<your home public IP>

# Cloudflare DDNS
CLOUDFLARE_API_TOKEN=<token with Zone:DNS:Edit on the example.com zone>
CLOUDFLARE_DOMAINS=remote.example.com,turn.example.com
# `is(<fqdn>)` is favonia/cloudflare-ddns's per-domain boolean syntax: true
# for the one matched name, false for the rest. Proxies the web UI, leaves
# TURN as DNS-only.
PROXIED=is(remote.example.com)
```

### 5. coturn config

Edit [turnserver.conf](turnserver.conf):

- `static-auth-secret=<TURN_SECRET>` — must match `.env`
- `realm=<TURN_REALM>` — match `.env`
- Uncomment `external-ip=<your-public-IP>` and set it (coturn embeds this in ICE candidates so remote browsers know where to send relay traffic)
- `cert=`/`pkey=` lines are already pointing at the bind-mounted certs from step 2; no edits needed if you use the default paths

The relay range (`min-port=49152`, `max-port=49252`) gives 100 ports — plenty for 10 concurrent streams. Narrow further if your router policy demands it, but keep at least 20 ports.

### 6. First boot

```bash
docker compose --profile prod up -d --build
```

This brings up `db`, `backend`, `frontend` (with TLS auto-enabled because `certs/origin.pem` is present), `turn` (host networking on 3478/5349 + the relay range), and `ddns` (keeps both Cloudflare A records pointed at your current public IP).

Verify:

```bash
docker compose ps                    # all services healthy
docker compose logs -f backend       # "Now listening on: http://[::]:8080"
docker compose logs -f turn          # coturn banner + listening on 3478/5349
docker compose logs -f ddns          # successful update for both records
curl -k https://remote.example.com/healthz       # → {"status":"ok"}
```

### 7. Sign in and rotate the demo password

The seed creates `admin / admin` on first boot (plus two demo `user1` / `user2` accounts) and **no devices** — the dashboard starts empty. Sign in to `https://remote.example.com` and immediately change the admin password via the user menu → Change Password. Delete the `user1` / `user2` accounts (User Management → Delete) unless you actually want them.

### 8. Pair phones

Phones must be on the **same LAN** as the server during pairing — the QR code points at `http://<server-LAN-ip>:5000` (i.e. `PAIRING_BASE_URL`). After pairing, the agent maintains an outbound SignalR connection over the LAN; remote browsers reach the phone's video stream via direct WebRTC, falling back to the TURN relay you just configured when NAT prevents a direct path.

See [android/README.md](android/README.md) for installing the agent APK and the in-app QR-scan flow.

### 9. Verifying the TURN relay actually works

Go to <https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/> and add `turn:turn.example.com:3478` with a username/credential pair you can grab out of the WatchDevice SignalR response (browser devtools → Network → WS frames). The page should show a `relay` candidate within ~2 seconds. No `relay` candidate means coturn isn't reachable — check port forwarding, `external-ip`, and that `TURN_SECRET` in `.env` matches `static-auth-secret` in `turnserver.conf`.

### Troubleshooting

- **QR pairing fails with `name not resolved`** — `PAIRING_BASE_URL` is unset or pointing at a name the phone can't resolve. Set it to the backend's LAN IP (`http://192.168.x.y:5000`).
- **Browser session connects but the video stays black** — ICE never selected a path. Check coturn logs for auth rejections (`401` = secret mismatch); confirm `turn.example.com` is **DNS-only** in Cloudflare (proxied records can't carry UDP).
- **Cloudflare shows a 526 / 502 to the SPA** — Origin Certificate isn't being served by nginx. `docker compose logs frontend` should print `[nginx] TLS certs detected — serving HTTPS on 443`. If it says "No TLS certs", the bind mount didn't pick up the files; verify they're at `./certs/origin.pem` + `./certs/origin-key.pem` and that nothing else (e.g. selinux) is blocking the mount.
- **`PAIRING_BASE_URL` was set after pairing** — already-paired phones cached the old URL in EncryptedSharedPreferences. Tap **Unpair** in the agent app and scan a fresh QR.

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

Admins can pair, rename, revoke, force-disconnect viewers, and remove devices entirely; regular users can connect to any device and end their own session. The seed inserts only these three accounts — no demo devices, the dashboard starts empty.
