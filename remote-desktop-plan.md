# Multi-Device Android Remote Desktop — Plan (v3)

## Overview

A self-hosted system running on a server that lets you remotely view and control up to 10 Android phones from a browser. The server acts as the central hub — orchestrating connections, relaying control signals, and brokering media streams. It does **not** transcode video.

## Architecture — Split Control & Media Planes

The key architectural decision is separating **control plane** (SignalR/WebSocket) from **media plane** (WebRTC). SignalR is excellent for session management, metadata, and input relay but adds overhead and is hard to optimize for sustained video transport. WebRTC gives us lower latency, adaptive bitrate, congestion control, and a well-defined browser playback path out of the box.

```
┌─────────────┐                  ┌──────────────────────────┐                  ┌─────────────┐
│  Android     │                 │   Server                  │                 │  Browser     │
│  Phone 1..10 │                 │   (Orchestrator)          │                 │  (any device)│
│              │   Control       │                           │   Control       │              │
│  Agent App   │◄────WSS────────►│  ASP.NET Core             │◄────WSS────────►│  SPA         │
│              │   (SignalR)     │  ├─ SignalR Control Hub   │   (SignalR)     │              │
│              │                 │  ├─ Device Manager        │                 │              │
│              │   Signaling     │  ├─ Auth + Trust Service  │   Signaling     │              │
│              │◄────WSS────────►│  ├─ WebRTC Signaling     │◄────WSS────────►│  <video>     │
│              │                 │  ├─ Observability Service │                 │  + overlay   │
│              │                 │  ├─ coturn TURN Relay    │                 │              │
│              │                 │  └─ Static File Server    │                 │              │
│              │◄════════ WebRTC media: direct or TURN relay ════════════════►│              │
│              │                  (H.264/VP8, no server transcoding)          │              │
└─────────────┘                 └──────────────────────────┘                 └─────────────┘
```

### Why Not SignalR for Video

- SignalR messages have framing overhead that adds up at 15–30fps across 10 devices.
- No built-in congestion control, adaptive bitrate, or jitter buffering — you'd have to build all of that yourself.
- Debugging "custom streaming over app messages" is significantly harder than using standard media paths.
- WebRTC provides all of these features natively and plays directly into a `<video>` element — no canvas hacks, no WebCodecs demuxing, no MSE/fMP4 packaging needed.

### Browser Video Playback — The Critical Detail

Browsers **cannot** accept arbitrary H.264 byte chunks into a canvas. The original plan left this underspecified. The viable paths are:

| Approach | Complexity | Latency | Browser Support |
|----------|-----------|---------|-----------------|
| **WebRTC** (recommended) | Medium | Lowest | Excellent |
| MSE + fMP4 packaging | High | Medium | Good |
| WebCodecs + demuxing | High | Low | Chrome/Edge only |
| MJPEG via `<img>` multipart | Low | High | Universal |

**Decision:** WebRTC for production, MJPEG as a debug/fallback mode only.

### Media Architecture Decision — Direct WebRTC + TURN

The production media architecture is **direct WebRTC between the Android agent and the browser**. The ASP.NET Core backend handles signaling, auth, session ownership, and orchestration, but it does **not** relay RTP/SRTP media packets and does **not** act as an SFU.

Media path priority:

1. **Direct peer-to-peer WebRTC** — preferred when ICE can establish connectivity between the Android phone and the browser.
2. **TURN relay via coturn** — fallback when NAT, CGNAT, corporate firewalls, or restrictive Wi-Fi prevent direct connectivity.
3. **MJPEG debug mode** — non-production fallback for basic troubleshooting only.

This matches the one-viewer-per-device rule and avoids operating an SFU until there is a real need for multi-viewer fan-out, server-side recording, or advanced stream routing.

## Backend — ASP.NET Core

### Project Structure

```
remote-desktop/
├── docker-compose.yml              # Orchestrates backend, frontend, PostgreSQL, coturn, DDNS
├── .env                            # DB_PASSWORD, JWT_SECRET, TURN credentials, CLOUDFLARE_API_TOKEN
├── turnserver.conf                 # coturn configuration
├── certs/                          # Cloudflare Origin Certificate + private key
│   ├── origin.pem
│   └── origin-key.pem
│
├── backend/
│   ├── Dockerfile                  # ASP.NET Core multi-stage build
│   ├── RemoteDesktop.sln
│   ├── RemoteDesktop/
│   │   ├── Controllers/
│   │   │   ├── DevicesController.cs
│   │   │   ├── AuthController.cs
│   │   │   └── UsersController.cs
│   │   ├── Hubs/
│   │   │   └── ControlHub.cs
│   │   ├── Services/
│   │   │   ├── DeviceManagerService.cs
│   │   │   ├── DeviceTrustService.cs
│   │   │   ├── UserService.cs
│   │   │   ├── InputRelayService.cs
│   │   │   ├── WebRtcSignalingService.cs
│   │   │   ├── PairingService.cs
│   │   │   └── ObservabilityService.cs
│   │   ├── Data/
│   │   │   ├── AppDbContext.cs         # EF Core DbContext (Users, Devices, DeviceTrusts, Sessions)
│   │   │   └── Migrations/            # EF Core migrations (auto-generated)
│   │   ├── Models/
│   │   │   ├── DeviceInfo.cs
│   │   │   ├── DeviceTrust.cs
│   │   │   ├── User.cs
│   │   │   ├── UserRole.cs
│   │   │   ├── InputEvent.cs
│   │   │   ├── SessionState.cs
│   │   │   └── DeviceMetrics.cs
│   │   ├── Middleware/
│   │   │   ├── DeviceAuthMiddleware.cs
│   │   │   └── RoleAuthorizationMiddleware.cs
│   │   ├── Program.cs
│   │   └── appsettings.json
│   └── RemoteDesktop.Tests/
│       └── ...
│
├── frontend/
│   ├── Dockerfile                  # Node multi-stage build (build + nginx serve)
│   ├── nginx.conf                  # Reverse proxy config (API + SignalR → backend, TLS via Cloudflare Origin Cert)
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx
│   │   │   ├── DashboardPage.tsx
│   │   │   ├── PairDevicePage.tsx
│   │   │   └── RemoteViewPage.tsx
│   │   ├── components/
│   │   │   ├── DeviceCard.tsx
│   │   │   ├── UserMenu.tsx
│   │   │   ├── MetricsBar.tsx
│   │   │   ├── PhoneFrame.tsx
│   │   │   ├── QrCodeDisplay.tsx
│   │   │   └── ControlPanel.tsx
│   │   ├── hooks/
│   │   │   ├── useSignalR.ts
│   │   │   ├── useWebRTC.ts
│   │   │   └── useAuth.ts
│   │   ├── services/
│   │   │   ├── api.ts
│   │   │   └── inputMapper.ts
│   │   └── types/
│   │       └── index.ts
│   └── public/
│       └── ...
│
└── android/                        # Agent app (separate, not containerized)
    └── ...
```

