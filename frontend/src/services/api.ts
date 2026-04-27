export type Role = "admin" | "user";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: Role;
}

export interface ConnectedUser {
  id: string;
  displayName: string;
  since: number;
}

export interface Device {
  id: string;
  name: string;
  model: string | null;
  status: "online" | "idle" | "offline";
  battery: number | null;
  signal: number | null;
  resolution: string | null;
  orientation: string | null;
  os: string | null;
  ip: string | null;
  lastSeen: number | null;
  fps: number | null;
  bitrate: number | null;
  latency: number | null;
  dropped: number | null;
  connectedUser: ConnectedUser | null;
}

export interface SessionRow {
  id: string;
  user: string;
  started: string;
  ended: string | null;
  duration: string;
  reason: string;
}

interface LoginResponse {
  token: string;
  user: AuthUser;
}

let authToken: string | null = null;

export const setToken = (t: string | null) => {
  authToken = t;
};
export const getToken = () => authToken;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let detail: any = null;
    try {
      detail = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail?.error ?? res.statusText, detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public detail: any = null) {
    super(message);
  }
}

export interface CreateUserPayload {
  username: string;
  password: string;
  displayName: string;
  email: string | null;
  role: Role;
}

export interface UpdateUserPayload {
  displayName: string;
  email: string | null;
  role: Role;
}

export interface PairingToken {
  token: string;
  uri: string;
  expiresAt: number;
  expiresInSeconds: number;
}

// Wire shape of the TURN entries the server attaches to the WatchDevice
// SignalR response. `username` and `credential` are absent for STUN-only
// entries; for the LAN-only deployment the array is empty entirely.
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export const api = {
  login: (username: string, password: string) =>
    request<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  me: () => request<AuthUser>("/api/users/me"),
  devices: () => request<Device[]>("/api/devices"),
  device: (id: string) => request<Device>(`/api/devices/${id}`),
  deviceSessions: (id: string) => request<SessionRow[]>(`/api/devices/${id}/sessions`),
  forceDisconnect: (id: string) =>
    request<void>(`/api/devices/${id}/disconnect`, { method: "POST" }),
  startPair: () => request<PairingToken>("/api/devices/pair/start", { method: "POST" }),
  cancelPair: (token: string) =>
    request<void>(`/api/devices/pair/${encodeURIComponent(token)}`, { method: "DELETE" }),
  revokeDevice: (id: string) =>
    request<void>(`/api/devices/${id}/revoke`, { method: "POST" }),
  rotateTrust: (id: string) =>
    request<{ trustKey: string }>(`/api/devices/${id}/rotate`, { method: "POST" }),
  deleteDevice: (id: string) =>
    request<void>(`/api/devices/${id}`, { method: "DELETE" }),
  listUsers: () => request<AuthUser[]>("/api/users"),
  createUser: (payload: CreateUserPayload) =>
    request<AuthUser>("/api/users", { method: "POST", body: JSON.stringify(payload) }),
  updateUser: (id: string, payload: UpdateUserPayload) =>
    request<AuthUser>(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  resetPassword: (id: string, password: string) =>
    request<void>(`/api/users/${id}/password`, {
      method: "PUT",
      body: JSON.stringify({ password }),
    }),
  changeOwnPassword: (password: string) =>
    request<void>("/api/users/me/password", {
      method: "PUT",
      body: JSON.stringify({ password }),
    }),
  deleteUser: (id: string) => request<void>(`/api/users/${id}`, { method: "DELETE" }),
};
