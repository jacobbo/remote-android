package com.remotedesktop.agent.control

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import androidx.activity.ComponentActivity

// Transparent shim that surfaces over the lock screen, wakes the display, and
// asks the system to dismiss the keyguard. The Service can't do any of this
// itself — `setShowWhenLocked` / `setTurnScreenOn` / `requestDismissKeyguard`
// are Activity-only APIs that require an Activity to be foreground.
//
// Behaviour by lock type:
//   • No lock / swipe-to-unlock → keyguard dismisses immediately
//   • PIN / pattern / password / biometric → system unlock UI appears, which
//     only a locally-present user can satisfy. From the remote viewer's
//     perspective this is a no-op (Android does not let any non-system app
//     bypass a secured keyguard).
class ScreenUnlockActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            )
        }

        val km = getSystemService(KEYGUARD_SERVICE) as KeyguardManager
        km.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
            override fun onDismissSucceeded() {
                Log.i(TAG, "Keyguard dismissed")
                finish()
            }
            override fun onDismissCancelled() {
                Log.i(TAG, "Keyguard dismiss cancelled (likely secured lock)")
                finish()
            }
            override fun onDismissError() {
                Log.w(TAG, "Keyguard dismiss error")
                finish()
            }
        })
    }

    companion object {
        private const val TAG = "ScreenUnlock"

        fun launch(context: Context) {
            val intent = Intent(context, ScreenUnlockActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            context.startActivity(intent)
        }
    }
}
