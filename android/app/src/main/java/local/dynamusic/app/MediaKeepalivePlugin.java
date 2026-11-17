package local.dynamusic.app;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.ServiceConnection;
import android.net.Uri;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "MediaKeepalive")
public class MediaKeepalivePlugin extends Plugin implements MediaPlaybackService.ServiceEventSink {
    private static final int MAX_AUDIO_BYTES = 24 * 1024 * 1024;
    private static final String DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    private static volatile WeakReference<MediaKeepalivePlugin> activeInstance = new WeakReference<>(null);

    private final ExecutorService executor = Executors.newFixedThreadPool(2);
    private final ExecutorService resolverExecutor = Executors.newFixedThreadPool(8);
    private final MobileStreamProxy streamProxy = MobileStreamProxy.getShared();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private BroadcastReceiver mediaControlReceiver;
    private MediaPlaybackService boundService;
    private boolean serviceBound = false;
    private String pendingQueueJson = "";
    private String pendingRepeatMode = "off";

    private final ServiceConnection serviceConn = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            if (service instanceof MediaPlaybackService.LocalBinder) {
                boundService = ((MediaPlaybackService.LocalBinder) service).getService();
                boundService.setEventSink(MediaKeepalivePlugin.this);
                if (!pendingQueueJson.isEmpty()) {
                    boundService.setUpcomingQueueNative(pendingQueueJson, pendingRepeatMode);
                }
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            if (boundService != null) {
                boundService.setEventSink(null);
            }
            boundService = null;
        }
    };

    static boolean dispatchBackPressed() {
        MediaKeepalivePlugin inst = activeInstance.get();
        if (inst == null || !inst.hasListeners("backPressed")) {
            return false;
        }
        inst.notifyListeners("backPressed", new JSObject());
        return true;
    }

    static void dispatchAppResume() {
        MediaKeepalivePlugin inst = activeInstance.get();
        if (inst == null) return;
        inst.notifyListeners("appResume", new JSObject());
    }

    @Override
    public void load() {
        super.load();
        activeInstance = new WeakReference<>(this);
        resolverExecutor.execute(() -> {
            try {
                streamProxy.ensureStarted();
            } catch (Exception ignored) {}
        });

        try {
            Intent bindIntent = new Intent(getContext(), MediaPlaybackService.class);
            serviceBound = getContext().bindService(bindIntent, serviceConn, Context.BIND_AUTO_CREATE);
        } catch (Exception ignored) {
            serviceBound = false;
        }

        mediaControlReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null) return;
                String action = intent.getStringExtra(MediaPlaybackService.EXTRA_CONTROL_ACTION);
                if (action == null || action.isEmpty()) return;
                double seekTime = intent.getDoubleExtra(MediaPlaybackService.EXTRA_SEEK_TIME, -1.0);
                String trackId = intent.getStringExtra(MediaPlaybackService.EXTRA_TRACK_ID);
                onServiceControlAction(action, seekTime, trackId != null ? trackId : "");
            }
        };
        try {
            IntentFilter filter = new IntentFilter(MediaPlaybackService.ACTION_MEDIA_CONTROL);
            ContextCompat.registerReceiver(getContext(), mediaControlReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
        } catch (Exception ignored) {}
    }

    @Override
    protected void handleOnDestroy() {
        activeInstance.clear();
        if (boundService != null) {
            boundService.setEventSink(null);
        }
        if (serviceBound) {
            try {
                getContext().unbindService(serviceConn);
            } catch (Exception ignored) {}
            serviceBound = false;
        }
        if (mediaControlReceiver != null) {
            try {
                getContext().unregisterReceiver(mediaControlReceiver);
            } catch (Exception ignored) {}
            mediaControlReceiver = null;
        }
        super.handleOnDestroy();
    }

    @Override
    public void onServicePlayerEvent(
            String type,
            String trackId,
            boolean playing,
            boolean buffering,
            String status,
            double positionSec,
            double durationSec,
            String errorMsg,
            String requestId) {
        JSObject data = new JSObject();
        data.put("type", type);
        data.put("trackId", trackId != null ? trackId : "");
        data.put("requestId", requestId != null ? requestId : "");
        data.put("playing", playing);
        data.put("buffering", buffering);
        data.put("status", status != null ? status : "idle");
        data.put("position", positionSec);
        data.put("duration", durationSec);
        if (errorMsg != null) {
            data.put("error", errorMsg);
        }
        notifyListeners("playerEvent", data);
    }

    @Override
    public void onServiceControlAction(String action, double seekSec, String trackId) {
        JSObject data = new JSObject();
        data.put("action", action);
        if (seekSec >= 0) {
            data.put("seekTime", seekSec);
        }
        if (trackId != null && !trackId.isEmpty()) {
            data.put("trackId", trackId);
        }
        notifyListeners("mediaControl", data);
    }

    private void startServiceIntentSafe(Intent intent) {
        Context ctx = getContext();
        try {
            ContextCompat.startForegroundService(ctx, intent);
        } catch (Exception ignored) {
            // If Android restricts background FGS start when UI is backgrounded, fallback to bound service
        }
    }

    @PluginMethod
    public void nativeLoad(PluginCall call) {
        String trackId = call.getString("trackId", "");
        String requestId = call.getString("requestId", "");
        String url = call.getString("url", "");
        String title = call.getString("title", "Dynamusic");
        String artist = call.getString("artist", "");
        String album = call.getString("album", "Dynamusic");
        String thumb = call.getString("thumb", "");
        boolean shuffle = Boolean.TRUE.equals(call.getBoolean("shuffle", false));
        boolean liked = Boolean.TRUE.equals(call.getBoolean("liked", false));
        boolean autoplay = Boolean.TRUE.equals(call.getBoolean("autoplay", true));
        double duration = call.getDouble("duration", 0.0) != null ? call.getDouble("duration", 0.0) : 0.0;
        double position = call.getDouble("position", 0.0) != null ? call.getDouble("position", 0.0) : 0.0;
        double volume = call.getDouble("volume", 1.0) != null ? call.getDouble("volume", 1.0) : 1.0;
        double speed = call.getDouble("speed", 1.0) != null ? call.getDouble("speed", 1.0) : 1.0;

        if (boundService != null) {
            mainHandler.post(() -> {
                if (boundService != null) {
                    boundService.setVolumeNative((float) volume);
                    boundService.setSpeedNative((float) speed);
                    boundService.updateMetadataNative(
                            trackId,
                            title,
                            artist,
                            album,
                            thumb,
                            autoplay,
                            shuffle,
                            liked,
                            duration,
                            position);
                    boundService.loadTrackNative(
                            trackId != null ? trackId : "",
                            url != null ? url : "",
                            autoplay,
                            position,
                            requestId != null ? requestId : "");
                }
            });
            call.resolve();
            return;
        }

        Intent intent = new Intent(getContext(), MediaPlaybackService.class);
        intent.setAction(MediaPlaybackService.ACTION_LOAD);
        intent.putExtra(MediaPlaybackService.EXTRA_TRACK_ID, trackId != null ? trackId : "");
        intent.putExtra(MediaPlaybackService.EXTRA_REQUEST_ID, requestId != null ? requestId : "");
        intent.putExtra(MediaPlaybackService.EXTRA_STREAM_URL, url != null ? url : "");
        intent.putExtra(MediaPlaybackService.EXTRA_TITLE, title != null ? title : "Dynamusic");
        intent.putExtra(MediaPlaybackService.EXTRA_ARTIST, artist != null ? artist : "");
        intent.putExtra(MediaPlaybackService.EXTRA_ALBUM, album != null ? album : "Dynamusic");
        intent.putExtra(MediaPlaybackService.EXTRA_THUMB, thumb != null ? thumb : "");
        intent.putExtra(MediaPlaybackService.EXTRA_SHUFFLE, shuffle);
        intent.putExtra(MediaPlaybackService.EXTRA_LIKED, liked);
        intent.putExtra(MediaPlaybackService.EXTRA_AUTOPLAY, autoplay);
        intent.putExtra(MediaPlaybackService.EXTRA_DURATION, duration);
        intent.putExtra(MediaPlaybackService.EXTRA_POSITION, position);
        intent.putExtra(MediaPlaybackService.EXTRA_VOLUME, volume);
        intent.putExtra(MediaPlaybackService.EXTRA_SPEED, speed);

        startServiceIntentSafe(intent);
        call.resolve();
    }

    @PluginMethod
    public void nativeStopAndReset(PluginCall call) {
        String requestId = call.getString("requestId", "");
        mainHandler.post(() -> {
            if (boundService != null) {
                boundService.stopAndResetNative(requestId != null ? requestId : "");
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void syncQueue(PluginCall call) {
        String queueJson = call.getString("queueJson", "[]");
        String repeatMode = call.getString("repeat", "off");
        pendingQueueJson = queueJson != null ? queueJson : "[]";
        pendingRepeatMode = repeatMode != null ? repeatMode : "off";
        mainHandler.post(() -> {
            if (boundService != null) {
                boundService.setUpcomingQueueNative(pendingQueueJson, pendingRepeatMode);
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void nativePrebuffer(PluginCall call) {
        String trackId = call.getString("trackId", "");
        String url = call.getString("url", "");
        mainHandler.post(() -> {
            if (boundService != null) {
                boundService.prebufferTrackNative(trackId, url);
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void nativePlay(PluginCall call) {
        mainHandler.post(() -> {
            if (boundService != null) {
                boundService.playNative();
            } else {
                Intent i = new Intent(getContext(), MediaPlaybackService.class);
                i.setAction(MediaPlaybackService.ACTION_PLAY);
                startServiceIntentSafe(i);
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void nativePause(PluginCall call) {
        mainHandler.post(() -> {
            if (boundService != null) {
                boundService.pauseNative();
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void nativeSeek(PluginCall call) {
        Double position = call.getDouble("position", 0.0);
        double pos = position != null ? position : 0.0;
        mainHandler.post(() -> {
            if (boundService != null) {
                boundService.seekNative(pos);
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void nativeSetVolume(PluginCall call) {
        Double vol = call.getDouble("volume", 1.0);
        float v = vol != null ? vol.floatValue() : 1.0f;
        mainHandler.post(() -> {
            if (boundService != null) {
                boundService.setVolumeNative(v);
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void nativeSetSpeed(PluginCall call) {
        Double sp = call.getDouble("speed", 1.0);
        float s = sp != null ? sp.floatValue() : 1.0f;
        mainHandler.post(() -> {
            if (boundService != null) {
                boundService.setSpeedNative(s);
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void nativeStop(PluginCall call) {
        mainHandler.post(() -> {
            if (boundService != null) {
                boundService.stopPlaybackNative();
            }
        });
        try {
            getContext().stopService(new Intent(getContext(), MediaPlaybackService.class));
        } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void minimizeApp(PluginCall call) {
        Activity act = getActivity();
        if (act != null) {
            act.runOnUiThread(() -> act.moveTaskToBack(true));
        }
        call.resolve();
    }

    @PluginMethod
    public void sync(PluginCall call) {
        boolean playing = call.getBoolean("playing", false);
        String trackId = call.getString("trackId", "");
        String title = call.getString("title", "Dynamusic");
        String artist = call.getString("artist", "");
        String album = call.getString("album", "Dynamusic");
        String thumb = call.getString("thumb", "");
        boolean shuffle = Boolean.TRUE.equals(call.getBoolean("shuffle", false));
        boolean liked = Boolean.TRUE.equals(call.getBoolean("liked", false));
        Double duration = call.getDouble("duration", 0.0);
        Double position = call.getDouble("position", 0.0);
        Context ctx = getContext();

        if (!playing && (title == null || title.isEmpty())) {
            try {
                ctx.stopService(new Intent(ctx, MediaPlaybackService.class));
            } catch (Exception ignored) {}
            call.resolve();
            return;
        }

        if (boundService != null) {
            final double durVal = duration != null ? duration : 0.0;
            final double posVal = position != null ? position : 0.0;
            mainHandler.post(() -> {
                if (boundService != null) {
                    boundService.updateMetadataNative(
                            trackId,
                            title,
                            artist,
                            album,
                            thumb,
                            playing,
                            shuffle,
                            liked,
                            durVal,
                            posVal);
                }
            });
            call.resolve();
            return;
        }

        try {
            Intent intent = new Intent(ctx, MediaPlaybackService.class);
            intent.setAction(MediaPlaybackService.ACTION_UPDATE);
            intent.putExtra(MediaPlaybackService.EXTRA_TRACK_ID, trackId != null ? trackId : "");
            intent.putExtra(MediaPlaybackService.EXTRA_TITLE, title);
            intent.putExtra(MediaPlaybackService.EXTRA_ARTIST, artist);
            intent.putExtra(MediaPlaybackService.EXTRA_ALBUM, album != null ? album : "Dynamusic");
            intent.putExtra(MediaPlaybackService.EXTRA_THUMB, thumb != null ? thumb : "");
            intent.putExtra(MediaPlaybackService.EXTRA_PLAYING, playing);
            intent.putExtra(MediaPlaybackService.EXTRA_SHUFFLE, shuffle);
            intent.putExtra(MediaPlaybackService.EXTRA_LIKED, liked);
            intent.putExtra(MediaPlaybackService.EXTRA_DURATION, duration != null ? duration : 0.0);
            intent.putExtra(MediaPlaybackService.EXTRA_POSITION, position != null ? position : 0.0);

            startServiceIntentSafe(intent);
        } catch (Exception ignored) {}
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

    private File getOfflineDir() {
        File dir = new File(getContext().getFilesDir(), "offline_vault");
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    private static String safeTrackFileBase(String id) {
        if (id == null) return "";
        return id.replaceAll("[^A-Za-z0-9_-]", "_");
    }

    private File findExistingOfflineFile(String safeId) {
        File dir = getOfflineDir();
        File[] files = dir.listFiles();
        if (files == null) return null;
        String prefix = safeId + ".";
        for (File f : files) {
            if (f.isFile() && f.getName().startsWith(prefix) && f.length() > 4096) {
                return f;
            }
        }
        return null;
    }

    @PluginMethod
    public void getOfflineFileUri(PluginCall call) {
        String id = call.getString("id", "");
        String safe = safeTrackFileBase(id);
        if (safe.isEmpty()) {
            JSObject out = new JSObject();
            out.put("exists", false);
            call.resolve(out);
            return;
        }
        File found = findExistingOfflineFile(safe);
        JSObject out = new JSObject();
        if (found != null) {
            out.put("exists", true);
            out.put("fileUri", Uri.fromFile(found).toString());
            out.put("size", found.length());
            out.put("mime", found.getName().endsWith(".webm") ? "audio/webm" : "audio/mp4");
        } else {
            out.put("exists", false);
        }
        call.resolve(out);
    }

    private File getOfflineArtDir() {
        File dir = new File(getContext().getFilesDir(), "offline_artwork");
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    private File findExistingOfflineArt(String safeId) {
        File dir = getOfflineArtDir();
        File[] files = dir.listFiles();
        if (files == null) return null;
        String prefix = safeId + ".";
        for (File f : files) {
            if (f.isFile() && f.getName().startsWith(prefix) && f.length() > 64) {
                return f;
            }
        }
        return null;
    }

    @PluginMethod
    public void getOfflineArtDataUrl(PluginCall call) {
        String id = call.getString("id", "");
        String safe = safeTrackFileBase(id);
        if (safe.isEmpty()) {
            JSObject out = new JSObject();
            out.put("exists", false);
            call.resolve(out);
            return;
        }
        executor.execute(() -> {
            File found = findExistingOfflineArt(safe);
            JSObject out = new JSObject();
            if (found != null) {
                try (java.io.FileInputStream fis = new java.io.FileInputStream(found)) {
                    byte[] bytes = new byte[(int) Math.min(found.length(), 2 * 1024 * 1024)];
                    int read = fis.read(bytes);
                    byte[] exact = read == bytes.length ? bytes : java.util.Arrays.copyOf(bytes, Math.max(0, read));
                    String mime = found.getName().endsWith(".png")
                            ? "image/png"
                            : found.getName().endsWith(".webp") ? "image/webp" : "image/jpeg";
                    String b64 = Base64.encodeToString(exact, Base64.NO_WRAP);
                    out.put("exists", true);
                    out.put("dataUrl", "data:" + mime + ";base64," + b64);
                    call.resolve(out);
                    return;
                } catch (Exception ignored) {}
            }
            out.put("exists", false);
            call.resolve(out);
        });
    }

    @PluginMethod
    public void saveOfflineArt(PluginCall call) {
        String id = call.getString("id", "");
        String rawUrl = call.getString("url", "");
        String base64 = call.getString("base64", "");
        String reqMime = call.getString("mime", "");
        String safe = safeTrackFileBase(id);
        if (safe.isEmpty()) {
            call.reject("Missing id");
            return;
        }
        executor.execute(() -> {
            HttpURLConnection conn = null;
            File tmp = null;
            try {
                byte[] bytes = null;
                String mime = (reqMime != null && !reqMime.isEmpty()) ? reqMime : "image/jpeg";
                if (base64 != null && !base64.isEmpty()) {
                    bytes = Base64.decode(base64, Base64.DEFAULT);
                } else if (rawUrl != null && (rawUrl.startsWith("https://") || rawUrl.startsWith("http://"))) {
                    conn = (HttpURLConnection) new URL(rawUrl).openConnection();
                    conn.setInstanceFollowRedirects(true);
                    conn.setConnectTimeout(3500);
                    conn.setReadTimeout(3500);
                    conn.setRequestProperty("User-Agent", DESKTOP_UA);
                    int code = conn.getResponseCode();
                    if (code < 200 || code >= 300) {
                        call.reject("HTTP " + code);
                        return;
                    }
                    String ct = conn.getContentType();
                    if (ct != null && !ct.isEmpty()) mime = ct.split(";")[0].trim();
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    byte[] buf = new byte[8192];
                    int n;
                    int total = 0;
                    try (InputStream in = conn.getInputStream()) {
                        while ((n = in.read(buf)) != -1) {
                            total += n;
                            if (total > 2 * 1024 * 1024) break;
                            bos.write(buf, 0, n);
                        }
                    }
                    bytes = bos.toByteArray();
                } else {
                    call.reject("Missing url or base64");
                    return;
                }
                if (bytes == null || bytes.length < 64) {
                    call.reject("Invalid artwork bytes");
                    return;
                }
                String ext = mime.contains("png") ? ".png" : mime.contains("webp") ? ".webp" : ".jpg";
                File dir = getOfflineArtDir();
                tmp = new File(dir, safe + ext + ".part");
                try (FileOutputStream fos = new FileOutputStream(tmp)) {
                    fos.write(bytes);
                }
                File existing = findExistingOfflineArt(safe);
                if (existing != null && !existing.equals(tmp)) existing.delete();
                File target = new File(dir, safe + ext);
                if (!tmp.renameTo(target)) {
                    call.reject("Failed to commit artwork file");
                    return;
                }
                JSObject out = new JSObject();
                out.put("exists", true);
                out.put("size", bytes.length);
                call.resolve(out);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Save artwork failed", e);
            } finally {
                if (tmp != null && tmp.exists()) tmp.delete();
                if (conn != null) conn.disconnect();
            }
        });
    }

    @PluginMethod
    public void deleteOfflineArt(PluginCall call) {
        String id = call.getString("id", "");
        String safe = safeTrackFileBase(id);
        if (!safe.isEmpty()) {
            File found = findExistingOfflineArt(safe);
            if (found != null) found.delete();
        }
        call.resolve();
    }

    @PluginMethod
    public void deleteOfflineFile(PluginCall call) {
        String id = call.getString("id", "");
        String safe = safeTrackFileBase(id);
        if (!safe.isEmpty()) {
            File found = findExistingOfflineFile(safe);
            if (found != null) {
                found.delete();
            }
        }
        call.resolve();
    }

    /**
     * Save offline audio natively to app-private storage (from URL or base64), returning a `file://`
     * URI that ExoPlayer plays 100% offline with zero WebView RAM pressure.
     */
    @PluginMethod
    public void saveOfflineFile(PluginCall call) {
        String id = call.getString("id", "");
        String rawUrl = call.getString("url", "");
        String base64 = call.getString("base64", "");
        String reqMime = call.getString("mime", "");
        String safe = safeTrackFileBase(id);
        if (safe.isEmpty()) {
            call.reject("Missing id");
            return;
        }
        executor.execute(() -> {
            HttpURLConnection conn = null;
            File tmp = null;
            try {
                byte[] directBytes = null;
                String mime = (reqMime != null && !reqMime.isEmpty()) ? reqMime : "audio/mp4";

                if (base64 != null && !base64.isEmpty()) {
                    directBytes = Base64.decode(base64, Base64.DEFAULT);
                    if (directBytes.length < 4096 || directBytes.length > MAX_AUDIO_BYTES) {
                        call.reject("Invalid audio byte size");
                        return;
                    }
                } else if (rawUrl != null && (rawUrl.startsWith("https://") || rawUrl.startsWith("http://"))) {
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
                    if (ct != null && !ct.isEmpty()) {
                        mime = ct.split(";")[0].trim();
                    }
                } else {
                    call.reject("Missing url or base64");
                    return;
                }

                String ext = mime.contains("webm") ? ".webm" : mime.contains("mpeg") ? ".mp3" : ".m4a";
                File dir = getOfflineDir();
                tmp = new File(dir, safe + ext + ".part");
                long total = 0;

                if (directBytes != null) {
                    try (FileOutputStream fos = new FileOutputStream(tmp)) {
                        fos.write(directBytes);
                    }
                    total = directBytes.length;
                } else {
                    byte[] buf = new byte[16384];
                    try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(tmp)) {
                        int n;
                        while ((n = in.read(buf)) != -1) {
                            total += n;
                            if (total > MAX_AUDIO_BYTES) {
                                call.reject("Audio exceeds 24 MB limit");
                                return;
                            }
                            fos.write(buf, 0, n);
                        }
                    }
                }

                if (total < 4096) {
                    call.reject("Audio response too small");
                    return;
                }

                File existing = findExistingOfflineFile(safe);
                if (existing != null && !existing.equals(tmp)) {
                    existing.delete();
                }
                File target = new File(dir, safe + ext);
                if (!tmp.renameTo(target)) {
                    call.reject("Failed to commit offline file");
                    return;
                }

                JSObject res = new JSObject();
                res.put("fileUri", Uri.fromFile(target).toString());
                res.put("mime", mime);
                res.put("size", total);
                call.resolve(res);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Offline save failed", e);
            } finally {
                if (tmp != null && tmp.exists()) {
                    tmp.delete();
                }
                if (conn != null) conn.disconnect();
            }
        });
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

    /**
     * Execute an allowlisted YouTube Music InnerTube WEB_REMIX API request natively
     * (with Music origin/referer headers) and return raw JSON text for TypeScript parsing.
     */
    @PluginMethod
    public void ytmRequest(PluginCall call) {
        String endpoint = call.getString("endpoint", "");
        JSObject body = call.getObject("body", new JSObject());
        if (endpoint == null || endpoint.trim().isEmpty()) {
            call.reject("Missing YTM endpoint");
            return;
        }
        resolverExecutor.execute(() -> {
            try {
                String raw = MobileYtmClient.request(endpoint.trim(), body);
                JSObject out = new JSObject();
                out.put("raw", raw);
                call.resolve(out);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "YTM request failed", e);
            }
        });
    }

    /**
     * Resolve lyrics natively across LyricsPlus (word-synced), LRCLIB (line-synced & plain),
     * and YouTube Music's own Lyrics tab without WebView CORS limits.
     */
    @PluginMethod
    public void resolveLyrics(PluginCall call) {
        String videoId = call.getString("videoId", "");
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        String album = call.getString("album", "");
        Double duration = call.getDouble("duration", 0.0);

        resolverExecutor.execute(() -> {
            try {
                org.json.JSONObject res = MobileLyricsResolver.resolve(
                        resolverExecutor,
                        videoId != null ? videoId.trim() : "",
                        title,
                        artist,
                        album,
                        duration != null ? duration : 0.0);
                call.resolve(JSObject.fromJSONObject(res));
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Lyrics resolution failed", e);
            }
        });
    }
}
