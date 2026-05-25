# Remote Desktop

Self-hosted system that lets you remotely view and control up to 10 Android phones from a browser. Any small Linux/Windows host runs the backend, brokers SignalR control, and relays WebRTC signaling — it does **not** transcode video. The phone encodes H.264 in hardware via `MediaProjection` + `ScreenCapturerAndroid` and ships the track straight to the browser's `<video>` element.

See [remote-desktop-plan.md](remote-desktop-plan.md) for the full architecture.

## Status

**Phases 1–6 complete (Phase 6: TLS termination shipped; deployment-side bits — Cloudflare records and WAF/rate-limiting at the edge — still require a real domain).** End-to-end working:

- Browser logs in, picks a device from the dashboard, hits **Connect**
- Backend tells the agent to start capturing; phone surfaces a one-time `MediaProjection` consent dialog (per agent process) and acquires a screen wake lock
- WebRTC handshake (phone-initiated offer, browser answer, ICE) flows through `/hubs/agent` ↔ `/hubs/control`
- Live H.264 video plays in the browser, capped at 1.5 Mbps per stream
- Mouse drag → swipe, mouse click → tap, navigation buttons → `KEYCODE_*` global actions, all dispatched on the phone via an `AccessibilityService`
- Admin can pair, **rename** (inline-edit on the device detail view; defaults to `Build.MODEL` from the agent), **revoke trust**, and **remove** a device entirely from the device detail view; revoke pushes a `Revoked` signal to the agent which unpairs and stops itself; remove also wipes the device row + its session history
- Offline devices stay clickable on the dashboard so an admin can drill in and delete stale entries — Connect is still gated by online status
- Admin pairs a phone via a QR code rendered in the web UI. The QR uses `rdpair://` (http) or `rdpairs://` (https) — chosen by the backend based on the scheme of `Pairing__BaseUrl` — and the agent's `PairUri` parser maps it back to the corresponding URL. The agent scans with CameraX + ML Kit, calls `/api/agent/pair`, and the admin's QR card auto-advances on the `PairingCompleted` SignalR event
- ICE servers shipped over the SignalR control plane: by default the backend serves Cloudflare's public STUN (`stun:stun.cloudflare.com:3478`) so each peer can discover its reflexive candidate. TURN is **optional** — set `TURN_SECRET` + `TURN_HOSTNAME` to point at a hosted or self-hosted TURN service and the backend will additionally mint ephemeral HMAC-SHA1 credentials per session
- Frontend nginx auto-switches to TLS termination on port 443 when a Cloudflare Origin Certificate is dropped into [certs/](certs/) — `origin.pem` + `origin-key.pem`. With no certs the container stays on plain HTTP/80 (dev mode). Behind Cloudflare's Full (Strict) mode, the edge speaks HTTPS to this origin.
- Agent holds a `PARTIAL_WAKE_LOCK` for the foreground service's whole lifetime (not just during viewer sessions) so Android's App Standby + Doze can't suspend the SignalR socket. First launch after pairing prompts the user to whitelist the app from battery optimization — without that, Pixel/Samsung devices kill the network within ~5 minutes of screen-off.

## Layout

```
.
├── docker-compose.yml
├── .env.example
├── api/                      # ASP.NET Core 10 + SignalR + EF Core (Postgres)
│   ├── Dockerfile
│   └── RemoteDesktop/
├── web/                      # Vite + React + TypeScript
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

## Run with Docker (dev / single-machine)

```bash
cp .env.example .env
docker compose up --build
```

- Web UI: <http://localhost:3000>
- Postgres: not exposed by default (use the LAN override below if you need psql access)

`docker compose up` starts `db`, `api`, and `web`. The api is bound to `127.0.0.1:5000:8080` (loopback) — `curl http://localhost:5000/healthz` works from the host, but it's not reachable from other machines on the LAN. The web service's nginx proxies `/api/` and `/hubs/` to the api over the internal docker network, which is how the SPA reaches it.

## Test on the LAN with a real phone

Before deploying to the VPS, it's worth pairing a real phone against a backend running on your dev machine. The base compose hides the api on loopback for safety; [docker-compose.override.yml](docker-compose.override.yml) opens the relevant ports for LAN reach and is auto-loaded by Docker Compose when you run plain `docker compose up`.

**1. Bring everything up**

```bash
docker compose up -d --build
```

Compose merges the base + override automatically — no flags needed.

**2. Set `.env` to point at your dev machine's LAN IP**

Start from the LAN-testing template:

```bash
cp .env.local.example .env
$EDITOR .env
```

Replace the `<LAN_IP>` placeholder with your dev machine's actual address (`ip addr` on Linux, `ipconfig` on Windows, `ipconfig getifaddr en0` on macOS). The template's other defaults (admin user, dev-only secrets) are fine to keep for LAN testing — they're dev-only and not safe for the VPS.

Restart so the new env is picked up: `docker compose ... up -d`.

