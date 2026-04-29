package com.remotedesktop.agent.control

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.remotedesktop.agent.AgentApp
import com.remotedesktop.agent.MainActivity
import com.remotedesktop.agent.R
import com.remotedesktop.agent.input.InputAccessibilityService
import com.remotedesktop.agent.input.InputDispatcher
import com.remotedesktop.agent.models.ConnectRequest
import com.remotedesktop.agent.models.IceCandidateWire
import com.remotedesktop.agent.models.IceServerWire
import com.remotedesktop.agent.status.StatusReporter
import org.webrtc.PeerConnection
import com.remotedesktop.agent.webrtc.MediaProjectionPermission
import com.remotedesktop.agent.webrtc.WebRtcCaptureSession
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.webrtc.IceCandidate

// Foreground service that owns the SignalR connection and the periodic
// status reporter. Lifecycle:
//   start  → reconnect loop until stopped
//   stop   → graceful disconnect, foreground notification cleared
//
// On the media plane: the service receives StartCapture / StopCapture pushes
// from the hub. StartCapture launches the MediaProjection consent activity,
// elevates the foreground service to include MEDIA_PROJECTION on Android 14+,
// and creates a WebRtcCaptureSession. SDP/ICE flows back through SignalR.
//
// The service does NOT directly inject input — that runs from the
// InputAccessibilityService (only a system AccessibilityService can dispatch
// gestures). InputDispatcher is the in-memory bridge between the two.
class AgentService : LifecycleService() {

    private var workJob: Job? = null
    private var signalR: SignalRClient? = null
    // Long-lived capture pipeline: stays warm across viewer connect/disconnect
    // cycles so the MediaProjection consent dialog only appears once per agent
    // process. Fully torn down only on service stop or projection revocation.
    private var capture: WebRtcCaptureSession? = null
    private val captureScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val captureMutex = Mutex()
    // Held while a viewer is attached so the display doesn't sleep — without
    // this the capture surface stops receiving fresh frames and the viewer sees
    // a black screen. SCREEN_BRIGHT_WAKE_LOCK + ACQUIRE_CAUSES_WAKEUP is the
    // standard pattern for screen-mirroring apps (deprecated but still works
    // and is the only API that turns the display on from a Service).
    private var screenWakeLock: PowerManager.WakeLock? = null
    // Held for the foreground service's whole lifetime. Without it, Android's
    // App Standby + Doze suspend the OkHttp socket within a few minutes of
    // screen-off — the agent process keeps running but its SignalR WebSocket
    // gets severed and the dashboard shows the device offline until the user
    // re-opens the app. PARTIAL_WAKE_LOCK keeps the CPU running just enough
    // to honour socket pings; the screen + radio still sleep normally.
    private var serviceWakeLock: PowerManager.WakeLock? = null
    // Set by the most recent StartCapture push. The backend mints fresh creds
    // server-side per session and ships them as the SignalR payload, so the
    // agent never has to round-trip a separate REST call. Reset on detach.
    @Volatile
    private var iceServers: List<PeerConnection.IceServer> = emptyList()

    override fun onBind(intent: Intent): IBinder? {
        super.onBind(intent)
        return null
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        when (intent?.action) {
            ACTION_STOP -> { stopSelfSafely(); return START_NOT_STICKY }
            else -> { ensureRunning() }
        }
        return START_STICKY
    }

    private fun ensureRunning() {
        if (workJob?.isActive == true) return

        val identity = AgentApp.get().identity
        if (!identity.isPaired) {
            Log.w(TAG, "Service started but device is not paired — stopping")
            stopSelfSafely()
            return
        }

        startForegroundCompat(identity.serverUrl ?: "", capturing = false)
        acquireServiceWakeLock()

        workJob = lifecycleScope.launch {
            // Outer loop keeps the agent reconnected on transient failures.
            // Each iteration: get a fresh device token, open SignalR, run the
            // status loop, then on disconnect/error back off and retry.
            var backoff = 2_000L
            while (isActive) {
                try {
                    val api = AgentApi(identity.serverUrl!!)
                    val conn = api.connect(ConnectRequest(identity.deviceId!!, identity.trustKey!!))

                    val client = SignalRClient(
                        baseUrl = identity.serverUrl!!,
                        token = conn.token,
                        onInput = { wire -> InputDispatcher.deliver(wire) },
                        onStartCapture = { servers -> handleStartCapture(servers) },
                        onStopCapture = { handleStopCapture() },
                        onSdpAnswer = { sdp -> capture?.acceptRemoteAnswer(sdp) },
                        onIceCandidate = { wire -> handleRemoteIce(wire) },
                        onRevoked = { handleRevoked() },
                        onClosed = { ex -> Log.w(TAG, "Hub closed", ex) }
                    )
                    signalR = client
                    client.connect()

                    val ctx = applicationContext
                    val initial = StatusReporter.snapshot(ctx)
                    client.register(initial.toRegistration())

                    backoff = 2_000L
                    runStatusLoop(ctx, client)
                } catch (cancel: kotlinx.coroutines.CancellationException) {
                    throw cancel
                } catch (t: Throwable) {
                    Log.w(TAG, "Agent loop iteration failed", t)
                }

                runCatching { signalR?.stop() }
                signalR = null
                handleStopCapture() // hub gone → drop any active capture too
                if (!isActive) break
                delay(backoff)
                backoff = (backoff * 2).coerceAtMost(60_000L)
            }
        }
    }

