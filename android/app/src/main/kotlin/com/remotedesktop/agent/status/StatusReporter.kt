package com.remotedesktop.agent.status

import android.content.Context
import android.net.wifi.WifiManager
import android.os.BatteryManager
import com.remotedesktop.agent.models.AgentRegistration
import com.remotedesktop.agent.models.AgentStatus

// Periodic device telemetry. Read directly from Android system services on
// each tick — no caching, the values are cheap to fetch and we want each
// snapshot to be authoritative.
data class StatusSnapshot(
    val battery: Int?,
    val signalBars: Int?,
    val resolution: String?,
) {
    fun toRegistration() = AgentRegistration(battery, signalBars, resolution)
    fun toStatus() = AgentStatus(battery, signalBars)
}

object StatusReporter {

    fun snapshot(context: Context): StatusSnapshot = StatusSnapshot(
        battery = batteryPercent(context),
        signalBars = wifiBars(context),
        resolution = resolution(context),
    )

    private fun batteryPercent(context: Context): Int? {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager ?: return null
        val pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return if (pct in 0..100) pct else null
    }

    @Suppress("DEPRECATION")
    private fun wifiBars(context: Context): Int? {
        // WifiManager.connectionInfo is restricted on API 31+ without
        // location permission and returns rssi = -127 in that case. We
        // intentionally don't ask for location here — return null when the
        // OS won't give us a real RSSI; the dashboard treats that as
        // "unknown" rather than a confident zero.
        val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return null
        val rssi = runCatching { wm.connectionInfo?.rssi }.getOrNull() ?: return null
        if (rssi == -127) return null
        return WifiManager.calculateSignalLevel(rssi, 5).coerceIn(0, 4)
    }

    private fun resolution(context: Context): String? {
        val dm = context.resources.displayMetrics
        return if (dm.widthPixels > 0 && dm.heightPixels > 0) "${dm.widthPixels}x${dm.heightPixels}" else null
    }
}
