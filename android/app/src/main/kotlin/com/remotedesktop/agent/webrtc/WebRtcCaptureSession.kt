package com.remotedesktop.agent.webrtc

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RTCStatsCollectorCallback
import org.webrtc.RtpReceiver
import org.webrtc.RtpSender
import org.webrtc.RtpTransceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import java.util.concurrent.atomic.AtomicBoolean

// Owns the long-lived screen capture pipeline plus zero-or-one PeerConnection
// at a time. The pipeline (MediaProjection + ScreenCapturerAndroid + VideoTrack)
// is started once on the first viewer connect — subsequent viewer connect /
// disconnect cycles only attach/detach a fresh PeerConnection. The system
// MediaProjection consent dialog therefore appears once per agent process,
// not once per viewer session.
//
// Lifecycle:
//   startCapture(projectionData)  → consent already granted, start the pipeline
//   attachPeer(peerCallbacks)     → create PC bound to the live VideoTrack,
//                                   create + send offer
//   acceptRemoteAnswer(sdp), addRemoteIce(candidate)
//   detachPeer()                  → close PC only; capture stays warm
//   close()                       → full teardown (service stop, or projection
//                                   revoked by user via system UI)
class WebRtcCaptureSession(
    private val context: Context,
    private val captureCallbacks: CaptureCallbacks,
) {

    interface PeerCallbacks {
        fun onLocalSdpOffer(sdp: String)
        fun onLocalIceCandidate(candidate: IceCandidate)
        fun onPeerFailed(reason: String)
    }

    interface CaptureCallbacks {
        // Fired when the OS-side MediaProjection ends (user revoked via the
        // system "Stop sharing" notification, or the system killed it).
        fun onProjectionStopped()
    }

    data class Config(
        val width: Int,
        val height: Int,
        val fps: Int = 30,
    )

    data class StatsSnapshot(
        val fps: Int? = null,
        val bitrateKbps: Int? = null,
        val droppedFrames: Int? = null,
        val latencyMs: Int? = null,
    )

    private val captureRunning = AtomicBoolean(false)
    private val eglBase: EglBase = EglBase.create()
    private var factory: PeerConnectionFactory? = null
    private var capturer: ScreenCapturerAndroid? = null
    private var helper: SurfaceTextureHelper? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    private var peer: PeerConnection? = null
    private var peerCallbacks: PeerCallbacks? = null
    private var videoSender: RtpSender? = null

    // Tracks the previous bytesSent + timestamp so we can compute bitrate from
    // the cumulative outbound-rtp counter. Reset whenever the peer is rebuilt.
    private var lastBytesSent: Long? = null
    private var lastStatsAtMs: Long? = null

    val isCaptureRunning: Boolean get() = captureRunning.get()
    val isPeerAttached: Boolean get() = peer != null

    fun startCapture(
        projectionResultCode: Int,
        projectionData: Intent,
        config: Config = defaultConfig(),
    ) {
        if (!captureRunning.compareAndSet(false, true)) {
            Log.w(TAG, "startCapture() called while already running — ignoring")
            return
        }
        try { initFactory() } catch (t: Throwable) {
            captureRunning.set(false); throw t
        }

        val f = factory!!
        val cap = ScreenCapturerAndroid(projectionData, object : MediaProjection.Callback() {
            override fun onStop() {
                Log.i(TAG, "MediaProjection stopped (user revoked or system)")
                captureCallbacks.onProjectionStopped()
            }
        }).also { capturer = it }

        val h = SurfaceTextureHelper.create("ScreenCaptureHelper", eglBase.eglBaseContext)
            .also { helper = it }
        val source = f.createVideoSource(cap.isScreencast).also { videoSource = it }
        cap.initialize(h, context, source.capturerObserver)
        cap.startCapture(config.width, config.height, config.fps)

        videoTrack = f.createVideoTrack(VIDEO_TRACK_ID, source)

        Log.i(TAG, "Capture pipeline started ${config.width}x${config.height}@${config.fps}fps")
    }

    fun attachPeer(callbacks: PeerCallbacks, iceServers: List<PeerConnection.IceServer> = emptyList()) {
        check(captureRunning.get()) { "capture not started" }
        if (peer != null) {
            Log.w(TAG, "attachPeer() called while peer already attached — replacing")
            detachPeer()
        }
        val f = factory ?: error("factory missing")
        val track = videoTrack ?: error("video track missing")

        // Empty ICE-server list keeps things LAN-only (host candidates only).
        // The agent fetches TURN credentials via /api/ice-servers per agent
        // session; coturn validates them against its static-auth-secret.
        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        // Snapshot callbacks into the observer so any late events from a
        // closing PC don't accidentally route through a freshly-attached one.
        val pc = f.createPeerConnection(rtcConfig, peerObserverFor(callbacks))
            ?: error("peer_connection_create_failed")
        peer = pc
        peerCallbacks = callbacks
        videoSender = pc.addTrack(track, listOf(STREAM_ID))

        pc.transceivers.firstOrNull { it.mediaType.name.contains("VIDEO") }
            ?.direction = RtpTransceiver.RtpTransceiverDirection.SEND_ONLY

        applyBitrateCap()
        // Stats counters are per-peer; reset so the first delta after re-attach
        // doesn't compute against the previous peer's counters.
        lastBytesSent = null
        lastStatsAtMs = null

        Log.i(TAG, "Peer attached — creating offer")
        createOffer(callbacks)
    }

    private fun applyBitrateCap() {
        val sender = videoSender ?: return
        val params = sender.parameters ?: return
        val updated = params.encodings.map { enc ->
            enc.also { it.maxBitrateBps = MAX_BITRATE_BPS }
        }
        // Re-assigning the encodings list and pushing back is the supported
        // way to tune the sender on stream-webrtc-android.
        params.encodings.clear()
        params.encodings.addAll(updated)
        sender.parameters = params
    }

    fun requestStats(callback: (StatsSnapshot) -> Unit) {
        val pc = peer
        if (pc == null) { callback(StatsSnapshot()); return }
        pc.getStats(RTCStatsCollectorCallback { report ->
            var fps: Int? = null
            var bitrate: Int? = null
            var dropped: Int? = null
            var latency: Int? = null

            val outbound = report.statsMap.values.firstOrNull { s ->
                s.type == "outbound-rtp" && (s.members["kind"] as? String) == "video"
            }
            if (outbound != null) {
                (outbound.members["framesPerSecond"] as? Number)?.let { fps = it.toInt() }
                (outbound.members["framesDropped"] as? Number)?.let { dropped = it.toInt() }

                val bytesSent = (outbound.members["bytesSent"] as? Number)?.toLong()
                val nowMs = System.currentTimeMillis()
                val prevBytes = lastBytesSent
                val prevAt = lastStatsAtMs
                if (bytesSent != null && prevBytes != null && prevAt != null && nowMs > prevAt) {
                    val deltaBits = (bytesSent - prevBytes) * 8.0
                    val deltaSec = (nowMs - prevAt) / 1000.0
                    if (deltaSec > 0) bitrate = (deltaBits / deltaSec / 1000.0).toInt()
                }
                if (bytesSent != null) {
                    lastBytesSent = bytesSent
                    lastStatsAtMs = nowMs
                }
            }

            val remote = report.statsMap.values.firstOrNull { s ->
                s.type == "remote-inbound-rtp" && (s.members["kind"] as? String) == "video"
            }
            (remote?.members?.get("roundTripTime") as? Number)?.let {
                latency = (it.toDouble() * 1000.0).toInt()
            }

            callback(StatsSnapshot(fps, bitrate, dropped, latency))
        })
    }

    fun detachPeer() {
        val pc = peer ?: return
        Log.i(TAG, "Detaching peer (capture stays warm)")
        runCatching { pc.close() }
        runCatching { pc.dispose() }
        peer = null
        peerCallbacks = null
        videoSender = null
    }

    fun acceptRemoteAnswer(sdp: String) {
        val pc = peer ?: return
        pc.setRemoteDescription(loggingSdpObserver("setRemote"),
            SessionDescription(SessionDescription.Type.ANSWER, sdp))
    }

    fun addRemoteIce(candidate: IceCandidate) {
        peer?.addIceCandidate(candidate)
    }

    fun close() {
        if (!captureRunning.compareAndSet(true, false)) return
        detachPeer()
        runCatching { capturer?.stopCapture() }
        runCatching { capturer?.dispose() }
        runCatching { helper?.dispose() }
        runCatching { videoTrack?.dispose() }
        runCatching { videoSource?.dispose() }
        runCatching { factory?.dispose() }
        runCatching { eglBase.release() }
        capturer = null; helper = null
        videoTrack = null; videoSource = null
        factory = null
        Log.i(TAG, "Capture session fully closed")
    }

    private fun initFactory() {
        // PeerConnectionFactory.initialize is process-global and idempotent
        // when called with the same options.
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions
                .builder(context.applicationContext)
                .setEnableInternalTracer(false)
                .createInitializationOptions()
        )
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(
                DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true)
            )
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()
    }

    private fun createOffer(cb: PeerCallbacks) {
        val pc = peer ?: return
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "false"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
        }
        pc.createOffer(object : SdpObserver {
            override fun onCreateSuccess(desc: SessionDescription) {
                pc.setLocalDescription(loggingSdpObserver("setLocal"), desc)
                cb.onLocalSdpOffer(desc.description)
            }
            override fun onSetSuccess() {}
            override fun onCreateFailure(error: String?) {
                Log.w(TAG, "createOffer failed: $error")
                cb.onPeerFailed("offer_failed:$error")
            }
            override fun onSetFailure(error: String?) {
                Log.w(TAG, "setLocal failed: $error")
            }
        }, constraints)
    }

    private fun peerObserverFor(cb: PeerCallbacks) = object : PeerConnection.Observer {
        override fun onIceCandidate(candidate: IceCandidate) {
            cb.onLocalIceCandidate(candidate)
        }
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
            Log.i(TAG, "ICE state $state")
            if (state == PeerConnection.IceConnectionState.FAILED)
                cb.onPeerFailed("ice_failed")
        }
        override fun onSignalingChange(state: PeerConnection.SignalingState) {}
        override fun onIceConnectionReceivingChange(receiving: Boolean) {}
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
        override fun onAddStream(stream: MediaStream) {}
        override fun onRemoveStream(stream: MediaStream) {}
        override fun onDataChannel(channel: DataChannel) {}
        override fun onRenegotiationNeeded() {}
        override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) {}
    }

    private fun loggingSdpObserver(label: String) = object : SdpObserver {
        override fun onCreateSuccess(p0: SessionDescription) {}
        override fun onSetSuccess() { Log.d(TAG, "$label ok") }
        override fun onCreateFailure(p0: String?) { Log.w(TAG, "$label create failed: $p0") }
        override fun onSetFailure(p0: String?) { Log.w(TAG, "$label set failed: $p0") }
    }

    private fun defaultConfig(): Config {
        val wm = context.getSystemService(WindowManager::class.java)
        val metrics = DisplayMetrics().also {
            @Suppress("DEPRECATION") wm.defaultDisplay.getRealMetrics(it)
        }
        // Cap the long edge to 1280 to keep encoder bandwidth sane on mid-tier
        // phones; preserve the aspect ratio.
        val (w, h) = scaleToMaxEdge(metrics.widthPixels, metrics.heightPixels, 1280)
        return Config(width = w, height = h)
    }

    private fun scaleToMaxEdge(w: Int, h: Int, max: Int): Pair<Int, Int> {
        val long = maxOf(w, h)
        if (long <= max) return w to h
        val k = max.toDouble() / long
        // WebRTC encoders prefer even dimensions.
        fun even(v: Double) = (v.toInt() / 2) * 2
        return even(w * k) to even(h * k)
    }

    companion object {
        private const val TAG = "WebRtcCapture"
        private const val VIDEO_TRACK_ID = "screen0"
        private const val STREAM_ID = "stream0"
        // 1.5 Mbps cap — keeps a 720p screen stream comfortable on a LAN while
        // leaving headroom for several concurrent devices on a Pi-class router.
        // Phase 6 should expose this via config / per-device tuning.
        private const val MAX_BITRATE_BPS = 1_500_000
    }
}
