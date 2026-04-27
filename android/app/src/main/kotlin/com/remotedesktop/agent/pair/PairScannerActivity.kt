package com.remotedesktop.agent.pair

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import com.google.android.material.snackbar.Snackbar
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.remotedesktop.agent.databinding.ActivityPairScannerBinding
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class PairScannerActivity : ComponentActivity() {

    private lateinit var binding: ActivityPairScannerBinding
    private val analyzerExecutor = Executors.newSingleThreadExecutor()
    private val scanner = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .build()
    )
    private val handled = AtomicBoolean(false)

    private val cameraPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) startCamera() else finishWithError(getString(com.remotedesktop.agent.R.string.scan_camera_denied))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPairScannerBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.cancelButton.setOnClickListener {
            setResult(RESULT_CANCELED)
            finish()
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED) {
            startCamera()
        } else {
            cameraPermission.launch(Manifest.permission.CAMERA)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        analyzerExecutor.shutdown()
        scanner.close()
    }

    private fun startCamera() {
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            val provider = providerFuture.get()
            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(binding.previewView.surfaceProvider)
            }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build().also {
                    it.setAnalyzer(analyzerExecutor) { image -> processFrame(image) }
                }

            try {
                provider.unbindAll()
                provider.bindToLifecycle(
                    this,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    analysis,
                )
            } catch (t: Throwable) {
                finishWithError(t.message ?: "camera_bind_failed")
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun processFrame(proxy: androidx.camera.core.ImageProxy) {
        val media = proxy.image
        if (media == null || handled.get()) {
            proxy.close()
            return
        }
        val input = InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees)
        scanner.process(input)
            .addOnSuccessListener { barcodes ->
                val raw = barcodes.firstNotNullOfOrNull { it.rawValue }
                val parsed = raw?.let { PairUri.parse(it) }
                if (parsed != null && handled.compareAndSet(false, true)) {
                    val out = Intent().apply {
                        putExtra(EXTRA_BASE_URL, parsed.baseUrl)
                        putExtra(EXTRA_TOKEN, parsed.token)
                    }
                    setResult(RESULT_OK, out)
                    finish()
                }
            }
            .addOnCompleteListener { proxy.close() }
    }

    private fun finishWithError(reason: String) {
        Snackbar.make(binding.root, reason, Snackbar.LENGTH_LONG).show()
        binding.root.postDelayed({
            setResult(RESULT_CANCELED)
            finish()
        }, 1800)
    }

    companion object {
        const val EXTRA_BASE_URL = "base_url"
        const val EXTRA_TOKEN = "token"
    }
}
