import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from "@microsoft/signalr";
import type { Device, IceServer } from "./api";
import { getToken } from "./api";

export interface IceCandidateWire {
  candidate: string | null;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

export interface WebRtcHandlers {
  onSdpOffer: (deviceId: string, sdp: string) => void;
  onIceCandidate: (deviceId: string, candidate: IceCandidateWire) => void;
}

let connection: HubConnection | null = null;

// One swappable handler set for the active RemoteView. The hub-level listener
// installed at connect() time delegates to whichever component is currently
// mounted. This avoids stacking listeners on remount.
let webrtcHandlers: WebRtcHandlers | null = null;

export const setWebRtcHandlers = (h: WebRtcHandlers | null) => {
  webrtcHandlers = h;
};

export const connectHub = async (
  onDevices: (devices: Device[]) => void,
  onSessionEnded: (deviceId: string, reason: string) => void,
  onPairingCompleted: (token: string, device: Device) => void
): Promise<HubConnection> => {
  if (connection && connection.state === HubConnectionState.Connected) return connection;

  connection = new HubConnectionBuilder()
    .withUrl("/hubs/control", { accessTokenFactory: () => getToken() ?? "" })
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Information)
    .build();

  connection.onclose((err) =>
    console.warn("[hub] closed", { ts: new Date().toISOString(), state: connection?.state, err: err?.message ?? err }));
  connection.onreconnecting((err) =>
    console.warn("[hub] reconnecting", { ts: new Date().toISOString(), err: err?.message ?? err }));
  connection.onreconnected((newId) =>
    console.info("[hub] reconnected", { ts: new Date().toISOString(), newConnectionId: newId }));

  connection.on("DeviceListUpdated", onDevices);
  connection.on("SessionEnded", onSessionEnded);
  connection.on("PairingCompleted", onPairingCompleted);
  connection.on("ReceiveSdpOffer", (deviceId: string, sdp: string) => {
    console.info("[hub] ReceiveSdpOffer", { ts: new Date().toISOString(), deviceId, sdpLen: sdp?.length, hasHandler: !!webrtcHandlers });
    webrtcHandlers?.onSdpOffer(deviceId, sdp);
  });
  connection.on("ReceiveIceCandidate", (deviceId: string, candidate: IceCandidateWire) => {
    webrtcHandlers?.onIceCandidate(deviceId, candidate);
  });

  await connection.start();
  console.info("[hub] started", { ts: new Date().toISOString(), connectionId: connection.connectionId, state: connection.state });
  return connection;
};

export const disconnectHub = async () => {
  if (connection) {
    await connection.stop();
    connection = null;
  }
};

const invokeOrWarn = <T = unknown>(method: string, ...args: unknown[]): Promise<T> | undefined => {
  if (!connection) {
    console.warn(`[hub] ${method} dropped — no connection`, { ts: new Date().toISOString() });
    return undefined;
  }
  if (connection.state !== HubConnectionState.Connected) {
    console.warn(`[hub] ${method} dropped — state=${connection.state}`, { ts: new Date().toISOString() });
    return undefined;
  }
  return connection.invoke<T>(method, ...args);
};

export const watchDevice = (deviceId: string) =>
  invokeOrWarn<{
    ok?: boolean;
    error?: string;
    connectedUser?: string;
    sessionId?: string;
    iceServers?: IceServer[];
  }>("WatchDevice", deviceId);

export const stopWatching = (deviceId: string) =>
  invokeOrWarn("StopWatching", deviceId);

export const sendInput = (deviceId: string, input: any) =>
  invokeOrWarn("SendInput", deviceId, input);

export const forceDisconnect = (deviceId: string) =>
  invokeOrWarn("ForceDisconnect", deviceId);

export const sendSdpAnswer = (deviceId: string, sdp: string) =>
  invokeOrWarn("SendSdpAnswer", deviceId, sdp);

export const sendIceCandidate = (deviceId: string, candidate: IceCandidateWire) =>
  invokeOrWarn("SendIceCandidate", deviceId, candidate);