**3. Allow cleartext HTTP in the Android agent (LAN-only edit)**

Android blocks cleartext HTTP by default. Edit [android/app/src/main/res/xml/network_security_config.xml](android/app/src/main/res/xml/network_security_config.xml) in your local checkout and add your dev machine's LAN IP:

```xml
<domain includeSubdomains="true">192.168.1.10</domain>
```

Don't commit this — production uses HTTPS via Cloudflare and doesn't need a cleartext exception.

**4. Build the debug APK and install**

```bash
cd android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

**5. Pair and test**

- Phone + dev machine on the same WiFi.
- Open `http://192.168.1.10:3000` in a browser (any machine on the LAN).
- Log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- Devices → Pair Device → scan the QR with the agent app.
- Click Connect. WebRTC will go peer-to-peer over the LAN (host candidates).

This validates the same code paths the VPS will run, minus TLS and the public internet. If it works here, the VPS bring-up is mostly a domain + cert exercise.

For production deployment to a VPS with a real domain and TLS, see the next section.

## Deploy to a VPS (production)

End-to-end recipe for putting the system on a Linux VPS with a real domain, TLS, and STUN-based WebRTC. The phone connects from anywhere — home WiFi, cellular, whatever — and the backend lives on a publicly reachable host instead of your LAN.

Throughout this section the placeholder `nomain.uk` stands in for your apex domain and `89.117.109.152` for your VPS IP — substitute your own.

### Requirements

- A Linux server (Ubuntu 22.04+ / Debian 12+) with at least 2 GB RAM
- Docker Engine 24+ and Docker Compose v2
- A domain name on Cloudflare (free plan is fine — nginx is pre-configured for Cloudflare Origin Certificates)

### 1. Install Docker

```bash
# Run as root or with sudo
curl -fsSL https://get.docker.com | sh
```

### 2. Create a deploy user

Do not run the application as root. Create a dedicated user and grant it Docker access:

```bash
sudo adduser deploy
sudo usermod -aG docker deploy
```

`adduser` prompts for a password — generate a strong one (`openssl rand -base64 24`) and store it in your password manager. You'll use it to ssh in as `deploy` from here on.

Give the user ownership of `/srv/rdp`:

```bash
sudo mkdir -p /srv/rdp
sudo chown deploy:deploy /srv/rdp
```

Install fail2ban — SSH on a public IP gets scanned constantly, and password auth is exactly the threat model fail2ban handles. Defaults are sensible; no tuning needed:

```bash
sudo apt update && sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban
```

Now switch into the deploy user for all remaining steps:

```bash
su - deploy
# verify Docker access:
docker compose version
```

### 3. Cloudflare DNS + Origin Certificate

**DNS** → add one A record:

| Name | Type | Value | Proxy |
|------|------|-------|-------|
| `nomain.uk` | A | `89.117.109.152` | **Proxied** (orange cloud) |

Optional: `www.nomain.uk` CNAME → `nomain.uk`, also proxied, if you want `www.` to work.

**SSL/TLS** → mode **Full (Strict)**.

**SSL/TLS → Origin Server → Create Certificate**. Include `nomain.uk` and `*.nomain.uk` as SANs. Download as `origin.pem` + `origin-key.pem` — you'll drop these into `certs/` in step 5.

**Optional WAF rules** (Security → WAF):
- `/api/auth/login`: 10 req/min/IP.
- `/api/devices/pair/start` + `/api/agent/pair`: 30 req/min/IP.

The app doesn't rate-limit — bcrypt slows brute-force naturally and pairing tokens are 122-bit UUIDs with 5-minute TTL, so any throttling belongs at the edge.

### 4. Clone and configure

```bash
git clone <this repo> /srv/rdp
cd /srv/rdp
cp .env.example .env
nano .env  # fill in secrets (see below)
```

Generate strong secrets:

```bash
openssl rand -hex 32     # JWT_SECRET
openssl rand -base64 24  # DB_PASSWORD
openssl rand -base64 24  # ADMIN_PASSWORD
```

Then set in `.env`:

```bash
DB_USER=rdadmin
DB_PASSWORD=<generated>
JWT_SECRET=<generated>
CORS_ORIGIN=https://nomain.uk
WEB_TLS_PORT=443

# Initial admin (seeded on first boot only). Email is the login identifier.
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=<generated>

# Pairing URL — the QR will embed this; phone dials it from anywhere
PAIRING_BASE_URL=https://nomain.uk

# TURN — leave blank, STUN is enough for direct P2P
# TURN_SECRET=
# TURN_HOSTNAME=
```

### 5. TLS certificates (Cloudflare origin)

Place your Cloudflare Origin Certificate and key under `certs/`:

```bash
mkdir -p certs
# from your laptop:
#   scp origin.pem origin-key.pem deploy@89.117.109.152:/opt/rdp/certs/
chmod 600 certs/origin-key.pem
```

