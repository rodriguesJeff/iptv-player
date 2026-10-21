package dev.local.iptvplayer

import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import org.json.JSONObject

/**
 * Hosts the shared web UI (assets = ../../www) over an ExoPlayer view. The page is transparent
 * while playing and tells us where the video goes (preview box or full screen) via [Bridge].
 */
@OptIn(UnstableApi::class)
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var playerView: PlayerView
    private var player: ExoPlayer? = null
    private val main = Handler(Looper.getMainLooper())

    // Polled from the JS thread by Bridge.position(); written on the main thread.
    @Volatile private var positionMs = 0L
    @Volatile private var durationMs = 0L
    private val positionTick = object : Runnable {
        override fun run() {
            player?.let {
                positionMs = it.currentPosition
                durationMs = it.duration.coerceAtLeast(0)
            }
            main.postDelayed(this, 500)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        playerView = PlayerView(this).apply {
            useController = false
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShutterBackgroundColor(Color.BLACK)
            visibility = View.GONE
        }

        web = WebView(this)
        // Transparent so the video behind shows through the page's see-through areas.
        web.setBackgroundColor(Color.TRANSPARENT)
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            // Lets the page (file://) call the IPTV server's API without CORS headers.
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            mediaPlaybackRequiresUserGesture = false
        }
        web.webViewClient = WebViewClient()
        web.addJavascriptInterface(Bridge(), "AndroidBridge")

        val root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)
        root.addView(playerView, FrameLayout.LayoutParams(-1, -1))
        root.addView(web, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
        web.requestFocus()

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl("file:///android_asset/index.html")
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars(window.decorView)
    }

    // Release on stop so the single allowed connection is freed as soon as we leave.
    override fun onStop() {
        super.onStop()
        web.evaluateJavascript("Player.close()", null)
        releasePlayer()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    @Deprecated("Back is routed through the web UI first")
    override fun onBackPressed() {
        web.evaluateJavascript("App.back()") { handled ->
            if (handled != "true") finish()
        }
    }

    private fun js(code: String) = web.evaluateJavascript(code, null)

    private fun ensurePlayer(): ExoPlayer = player ?: run {
        val http = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(20_000)
        ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(http))
            .build()
            .also { p ->
                p.addListener(object : Player.Listener {
                    override fun onPlayerError(error: PlaybackException) {
                        if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                            p.seekToDefaultPosition()
                            p.prepare()
                            return
                        }
                        js("Player.onNative('error', ${JSONObject.quote(error.errorCodeName)})")
                    }

                    override fun onPlaybackStateChanged(state: Int) {
                        when (state) {
                            Player.STATE_BUFFERING -> js("Player.onNative('buffering', true)")
                            Player.STATE_READY -> js("Player.onNative('buffering', false)")
                            Player.STATE_ENDED -> js("Player.onNative('ended')")
                        }
                    }
                })
                playerView.player = p
                player = p
                main.post(positionTick)
            }
    }

    private fun releasePlayer() {
        main.removeCallbacks(positionTick)
        player?.release()
        player = null
        playerView.player = null
        playerView.visibility = View.GONE
        positionMs = 0
        durationMs = 0
    }

    inner class Bridge {
        @JavascriptInterface
        fun open(url: String, live: Boolean) = main.post {
            val p = ensurePlayer()
            val mime = when {
                url.contains(".m3u8") -> MimeTypes.APPLICATION_M3U8
                url.endsWith(".ts") -> MimeTypes.VIDEO_MP2T
                else -> null
            }
            p.setMediaItem(MediaItem.Builder().setUri(url).setMimeType(mime).build())
            p.prepare()
            p.playWhenReady = true
            playerView.visibility = View.VISIBLE
        }

        @JavascriptInterface
        fun stop() = main.post {
            player?.stop()
            player?.clearMediaItems()
            playerView.visibility = View.GONE
        }

        /** Rect in CSS px; negative width means full screen. */
        @JavascriptInterface
        fun setRect(x: Double, y: Double, w: Double, h: Double) = main.post {
            val d = resources.displayMetrics.density
            playerView.layoutParams = if (w < 0) {
                FrameLayout.LayoutParams(-1, -1)
            } else {
                FrameLayout.LayoutParams((w * d).toInt(), (h * d).toInt()).apply {
                    leftMargin = (x * d).toInt()
                    topMargin = (y * d).toInt()
                }
            }
        }

        @JavascriptInterface
        fun toggle() = main.post { player?.let { it.playWhenReady = !it.playWhenReady } }

        @JavascriptInterface
        fun seek(deltaMs: Double) = main.post {
            player?.let { it.seekTo((it.currentPosition + deltaMs.toLong()).coerceAtLeast(0)) }
        }

        @JavascriptInterface
        fun position(): String = "{\"cur\":${positionMs / 1000.0},\"dur\":${durationMs / 1000.0}}"

        /** WebView won't always raise the soft keyboard for a field focused from JS. */
        @JavascriptInterface
        fun showKeyboard() {
            // No web.requestFocus() here: it moves DOM focus back to the first field.
            main.post {
                val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
                imm.showSoftInput(web, InputMethodManager.SHOW_IMPLICIT)
            }
        }
    }
}

@Suppress("DEPRECATION")
fun hideSystemBars(decor: View) {
    decor.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        or View.SYSTEM_UI_FLAG_FULLSCREEN
        or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
}
