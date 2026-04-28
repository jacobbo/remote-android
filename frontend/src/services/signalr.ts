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
    .configureLogging(LogLevel.Warning)
    .build();

  connection.on("DeviceListUpdated", onDevices);
  connection.on("SessionEnded", onSessionEnded);
  connection.on("PairingCompleted", onPairingCompleted);
  connection.on("ReceiveSdpOffer", (deviceId: string, sdp: string) =>
    webrtcHandlers?.onSdpOffer(deviceId, sdp)
  );
  connection.on("ReceiveIceCandidate", (deviceId: string, candidate: IceCandidateWire) =>
    webrtcHandlers?.onIceCandidate(deviceId, candidate)
  );

  await connection.start();
  return connection;
};

export const disconnectHub = async () => {
  if (connection) {
    await connection.stop();
    connection = null;
  }
};

export const watchDevice = (deviceId: string) =>
  connection?.invoke<{
    ok?: boolean;
    error?: string;
    connectedUser?: string;
    sessionId?: string;
    iceServers?: IceServer[];
  }>("WatchDevice", deviceId);

export const stopWatching = (deviceId: string) =>
  connection?.invoke("StopWatching", deviceId);

export const sendInput = (deviceId: string, input: any) =>
  connection?.invoke("SendInput", deviceId, input);

export const forceDisconnect = (deviceId: string) =>
  connection?.invoke("ForceDisconnect", deviceId);

export const sendSdpAnswer = (deviceId: string, sdp: string) =>
  connection?.invoke("SendSdpAnswer", deviceId, sdp);

export const sendIceCandidate = (deviceId: string, candidate: IceCandidateWire) =>
  connection?.invoke("SendIceCandidate", deviceId, candidate);
