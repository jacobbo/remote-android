package com.remotedesktop.agent.models

import kotlinx.serialization.Serializable

// ── REST DTOs (kotlinx.serialization) ─────────────────────────────────────

@Serializable
data class PairRequest(
    val token: String,
    val name: String,
    val model: String? = null,
    val osVersion: String? = null,
    val ipAddress: String? = null,
)

@Serializable
data class PairResponse(
    val deviceId: String,
    val name: String,
    val trustKey: String,
    val token: String,
    val expiresInSeconds: Int,
)

@Serializable
data class ConnectRequest(
    val deviceId: String,
    val trustKey: String,
)

@Serializable
data class ConnectResponse(
    val token: String,
    val expiresInSeconds: Int,
    val deviceName: String,
)

@Serializable
data class ApiError(val error: String? = null)

// ── Hub payloads (Jackson-friendly POJOs for SignalR) ─────────────────────
//
// Microsoft's SignalR Java client serializes/deserializes hub args via
// Jackson. These classes therefore use mutable properties + a no-arg
// constructor so Jackson can populate them reflectively.

class AgentRegistration() {
    var battery: Int? = null
    var signal: Int? = null
    var orientation: String? = null
    var resolution: String? = null

    constructor(battery: Int?, signal: Int?, orientation: String?, resolution: String?) : this() {
        this.battery = battery
        this.signal = signal
        this.orientation = orientation
        this.resolution = resolution
    }
}

class AgentStatus() {
    var battery: Int? = null
    var signal: Int? = null
    var orientation: String? = null

    constructor(battery: Int?, signal: Int?, orientation: String?) : this() {
        this.battery = battery
        this.signal = signal
        this.orientation = orientation
    }
}

class AgentMetrics() {
    var fps: Int? = null
    var bitrateKbps: Int? = null
    var latencyMs: Int? = null
    var droppedFrames: Int? = null

    constructor(fps: Int?, bitrateKbps: Int?, latencyMs: Int?, droppedFrames: Int?) : this() {
        this.fps = fps
        this.bitrateKbps = bitrateKbps
        this.latencyMs = latencyMs
        this.droppedFrames = droppedFrames
    }
}

// Server → device push for TURN/STUN credentials. Arrives as the payload of
// the SignalR "StartCapture" event so the agent's PeerConnection has fresh
// ephemeral credentials at the moment it builds its offer. urls + username +
// credential mirror RTCIceServer; the latter two are absent for STUN-only
// entries, and the entire array is empty for LAN-only deployments.
class IceServerWire {
    var urls: List<String> = emptyList()
    var username: String? = null
    var credential: String? = null
}

// WebRTC ICE candidate wire shape. Matches Hubs/AgentHub.cs IceCandidate +
// browser RTCIceCandidateInit.
class IceCandidateWire() {
    var candidate: String? = null
    var sdpMid: String? = null
    var sdpMLineIndex: Int? = null

    constructor(candidate: String?, sdpMid: String?, sdpMLineIndex: Int?) : this() {
        this.candidate = candidate
        this.sdpMid = sdpMid
        this.sdpMLineIndex = sdpMLineIndex
    }
}

// Server → device push payload. Shape matches Models/InputEvent.cs.
class WireInputEvent {
    var type: String = ""
    var x: Double? = null
    var y: Double? = null
    var startX: Double? = null
    var startY: Double? = null
    var endX: Double? = null
    var endY: Double? = null
    var durationMs: Int? = null
    var deltaY: Double? = null
    var keyCode: String? = null
}
