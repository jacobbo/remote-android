package com.remotedesktop.agent.identity

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

// On-device persistence for the device's identity and trust key. Stored in
// EncryptedSharedPreferences (AES-256-GCM keys + values), backed by Android
// KeyStore. Survives app restarts; cleared by Unpair() or app data wipe.
class DeviceIdentity(context: Context) {

    private val prefs: SharedPreferences = run {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    var serverUrl: String?
        get() = prefs.getString(KEY_SERVER_URL, null)
        set(value) { prefs.edit().putString(KEY_SERVER_URL, value).apply() }

    var deviceId: String?
        get() = prefs.getString(KEY_DEVICE_ID, null)
        set(value) { prefs.edit().putString(KEY_DEVICE_ID, value).apply() }

    var deviceName: String?
        get() = prefs.getString(KEY_DEVICE_NAME, null)
        set(value) { prefs.edit().putString(KEY_DEVICE_NAME, value).apply() }

    var trustKey: String?
        get() = prefs.getString(KEY_TRUST_KEY, null)
        set(value) { prefs.edit().putString(KEY_TRUST_KEY, value).apply() }

    val isPaired: Boolean
        get() = !deviceId.isNullOrBlank() && !trustKey.isNullOrBlank() && !serverUrl.isNullOrBlank()

    fun savePairing(serverUrl: String, deviceId: String, name: String, trustKey: String) {
        prefs.edit()
            .putString(KEY_SERVER_URL, serverUrl)
            .putString(KEY_DEVICE_ID, deviceId)
            .putString(KEY_DEVICE_NAME, name)
            .putString(KEY_TRUST_KEY, trustKey)
            .apply()
    }

    fun unpair() {
        prefs.edit().clear().apply()
    }

    companion object {
        // Keep this filename in sync with backup_rules.xml / data_extraction_rules.xml.
        private const val FILE_NAME = "agent_identity"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_DEVICE_NAME = "device_name"
        private const val KEY_TRUST_KEY = "trust_key"
    }
}