If you are not using Cloudflare, replace [web/nginx.prod.conf](web/nginx.prod.conf) with your own TLS setup (e.g. Let's Encrypt via certbot) and adjust the `server_name` line.

### 6. Start the stack

```bash
# IMPORTANT: pass -f docker-compose.yml explicitly so the auto-loaded
# docker-compose.override.yml (which exposes the api on the LAN for dev)
# does NOT apply on the VPS.
docker compose -f docker-compose.yml up -d --build
```

This starts three containers:

| Container | Purpose | Port |
|---|---|---|
| `db` | PostgreSQL 17 | not exposed (internal network only) |
| `api` | ASP.NET Core 10 | `127.0.0.1:5000` (host-only, for curl debugging) |
| `web` | nginx + React SPA | `80` and `443` (public) |

Verify:

```bash
docker compose -f docker-compose.yml ps                                  # all services healthy
docker compose -f docker-compose.yml logs api | grep -i "now listening"  # ASP.NET on :8080
docker compose -f docker-compose.yml logs api | grep -i "seeded.*admin"  # confirms admin was created
curl -kI https://localhost/healthz                                       # HTTP/2 200
```

To save typing, export `COMPOSE_FILE=docker-compose.yml` in your shell (or stick it in `~/.bashrc`) — then plain `docker compose <cmd>` skips the dev override.

### 7. Firewall

Only expose 80 and 443 externally. Postgres and the api are not publicly accessible by design:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 8. Sign in

Visit `https://nomain.uk` and log in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` you set in `.env`. Create additional users via User Management as needed.

If you forgot to set them, the seed falls back to `admin@local / admin` and logs a warning — change the password immediately via the user menu.

### 9. Build and install the agent APK

```bash
cd android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The debug APK is fine for personal use. For a release APK, see [android/README.md](android/README.md).

### 10. Pair the phone

The phone can pair from **any network** — home WiFi, cellular, whatever has internet access. The agent dials `https://nomain.uk` directly.

1. In the web dashboard: Devices → Pair Device → QR code appears.
2. In the agent app: Pair → scan the QR.
3. The QR card auto-advances when pairing completes.

After pairing, the agent maintains a persistent SignalR connection from the phone to `wss://nomain.uk/hubs/agent`. The dashboard shows it as online regardless of which network the phone is on.

### Updating

```bash
cd /opt/rdp
git pull
docker compose -f docker-compose.yml up -d --build
```

EF Core migrations run automatically on api startup ([Program.cs:78](api/RemoteDesktop/Program.cs#L78)).

### Troubleshooting

- **Cloudflare 526 (Invalid SSL Certificate)** — The Origin Certificate doesn't cover the hostname being requested, or isn't being served by nginx. Check `docker compose logs web` for "TLS certs detected"; if missing, the bind mount didn't pick up `./certs/origin.pem` / `./certs/origin-key.pem`. If present but still 526, re-issue the cert with `nomain.uk` (and `*.nomain.uk`) as SANs.
- **Cloudflare 502 (Bad Gateway)** — The api service isn't responding to nginx. `docker compose logs api` should show "Now listening on http://[::]:8080". If it's restarting, the DB likely isn't ready or `DB_PASSWORD` is wrong.
- **Login returns 401** — `ADMIN_EMAIL` / `ADMIN_PASSWORD` don't match. The seed only runs on an empty `Users` table — if you've already signed in once, changing `.env` won't update the password. Use User Management in the dashboard.
- **QR pairing fails with "Pair URL invalid"** — `PAIRING_BASE_URL` is unset on the api. The QR fell back to the request `Host` header which is Cloudflare's edge, then the agent's parser rejected it. Set `PAIRING_BASE_URL=https://nomain.uk` and restart the api service.
- **Phone says paired, dashboard shows offline** — the agent stored an old `serverUrl`. Tap Unpair in the agent app and scan a fresh QR.
- **Phone session connects but video freezes after 30 min idle** — likely the home router's UDP NAT idle timeout severing the WebRTC media path. See the diagnostic logging already wired into [App.tsx](web/src/App.tsx) (the `[rtc]` stats poll) and the agent logcat. If reproducible, options are: aggressive RTCP keepalives, periodic dummy frames from the encoder, or adding TURN fallback by setting `TURN_SECRET` + `TURN_HOSTNAME` to a hosted provider (Twilio, Metered.ca).
- **Want to inspect Postgres** — it's not publicly exposed and not even bound to the host loopback in production. Easiest is to drop into the container directly: `docker compose -f docker-compose.yml exec db psql -U rdadmin -d remotedesktop`.

## Local dev (no Docker)

API:

```bash
cd api/RemoteDesktop
dotnet run
```

Web:

```bash
cd web
npm install
npm run dev
```

The Vite dev server proxies `/api` and `/hubs` to `http://localhost:5000` (configured in [web/vite.config.ts](web/vite.config.ts)).

Android agent:

```bash
cd android
./gradlew :app:assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk
```

See [android/README.md](android/README.md) for SDK setup and pairing.