    private suspend fun runStatusLoop(ctx: Context, client: SignalRClient) {
        while (lifecycleScope.isActive && client.isConnected) {
            delay(STATUS_INTERVAL_MS)
            val snap = StatusReporter.snapshot(ctx)
            runCatching { client.reportStatus(snap.toStatus()) }
        }
    }

    private fun handleRevoked() {
        Log.w(TAG, "Server-side trust revoked — unpairing and stopping service")
        captureScope.launch {
            captureMutex.withLock {
                runCatching { capture?.close() }
                capture = null
                releaseScreenWakeLock()
            }
            runCatching { AgentApp.get().identity.unpair() }
            stopSelfSafely()
        }
    }

    // ── Capture lifecycle (driven by hub messages) ──────────────────────
    //
    // The MediaProjection + capture pipeline is created once on the first
    // viewer connect (consent prompt) and kept warm between viewers. Each
    // StartCapture only attaches a fresh PeerConnection to the existing video
    // track; StopCapture only detaches it. Full teardown happens on service
    // stop or when the user revokes the projection via the system UI.

    private fun handleStartCapture(servers: Array<IceServerWire>) {
        // Latch the latest credentials so any in-flight peer attach uses them.
        // Empty array stays empty → host-only candidates (LAN-only deployment).
        iceServers = servers.map(::toRtcIceServer)
        captureScope.launch {
            captureMutex.withLock {
                if (capture?.isPeerAttached == true) {
                    Log.i(TAG, "StartCapture but viewer already attached — ignored")
                    return@withLock
                }

                if (capture == null) {
                    Log.i(TAG, "First viewer — requesting MediaProjection consent")
                    if (!MediaProjectionPermission.isAvailable()) {
                        Log.w(TAG, "Another consent request is already pending — bail")
                        return@withLock
                    }
                    MediaProjectionPermission.launch(applicationContext)
                    val granted = MediaProjectionPermission.await()
                    if (granted == null) {
                        Log.w(TAG, "MediaProjection consent denied — capture aborted")
                        return@withLock
                    }

                    // API 34+: foreground service must be MEDIA_PROJECTION
                    // *before* getMediaProjection is invoked inside the capturer.
                    startForegroundCompat(AgentApp.get().identity.serverUrl ?: "", capturing = true)

                    val session = WebRtcCaptureSession(applicationContext, captureLifecycleCallbacks())
                    val ok = runCatching { session.startCapture(granted.resultCode, granted.data) }
                        .onFailure { t -> Log.w(TAG, "Capture pipeline failed to start", t) }
                        .isSuccess
                    if (!ok) {
                        startForegroundCompat(AgentApp.get().identity.serverUrl ?: "", capturing = false)
                        return@withLock
                    }
                    capture = session
                }

                val session = capture!!
                val attached = runCatching { session.attachPeer(peerCallbacks(), iceServers) }
                    .onFailure { t -> Log.w(TAG, "attachPeer failed", t) }
                    .isSuccess
                if (attached) {
                    acquireScreenWakeLock()
                    // Best-effort: dismiss the keyguard for swipe-to-unlock
                    // devices. Secured locks (PIN/pattern/biometric) can't be
                    // bypassed by any non-system app — that path is a no-op.
                    runCatching { ScreenUnlockActivity.launch(applicationContext) }
                }
            }
        }
    }

    private fun handleStopCapture() {
        captureScope.launch {
            captureMutex.withLock {
                val s = capture ?: return@withLock
                if (!s.isPeerAttached) return@withLock
                Log.i(TAG, "StopCapture — detaching peer (capture stays warm)")
                runCatching { s.detachPeer() }
                releaseScreenWakeLock()
            }
        }
    }

    private fun handleProjectionRevoked() {
        captureScope.launch {
            captureMutex.withLock {
                val s = capture ?: return@withLock
                Log.w(TAG, "MediaProjection revoked externally — full teardown")
                runCatching { s.close() }
                capture = null
                releaseScreenWakeLock()
                startForegroundCompat(AgentApp.get().identity.serverUrl ?: "", capturing = false)
            }
        }
    }

    private fun acquireScreenWakeLock() {
        if (screenWakeLock?.isHeld == true) return
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        @Suppress("DEPRECATION")
        val wl = pm.newWakeLock(
            PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                PowerManager.ACQUIRE_CAUSES_WAKEUP or
                PowerManager.ON_AFTER_RELEASE,
            "RemoteDesktop:viewer"
        )
        runCatching { wl.acquire(MAX_WAKE_LOCK_MS) }
            .onFailure { t -> Log.w(TAG, "Failed to acquire wake lock", t) }
        screenWakeLock = wl
    }

