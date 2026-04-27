package com.remotedesktop.agent

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import com.google.android.material.snackbar.Snackbar
import com.remotedesktop.agent.control.AgentApi
import com.remotedesktop.agent.control.AgentService
import com.remotedesktop.agent.databinding.ActivityMainBinding
import com.remotedesktop.agent.input.InputAccessibilityService
import com.remotedesktop.agent.models.PairRequest
import com.remotedesktop.agent.pair.PairScannerActivity
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private lateinit var binding: ActivityMainBinding

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* result ignored — service starts whether granted or not */ }

    private val pairScannerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode != Activity.RESULT_OK) return@registerForActivityResult
        val data = result.data ?: return@registerForActivityResult
        val baseUrl = data.getStringExtra(PairScannerActivity.EXTRA_BASE_URL) ?: return@registerForActivityResult
        val token = data.getStringExtra(PairScannerActivity.EXTRA_TOKEN) ?: return@registerForActivityResult
        completePairing(baseUrl, token)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        wireButtons()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notificationPermissionLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    private fun refreshStatus() {
        val id = AgentApp.get().identity
        binding.statusLine.text = when {
            !id.isPaired -> getString(R.string.status_unpaired)
            else -> getString(R.string.status_paired, id.deviceName ?: id.deviceId)
        }
        val accessibilityOn = InputAccessibilityService.isEnabled(this)
        binding.startButton.isEnabled = id.isPaired
        binding.stopButton.isEnabled = id.isPaired
        binding.unpairButton.isEnabled = id.isPaired
        binding.scanButton.isEnabled = !id.isPaired
        binding.pairHint.visibility = if (id.isPaired) android.view.View.GONE else android.view.View.VISIBLE

        if (id.isPaired && !accessibilityOn) {
            Snackbar.make(
                binding.root,
                getString(R.string.warn_accessibility_off, getString(R.string.action_open_accessibility)),
                Snackbar.LENGTH_LONG
            ).show()
        }
    }

    private fun wireButtons() {
        binding.scanButton.setOnClickListener {
            pairScannerLauncher.launch(Intent(this, PairScannerActivity::class.java))
        }
        binding.startButton.setOnClickListener {
            AgentService.start(this)
            Snackbar.make(binding.root, R.string.status_running, Snackbar.LENGTH_SHORT).show()
        }
        binding.stopButton.setOnClickListener {
            AgentService.stop(this)
            Snackbar.make(binding.root, R.string.status_stopped, Snackbar.LENGTH_SHORT).show()
        }
        binding.accessibilityButton.setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        binding.unpairButton.setOnClickListener {
            AgentService.stop(this)
            AgentApp.get().identity.unpair()
            refreshStatus()
        }
    }

    private fun completePairing(baseUrl: String, token: String) {
        binding.scanButton.isEnabled = false
        lifecycleScope.launch {
            try {
                val api = AgentApi(baseUrl)
                val res = api.pair(PairRequest(
                    token = token,
                    name = Build.MODEL,
                    model = Build.MODEL,
                    osVersion = "Android ${Build.VERSION.RELEASE}",
                    ipAddress = null,
                ))
                AgentApp.get().identity.savePairing(baseUrl, res.deviceId, res.name, res.trustKey)
                refreshStatus()
                AgentService.start(this@MainActivity)
                Snackbar.make(binding.root, getString(R.string.status_paired, res.name), Snackbar.LENGTH_LONG).show()
            } catch (t: Throwable) {
                refreshStatus()
                Snackbar.make(
                    binding.root,
                    getString(R.string.error_pair_failed, t.message ?: t.javaClass.simpleName),
                    Snackbar.LENGTH_LONG
                ).show()
            }
        }
    }
}