### Docker Configuration

**`docker-compose.yml`:**

```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      - POSTGRES_DB=remotedesktop
      - POSTGRES_USER=${DB_USER:-rdadmin}
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - pg-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rdadmin -d remotedesktop"]
      interval: 5s
      timeout: 3s
      retries: 5
    networks:
      - app-net

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "5000:8080"
    environment:
      - ASPNETCORE_ENVIRONMENT=Production
      - JWT_SECRET=${JWT_SECRET}
      - ConnectionStrings__Default=Host=db;Port=5432;Database=remotedesktop;Username=${DB_USER:-rdadmin};Password=${DB_PASSWORD}
      - CORS_ORIGIN=http://localhost:3000
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - app-net

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "3000:80"
    depends_on:
      - backend
    restart: unless-stopped
    networks:
      - app-net

volumes:
  pg-data:

networks:
  app-net:
```

**Backend `Dockerfile`:**

```dockerfile
# Build stage
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY RemoteDesktop/*.csproj ./RemoteDesktop/
RUN dotnet restore RemoteDesktop/RemoteDesktop.csproj
COPY . .
RUN dotnet publish RemoteDesktop/RemoteDesktop.csproj -c Release -o /app/publish

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 8080
ENTRYPOINT ["dotnet", "RemoteDesktop.dll"]
```

**Frontend `Dockerfile`:**

