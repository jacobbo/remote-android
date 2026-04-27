package com.remotedesktop.agent.control

import android.util.Log
import com.microsoft.signalr.HubConnection
import com.microsoft.signalr.HubConnectionBuilder
import com.microsoft.signalr.HubConnectionState
import com.remotedesktop.agent.models.AgentMetrics
import com.remotedesktop.agent.models.AgentRegistration
import com.remotedesktop.agent.models.AgentStatus
import com.remotedesktop.agent.models.IceCandidateWire
import com.remotedesktop.agent.models.IceServerWire
import com.remotedesktop.agent.models.WireInputEvent
import io.reactivex.rxjava3.core.Single
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

// Thin coroutine-friendly wrapper around the Microsoft SignalR Java client.
// Owns one HubConnection at a time. The owning AgentService takes a fresh
// device JWT (via AgentApi.connect) and passes it as `token`; reconnect logic
// lives in the service layer.
//
// Server push hooks (set up before connect()):
//   onInput        — user touch/key relayed by the server from the active viewer
//   onStartCapture — viewer asked to start a session, build a WebRTC offer.
//                    Carries fresh ephemeral TURN/STUN credentials minted by
//                    the backend; pass them straight into the PeerConnection
//                    config. Empty array = LAN-only (host candidates).
//   onStopCapture  — viewer disconnected (or admin force-disconnected); tear down
//   onSdpAnswer    — browser's answer to our offer
//   onIceCandidate — browser's ICE candidate
class SignalRClient(
    private val baseUrl: String,
    private val token: String,
    private val onInput: (WireInputEvent) -> Unit,
    private val onStartCapture: (Array<IceServerWire>) -> Unit,
    private val onStopCapture: () -> Unit,
    private val onSdpAnswer: (String) -> Unit,
    private val onIceCandidate: (IceCandidateWire) -> Unit,
    private val onRevoked: () -> Unit,
    private val onClosed: (Throwable?) -> Unit,
) {

    private var hub: HubConnection? = null

    val isConnected: Boolean
        get() = hub?.connectionState == HubConnectionState.CONNECTED

    suspend fun connect() = withContext(Dispatchers.IO) {
        val url = baseUrl.trimEnd('/') + "/hubs/agent"
        val h = HubConnectionBuilder.create(url)
            .withAccessTokenProvider(Single.defer { Single.just(token) })
            .build()

        h.on("ReceiveInput", { event -> onInput(event) }, WireInputEvent::class.java)
        h.on("StartCapture", { servers -> onStartCapture(servers) }, Array<IceServerWire>::class.java)
        h.on("StopCapture", { onStopCapture() })
        h.on("ReceiveSdpAnswer", { sdp -> onSdpAnswer(sdp) }, String::class.java)
        h.on("ReceiveIceCandidate", { c -> onIceCandidate(c) }, IceCandidateWire::class.java)
        h.on("Revoked", { onRevoked() })
        h.onClosed { ex -> onClosed(ex) }

        hub = h
        h.start().awaitCompletable()
        Log.i(TAG, "SignalR connected to $url")
    }

    suspend fun register(reg: AgentRegistration) = invoke("RegisterDevice", reg)
    suspend fun reportStatus(status: AgentStatus) = invoke("ReportStatus", status)
    suspend fun reportMetrics(metrics: AgentMetrics) = invoke("ReportMetrics", metrics)

    suspend fun sendSdpOffer(sdp: String) = invoke("SendSdpOffer", sdp)
    suspend fun sendIceCandidate(candidate: IceCandidateWire) = invoke("SendIceCandidate", candidate)

    suspend fun stop() = withContext(Dispatchers.IO) {
        runCatching { hub?.stop()?.awaitCompletable() }
        hub = null
    }

    private suspend fun invoke(method: String, arg: Any) = withContext(Dispatchers.IO) {
        val h = hub ?: error("not_connected")
        h.invoke(Void::class.java, method, arg).awaitSingle()
    }

    companion object { private const val TAG = "AgentSignalR" }
}

// ── RxJava 3 ↔ coroutine bridge (avoids pulling rxjava-coroutines lib) ──

private suspend fun io.reactivex.rxjava3.core.Completable.awaitCompletable() =
    suspendCancellableCoroutine { cont ->
        val disposable = subscribe(
            { cont.resume(Unit) },
            { e -> cont.resumeWithException(e) }
        )
        cont.invokeOnCancellation { disposable.dispose() }
    }

private suspend fun <T : Any> Single<T>.awaitSingle(): T =
    suspendCancellableCoroutine { cont ->
        val disposable = subscribe(
            { value -> cont.resume(value) },
            { e -> cont.resumeWithException(e) }
        )
        cont.invokeOnCancellation { disposable.dispose() }
    }