    private fun releaseScreenWakeLock() {
        val wl = screenWakeLock ?: return
        if (wl.isHeld) runCatching { wl.release() }
        screenWakeLock = null
    }

    private fun acquireServiceWakeLock() {
        if (serviceWakeLock?.isHeld == true) return
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RemoteDesktop:service")
        wl.setReferenceCounted(false)
        runCatching { wl.acquire() }  // no timeout — released on stopSelfSafely / onDestroy
            .onFailure { t -> Log.w(TAG, "Failed to acquire service wake lock", t) }
        serviceWakeLock = wl
    }

    private fun releaseServiceWakeLock() {
        val wl = serviceWakeLock ?: return
        if (wl.isHeld) runCatching { wl.release() }
        serviceWakeLock = null
    }

    private fun handleRemoteIce(wire: IceCandidateWire) {
        val mid = wire.sdpMid ?: return
        val idx = wire.sdpMLineIndex ?: return
        val sdp = wire.candidate ?: return
        capture?.addRemoteIce(IceCandidate(mid, idx, sdp))
    }

    private fun captureLifecycleCallbacks() = object : WebRtcCaptureSession.CaptureCallbacks {
        override fun onProjectionStopped() { handleProjectionRevoked() }
    }

    private fun peerCallbacks() = object : WebRtcCaptureSession.PeerCallbacks {
        override fun onLocalSdpOffer(sdp: String) {
            captureScope.launch { runCatching { signalR?.sendSdpOffer(sdp) } }
        }
        override fun onLocalIceCandidate(candidate: IceCandidate) {
            val wire = IceCandidateWire(
                candidate = candidate.sdp,
                sdpMid = candidate.sdpMid,
                sdpMLineIndex = candidate.sdpMLineIndex,
            )
            captureScope.launch { runCatching { signalR?.sendIceCandidate(wire) } }
        }
        override fun onPeerFailed(reason: String) {
            Log.w(TAG, "WebRTC peer failed: $reason — detaching")
            handleStopCapture()
        }
    }

    private fun stopSelfSafely() {
        workJob?.cancel()
        workJob = null
        // Tear down capture pipeline synchronously since we're about to cancel
        // the captureScope. close() is internally null-safe and idempotent.
        runCatching { capture?.close() }
        capture = null
        releaseScreenWakeLock()
        releaseServiceWakeLock()
        captureScope.cancel()
        lifecycleScope.launch { runCatching { signalR?.stop() } }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
        @Suppress("DEPRECATION") if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) stopForeground(true)
        stopSelf()
    }

    override fun onDestroy() {
        workJob?.cancel()
        workJob = null
        // Belt-and-braces: stopSelfSafely already releases, but if the service
        // is destroyed via some other path (LMKD, crash) we still want the
        // wake lock back so the system isn't holding our CPU forever.
        releaseServiceWakeLock()
        releaseScreenWakeLock()
        super.onDestroy()
    }

    private fun startForegroundCompat(host: String, capturing: Boolean) {
        val openApp = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pi = PendingIntent.getActivity(
            this, 0, openApp,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val text = if (capturing)
            getString(R.string.notif_capturing_text, host)
        else
            getString(R.string.notif_running_text, host)
        val n: Notification = NotificationCompat.Builder(this, AgentApp.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(getString(if (capturing) R.string.notif_capturing_title else R.string.notif_running_title))
            .setContentText(text)
            .setContentIntent(pi)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val type = if (capturing)
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            else
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            startForeground(AgentApp.NOTIF_ID_RUNNING, n, type)
        } else {
            startForeground(AgentApp.NOTIF_ID_RUNNING, n)
        }
    }

    companion object {
        private const val TAG = "AgentService"
        private const val STATUS_INTERVAL_MS = 30_000L
        // Safety upper bound on the screen wake lock so a misbehaving session
        // can't drain the battery indefinitely. Re-acquired on each viewer.
        private const val MAX_WAKE_LOCK_MS = 4 * 60 * 60 * 1000L
        const val ACTION_STOP = "com.remotedesktop.agent.action.STOP"

        fun start(context: Context) {
            val intent = Intent(context, AgentService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, AgentService::class.java).setAction(ACTION_STOP)
            context.startService(intent)
        }

        fun isAccessibilityEnabled(context: Context): Boolean =
            InputAccessibilityService.isEnabled(context)

        // Wire-shape (List<String> urls + username + credential) → the WebRTC
        // SDK type. The TURN scheme uses .setPassword() for the credential.
        private fun toRtcIceServer(src: IceServerWire): PeerConnection.IceServer {
            val builder = PeerConnection.IceServer.builder(src.urls)
            src.username?.let { builder.setUsername(it) }
            src.credential?.let { builder.setPassword(it) }
            return builder.createIceServer()
        }
    }
}