```dockerfile
# Build stage
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Serve stage
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

**Frontend `nginx.conf`:**

```nginx
server {
    listen 80;

    # SPA — serve index.html for all routes
    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to backend
    location /api/ {
        proxy_pass http://backend:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Proxy SignalR WebSocket to backend
    location /hubs/ {
        proxy_pass http://backend:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

### Development Workflow

- **`docker compose up --build`** — builds and starts both containers. Frontend available at `localhost:3000`, API at `localhost:5000`.
- **`docker compose up backend`** — run only the backend (for frontend dev with Vite's dev server + proxy).
- **Local dev without Docker** — `cd backend && dotnet run` and `cd frontend && npm run dev` with Vite proxy configured to forward `/api` and `/hubs` to `localhost:5000`.
- **Deployment** — `docker compose up -d` on the server. For arm64, the .NET and Node base images support multi-arch natively. No cross-compilation needed if building directly on the server.

### Server Docker Considerations

- Docker runs natively on Ubuntu Server or Debian. Install via `curl -fsSL https://get.docker.com | sh`.
- .NET 10 and Node 22 base images support both `linux/amd64` and `linux/arm64` out of the box.
- Memory overhead: Docker engine ~100MB, nginx container ~10MB, .NET container ~200–400MB. Total ~500MB — minimal for any modern server.
- WebRTC media is negotiated by the backend but flows directly phone ↔ browser when possible, or through coturn when relay is required. Docker bridge networking mainly affects API/SignalR traffic, not the media path.

### Key Design Decisions

- **SignalR for control plane only** — session management, device metadata, input relay, and WebRTC signaling (ICE candidate / SDP exchange). No video frames flow through SignalR.
- **Direct WebRTC for media plane** — the server brokers signaling between phones and browsers, but does not sit in the media path. Media flows phone ↔ browser when ICE can establish a direct path, and falls back to coturn when NAT/firewall conditions require a relay.
- `DeviceManagerService` as a singleton — holds a `ConcurrentDictionary<string, DeviceInfo>` capped at 10 devices.
- **No transcoding on the server** — phones encode, browsers decode. The backend's role is orchestration/signaling, and coturn only relays encrypted packets when needed.

### Database — PostgreSQL

PostgreSQL 17 runs as a Docker container alongside the backend. The backend connects via Entity Framework Core (Npgsql provider). Migrations are code-first via `dotnet ef`.

**Schema:**

```
users
├── id              UUID PK
├── username        VARCHAR(50) UNIQUE NOT NULL
├── display_name    VARCHAR(100) NOT NULL
├── email           VARCHAR(200)
├── role            VARCHAR(10) NOT NULL  -- 'admin' or 'user'
├── password_hash   VARCHAR(200) NOT NULL -- bcrypt
├── created_at      TIMESTAMPTZ NOT NULL
└── updated_at      TIMESTAMPTZ NOT NULL

devices
├── id              UUID PK
├── name            VARCHAR(100) NOT NULL
├── model           VARCHAR(100)
├── os_version      VARCHAR(50)
├── resolution      VARCHAR(20)
├── ip_address      VARCHAR(45)
├── status          VARCHAR(10) NOT NULL  -- 'online', 'idle', 'offline'
├── last_seen_at    TIMESTAMPTZ
├── created_at      TIMESTAMPTZ NOT NULL
└── updated_at      TIMESTAMPTZ NOT NULL

device_trusts
├── id              UUID PK
├── device_id       UUID FK → devices.id UNIQUE
├── key_hash        VARCHAR(200) NOT NULL -- hashed trust key
├── paired_at       TIMESTAMPTZ NOT NULL
├── last_rotated_at TIMESTAMPTZ
└── revoked_at      TIMESTAMPTZ          -- NULL = active, set = revoked

sessions
├── id              UUID PK
├── user_id         UUID FK → users.id
├── device_id       UUID FK → devices.id
├── status          VARCHAR(15) NOT NULL  -- 'connecting', 'connected', 'disconnected'
├── started_at      TIMESTAMPTZ NOT NULL
├── ended_at        TIMESTAMPTZ
└── disconnect_reason VARCHAR(50)         -- 'user', 'timeout', 'network', 'error'
```

**Design notes:**

- **EF Core code-first** — models in `Models/` map directly to these tables. `AppDbContext` in `Data/` configures relationships and indexes. Migrations are generated and applied automatically on startup in development, manually in production. Pairing tokens are short-lived (5 minutes) and held in-memory by `PairingService` rather than persisted to the database.
- **Session history** — the `sessions` table is append-only for audit purposes. Completed sessions are never deleted, allowing usage analytics (who connected to which device, when, for how long).
- **Device state is hybrid** — persistent fields (name, model, trust key) live in PostgreSQL. Volatile runtime state (battery, signal, FPS, latency, current status) lives in `DeviceManagerService`'s in-memory `ConcurrentDictionary`, updated by the device agent via SignalR. The `status` and `last_seen_at` columns in the `devices` table are synced periodically (every 30s) and on connect/disconnect events, so the dashboard can show last-known state for offline devices.
- **Connection string** — injected via environment variable in Docker. For local dev, configured in `appsettings.Development.json`.
- **Database performance** — PostgreSQL Alpine uses ~50–100MB RAM at idle with this workload. Disk usage is negligible for 10 devices and a handful of users.

### REST API Endpoints

| Method | Route | Role | Purpose |
|--------|-------|------|---------|
| GET | `/api/devices` | Any | List all devices with status, metrics, and active session info |
| GET | `/api/devices/{id}` | Any | Get device detail including current session (if any) |
| GET | `/api/devices/{id}/sessions` | Any | Get last 10 sessions for this device (user, timing, reason) |
| POST | `/api/devices/pair/generate` | Admin | Generate a time-limited pairing token and return it (frontend renders as QR code) |
| POST | `/api/devices/pair/complete` | Public (token-auth) | Called by the agent app with the pairing token to complete pairing and receive a trust key |
| POST | `/api/devices/{id}/revoke` | Admin | Revoke device trust, force disconnect |
| DELETE | `/api/devices/{id}` | Admin | Remove a device |
| POST | `/api/devices/{id}/disconnect` | Admin | Force disconnect current user from this device |
| POST | `/api/auth/login` | Public | Authenticate, get JWT with role claim |
| GET | `/api/users` | Admin | List all users |
| POST | `/api/users` | Admin | Create a new user (username, password, role) |
| PUT | `/api/users/{id}` | Admin | Update user (display name, email, role) |
| PUT | `/api/users/{id}/password` | Admin | Reset a user's password |
| DELETE | `/api/users/{id}` | Admin | Delete a user |
| GET | `/api/users/me` | Any | Get current user's own profile |
| PUT | `/api/users/me/password` | Any | Change own password |

### SignalR ControlHub Methods

All hub methods require a valid JWT. Device management operations (pair, revoke, remove) are restricted to admin role. Both admins and users can connect to, interact with, and disconnect from any device. **Only one user can be connected to a device at a time** — this is enforced server-side.

**Server → Device:**

- `StartMediaSession()` — signals the device agent to begin MediaProjection capture and create a WebRTC offer.
- `StopMediaSession()` — signals the device agent to stop capture and tear down the WebRTC peer connection.
- `ForwardSdpAnswer(string sdp)` — relays the browser's SDP answer to the device.
- `ForwardIceCandidate(string candidate)` — relays ICE candidates from the browser.
- `ForwardInput(InputEvent input)` — relays validated input events from the connected user.
- `DeviceRevoked()` — notifies the device agent that its trust has been revoked or the device has been removed by an admin. The agent must immediately disconnect, delete its stored trust key and server address, and return to the unpaired QR scan screen.
- `RotateKey(string newKeyHash)` — pushes a rotated trust key to the device over the existing trusted connection.

**Device → Server:**

- `RegisterDevice(DeviceInfo info)` — phone announces itself with long-lived device key
- `ReportStatus(DeviceStatus status)` — battery, wifi, orientation, temperature
- `ReportMetrics(DeviceMetrics metrics)` — fps, encode bitrate, dropped frames
- `SendIceCandidate(string candidate)` — WebRTC ICE candidate from phone
- `SendSdpOffer(string sdp)` — WebRTC SDP offer from phone

**Browser → Server (any role):**

- `WatchDevice(string deviceId)` — initiate an exclusive session. Server checks if another user already has an active session on this device. If yes, returns an error with the connected user's name. If no, creates the session and starts WebRTC signaling.
- `StopWatching(string deviceId)` — end own session, tear down WebRTC. Updates session record with `ended_at` and `disconnect_reason: "user"`.
- `SendInput(string deviceId, InputEvent input)` — touch/key event relay. Rejected if caller does not have the active session on this device.
- `SendIceCandidate(string deviceId, string candidate)` — WebRTC ICE from browser
- `SendSdpAnswer(string deviceId, string sdp)` — WebRTC SDP answer from browser

**Browser → Server (admin only):**

- `ForceDisconnect(string deviceId)` — admin forcibly ends another user's active session. Server tears down the WebRTC connection, updates the session record with `disconnect_reason: "admin"`, and notifies the disconnected user.

**Server → Browser (any role):**

- `DeviceListUpdated(DeviceInfo[] devices)` — push dashboard updates (includes active session info per device: connected user name, session start time)
- `ReceiveIceCandidate(string candidate)` — forward ICE candidate
- `ReceiveSdpOffer(string sdp)` — forward SDP offer
- `MetricsUpdated(DeviceMetrics metrics)` — push live metrics
- `SessionEnded(string deviceId, string reason)` — notifies the connected user that their session was ended (by admin force-disconnect, device going offline, or timeout). The browser shows a notification and returns to device detail view.
- `PairingCompleted(DeviceInfo device)` — notifies the admin's browser that a device has successfully paired via the QR code flow. The pairing page shows a success state and the device appears in the dashboard.

## Android Side

Each phone runs a lightweight agent app that handles three responsibilities:

### Pairing (via QR code scan)

1. On first launch (or when unpaired), the agent app shows a "Scan QR to pair" screen with a camera viewfinder.
2. The admin generates a pairing QR code in the web UI. The QR encodes a URI: `rdpair://<server-host>:<port>/pair?token=<uuid>`.
3. The agent scans the QR code, parses the server's address and pairing token from the URI.
4. The agent connects to the server via HTTPS and calls `POST /api/devices/pair/complete` with the pairing token and the device's metadata (model, OS version, resolution).
5. The server validates the token (not expired, not already consumed), creates the device record, generates a long-lived trust key, and returns it in the response.
6. The agent stores the trust key and server address securely (Android Keystore). The pairing screen transitions to a "Paired successfully" state, and the agent begins normal operation (SignalR connection with the trust key).
7. If the token is invalid or expired, the agent shows an error and prompts the admin to generate a new QR code.
8. The agent also persists the server address from the QR code, so it knows where to connect on subsequent launches without re-pairing.

### Unpairing (revocation or removal)

When an admin revokes or removes a device from the web UI:

1. The server sends a `DeviceRevoked` message to the agent over the existing SignalR connection.
2. The agent immediately tears down any active WebRTC peer connection and stops MediaProjection if running.
3. The agent deletes the stored trust key and server address from Android Keystore.
4. The agent resets to the unpaired state and shows the "Scan QR to pair" screen.
5. If the agent is offline when revocation happens (phone off, no network), the server has already rejected its trust key server-side. On the next launch, the agent's `RegisterDevice` call will be rejected with an `untrusted_device` error. The agent handles this the same way — wipes stored credentials and returns to the QR scan screen.
6. The agent also exposes a manual "Unpair" option in its settings, allowing the phone owner to clear the trust key locally and return to the QR scan screen without admin action on the server.

### Control (via SignalR/WebSocket)

1. Connects to the server's `ControlHub` via WebSocket client using the stored server address.
2. Registers with its long-lived device trust key (obtained during QR pairing).
3. Receives `InputEvent` messages and injects them via `AccessibilityService` or adb input bridge.
4. Reports device metadata and metrics periodically.

### Media (via WebRTC)

1. When a user requests a session, the server signals the phone to start a WebRTC peer connection.
2. The phone uses `MediaProjection` API to capture the screen.
3. Encodes as H.264 (hardware encoder) or VP8 and sends via WebRTC.
4. WebRTC's built-in congestion control handles adaptive bitrate and frame dropping.

### Codec and Transport by Phase

| Phase | Codec | Transport | Playback |
|-------|-------|-----------|----------|
| Phase 1 | None (mock stills) | SignalR | `<img>` swap |
| Phase 2 | MJPEG | WebSocket | `<img>` multipart |
| Phase 3+ | H.264 (hw) / VP8 | WebRTC | `<video>` element |

## Frontend

A single-page app served from `wwwroot/`:

### Login Page

- Username/password form with JWT authentication.
- On success, JWT is stored in memory (not localStorage) and attached to all API and SignalR requests.
- JWT contains user id, role, and display name as claims.

### User Menu

- Displayed in the header on all authenticated pages.
- Shows user initials avatar, display name, and role badge (admin/user).
- Dropdown menu with: Manage Users (admin only), Settings (admin only), Sign Out.

### Dashboard View

- Grid of up to 10 uniform device cards showing device icon, name, model, status, battery, signal, OS, IP, and latency.
- Cards are identical in size and layout regardless of device state.
- If a user is currently connected to a device, the card shows a **connected indicator** with the connected user's name (e.g. "Jordan Lee connected").
- "Pair new device" slot visible to admins only. Clicking it generates a pairing token and displays a QR code that the agent app on the phone scans to initiate pairing.

### Device Detail View

Clicking a device card opens the device detail view (not the remote view). This is an intermediate page showing device information and actions before connecting.

**Device info panel:**
- Device name, model, OS, resolution, IP, orientation.
- Current status (online/idle/offline) with battery and signal.
- If another user is connected: shows their name, role, and session duration. Connect button is disabled with message "In use by [name]".

**Actions:**
- **Connect** — available only when the device is online and no other user is connected. Starts a remote session (transitions to remote view with WebRTC connection flow).
- **Disconnect** — visible only when the current user is connected to this device. Ends the session and returns to device detail view.
- **Force Disconnect** (admin only) — visible when another user is connected. Admin can forcibly end another user's session. The disconnected user sees a notification that their session was ended by an admin.

**Connection history (last 10 sessions):**
- Table showing the 10 most recent sessions for this device, pulled from the `sessions` table.
- Columns: User (display name), Started, Ended, Duration, Disconnect Reason.
- Sorted by most recent first.
- Admins and users both see the same history.

**Exclusive access rule:**
- Only one user can be connected to a device at a time. This is enforced server-side in `ControlHub.WatchDevice` — if a session already exists for the device, the request is rejected with an error indicating who is currently connected.
- The frontend checks session state before showing the Connect button, but the server is the authoritative enforcer.

### Remote View (single device)

Entered only via the Connect action on the device detail view. Shows the live phone screen and controls.

- `<video>` element receiving a WebRTC stream from the selected device.
- Transparent `<canvas>` or `<div>` overlay on top of the video for input capture.
- Control bar: Home, Back, Recents, keyboard toggle, fullscreen, screenshot, rotate, volume, power.
- Disconnect button — ends the session and returns to device detail view (not dashboard).
- Live metrics overlay: FPS, latency, bitrate (from `ObservabilityService`).
- Both admins and users have full interactive control — tap, swipe, key injection, all buttons active.

### Role-Based UI Summary

| Feature | Admin | User |
|---------|-------|------|
| View dashboard | Yes | Yes |
| View device detail | Yes | Yes |
| View connection history | Yes | Yes |
| View metrics | Yes | Yes |
| Connect to device (if available) | Yes | Yes |
| Send input (tap, swipe, keys) | Yes | Yes |
| Navigation buttons (Back, Home, Recents) | Yes | Yes |
| System controls (Volume, Power) | Yes | Yes |
| Screenshot, Rotate | Yes | Yes |
| Disconnect own session | Yes | Yes |
| Force disconnect another user | Yes | No |
| Pair new device | Yes | Hidden |
| Revoke device trust | Yes | Hidden |
| Remove device | Yes | Hidden |
| Manage Users | Yes | Hidden |
| Settings | Yes | Hidden |
| Change own password | Yes | Yes |

### Input Mapping

- Click → tap at mapped coordinates.
- Click + drag → swipe gesture.
- Scroll wheel → scroll event.
- Keyboard → key injection.
- Coordinate mapping accounts for: phone resolution, current orientation, letterboxing in the video element.

## Observability

Per-device and per-session metrics, pushed to the frontend via the SignalR `MetricsUpdated` event whenever the agent reports new numbers:

| Metric | Source | Purpose |
|--------|--------|---------|
| Capture FPS | Device agent | Is the phone keeping up? |
| Encode bitrate | Device agent | Bandwidth consumption |
| End-to-end latency | Browser (measured via ping frame) | User experience quality |
| Dropped frames | server relay + browser | Congestion detection |
| Reconnect count | ControlHub | Connection stability |
| Input round-trip latency | Browser → device → screen update | Responsiveness |
| Active users per device | ControlHub | Load tracking |
| Server CPU / memory / network | System metrics | Infrastructure health |

## Device Trust Model

Moving beyond simple pairing codes to a proper trust model:

- **Per-device long-lived key** — generated during initial pairing, stored on both the phone and the server. Used for all subsequent connections without re-pairing.
- **Initial pairing via QR code** — an admin clicks "Pair new device" in the web UI, which generates a time-limited pairing token and displays it as a QR code. The admin scans this QR code using the agent app on the phone. The QR payload contains the server's address and the one-time pairing token (e.g. `rdpair://<server-host>:<port>/pair?token=<uuid>`). The agent app connects to the server, presents the token, and the server validates it. On success, the server issues a device-specific long-lived trust key to the phone and the device appears in the dashboard. The pairing token expires after 5 minutes and can only be used once.
- **QR pairing security** — the token is a cryptographically random UUID, single-use, and time-limited. The server rejects expired or already-consumed tokens. The QR code is displayed only to authenticated admins. If the token expires before being scanned, the admin can generate a new one. No sensitive secrets (like the trust key itself) are embedded in the QR code — the key exchange happens over the established WSS connection after the token is validated.
- **Key rotation** — pairing secrets can be rotated on demand from the web UI without physical access to the phone (the new key is pushed over the existing trusted connection).
- **Remote revocation** — any device can be revoked from the web UI at any time. Revocation is immediate: the server sends a `DeviceRevoked` message to the agent, closes the device's WebSocket and WebRTC connections, and rejects the device key on future attempts. On receiving the revocation, the agent deletes its stored trust key and server address from Android Keystore and resets to the unpaired state (QR scan screen). The device must be re-paired via a new QR code to reconnect. Device removal (`DELETE /api/devices/{id}`) follows the same agent-side flow — the agent is notified, wiped, and returned to the QR scan screen.
- **Device inventory** — the web UI shows all trusted devices (connected or not), with last-seen timestamps and the ability to revoke.

## Server Performance Considerations

The server should be a modest Linux machine (e.g. a single-board computer with 4+ GB RAM, or any small dedicated host). The workload must be well-scoped:

- **No transcoding** — media is sent via direct WebRTC or TURN relay. All encoding happens on the phones, all decoding in the browsers.
- **TURN relay load** — when direct WebRTC fails and coturn is used, the workload is primarily network I/O. A gigabit Ethernet connection and a modern multi-core CPU handle this comfortably, but monitor CPU and network usage under load.
- **Bandwidth reality check** — 10 streams at 720p H.264/15fps ≈ 5–15 Mbps total (H.264 is far more efficient than MJPEG). MJPEG at the same settings would be 30–50+ Mbps and is only used for debugging.
- **Memory** — ASP.NET Core runtime ~200–400MB, WebRTC relay overhead ~50–100MB per stream. 4 GB RAM is a comfortable minimum; 8+ GB provides ample headroom.
- **Concurrent load** — dashboard device list for 10 devices + 1 active live interactive stream is the primary target workload.

## Security

### User Authentication

- JWT-based authentication for the web UI. Tokens contain user id, role (`admin` or `user`), and display name.
- Passwords stored as bcrypt hashes. Default admin account created on first run.
- JWT stored in memory only (not localStorage/cookies) to limit XSS exposure. Refresh tokens optional for longer sessions.
- Admin can create, update, and delete user accounts via `/api/users`. Admin can reset any user's password. All users can change their own password via `/api/users/me/password`.

### Role Enforcement

- Role is checked server-side on every request — both REST API endpoints and SignalR hub method invocations.
- Admin-only operations: device pairing, revocation, removal, user management, and **force-disconnecting another user's session**. A user calling `POST /api/devices/{id}/disconnect` or `POST /api/users` receives a 403 Forbidden.
- Device interaction (connecting, sending input, disconnecting own session) is available to both admins and users, subject to the exclusive access rule (one user per device at a time).
- Frontend hides admin-only UI elements for users, but the backend is the authoritative enforcement layer.
- JWT role claim is validated on every SignalR hub invocation, not just at connection time, to handle role changes mid-session.

### Device Trust

- Per-device long-lived keys with revocation (see Device Trust Model above).
- All connections over TLS — WSS for SignalR, DTLS for WebRTC.

### General

- Rate limiting handled at the Cloudflare edge via WAF rules (the app itself relies on bcrypt's natural throttling for `/api/auth/login` and the 122-bit cryptographic randomness + 5-minute TTL of pairing tokens for `/api/agent/pair` and `/api/devices/pair/start`).
- Session timeout for idle users.

## Network & Connectivity

The server and Android phones live on your home LAN. The web UI is accessed by browsers worldwide over the internet. This creates two distinct network zones with different requirements.

### Network Topology

```
┌─ Home LAN ──────────────────────────────────────────────────┐
│                                                              │
│  ┌──────────────┐     LAN (no NAT)    ┌───────────────────┐ │
│  │ Android      │◄──── WSS + WebRTC ──►│ Server            │ │
│  │ Phones 1..10 │                      │ (Docker)          │ │
│  └──────────────┘                      │  :443 HTTPS       │ │
│                                        │  :3478 TURN       │ │
│                                        └────────┬──────────┘ │
│                                                  │            │
│  ┌──────────────┐                                │            │
│  │ Home Router  │◄───────────────────────────────┘            │
│  │ Port Forward │                                             │
│  └──────┬───────┘                                             │
└─────────┼─────────────────────────────────────────────────────┘
          │ Internet
          │
    ┌─────▼─────┐
    │ Browser   │
    │ (anywhere)│
    └───────────┘
```

### What Stays on the LAN

The Android phones never need to be reachable from the internet. They always initiate outbound connections to the server over the local network:

- **SignalR (WSS)** — phones connect outbound to the server. No inbound ports needed on the phones.
- **WebRTC media** — the phone creates a peer connection for the browser session. If the browser is also on the LAN, ICE should select a direct LAN path. If the browser is remote, ICE may select a direct public/reflexive path or fall back to coturn.
- **QR pairing** — the phone connects to the server's LAN address (embedded in the QR code). Pairing only works when the phone is on the same network as the server.

### What Needs Internet Access

Browsers connecting from outside the LAN need to reach two things on your server:

**1. HTTPS (port 443)** — serves the web UI (SPA), the REST API, and the SignalR WebSocket upgrade. This is the only port strictly required for the control plane.

**2. TURN relay (port 3478 + media ports)** — WebRTC between a remote browser and a LAN phone may require TURN when NAT/firewall conditions prevent a direct path. The server runs coturn to relay encrypted WebRTC packets only when ICE selects a relay candidate.

### Router Port Forwarding

Forward these ports on your home router to the server's LAN IP:

| Port | Protocol | Service | Required? |
|------|----------|---------|-----------|
| 443 | TCP | HTTPS origin (Cloudflare proxies to this) | Yes |
| 3478 | TCP + UDP | TURN signaling | Yes (for remote WebRTC) |
| 49152–65535 | UDP | TURN media relay range | Yes (for remote WebRTC) |

**Notes:**

- HTTPS traffic (web UI, API, SignalR) flows through Cloudflare's proxy: browser → Cloudflare edge → your port 443. Your home IP is hidden behind Cloudflare for this traffic.
- TURN traffic (UDP media relay) goes direct: browser → `turn.yourdomain.com` (your home IP, DNS-only record) → your TURN ports. This is the only traffic where your home IP is exposed, but coturn rejects unauthenticated connections.
- The TURN media port range can be narrowed (e.g. 49152–49252 for 100 ports) and configured in coturn's `min-port` / `max-port` settings. 10 concurrent streams need roughly 10–20 port pairs.
- Port 80 is not needed — Cloudflare handles HTTP→HTTPS redirect at the edge, and the Origin Certificate eliminates the need for Let's Encrypt HTTP-01 challenges.
- Port 5432 (PostgreSQL) is **never** exposed externally — it is only accessible between Docker containers on the internal network.

### DNS & TLS via Cloudflare

Cloudflare manages the domain, DNS, TLS termination at the edge, and DDoS protection. This avoids exposing your home IP for web traffic and eliminates Let's Encrypt certificate management on the server.

- **Domain** — register or transfer a domain to Cloudflare (e.g. `yourdomain.com`). Create a subdomain (e.g. `remote.yourdomain.com`).
- **Proxied DNS (orange cloud)** — Cloudflare proxies all HTTPS traffic. Browsers connect to Cloudflare's edge, which forwards to your origin. Your home IP is not visible in DNS lookups for the proxied record.
- **TLS mode: Full (Strict)** — Cloudflare terminates TLS at the edge and re-encrypts to your origin. The server runs nginx with a Cloudflare Origin Certificate (free, 15-year validity, no renewal hassle). No Let's Encrypt needed.
- **WebSocket support** — Cloudflare proxies WebSocket connections natively. SignalR over WSS works through Cloudflare without any special configuration.
- **Caching** — configure a cache rule to cache static frontend assets (`/assets/*`, `*.js`, `*.css`, `*.png`) at the Cloudflare edge. API and SignalR routes are never cached (dynamic content + WebSocket).
- **Security** — enable Cloudflare WAF rules, bot protection, and rate limiting at the edge as an additional layer on top of the server's own rate limiting.
- **Dynamic IP** — if your ISP assigns a dynamic home IP, run a lightweight DDNS updater (e.g. a cron job using the Cloudflare API, or a container like `oznu/cloudflare-ddns`) to keep the DNS A record pointing at your current IP.

**TURN DNS record (grey cloud / DNS-only)** — the TURN server needs a separate DNS record (e.g. `turn.yourdomain.com`) that is **not proxied** by Cloudflare (grey cloud). Cloudflare does not proxy UDP traffic, and TURN relies on UDP for media relay. This record points directly to your home IP. This is acceptable because TURN credentials are ephemeral and short-lived — even though the IP is visible, unauthenticated connections are rejected by coturn.

### TURN Server Configuration

The server runs coturn as an additional Docker container (or as a system service). Key configuration:

- **Realm** — set to your domain (e.g. `remote.yourdomain.com`).
- **External IP** — your home's public IP (coturn needs this to generate correct ICE candidates for remote browsers). Keep this in sync with the `turn.yourdomain.com` DNS-only record in Cloudflare.
- **Relay range** — restrict to the forwarded UDP port range (e.g. 49152–49252).
- **Credentials** — ephemeral TURN credentials generated by the backend and passed to browsers via the SignalR control plane. Not long-lived static credentials.
- **LAN traffic exemption** — when both the browser and server are on the LAN (e.g. admin on the home network), WebRTC uses direct LAN candidates and skips TURN entirely.
- **TLS** — coturn can use the same Cloudflare Origin Certificate for TURNS (TLS-encrypted TURN signaling on port 5349) if needed, though standard TURN on 3478 with DTLS-encrypted media is sufficient for most cases.

### docker-compose Addition

```yaml
  turn:
    image: coturn/coturn:latest
    network_mode: host          # Needs direct access to public IP for media relay
    volumes:
      - ./turnserver.conf:/etc/coturn/turnserver.conf:ro
      - ./certs:/etc/coturn/certs:ro
    restart: unless-stopped

  ddns:
    image: oznu/cloudflare-ddns:latest
    environment:
      - API_KEY=${CLOUDFLARE_API_TOKEN}
      - ZONE=yourdomain.com
      - SUBDOMAIN=remote            # Updates remote.yourdomain.com
      - PROXIED=true                # Keeps Cloudflare proxy enabled
    restart: unless-stopped
    networks:
      - app-net
```

A second DDNS instance (or a custom script) should also update the `turn.yourdomain.com` record with `PROXIED=false` (DNS-only) so the TURN server remains reachable by direct IP.

Note: `network_mode: host` is used for the TURN container because NAT hairpinning through Docker's bridge network adds complexity and latency for UDP media relay. The backend and frontend containers remain on the bridge network.

### Phone Connectivity Requirements

The phones only need:

- WiFi access to the home LAN (same network as the server).
- No port forwarding, no public IP, no internet access required (unless the phone itself needs internet for its own apps).
- If a phone is on a different network (e.g. mobile data), it would need to reach the server's public address and go through TURN — but this is not the intended deployment. The plan assumes all phones are on the home LAN.

## Use Case — Remote Device Session

End-to-end flow: user opens a device, connects, interacts, and disconnects.

### 1. User Clicks Device Card → Device Detail View

**Browser:**
- User is on the dashboard, sees device cards. Each card shows the device status and, if someone is connected, the connected user's name.
- User clicks a device card (e.g. "Galaxy S24").
- Frontend transitions to the **device detail view** (not the remote view).
- Frontend fetches `GET /api/devices/{id}` for full device info and active session state.
- Frontend fetches `GET /api/devices/{id}/sessions` for the last 10 connection records.

**Device detail view shows:**
- Device info: name, model, OS, resolution, IP, battery, signal, status.
- Active session panel: either "No one connected" with a Connect button, or "Jordan Lee connected (5m 32s)" with the Connect button disabled.
- Connection history table: last 10 sessions with user, start/end times, duration, and disconnect reason.
- If admin and another user is connected: a "Force Disconnect" button is visible.

### 2. User Clicks Connect → Remote View

**Precondition:** device is online and no other user is connected.

**Browser:**
- User clicks Connect on the device detail view.
- Frontend transitions to remote view with a connecting overlay.
- Frontend calls `ControlHub.WatchDevice(deviceId)` via SignalR.

**Server (`ControlHub`):**
- Validates JWT — confirms user is authenticated.
- Checks `DeviceManagerService` — confirms device exists and is online.
- **Checks for exclusive access** — queries active sessions for this device. If another user already has a session, rejects with error: `{ error: "device_in_use", connectedUser: "Jordan Lee" }`. Browser shows the error and returns to device detail view.
- If available: creates a `SessionState` record: `{ userId, deviceId, startedAt, status: "connecting" }`.
- Broadcasts `DeviceListUpdated` to all connected browsers so dashboard cards update to show the new session.
- Initiates WebRTC signaling: tells the device agent to create a WebRTC offer.

**Device Agent (on phone):**
- Receives the signal to start a media session.
- Starts `MediaProjection` screen capture.
- Creates a WebRTC peer connection, generates an SDP offer.
- Sends the SDP offer back to the server via `SendSdpOffer`.

**Server → Browser (signaling relay):**
- Forwards the SDP offer to the browser via `ReceiveSdpOffer`.
- Browser and device exchange ICE candidates through the server (`SendIceCandidate` / `ReceiveIceCandidate`).

**Browser:**
- Receives the SDP offer, creates an SDP answer, sends it back via `SendSdpAnswer`.
- WebRTC peer connection is established.
- H.264 video stream from the phone arrives and plays in the `<video>` element.
- Session status updates to "connected". Metrics overlay starts showing live FPS, latency, bitrate.

**Time to first frame:** target < 2 seconds from Connect click to live video.

### 3. User Interacts with Device

**Touch input (tap):**
- User clicks on the phone screen area in the browser.
- Frontend captures the click, maps `(mouseX, mouseY)` to phone coordinates: `phoneX = (mouseX - videoOffsetX) / videoScale * phoneResolutionX`, same for Y. Accounts for letterboxing and orientation.
- Frontend sends `ControlHub.SendInput(deviceId, { type: "tap", x: phoneX, y: phoneY })` via SignalR.
- Server validates the session (caller must be the user with the active session on this device), forwards the `InputEvent` to the device agent.
- Device agent injects the tap via `AccessibilityService` or `Instrumentation`. The phone registers the touch.
- The screen updates. The new frame is captured, encoded, sent via WebRTC. The browser displays it.

**Swipe input:**
- User clicks and drags on the phone screen area.
- Frontend captures `mousedown` → `mousemove` → `mouseup`, maps start and end coordinates to phone space.
- Sends `{ type: "swipe", startX, startY, endX, endY, durationMs }`.
- Device agent injects the swipe gesture.

**Key input:**
- User presses a key on their keyboard (with keyboard mode active) or clicks a control button (Home, Back, Recents, Volume, Power).
- Frontend sends `{ type: "key", keyCode: "KEYCODE_HOME" }` or `{ type: "key", keyCode: "KEYCODE_BACK" }`.
- Device agent injects the key event.

**Scroll input:**
- User scrolls the mouse wheel over the phone screen area.
- Frontend sends `{ type: "scroll", x, y, deltaY }`.
- Device agent injects a scroll gesture at the given coordinates.

**Latency budget:** target < 100ms from browser click to visible screen update in the video stream.

### Device Behavior Outside of Sessions

The device is a normal phone at all times. The agent app is a lightweight background service — it does not lock the screen, block user interaction, or alter the phone's behavior in any way. When no remote session is active:

- The phone operates completely normally. The owner can use it, receive calls, run apps, and interact with it as usual.
- The agent only maintains a SignalR connection to the server for status reporting (battery, wifi, online/offline). This has negligible impact on battery and performance.
- `MediaProjection` is **not** running — no screen capture, no encoding, no bandwidth usage.
- No input is being injected — the agent's input injection service is dormant.
- The phone's screen follows its normal sleep/wake behavior.

When a remote session starts, `MediaProjection` activates (Android shows a system notification that the screen is being captured) and input injection becomes active. The phone owner can still use the device physically — remote input and local input coexist, though simultaneous use from both sides will conflict. When the session ends, the phone returns to its normal state with no residual effects.

### 4. User Disconnects

**User clicks "Disconnect" on the remote view:**
- Frontend calls `ControlHub.StopWatching(deviceId)` via SignalR.
- Frontend tears down the local WebRTC peer connection.
- Frontend transitions back to the **device detail view** (not dashboard). The device detail view refreshes to show the session as ended and the Connect button re-enabled.

**Server (`ControlHub`):**
- Receives `StopWatching`. Updates session record: `{ status: "disconnected", endedAt, disconnect_reason: "user" }`.
- Broadcasts `DeviceListUpdated` to all browsers so dashboard cards update (device no longer shows a connected user).
- Signals the device agent that the user has left.
- Signals the device agent to stop `MediaProjection` capture (after an idle timeout, e.g. 30 seconds, to avoid restart churn if the user reconnects quickly).

**Device Agent (on phone):**
- Receives the stop signal.
- Tears down the WebRTC peer connection.
- After idle timeout: stops `MediaProjection`, releases the hardware encoder, and returns to idle state (SignalR status reporting only). The phone resumes fully normal operation.

### 5. Admin Force Disconnects Another User

**Scenario:** admin opens the device detail view and sees that "Jordan Lee" is connected.

**Browser (admin):**
- Admin clicks "Force Disconnect" on the device detail view.
- Frontend calls `ControlHub.ForceDisconnect(deviceId)` via SignalR (or `POST /api/devices/{id}/disconnect`).

**Server:**
- Validates caller is admin.
- Finds the active session for this device.
- Tears down the WebRTC connection server-side.
- Updates session record: `{ status: "disconnected", endedAt, disconnect_reason: "admin" }`.
- Sends `SessionEnded(deviceId, "admin")` to the disconnected user's browser.
- Broadcasts `DeviceListUpdated` to all browsers.

**Disconnected user's browser:**
- Receives `SessionEnded`. Shows a notification: "Your session was ended by an admin."
- Tears down local WebRTC. Transitions back to device detail view.

**Admin's browser:**
- Device detail view refreshes. Connect button is now available.

### 6. Abnormal Disconnect

**Browser closed, network dropped, or device goes offline:**
- SignalR detects the WebSocket disconnection (browser) or device agent disconnect.
- Server updates session record: `{ disconnect_reason: "network" }` or `{ disconnect_reason: "device_offline" }`.
- Broadcasts `DeviceListUpdated` to remaining browsers.
- Device agent tears down the peer connection after a grace period (10 seconds for reconnection).

### Sequence Diagram

```
Browser                    Server                          Device Agent (Phone)
  │                           │                              │
  │── Click device card ─────►│                              │
  │◄── Device detail + ───────│                              │
  │    session history        │                              │
  │                           │                              │
  │── Click Connect ─────────►│                              │
  │── WatchDevice(devId) ────►│                              │
  │                           │── Check exclusive access     │
  │                           │── Create session record      │
  │                           │── Broadcast DeviceListUpdated│
  │                           │── StartMediaSession ────────►│
  │                           │                              │── Start MediaProjection
  │                           │                              │── Create WebRTC offer
  │                           │◄── SendSdpOffer ─────────────│
  │◄── ReceiveSdpOffer ───────│                              │
  │── SendSdpAnswer ─────────►│                              │
  │                           │── ForwardSdpAnswer ─────────►│
  │◄─────── ICE exchange ────►│◄─────── ICE exchange ───────►│
  │                           │                              │
  │◄══════ WebRTC H.264 video stream ════════════════════════│
  │                           │                              │
  │── SendInput(tap) ────────►│                              │
  │                           │── Validate session owner     │
  │                           │── ForwardInput(tap) ────────►│
  │                           │                              │── Inject touch
  │◄══════ Updated video frame ══════════════════════════════│
  │                           │                              │
  │── StopWatching(devId) ───►│                              │
  │── Tear down WebRTC       │── Update session record      │
  │                           │── Broadcast DeviceListUpdated│
  │◄── Device detail view ────│── StopMediaSession ─────────►│
  │                           │                              │── Stop MediaProjection
  │                           │                              │── Return to idle
```

## Phases

### Phase 1 — Frontend + Mock Backend + Docker

Set up the monorepo with `docker-compose.yml`, backend Dockerfile (ASP.NET Core), frontend Dockerfile (Vite + nginx), and PostgreSQL container. Backend serves a mock `ControlHub` with fake device data and mock users. Frontend is a Vite/React SPA with login page, user menu, dashboard with device cards (including connected user indicator), device detail view (info, actions, session history), remote view with connecting state and control panel. `docker compose up --build` runs the full stack. Fully testable without any phones.

### Phase 2 — Backend Control Plane + Database

Implement the real backend: `UserService` (auth, JWT, bcrypt), `DeviceManagerService`, `DeviceTrustService`, `InputRelayService`, and the `ControlHub` with real SignalR hub methods. Wire up PostgreSQL via EF Core — users, devices, device_trusts, sessions tables. Implement exclusive access enforcement (one user per device), session lifecycle (create, connect, disconnect, force disconnect), and session history queries. Frontend connects to real API and SignalR instead of mock data.

### Phase 3 — Android Agent App

Build the Android agent app (Kotlin, VS Code + Gradle):

- **QR code pairing** — on first launch, the agent presents a camera viewfinder to scan a pairing QR code generated by the web UI. Parses the server address and one-time token from the `rdpair://` URI, calls the server's pairing endpoint, and stores the returned trust key in Android Keystore. Handles expired/invalid tokens with clear error messaging.
- **SignalR client** — connects to the server's `ControlHub` using the stored server address and trust key from pairing, registers the device, reports status (battery, wifi, orientation) periodically.
- **MediaProjection capture** — starts/stops screen capture on demand when the server signals a session start/stop. Encodes H.264 via the phone's hardware `MediaCodec`.
- **Input injection** — receives `InputEvent` messages from the server and injects touch, swipe, key, and scroll events via `AccessibilityService` or `Instrumentation`.
- **WebRTC peer connection** — establishes a WebRTC connection to relay the H.264 stream to the browser via the server.
- **Lifecycle management** — runs as a foreground service, handles Android permissions (Camera for QR scan, MediaProjection prompt, Accessibility), survives app switching and screen sleep.
- **Testing** — validate with a single phone: scan QR to pair, confirm device appears in dashboard, connect and verify phone screen visible in browser, tap/swipe input works, session start/stop/reconnect behaves correctly.

### Phase 4 — Direct WebRTC Media Plane Integration

Connect the Android agent and browser with a direct WebRTC peer connection. Implement `WebRtcSignalingService` on the server for ICE/SDP relay only; the backend does not forward media packets. Browser plays the live stream via a `<video>` element. Wire up the full flow: user clicks Connect in device detail → SignalR triggers agent → Android creates a WebRTC offer → browser answers → ICE selects either a direct path or coturn relay → live video appears in the browser → input events flow back over SignalR. Add connection-state handling, bitrate/frame-rate constraints, and TURN fallback diagnostics.

### Phase 5 — Multi-Device + Observability

Scale to 10 devices. Implement device pairing flow (admin generates QR code in web UI → phone agent scans QR → token validated → trust key issued), device trust key rotation and revocation. Add the full metrics pipeline (`ObservabilityService`) — per-device FPS, bitrate, latency, dropped frames, session counts. Load-test with multiple devices on the server. Tune buffer sizes, frame rate caps, and degradation thresholds based on real measurements.

### Phase 6 — Remote Access + Hardening

Configure Cloudflare: proxied DNS for the web UI (`remote.yourdomain.com`), DNS-only record for TURN (`turn.yourdomain.com`), Full (Strict) TLS with Origin Certificate on nginx, WAF and rate limiting rules at the edge, and a DDNS updater container if the home IP is dynamic. Configure coturn TURN server for WebRTC NAT traversal (see Network & Connectivity section). Set up router port forwarding (443 for HTTPS origin, 3478 + UDP media range for TURN). Harden: session timeouts, abnormal disconnect handling, agent reconnection logic, crash recovery.
