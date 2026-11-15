package local.dynamusic.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "MediaKeepalive")
public class MediaKeepalivePlugin extends Plugin {
    private static final int MAX_AUDIO_BYTES = 24 * 1024 * 1024;
    private static final String DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    private final ExecutorService executor = Executors.newFixedThreadPool(2);
    private final ExecutorService resolverExecutor = Executors.newFixedThreadPool(8);
    private final MobileStreamProxy streamProxy = new MobileStreamProxy();
    private BroadcastReceiver mediaControlReceiver;

    @Override
    public void load() {
        super.load();
        mediaControlReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null) return;
                String action = intent.getStringExtra(MediaPlaybackService.EXTRA_CONTROL_ACTION);
                if (action == null || action.isEmpty()) return;
                JSObject data = new JSObject();
                data.put("action", action);
                notifyListeners("mediaControl", data);
            }
        };
        try {
            IntentFilter filter = new IntentFilter(MediaPlaybackService.ACTION_MEDIA_CONTROL);
            ContextCompat.registerReceiver(getContext(), mediaControlReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
        } catch (Exception ignored) {}
    }

    @Override
    protected void handleOnDestroy() {
        if (mediaControlReceiver != null) {
            try {
                getContext().unregisterReceiver(mediaControlReceiver);
            } catch (Exception ignored) {}
            mediaControlReceiver = null;
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void sync(PluginCall call) {
        boolean playing = call.getBoolean("playing", false);
        String title = call.getString("title", "Dynamusic");
        String artist = call.getString("artist", "");
        Context ctx = getContext();

        try {
            Intent intent = new Intent(ctx, MediaPlaybackService.class);
            if (!playing && (title == null || title.isEmpty())) {
                ctx.stopService(intent);
                call.resolve();
                return;
            }

            intent.setAction(MediaPlaybackService.ACTION_UPDATE);
            intent.putExtra(MediaPlaybackService.EXTRA_TITLE, title);
            intent.putExtra(MediaPlaybackService.EXTRA_ARTIST, artist);
            intent.putExtra(MediaPlaybackService.EXTRA_PLAYING, playing);

            if (playing) {
                ContextCompat.startForegroundService(ctx, intent);
            } else {
                ctx.startService(intent);
            }
        } catch (Exception ignored) {
            // Avoid BackgroundServiceStartNotAllowedException when already backgrounded & paused
        }
        call.resolve();
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String raw = call.getString("url", "");
        if (raw == null || (!raw.startsWith("https://") && !raw.startsWith("http://"))) {
            call.reject("Invalid external URL");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(raw));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open browser", e);
        }
    }

    @PluginMethod
    public void takePendingOAuthUrl(PluginCall call) {
        JSObject out = new JSObject();
        out.put("url", MainActivity.consumePendingOAuthUrl());
        call.resolve(out);
    }

    /**
     * Native HTTP audio fetcher for WebView offline vault: avoids upstream CDN CORS blocks
     * while returning raw bytes back for IndexedDB Blob storage.
     */
    @PluginMethod
    public void fetchAudioBase64(PluginCall call) {
        String rawUrl = call.getString("url", "");
        if (rawUrl == null || (!rawUrl.startsWith("https://") && !rawUrl.startsWith("http://"))) {
            call.reject("Invalid audio URL");
            return;
        }
        executor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(rawUrl);
                conn = (HttpURLConnection) url.openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(25000);
                conn.setRequestProperty("User-Agent", DESKTOP_UA);

                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    call.reject("HTTP " + code);
                    return;
                }
                String ct = conn.getContentType();
                String mime = (ct != null && !ct.isEmpty()) ? ct.split(";")[0].trim() : "audio/mp4";

                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int total = 0;
                try (InputStream in = conn.getInputStream()) {
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        total += n;
                        if (total > MAX_AUDIO_BYTES) {
                            call.reject("Audio exceeds 24 MB limit");
                            return;
                        }
                        out.write(buf, 0, n);
                    }
                }
                if (total < 4096) {
                    call.reject("Audio response too small");
                    return;
                }
                JSObject res = new JSObject();
                res.put("base64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                res.put("mime", mime);
                res.put("size", total);
                call.resolve(res);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Download failed", e);
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    /**
     * Resolve a track stream natively on-device (YouTube InnerTube, JioSaavn CDN, Piped)
     * and return a loopback proxy URL with CORS, matching User-Agent, and HTTP Range support.
     */
    @PluginMethod
    public void resolveStream(PluginCall call) {
        String videoId = call.getString("videoId", "");
        boolean forceRotate = Boolean.TRUE.equals(call.getBoolean("forceRotate", false));
        String quality = call.getString("quality", "");
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");

        if (videoId == null || videoId.trim().isEmpty()) {
            call.reject("Missing videoId");
            return;
        }
        resolverExecutor.execute(() -> {
            try {
                MobileStreamProxy.ResolvedStream resolved =
                        streamProxy.resolve(videoId.trim(), forceRotate, quality, title, artist);
                JSObject out = new JSObject();
                out.put("proxyUrl", resolved.proxyUrl);
                out.put("upstreamUrl", resolved.upstreamUrl);
                out.put("mime", resolved.mimeType);
                out.put("source", resolved.source);
                if (resolved.lufs != null) {
                    out.put("lufs", resolved.lufs);
                }
                call.resolve(out);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Stream resolution failed", e);
            }
        });
    }
}
