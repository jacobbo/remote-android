package com.remotedesktop.agent

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.remotedesktop.agent.identity.DeviceIdentity

class AgentApp : Application() {

    val identity: DeviceIdentity by lazy { DeviceIdentity(this) }

    override fun onCreate() {
        super.onCreate()
        instance = this

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notif_channel_agent),
                NotificationManager.IMPORTANCE_LOW
            )
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    companion object {
        const val CHANNEL_ID = "agent_running"
        const val NOTIF_ID_RUNNING = 1001

        @Volatile
        private var instance: AgentApp? = null
        fun get(): AgentApp = checkNotNull(instance) { "AgentApp not initialized" }
    }
}
