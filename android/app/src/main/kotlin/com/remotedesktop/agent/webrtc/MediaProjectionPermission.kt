package com.remotedesktop.agent.webrtc

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import kotlinx.coroutines.CompletableDeferred

// Bridge for collecting a MediaProjection permission token from an Activity
// context (the only place createScreenCaptureIntent() can be launched). The
// AgentService can't call it directly, so it spawns
// MediaProjectionPermissionActivity, awaits the deferred, then uses the
// resultCode + Intent to build a MediaProjection.
//
// One pending request at a time; the service serializes capture starts.
object MediaProjectionPermission {

    @Volatile
    private var pending: CompletableDeferred<Granted?>? = null

    data class Granted(val resultCode: Int, val data: Intent)

    fun isAvailable(): Boolean = pending == null

    // Suspends until the launched Activity completes the deferred. If the user
    // denies, returns null. Caller is responsible for having started the
    // activity (we don't do it here so the service controls intent flags).
    suspend fun await(): Granted? {
        val d = CompletableDeferred<Granted?>()
        pending = d
        return try { d.await() } finally { pending = null }
    }

    internal fun complete(value: Granted?) {
        pending?.complete(value)
    }

    fun launch(context: Context) {
        val intent = Intent(context, MediaProjectionPermissionActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        context.startActivity(intent)
    }
}

// Transparent, no-UI activity. Launches the system's MediaProjection consent
// dialog, then completes the deferred with the result and finishes itself.
class MediaProjectionPermissionActivity : ComponentActivity() {

    private val launcher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val granted = if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            MediaProjectionPermission.Granted(result.resultCode, result.data!!)
        } else null
        if (granted == null) Log.w(TAG, "MediaProjection consent denied or cancelled")
        MediaProjectionPermission.complete(granted)
        finish()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Treat back as denial so the awaiter doesn't hang forever. Modern
        // dispatcher API (API 33+ deprecated the onBackPressed override).
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                MediaProjectionPermission.complete(null)
                finish()
            }
        })
        val mgr = getSystemService(MediaProjectionManager::class.java)
        if (mgr == null) {
            MediaProjectionPermission.complete(null)
            finish()
            return
        }
        // On API 34+ the system requires the foreground service of type
        // mediaProjection to be running BEFORE getMediaProjection is called.
        // AgentService elevates its foreground service type before calling
        // WebRtcCaptureSession.startCapture.
        launcher.launch(mgr.createScreenCaptureIntent())
    }

    companion object { private const val TAG = "MediaProjPerm" }
}
