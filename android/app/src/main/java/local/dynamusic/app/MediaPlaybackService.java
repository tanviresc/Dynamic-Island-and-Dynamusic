package local.dynamusic.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Base64;
import android.util.LruCache;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MediaPlaybackService extends Service {
    public static final String CHANNEL_ID = "dynamusic_media_playback";
    public static final int NOTIFICATION_ID = 47822;
    public static final String ACTION_UPDATE = "local.dynamusic.app.ACTION_MEDIA_UPDATE";
    public static final String ACTION_STOP = "local.dynamusic.app.ACTION_MEDIA_STOP";
    public static final String ACTION_BTN_SHUFFLE = "local.dynamusic.app.ACTION_BTN_SHUFFLE";
    public static final String ACTION_BTN_PREV = "local.dynamusic.app.ACTION_BTN_PREV";
    public static final String ACTION_BTN_TOGGLE = "local.dynamusic.app.ACTION_BTN_TOGGLE";
    public static final String ACTION_BTN_NEXT = "local.dynamusic.app.ACTION_BTN_NEXT";
    public static final String ACTION_BTN_LIKE = "local.dynamusic.app.ACTION_BTN_LIKE";
    public static final String ACTION_MEDIA_CONTROL = "local.dynamusic.app.ACTION_MEDIA_CONTROL";
    public static final String EXTRA_CONTROL_ACTION = "control_action";
    public static final String EXTRA_SEEK_TIME = "seek_time";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_ALBUM = "album";
    public static final String EXTRA_THUMB = "thumb";
    public static final String EXTRA_PLAYING = "playing";
    public static final String EXTRA_SHUFFLE = "shuffle";
    public static final String EXTRA_LIKED = "liked";
    public static final String EXTRA_DURATION = "duration";
    public static final String EXTRA_POSITION = "position";

    private static final String CUSTOM_SHUFFLE = "dynamusic_shuffle";
    private static final String CUSTOM_LIKE = "dynamusic_like";
    private static final int DEFAULT_ACCENT_COLOR = 0xFF4A1F5E;
    private static final String DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    private static final class ArtEntry {
        final Bitmap bitmap;
        final int accentColor;

        ArtEntry(Bitmap bitmap, int accentColor) {
            this.bitmap = bitmap;
            this.accentColor = accentColor;
        }
    }

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private MediaSessionCompat mediaSession;
    private boolean hasAudioFocus = false;
    private boolean noisyReceiverRegistered = false;
    private boolean pausedForTransientFocus = false;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService artExecutor = Executors.newSingleThreadExecutor();
    private final LruCache<String, ArtEntry> artCache = new LruCache<>(16);

    private String curTitle = "Dynamusic";
    private String curArtist = "";
    private String curAlbum = "Dynamusic";
    private String curThumb = "";
    private boolean curPlaying = false;
    private boolean curShuffle = false;
    private boolean curLiked = false;
    private double curDurationSec = 0;
    private double curPositionSec = 0;
    private volatile String pendingArtUrl = "";

    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent != null ? intent.getAction() : null)) {
                dispatchMediaControl("pause");
            }
        }
    };

    private final AudioManager.OnAudioFocusChangeListener focusListener = focusChange -> {
        if (focusChange == AudioManager.AUDIOFOCUS_LOSS) {
            pausedForTransientFocus = false;
            hasAudioFocus = false;
            dispatchMediaControl("pause");
        } else if (focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
                || focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
            pausedForTransientFocus = true;
            dispatchMediaControl("pause");
        } else if (focusChange == AudioManager.AUDIOFOCUS_GAIN) {
            if (pausedForTransientFocus) {
                pausedForTransientFocus = false;
                dispatchMediaControl("play");
            }
        }
    };

    @Override
    @SuppressWarnings("deprecation")
    public void onCreate() {
        super.onCreate();
        ensureChannel();
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Dynamusic::PlaybackWakeLock");
            wakeLock.setReferenceCounted(false);
        }
        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
            if (wm != null) {
                int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                        ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                        : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                wifiLock = wm.createWifiLock(mode, "Dynamusic::PlaybackWifiLock");
                wifiLock.setReferenceCounted(false);
            }
        } catch (Exception ignored) {
            wifiLock = null;
        }
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);

        mediaSession = new MediaSessionCompat(this, "DynamusicSession");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                dispatchMediaControl("play");
            }

            @Override
            public void onPause() {
                dispatchMediaControl("pause");
            }

            @Override
            public void onSkipToNext() {
                dispatchMediaControl("next");
            }

            @Override
            public void onSkipToPrevious() {
                dispatchMediaControl("prev");
            }

            @Override
            public void onStop() {
                handleStopFromUser();
            }

            @Override
            public void onSeekTo(long pos) {
                Intent i = new Intent(ACTION_MEDIA_CONTROL);
                i.setPackage(getPackageName());
                i.putExtra(EXTRA_CONTROL_ACTION, "seekTo");
                i.putExtra(EXTRA_SEEK_TIME, pos / 1000.0);
                sendBroadcast(i);
            }

            @Override
            public void onCustomAction(String action, Bundle extras) {
                if (CUSTOM_SHUFFLE.equals(action)) {
                    curShuffle = !curShuffle;
                    dispatchMediaControl("shuffle");
                    postUpdatedNotification();
                } else if (CUSTOM_LIKE.equals(action)) {
                    curLiked = !curLiked;
                    dispatchMediaControl("like");
                    postUpdatedNotification();
                }
            }
        });
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        if (ACTION_STOP.equals(action)) {
            handleStopFromUser();
            return START_NOT_STICKY;
        }
        if (ACTION_BTN_SHUFFLE.equals(action)) {
            curShuffle = !curShuffle;
            dispatchMediaControl("shuffle");
            postUpdatedNotification();
            return START_STICKY;
        }
        if (ACTION_BTN_PREV.equals(action)) {
            dispatchMediaControl("prev");
            return START_STICKY;
        }
        if (ACTION_BTN_TOGGLE.equals(action)) {
            curPlaying = !curPlaying;
            dispatchMediaControl(curPlaying ? "play" : "pause");
            if (curPlaying) {
                acquireLocksAndFocus();
            } else {
                releaseWakeAndWifiLocks();
                unregisterNoisyReceiver();
            }
            postUpdatedNotification();
            return START_STICKY;
        }
        if (ACTION_BTN_NEXT.equals(action)) {
            dispatchMediaControl("next");
            return START_STICKY;
        }
        if (ACTION_BTN_LIKE.equals(action)) {
            curLiked = !curLiked;
            dispatchMediaControl("like");
            postUpdatedNotification();
            return START_STICKY;
        }

        if (intent != null && intent.hasExtra(EXTRA_TITLE)) {
            String t = intent.getStringExtra(EXTRA_TITLE);
            curTitle = (t != null && !t.isEmpty()) ? t : "Dynamusic";
        }
        if (intent != null && intent.hasExtra(EXTRA_ARTIST)) {
            String a = intent.getStringExtra(EXTRA_ARTIST);
            curArtist = a != null ? a : "";
        }
        if (intent != null && intent.hasExtra(EXTRA_ALBUM)) {
            String alb = intent.getStringExtra(EXTRA_ALBUM);
            curAlbum = (alb != null && !alb.isEmpty()) ? alb : "Dynamusic";
        }
        if (intent != null && intent.hasExtra(EXTRA_THUMB)) {
            String th = intent.getStringExtra(EXTRA_THUMB);
            curThumb = th != null ? th : "";
        }
        if (intent != null && intent.hasExtra(EXTRA_PLAYING)) {
            curPlaying = intent.getBooleanExtra(EXTRA_PLAYING, true);
        } else if (intent == null) {
            curPlaying = true;
        }
        if (intent != null && intent.hasExtra(EXTRA_SHUFFLE)) {
            curShuffle = intent.getBooleanExtra(EXTRA_SHUFFLE, false);
        }
        if (intent != null && intent.hasExtra(EXTRA_LIKED)) {
            curLiked = intent.getBooleanExtra(EXTRA_LIKED, false);
        }
        if (intent != null && intent.hasExtra(EXTRA_DURATION)) {
            curDurationSec = intent.getDoubleExtra(EXTRA_DURATION, 0);
        }
        if (intent != null && intent.hasExtra(EXTRA_POSITION)) {
            curPositionSec = intent.getDoubleExtra(EXTRA_POSITION, 0);
        }

        if (curPlaying) {
            acquireLocksAndFocus();
        } else {
            releaseWakeAndWifiLocks();
            unregisterNoisyReceiver();
        }

        if (mediaSession != null && !mediaSession.isActive()) {
            mediaSession.setActive(true);
        }

        ArtEntry art = !curThumb.isEmpty() ? artCache.get(curThumb) : null;
        if (art == null && !curThumb.isEmpty() && !curThumb.equals(pendingArtUrl)) {
            fetchArtworkAsync(curThumb);
        }

        Notification notification = buildNotification(art);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceCompat.startForeground(
                    this,
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        return START_STICKY;
    }

    private void handleStopFromUser() {
        dispatchMediaControl("stop");
        releaseLocksAndFocus();
        if (mediaSession != null) {
            mediaSession.setActive(false);
        }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void postUpdatedNotification() {
        ArtEntry art = !curThumb.isEmpty() ? artCache.get(curThumb) : null;
        Notification notification = buildNotification(art);
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID, notification);
        }
    }

    @Override
    public void onDestroy() {
        releaseLocksAndFocus();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        artExecutor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void dispatchMediaControl(String action) {
        Intent i = new Intent(ACTION_MEDIA_CONTROL);
        i.setPackage(getPackageName());
        i.putExtra(EXTRA_CONTROL_ACTION, action);
        sendBroadcast(i);
    }

    private void acquireLocksAndFocus() {
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire(4 * 60 * 60 * 1000L);
        }
        if (wifiLock != null && !wifiLock.isHeld()) {
            try {
                wifiLock.acquire();
            } catch (Exception ignored) {}
        }
        requestAudioFocus();
        registerNoisyReceiver();
    }

    private void releaseWakeAndWifiLocks() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception ignored) {}
        }
        if (wifiLock != null && wifiLock.isHeld()) {
            try {
                wifiLock.release();
            } catch (Exception ignored) {}
        }
    }

    private void releaseLocksAndFocus() {
        releaseWakeAndWifiLocks();
        unregisterNoisyReceiver();
        abandonAudioFocus();
    }

    private void registerNoisyReceiver() {
        if (noisyReceiverRegistered) return;
        try {
            IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            ContextCompat.registerReceiver(this, noisyReceiver, filter, ContextCompat.RECEIVER_EXPORTED);
            noisyReceiverRegistered = true;
        } catch (Exception ignored) {}
    }

    private void unregisterNoisyReceiver() {
        if (!noisyReceiverRegistered) return;
        try {
            unregisterReceiver(noisyReceiver);
        } catch (Exception ignored) {}
        noisyReceiverRegistered = false;
    }

    @SuppressWarnings("deprecation")
    private void requestAudioFocus() {
        if (audioManager == null || hasAudioFocus) return;
        try {
            int res;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (audioFocusRequest == null) {
                    AudioAttributes attrs = new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build();
                    audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                            .setAudioAttributes(attrs)
                            .setOnAudioFocusChangeListener(focusListener)
                            .build();
                }
                res = audioManager.requestAudioFocus(audioFocusRequest);
            } else {
                res = audioManager.requestAudioFocus(
                        focusListener,
                        AudioManager.STREAM_MUSIC,
                        AudioManager.AUDIOFOCUS_GAIN);
            }
            hasAudioFocus = (res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
        } catch (Exception ignored) {}
    }

    @SuppressWarnings("deprecation")
    private void abandonAudioFocus() {
        if (audioManager == null || !hasAudioFocus) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
                audioManager.abandonAudioFocusRequest(audioFocusRequest);
            } else {
                audioManager.abandonAudioFocus(focusListener);
            }
        } catch (Exception ignored) {}
        hasAudioFocus = false;
        pausedForTransientFocus = false;
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID,
                        "Dynamusic Audio Playback",
                        NotificationManager.IMPORTANCE_LOW);
                channel.setDescription("Playback controls and lockscreen media player");
                channel.setShowBadge(false);
                channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                nm.createNotificationChannel(channel);
            }
        }
    }

    private PendingIntent servicePendingIntent(String action, int requestCode) {
        Intent i = new Intent(this, MediaPlaybackService.class);
        i.setAction(action);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getService(this, requestCode, i, piFlags);
    }

    private void updateMediaSession(ArtEntry art) {
        if (mediaSession == null) return;
        MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, curTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, curArtist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, curAlbum);
        if (curDurationSec > 0) {
            meta.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, Math.round(curDurationSec * 1000.0));
        }
        if (art != null && art.bitmap != null) {
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art.bitmap);
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, art.bitmap);
        }
        mediaSession.setMetadata(meta.build());

        long actions = PlaybackStateCompat.ACTION_PLAY
                | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                | PlaybackStateCompat.ACTION_STOP
                | PlaybackStateCompat.ACTION_SEEK_TO;
        int state = curPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
        long posMs = Math.max(0L, Math.round(curPositionSec * 1000.0));
        PlaybackStateCompat.Builder pb = new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(state, posMs, curPlaying ? 1.0f : 0.0f)
                .addCustomAction(new PlaybackStateCompat.CustomAction.Builder(
                        CUSTOM_SHUFFLE,
                        curShuffle ? "Shuffle On" : "Shuffle",
                        curShuffle ? R.drawable.ic_media_shuffle_on : R.drawable.ic_media_shuffle).build())
                .addCustomAction(new PlaybackStateCompat.CustomAction.Builder(
                        CUSTOM_LIKE,
                        curLiked ? "Remove from Liked" : "Add to Liked",
                        curLiked ? R.drawable.ic_media_heart_filled : R.drawable.ic_media_heart).build());
        mediaSession.setPlaybackState(pb.build());
    }

    private Notification buildNotification(ArtEntry art) {
        updateMediaSession(art);

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, openIntent, piFlags);

        PendingIntent shufflePi = servicePendingIntent(ACTION_BTN_SHUFFLE, 1);
        PendingIntent prevPi = servicePendingIntent(ACTION_BTN_PREV, 2);
        PendingIntent togglePi = servicePendingIntent(ACTION_BTN_TOGGLE, 3);
        PendingIntent nextPi = servicePendingIntent(ACTION_BTN_NEXT, 4);
        PendingIntent likePi = servicePendingIntent(ACTION_BTN_LIKE, 5);
        PendingIntent stopPi = servicePendingIntent(ACTION_STOP, 6);

        int accentColor = art != null ? art.accentColor : DEFAULT_ACCENT_COLOR;
        String subText = curArtist != null && !curArtist.isEmpty() ? curArtist : "Dynamusic";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(curTitle)
                .setContentText(subText)
                .setSubText(curAlbum != null && !curAlbum.equals("Dynamusic") ? curAlbum : null)
                .setSmallIcon(R.drawable.ic_stat_dynamusic)
                .setContentIntent(contentIntent)
                .setDeleteIntent(stopPi)
                .setColor(accentColor)
                .setColorized(true)
                .setOngoing(curPlaying)
                .setSilent(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .addAction(
                        curShuffle ? R.drawable.ic_media_shuffle_on : R.drawable.ic_media_shuffle,
                        curShuffle ? "Shuffle On" : "Shuffle",
                        shufflePi)
                .addAction(R.drawable.ic_media_prev, "Previous", prevPi)
                .addAction(
                        curPlaying ? R.drawable.ic_media_pause : R.drawable.ic_media_play,
                        curPlaying ? "Pause" : "Play",
                        togglePi)
                .addAction(R.drawable.ic_media_next, "Next", nextPi)
                .addAction(
                        curLiked ? R.drawable.ic_media_heart_filled : R.drawable.ic_media_heart,
                        curLiked ? "Unlike" : "Like",
                        likePi);

        if (art != null && art.bitmap != null) {
            builder.setLargeIcon(art.bitmap);
        }

        MediaStyle style = new MediaStyle()
                .setShowActionsInCompactView(1, 2, 3)
                .setShowCancelButton(true)
                .setCancelButtonIntent(stopPi);
        if (mediaSession != null) {
            style.setMediaSession(mediaSession.getSessionToken());
        }
        builder.setStyle(style);
        return builder.build();
    }

    private void fetchArtworkAsync(String thumbUrl) {
        pendingArtUrl = thumbUrl;
        artExecutor.execute(() -> {
            Bitmap bmp = loadScaledBitmap(thumbUrl);
            if (bmp == null) return;
            int accent = extractRichDarkAccent(bmp);
            artCache.put(thumbUrl, new ArtEntry(bmp, accent));
            mainHandler.post(() -> {
                if (thumbUrl.equals(curThumb)) {
                    postUpdatedNotification();
                }
            });
        });
    }

    private static Bitmap loadScaledBitmap(String urlStr) {
        if (urlStr == null || urlStr.isEmpty()) return null;
        if (urlStr.startsWith("data:image/")) {
            try {
                int comma = urlStr.indexOf(',');
                if (comma < 0) return null;
                byte[] bytes = Base64.decode(urlStr.substring(comma + 1), Base64.DEFAULT);
                return decodeScaledBytes(bytes);
            } catch (Exception ignored) {
                return null;
            }
        }
        if (!urlStr.startsWith("https://") && !urlStr.startsWith("http://")) return null;
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(7000);
            conn.setRequestProperty("User-Agent", DESKTOP_UA);
            if (conn.getResponseCode() < 200 || conn.getResponseCode() >= 300) return null;
            try (InputStream in = conn.getInputStream()) {
                byte[] buf = new byte[16384];
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                int n;
                int total = 0;
                while ((n = in.read(buf)) != -1) {
                    total += n;
                    if (total > 2 * 1024 * 1024) break;
                    out.write(buf, 0, n);
                }
                return decodeScaledBytes(out.toByteArray());
            }
        } catch (Exception ignored) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static Bitmap decodeScaledBytes(byte[] bytes) {
        if (bytes == null || bytes.length == 0) return null;
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        int maxDim = Math.max(bounds.outWidth, bounds.outHeight);
        int sample = 1;
        while (maxDim / sample > 512) sample *= 2;
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        Bitmap raw = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
        if (raw == null) return null;
        if (raw.getWidth() <= 256 && raw.getHeight() <= 256) return raw;
        return Bitmap.createScaledBitmap(raw, 256, 256, true);
    }

    private static int extractRichDarkAccent(Bitmap bmp) {
        try {
            Bitmap tiny = Bitmap.createScaledBitmap(bmp, 24, 24, true);
            float bestScore = -1f;
            int bestColor = DEFAULT_ACCENT_COLOR;
            float[] hsv = new float[3];
            for (int y = 0; y < tiny.getHeight(); y++) {
                for (int x = 0; x < tiny.getWidth(); x++) {
                    int px = tiny.getPixel(x, y);
                    if (Color.alpha(px) < 200) continue;
                    Color.colorToHSV(px, hsv);
                    float sat = hsv[1];
                    float val = hsv[2];
                    if (val < 0.08f || val > 0.96f) continue;
                    float score = sat * 3.0f + (1.0f - Math.abs(val - 0.55f));
                    if (score > bestScore) {
                        bestScore = score;
                        bestColor = px;
                    }
                }
            }
            Color.colorToHSV(bestColor, hsv);
            // Boost saturation and clamp value so white text & controls stay crisp and vibrant
            hsv[1] = Math.min(0.88f, Math.max(0.45f, hsv[1] * 1.15f));
            hsv[2] = Math.min(0.44f, Math.max(0.24f, hsv[2] * 0.72f));
            return Color.HSVToColor(hsv);
        } catch (Exception ignored) {
            return DEFAULT_ACCENT_COLOR;
        }
    }
}
