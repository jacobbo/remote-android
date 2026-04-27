package com.remotedesktop.agent.input

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.ComponentName
import android.content.Context
import android.graphics.Path
import android.media.AudioManager
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import com.remotedesktop.agent.models.WireInputEvent

class InputAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.i(TAG, "Accessibility service connected — input bridge active")
        InputDispatcher.attach { event -> dispatchEvent(event) }
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        InputDispatcher.detach()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        InputDispatcher.detach()
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) { /* no-op */ }
    override fun onInterrupt() { /* no-op */ }

    private fun dispatchEvent(event: WireInputEvent) {
        try {
            when (event.type.lowercase()) {
                "tap" -> tap(event.x ?: return, event.y ?: return)
                "swipe" -> swipe(
                    event.startX ?: return, event.startY ?: return,
                    event.endX ?: return, event.endY ?: return,
                    event.durationMs ?: 200
                )
                "scroll" -> {
                    val cx = event.x ?: return
                    val cy = event.y ?: return
                    val dy = event.deltaY ?: return
                    swipe(cx, cy, cx, cy - dy, 200)
                }
                "key" -> key(event.keyCode ?: return)
                else -> Log.w(TAG, "Unknown input type: ${event.type}")
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Failed to dispatch input ${event.type}", t)
        }
    }

    private fun tap(x: Double, y: Double) {
        val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
        val stroke = GestureDescription.StrokeDescription(path, 0L, 60L)
        dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    private fun swipe(sx: Double, sy: Double, ex: Double, ey: Double, durationMs: Int) {
        val path = Path().apply {
            moveTo(sx.toFloat(), sy.toFloat())
            lineTo(ex.toFloat(), ey.toFloat())
        }
        val stroke = GestureDescription.StrokeDescription(path, 0L, durationMs.toLong().coerceAtLeast(20L))
        dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    private fun key(keyCode: String) {
        // Accessibility services can perform global actions for the system
        // navigation keys. Volume/screen-off use AudioManager / global action.
        // KeyEvent injection beyond this requires system-level INJECT_EVENTS.
        when (keyCode.uppercase()) {
            "KEYCODE_HOME"   -> performGlobalAction(GLOBAL_ACTION_HOME)
            "KEYCODE_BACK"   -> performGlobalAction(GLOBAL_ACTION_BACK)
            "KEYCODE_APP_SWITCH", "KEYCODE_RECENTS" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
            "KEYCODE_POWER"  -> performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN)
            "KEYCODE_NOTIFICATIONS" -> performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)
            "KEYCODE_VOLUME_UP" -> volume(AudioManager.ADJUST_RAISE)
            "KEYCODE_VOLUME_DOWN" -> volume(AudioManager.ADJUST_LOWER)
            "KEYCODE_VOLUME_MUTE" -> volume(AudioManager.ADJUST_TOGGLE_MUTE)
            else -> Log.w(TAG, "Unhandled keycode: $keyCode")
        }
    }

    private fun volume(direction: Int) {
        val am = getSystemService(AUDIO_SERVICE) as AudioManager
        am.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI)
    }

    companion object {
        private const val TAG = "InputAccessibility"

        // Reads the system list of enabled accessibility services and checks
        // whether ours is in there — there's no public callback for this.
        fun isEnabled(context: Context): Boolean {
            val expected = ComponentName(context, InputAccessibilityService::class.java).flattenToString()
            val enabled = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ).orEmpty()
            return enabled.split(':').any { it.equals(expected, ignoreCase = true) }
        }
    }
}
