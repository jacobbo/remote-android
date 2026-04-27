package com.remotedesktop.agent.input

import com.remotedesktop.agent.models.WireInputEvent
import java.util.concurrent.ConcurrentLinkedQueue

// Process-local handoff between the SignalR receive callback (in
// AgentService) and the AccessibilityService (which is the only component
// that can actually dispatch gestures/global actions).
//
// The accessibility service is hosted by the system in the same process, so
// a static reference works without IPC. If the service isn't running yet,
// events are buffered briefly so the first taps after enabling don't drop.
object InputDispatcher {

    @Volatile private var sink: ((WireInputEvent) -> Unit)? = null
    private val pending = ConcurrentLinkedQueue<WireInputEvent>()

    fun attach(sink: (WireInputEvent) -> Unit) {
        this.sink = sink
        while (true) {
            val ev = pending.poll() ?: break
            sink(ev)
        }
    }

    fun detach() { sink = null }

    fun deliver(event: WireInputEvent) {
        val s = sink
        if (s != null) s(event) else pending.offer(event)
        // Keep the buffer bounded — drop oldest beyond a small head.
        while (pending.size > BUFFER_MAX) pending.poll()
    }

    private const val BUFFER_MAX = 32
}
