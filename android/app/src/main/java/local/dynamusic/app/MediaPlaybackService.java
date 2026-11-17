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
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Binder;
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
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Single authoritative Android media playback engine owning ExoPlayer,
 * AudioFocus/WakeLocks, MediaSessionCompat hardware transport, and the
 * colorful MediaStyle notification bar.
 */
public class MediaPlaybackService extends Service {
    public static final String CHANNEL_ID = "dynamusic_media_playback";
    public static final int NOTIFICATION_ID = 47822;

    public static final String ACTION_LOAD = "local.dynamusic.app.ACTION_MEDIA_LOAD";
    public static final String ACTION_PREBUFFER = "local.dynamusic.app.ACTION_MEDIA_PREBUFFER";
    public static final String ACTION_PLAY = "local.dynamusic.app.ACTION_MEDIA_PLAY";
    public static final String ACTION_PAUSE = "local.dynamusic.app.ACTION_MEDIA_PAUSE";
    public static final String ACTION_SEEK = "local.dynamusic.app.ACTION_MEDIA_SEEK";
    public static final String ACTION_VOLUME = "local.dynamusic.app.ACTION_MEDIA_VOLUME";
    public static final String ACTION_SPEED = "local.dynamusic.app.ACTION_MEDIA_SPEED";
    public static final String ACTION_UPDATE = "local.dynamusic.app.ACTION_MEDIA_UPDATE";
    public static final String ACTION_STOP = "local.dynamusic.app.ACTION_MEDIA_STOP";

    public static final String ACTION_BTN_SHUFFLE = "local.dynamusic.app.ACTION_BTN_SHUFFLE";
    public static final String ACTION_BTN_PREV = "local.dynamusic.app.ACTION_BTN_PREV";
    public static final String ACTION_BTN_TOGGLE = "local.dynamusic.app.ACTION_BTN_TOGGLE";
    public static final String ACTION_BTN_NEXT = "local.dynamusic.app.ACTION_BTN_NEXT";
    public static final String ACTION_BTN_LIKE = "local.dynamusic.app.ACTION_BTN_LIKE";

    public static final String ACTION_MEDIA_CONTROL = "local.dynamusic.app.ACTION_MEDIA_CONTROL";
    public static final String ACTION_PLAYER_EVENT = "local.dynamusic.app.ACTION_PLAYER_EVENT";

    public static final String EXTRA_CONTROL_ACTION = "control_action";
    public static final String EXTRA_SEEK_TIME = "seek_time";
    public static final String EXTRA_TRACK_ID = "track_id";
    public static final String EXTRA_STREAM_URL = "stream_url";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_ALBUM = "album";
    public static final String EXTRA_THUMB = "thumb";
    public static final String EXTRA_PLAYING = "playing";
    public static final String EXTRA_AUTOPLAY = "autoplay";
    public static final String EXTRA_SHUFFLE = "shuffle";
    public static final String EXTRA_LIKED = "liked";
    public static final String EXTRA_DURATION = "duration";
    public static final String EXTRA_POSITION = "position";
    public static final String EXTRA_VOLUME = "volume";
    public static final String EXTRA_SPEED = "speed";
    public static final String EXTRA_EVENT_TYPE = "event_type";
    public static final String EXTRA_BUFFERING = "buffering";
    public static final String EXTRA_STATUS = "status";
    public static final String EXTRA_ERROR = "error";
    public static final String EXTRA_REQUEST_ID = "request_id";

    private static final String CUSTOM_SHUFFLE = "dynamusic_shuffle";
    private static final String CUSTOM_LIKE = "dynamusic_like";
    private static final int DEFAULT_ACCENT_COLOR = 0xFF4A1F5E;
    private static final String DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    public interface ServiceEventSink {
        void onServicePlayerEvent(String type, String trackId, boolean playing, boolean buffering,
                                  String status, double positionSec, double durationSec, String errorMsg,
                                  String requestId);
        void onServiceControlAction(String action, double seekSec, String trackId);
    }

    static final class QueuedTrack {
        final String id;
        final String title;
        final String artist;
        final String album;
        final double duration;
        final String thumb;
        final boolean liked;
        final String offlineUri;

        QueuedTrack(String id, String title, String artist, String album, double duration,
                    String thumb, boolean liked, String offlineUri) {
            this.id = id != null ? id : "";
            this.title = (title != null && !title.isEmpty()) ? title : "Dynamusic";
            this.artist = artist != null ? artist : "";
            this.album = (album != null && !album.isEmpty()) ? album : "Dynamusic";
            this.duration = duration;
            this.thumb = thumb != null ? thumb : "";
            this.liked = liked;
            this.offlineUri = offlineUri != null ? offlineUri : "";
        }
    }

    public final class LocalBinder extends Binder {
        MediaPlaybackService getService() {
            return MediaPlaybackService.this;
        }
    }

    private static final class ArtEntry {
        final Bitmap bitmap;
        final int accentColor;

        ArtEntry(Bitmap bitmap, int accentColor) {
            this.bitmap = bitmap;
            this.accentColor = accentColor;
        }
    }

    private final IBinder binder = new LocalBinder();
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private MediaSessionCompat mediaSession;
    private boolean hasAudioFocus = false;
    private boolean noisyReceiverRegistered = false;
    private boolean pausedForTransientFocus = false;
    private boolean duckedForTransientFocus = false;
    private volatile String nativePrebufferInFlightId = "";
    private final Runnable endedLockReleaseTask = this::releaseWakeAndWifiLocks;

    private ExoPlayer activePlayer;
    private ExoPlayer standbyPlayer;
    private String standbyTrackId = "";
    private String standbyUrl = "";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService artExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService queueResolverExecutor = Executors.newSingleThreadExecutor();
    private final LruCache<String, ArtEntry> artCache = new LruCache<>(24);

    private volatile ServiceEventSink eventSink;

    private String curTrackId = "";
    private String curRequestId = "";
    private String curStreamUrl = "";
    private String curTitle = "Dynamusic";
    private String curArtist = "";
    private String curAlbum = "Dynamusic";
    private String curThumb = "";
    private boolean curPlaying = false;
    private boolean curBuffering = false;
    private String curStatus = "idle";
    private boolean curShuffle = false;
    private boolean curLiked = false;
    private String curRepeatMode = "off";
    private double curDurationSec = 0;
    private double curPositionSec = 0;
    private float curVolume = 1.0f;
    private float curSpeed = 1.0f;
    private volatile String pendingArtUrl = "";
    private boolean foregroundStarted = false;
    private final List<QueuedTrack> upcomingQueue = new ArrayList<>();
    private final AtomicInteger nativeAdvanceSeq = new AtomicInteger(0);
    private boolean retriedEndedStream = false;

    private final Runnable progressTicker = new Runnable() {
        @Override
        public void run() {
            if (activePlayer != null) {
                int st = activePlayer.getPlaybackState();
                boolean wantPlay = activePlayer.getPlayWhenReady() && (st == Player.STATE_READY || st == Player.STATE_BUFFERING);
                if (st == Player.STATE_READY || st == Player.STATE_BUFFERING) {
                    long posMs = Math.max(0L, activePlayer.getCurrentPosition());
                    long durMs = activePlayer.getDuration();
                    curPositionSec = posMs / 1000.0;
                    if (durMs != C.TIME_UNSET && durMs > 0) {
                        curDurationSec = durMs / 1000.0;
                    }
                    emitPlayerEvent("position", curErrorNull());
                }
                if (wantPlay) {
                    mainHandler.postDelayed(this, 250L);
                    return;
                }
            }
            mainHandler.removeCallbacks(this);
        }
    };

    private static String curErrorNull() {
        return null;
    }

    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent != null ? intent.getAction() : null)) {
                pauseNative();
                dispatchMediaControl("pause");
            }
        }
    };

    private final AudioManager.OnAudioFocusChangeListener focusListener = focusChange -> {
        if (focusChange == AudioManager.AUDIOFOCUS_LOSS) {
            pausedForTransientFocus = false;
            duckedForTransientFocus = false;
            hasAudioFocus = false;
            pauseNative();
            dispatchMediaControl("pause");
        } else if (focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            boolean wasPlaying = curPlaying || (activePlayer != null && activePlayer.getPlayWhenReady());
            if (wasPlaying) {
                pausedForTransientFocus = true;
                pauseForAudioFocus();
                dispatchMediaControl("interrupted_pause");
            }
        } else if (focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
            duckedForTransientFocus = true;
            applyEffectiveVolume();
        } else if (focusChange == AudioManager.AUDIOFOCUS_GAIN) {
            hasAudioFocus = true;
            if (duckedForTransientFocus) {
                duckedForTransientFocus = false;
                applyEffectiveVolume();
            }
            if (pausedForTransientFocus) {
                pausedForTransientFocus = false;
                playNative();
                dispatchMediaControl("interrupted_resume");
            }
        }
    };

    private final Player.Listener playerListener = new Player.Listener() {
        @Override
        public void onPlaybackStateChanged(int playbackState) {
            if (playbackState == Player.STATE_ENDED) {
                long playerDurMs = C.TIME_UNSET;
                long playerPosMs = 0L;
                if (activePlayer != null) {
                    playerDurMs = activePlayer.getDuration();
                    playerPosMs = Math.max(0L, activePlayer.getCurrentPosition());
                    if (playerDurMs != C.TIME_UNSET && playerDurMs > 0) {
                        curDurationSec = playerDurMs / 1000.0;
                    }
                    curPositionSec = Math.max(curPositionSec, playerPosMs / 1000.0);
                }
                mainHandler.removeCallbacks(progressTicker);

                double playerDurSec = (playerDurMs != C.TIME_UNSET && playerDurMs > 0) ? (playerDurMs / 1000.0) : 0.0;
                double actualDurSec = playerDurSec > 0.0 ? playerDurSec : curDurationSec;
                boolean isLocalFile = !curStreamUrl.startsWith("http");
                boolean playedNearEnd = playerDurSec > 1.5 && curPositionSec >= playerDurSec - 3.0;
                boolean localEnded = isLocalFile && curPositionSec >= Math.max(1.0, actualDurSec - 2.5);
                boolean genuineEnd = playedNearEnd || localEnded;

                if (!genuineEnd) {
                    // Premature EOF or truncated HTTP stream — NEVER auto-skip to the next song.
                    // Recover cleanly in place with a rotated client/mirror if possible, else report error.
                    if (!retriedEndedStream && curStreamUrl.startsWith("http") && !curTrackId.isEmpty()) {
                        retriedEndedStream = true;
                        final String retryTrackId = curTrackId;
                        final String retryTitle = curTitle;
                        final String retryArtist = curArtist;
                        final String retryReqId = curRequestId;
                        final double resumePos = curPositionSec;
                        curBuffering = true;
                        curStatus = "loading";
                        postUpdatedNotification();
                        emitPlayerEvent("state", null);
                        queueResolverExecutor.execute(() -> {
                            try {
                                MobileStreamProxy proxy = MobileStreamProxy.getShared();
                                proxy.ensureStarted();
                                MobileStreamProxy.ResolvedStream resolved =
                                        proxy.resolve(retryTrackId, true, "", retryTitle, retryArtist);
                                final String freshUrl = resolved != null ? resolved.proxyUrl : "";
                                mainHandler.post(() -> {
                                    if (!retryTrackId.equals(curTrackId) || !retryReqId.equals(curRequestId)) return;
                                    if (!freshUrl.isEmpty()) {
                                        loadTrackNative(retryTrackId, freshUrl, true, resumePos, retryReqId);
                                    } else {
                                        curPlaying = false;
                                        curBuffering = false;
                                        curStatus = "error";
                                        releaseWakeAndWifiLocks();
                                        unregisterNoisyReceiver();
                                        postUpdatedNotification();
                                        emitPlayerEvent("error", "Stream ended prematurely");
                                    }
                                });
                            } catch (Exception e) {
                                mainHandler.post(() -> {
                                    if (!retryTrackId.equals(curTrackId) || !retryReqId.equals(curRequestId)) return;
                                    curPlaying = false;
                                    curBuffering = false;
                                    curStatus = "error";
                                    releaseWakeAndWifiLocks();
                                    unregisterNoisyReceiver();
                                    postUpdatedNotification();
                                    emitPlayerEvent("error", e.getMessage() != null ? e.getMessage() : "Stream ended prematurely");
                                });
                            }
                        });
                        return;
                    }
                    curPlaying = false;
                    curBuffering = false;
                    curStatus = "error";
                    releaseWakeAndWifiLocks();
                    unregisterNoisyReceiver();
                    postUpdatedNotification();
                    emitPlayerEvent("error", "Stream ended prematurely");
                    return;
                }

                // Genuine completion: handle Repeat One & Next Track natively in Java so locked/backgrounded
                // playback advances immediately without waiting for throttled WebView JS timers.
                if ("one".equals(curRepeatMode) && hasLoadedTrack()) {
                    seekNative(0.0);
                    playNative();
                    emitPlayerEvent("nativeRepeatOne", null);
                    return;
                }
                if (!upcomingQueue.isEmpty()) {
                    advanceToNextNative(false);
                    return;
                }

                curPlaying = false;
                curBuffering = false;
                curStatus = "paused";
                // Keep WakeLock/WifiLock briefly while WebView handles "ended" fallback under Doze.
                mainHandler.removeCallbacks(endedLockReleaseTask);
                mainHandler.postDelayed(endedLockReleaseTask, 15_000L);
                unregisterNoisyReceiver();
                postUpdatedNotification();
                emitPlayerEvent("ended", null);
                return;
            }
            syncStateFromPlayer(playbackState);
        }

        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            syncStateFromPlayer(activePlayer != null ? activePlayer.getPlaybackState() : Player.STATE_IDLE);
        }

        @Override
        public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
            syncStateFromPlayer(activePlayer != null ? activePlayer.getPlaybackState() : Player.STATE_IDLE);
        }

        @Override
        public void onPlayerError(@NonNull PlaybackException error) {
            if (activePlayer != null) {
                long posMs = activePlayer.getCurrentPosition();
                long durMs = activePlayer.getDuration();
                if (posMs > 0) curPositionSec = posMs / 1000.0;
                if (durMs != C.TIME_UNSET && durMs > 0) curDurationSec = durMs / 1000.0;
            }
            curPlaying = false;
            curBuffering = false;
            curStatus = "error";
            releaseWakeAndWifiLocks();
            unregisterNoisyReceiver();
            mainHandler.removeCallbacks(progressTicker);
            postUpdatedNotification();
            String msg = error.getMessage() != null ? error.getMessage() : "ExoPlayer playback error";
            emitPlayerEvent("error", msg);
        }
    };

    void setEventSink(ServiceEventSink sink) {
        this.eventSink = sink;
    }

    private ExoPlayer createConfiguredPlayer(boolean isStandby) {
        DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
                .setUserAgent(DESKTOP_UA)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(10000)
                .setReadTimeoutMs(15000);
        DefaultDataSource.Factory dataSourceFactory = new DefaultDataSource.Factory(this, httpFactory);
        DefaultLoadControl loadControl = isStandby
                ? new DefaultLoadControl.Builder()
                        .setBufferDurationsMs(4000, 8000, 500, 1000)
                        .setPrioritizeTimeOverSizeThresholds(true)
                        .build()
                : new DefaultLoadControl.Builder()
                        .setBufferDurationsMs(15000, 30000, 600, 1500)
                        .setPrioritizeTimeOverSizeThresholds(true)
                        .build();
        ExoPlayer player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(dataSourceFactory))
                .setLoadControl(loadControl)
                .build();
        androidx.media3.common.AudioAttributes attrs = new androidx.media3.common.AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build();
        // We manage AudioFocus ourselves so AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK and
        // MediaStyle lock-screen focus transitions stay completely deterministic.
        player.setAudioAttributes(attrs, false);
        return player;
    }

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

        activePlayer = createConfiguredPlayer(false);
        activePlayer.addListener(playerListener);

        mediaSession = new MediaSessionCompat(this, "DynamusicSession");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                if (hasLoadedTrack()) {
                    playNative();
                }
                dispatchMediaControl("play");
            }

            @Override
            public void onPause() {
                pauseNative();
                dispatchMediaControl("pause");
            }

            @Override
            public void onSkipToNext() {
                dispatchNextWithNativeFallback();
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
                double targetSec = Math.max(0.0, pos / 1000.0);
                seekNative(targetSec);
                dispatchMediaControlSeek(targetSec);
            }

            @Override
            public void onCustomAction(String action, Bundle extras) {
                if (CUSTOM_SHUFFLE.equals(action)) {
                    curShuffle = !curShuffle;
                    postUpdatedNotification();
                    dispatchMediaControl("shuffle");
                } else if (CUSTOM_LIKE.equals(action)) {
                    curLiked = !curLiked;
                    postUpdatedNotification();
                    dispatchMediaControl("like");
                }
            }
        });
        mediaSession.setActive(true);
    }

    private boolean hasLoadedTrack() {
        return activePlayer != null && activePlayer.getMediaItemCount() > 0 && !curStreamUrl.isEmpty();
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
            postUpdatedNotification();
            dispatchMediaControl("shuffle");
            return START_STICKY;
        }
        if (ACTION_BTN_PREV.equals(action)) {
            dispatchMediaControl("prev");
            return START_STICKY;
        }
        if (ACTION_BTN_TOGGLE.equals(action)) {
            if (curPlaying) {
                pauseNative();
                dispatchMediaControl("pause");
            } else {
                if (hasLoadedTrack()) {
                    playNative();
                }
                dispatchMediaControl("play");
            }
            return START_STICKY;
        }
        if (ACTION_BTN_NEXT.equals(action)) {
            dispatchNextWithNativeFallback();
            return START_STICKY;
        }
        if (ACTION_BTN_LIKE.equals(action)) {
            curLiked = !curLiked;
            postUpdatedNotification();
            dispatchMediaControl("like");
            return START_STICKY;
        }

        if (ACTION_LOAD.equals(action) && intent != null) {
            applyMetadataExtras(intent);
            String streamUrl = intent.getStringExtra(EXTRA_STREAM_URL);
            boolean autoplay = intent.getBooleanExtra(EXTRA_AUTOPLAY, true);
            double startPos = intent.getDoubleExtra(EXTRA_POSITION, 0.0);
            String reqId = intent.getStringExtra(EXTRA_REQUEST_ID);
            loadTrackNative(
                    curTrackId,
                    streamUrl != null ? streamUrl : "",
                    autoplay,
                    startPos,
                    reqId != null ? reqId : "");
            ensureForeground();
            return START_STICKY;
        }

        if (ACTION_PREBUFFER.equals(action) && intent != null) {
            String nextId = intent.getStringExtra(EXTRA_TRACK_ID);
            String nextUrl = intent.getStringExtra(EXTRA_STREAM_URL);
            prebufferTrackNative(nextId != null ? nextId : "", nextUrl != null ? nextUrl : "");
            return START_STICKY;
        }

        if (ACTION_PLAY.equals(action)) {
            playNative();
            ensureForeground();
            return START_STICKY;
        }

        if (ACTION_PAUSE.equals(action)) {
            pauseNative();
            ensureForeground();
            return START_STICKY;
        }

        if (ACTION_SEEK.equals(action) && intent != null) {
            seekNative(intent.getDoubleExtra(EXTRA_SEEK_TIME, 0.0));
            return START_STICKY;
        }

        if (ACTION_VOLUME.equals(action) && intent != null) {
            setVolumeNative((float) intent.getDoubleExtra(EXTRA_VOLUME, curVolume));
            return START_STICKY;
        }

        if (ACTION_SPEED.equals(action) && intent != null) {
            setSpeedNative((float) intent.getDoubleExtra(EXTRA_SPEED, curSpeed));
            return START_STICKY;
        }

        // Metadata / shuffle / liked sync without disrupting ExoPlayer audio pipeline
        if (intent != null) {
            applyMetadataExtras(intent);
        }

        if (!curThumb.isEmpty()) {
            ArtEntry art = artCache.get(curThumb);
            if (art == null && !curThumb.equals(pendingArtUrl)) {
                fetchArtworkAsync(curThumb);
            }
        }
        ensureForeground();
        postUpdatedNotification();
        return START_STICKY;
    }

    private void applyMetadataExtras(Intent intent) {
        if (intent.hasExtra(EXTRA_TRACK_ID)) {
            String id = intent.getStringExtra(EXTRA_TRACK_ID);
            if (id != null) curTrackId = id;
        }
        if (intent.hasExtra(EXTRA_TITLE)) {
            String t = intent.getStringExtra(EXTRA_TITLE);
            curTitle = (t != null && !t.isEmpty()) ? t : "Dynamusic";
        }
        if (intent.hasExtra(EXTRA_ARTIST)) {
            String a = intent.getStringExtra(EXTRA_ARTIST);
            curArtist = a != null ? a : "";
        }
        if (intent.hasExtra(EXTRA_ALBUM)) {
            String alb = intent.getStringExtra(EXTRA_ALBUM);
            curAlbum = (alb != null && !alb.isEmpty()) ? alb : "Dynamusic";
        }
        if (intent.hasExtra(EXTRA_THUMB)) {
            String th = intent.getStringExtra(EXTRA_THUMB);
            curThumb = th != null ? th : "";
        }
        if (intent.hasExtra(EXTRA_SHUFFLE)) {
            curShuffle = intent.getBooleanExtra(EXTRA_SHUFFLE, false);
        }
        if (intent.hasExtra(EXTRA_LIKED)) {
            curLiked = intent.getBooleanExtra(EXTRA_LIKED, false);
        }
        if (intent.hasExtra(EXTRA_DURATION)) {
            double d = intent.getDoubleExtra(EXTRA_DURATION, 0);
            if (d > 0) curDurationSec = d;
        }
        if (intent.hasExtra(EXTRA_VOLUME)) {
            setVolumeNative((float) intent.getDoubleExtra(EXTRA_VOLUME, curVolume));
        }
        if (intent.hasExtra(EXTRA_SPEED)) {
            setSpeedNative((float) intent.getDoubleExtra(EXTRA_SPEED, curSpeed));
        }
        if (!curThumb.isEmpty() && artCache.get(curThumb) == null && !curThumb.equals(pendingArtUrl)) {
            fetchArtworkAsync(curThumb);
        }
    }

    void setUpcomingQueueNative(String queueJson, String repeatMode) {
        if (repeatMode != null && !repeatMode.isEmpty()) {
            curRepeatMode = repeatMode;
        }
        upcomingQueue.clear();
        if (queueJson == null || queueJson.isEmpty()) return;
        try {
            JSONArray arr = new JSONArray(queueJson);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                String id = o.optString("id", "");
                if (id.isEmpty()) continue;
                upcomingQueue.add(new QueuedTrack(
                        id,
                        o.optString("title", "Dynamusic"),
                        o.optString("artist", ""),
                        o.optString("album", "Dynamusic"),
                        o.optDouble("duration", 0.0),
                        o.optString("thumb", ""),
                        o.optBoolean("liked", false),
                        o.optString("offlineUri", "")));
            }
        } catch (Exception ignored) {
        }
    }

    void updateMetadataNative(
            String trackId,
            String title,
            String artist,
            String album,
            String thumb,
            boolean playing,
            boolean shuffle,
            boolean liked,
            double duration,
            double position) {
        if (trackId != null && !trackId.isEmpty()) curTrackId = trackId;
        curTitle = (title != null && !title.isEmpty()) ? title : "Dynamusic";
        curArtist = artist != null ? artist : "";
        curAlbum = (album != null && !album.isEmpty()) ? album : "Dynamusic";
        curThumb = thumb != null ? thumb : "";
        curShuffle = shuffle;
        curLiked = liked;
        if (duration > 0) curDurationSec = duration;
        if (!hasLoadedTrack() && position >= 0) curPositionSec = position;
        if (!curThumb.isEmpty()) {
            ArtEntry art = artCache.get(curThumb);
            if (art == null && !curThumb.equals(pendingArtUrl)) {
                fetchArtworkAsync(curThumb);
            }
        }
        ensureForeground();
        postUpdatedNotification();
    }

    void stopAndResetNative(String requestId) {
        nativeAdvanceSeq.incrementAndGet();
        if (requestId != null && !requestId.isEmpty()) {
            curRequestId = requestId;
        }
        mainHandler.removeCallbacks(progressTicker);
        if (activePlayer != null) {
            activePlayer.setPlayWhenReady(false);
            activePlayer.stop();
            activePlayer.clearMediaItems();
        }
        curStreamUrl = "";
        curPositionSec = 0;
        curPlaying = false;
        curBuffering = false;
        curStatus = "idle";
        releaseWakeAndWifiLocks();
        unregisterNoisyReceiver();
        emitPlayerEvent("state", null);
    }

    private void dispatchNextWithNativeFallback() {
        final String beforeReq = curRequestId;
        final String beforeId = curTrackId;
        dispatchMediaControl("next");
        if (!upcomingQueue.isEmpty()) {
            mainHandler.postDelayed(() -> {
                if (beforeId.equals(curTrackId) && beforeReq.equals(curRequestId) && !upcomingQueue.isEmpty()) {
                    advanceToNextNative(true);
                }
            }, 420L);
        }
    }

    private String findOfflineAudioUri(String trackId) {
        if (trackId == null || trackId.isEmpty()) return null;
        String safe = trackId.replaceAll("[^A-Za-z0-9_-]", "_");
        if (safe.isEmpty()) return null;
        File dir = new File(getFilesDir(), "offline_vault");
        File[] files = dir.listFiles();
        if (files == null) return null;
        String prefix = safe + ".";
        for (File f : files) {
            if (f.isFile() && f.getName().startsWith(prefix) && f.length() > 4096) {
                return Uri.fromFile(f).toString();
            }
        }
        return null;
    }

    private void advanceToNextNative(boolean manualSkip) {
        if (upcomingQueue.isEmpty()) return;
        QueuedTrack next = upcomingQueue.remove(0);
        if ("all".equals(curRepeatMode) && next != null && !next.id.isEmpty()) {
            upcomingQueue.add(next);
        }
        final int advGen = nativeAdvanceSeq.incrementAndGet();
        final String newReqId = "nat_" + advGen;
        curTrackId = next.id;
        curRequestId = newReqId;
        curTitle = next.title;
        curArtist = next.artist;
        curAlbum = next.album;
        curThumb = next.thumb;
        curLiked = next.liked;
        curDurationSec = next.duration > 0 ? next.duration : 0;
        curPositionSec = 0;
        curPlaying = true;
        curBuffering = true;
        curStatus = "loading";

        if (!curThumb.isEmpty()) {
            ArtEntry art = artCache.get(curThumb);
            if (art == null && !curThumb.equals(pendingArtUrl)) {
                fetchArtworkAsync(curThumb);
            }
        }
        ensureForeground();
        postUpdatedNotification();

        // Fast path 1: standbyPlayer already pre-buffered this exact track!
        if (standbyPlayer != null && next.id.equals(standbyTrackId) && !standbyUrl.isEmpty()) {
            emitPlayerEvent("nativeTrackAdvanced", null);
            loadTrackNative(next.id, standbyUrl, true, 0.0, newReqId);
            return;
        }

        // Fast path 2: local offline file already exists!
        String offline = !next.offlineUri.isEmpty() ? next.offlineUri : findOfflineAudioUri(next.id);
        if (offline != null && !offline.isEmpty()) {
            emitPlayerEvent("nativeTrackAdvanced", null);
            loadTrackNative(next.id, offline, true, 0.0, newReqId);
            return;
        }

        // Stop old audio immediately while resolving next stream on background executor
        if (activePlayer != null) {
            activePlayer.setPlayWhenReady(false);
            activePlayer.stop();
            activePlayer.clearMediaItems();
        }
        curStreamUrl = "";
        emitPlayerEvent("nativeTrackAdvanced", null);

        // Background native stream resolution while WakeLock + WifiLock stay held.
        acquireLocksAndFocus();
        queueResolverExecutor.execute(() -> {
            try {
                MobileStreamProxy proxy = MobileStreamProxy.getShared();
                proxy.ensureStarted();
                MobileStreamProxy.ResolvedStream resolved =
                        proxy.resolve(next.id, false, "", next.title, next.artist);
                final String url = resolved != null ? resolved.proxyUrl : "";
                mainHandler.post(() -> {
                    if (advGen != nativeAdvanceSeq.get() || !newReqId.equals(curRequestId)) return;
                    if (!url.isEmpty()) {
                        loadTrackNative(next.id, url, true, 0.0, newReqId);
                    } else {
                        // Never cascade-skip down the entire queue on a failed resolution
                        curPlaying = false;
                        curBuffering = false;
                        curStatus = "error";
                        releaseWakeAndWifiLocks();
                        unregisterNoisyReceiver();
                        postUpdatedNotification();
                        emitPlayerEvent("error", "Stream unavailable");
                    }
                });
            } catch (Exception e) {
                mainHandler.post(() -> {
                    if (advGen != nativeAdvanceSeq.get() || !newReqId.equals(curRequestId)) return;
                    curPlaying = false;
                    curBuffering = false;
                    curStatus = "error";
                    releaseWakeAndWifiLocks();
                    unregisterNoisyReceiver();
                    postUpdatedNotification();
                    emitPlayerEvent("error", e.getMessage() != null ? e.getMessage() : "Stream resolution failed");
                });
            }
        });
    }

    void loadTrackNative(
            String trackId,
            String streamUrl,
            boolean autoplay,
            double startPosSec,
            String requestId) {
        nativeAdvanceSeq.incrementAndGet();
        if (trackId != null) {
            if (!trackId.equals(curTrackId)) {
                curDurationSec = 0.0;
            }
            curTrackId = trackId;
        }
        if (requestId != null && !requestId.isEmpty()) {
            curRequestId = requestId;
        }
        retriedEndedStream = false;
        curStreamUrl = streamUrl != null ? streamUrl : "";
        curPositionSec = Math.max(0.0, startPosSec);

        if (activePlayer == null) {
            activePlayer = createConfiguredPlayer(false);
            activePlayer.addListener(playerListener);
        }

        // Stop any active playback immediately before switching streams so old audio can never bleed
        mainHandler.removeCallbacks(progressTicker);

        if (curStreamUrl.isEmpty()) {
            activePlayer.setPlayWhenReady(false);
            activePlayer.stop();
            activePlayer.clearMediaItems();
            curPlaying = false;
            curBuffering = false;
            curStatus = "idle";
            releaseWakeAndWifiLocks();
            unregisterNoisyReceiver();
            postUpdatedNotification();
            emitPlayerEvent("state", null);
            return;
        }

        boolean standbyMatches = standbyPlayer != null
                && !standbyUrl.isEmpty()
                && (curStreamUrl.equals(standbyUrl) || (!curTrackId.isEmpty() && curTrackId.equals(standbyTrackId)));
        if (standbyMatches) {
            // Instant promotion of pre-buffered standby deck
            activePlayer.removeListener(playerListener);
            activePlayer.stop();
            activePlayer.release();

            activePlayer = standbyPlayer;
            standbyPlayer = null;
            standbyTrackId = "";
            standbyUrl = "";

            activePlayer.addListener(playerListener);
            if (startPosSec > 0.05) {
                activePlayer.seekTo(Math.round(startPosSec * 1000.0));
            }
            applyEffectiveVolume();
            activePlayer.setPlaybackSpeed(curSpeed);
            if (autoplay) {
                acquireLocksAndFocus();
            }
            curPlaying = autoplay;
            curBuffering = activePlayer.getPlaybackState() == Player.STATE_BUFFERING;
            curStatus = curBuffering ? "loading" : (autoplay ? "playing" : "paused");
            activePlayer.setPlayWhenReady(autoplay);
            if (autoplay) {
                mainHandler.post(progressTicker);
            }
            ensureForeground();
            postUpdatedNotification();
            emitPlayerEvent("state", null);
            return;
        }

        releaseStandbyPlayer();
        activePlayer.setPlayWhenReady(false);
        activePlayer.stop();
        activePlayer.clearMediaItems();

        MediaItem item = MediaItem.fromUri(Uri.parse(curStreamUrl));
        activePlayer.setMediaItem(item);
        if (startPosSec > 0.05) {
            activePlayer.seekTo(Math.round(startPosSec * 1000.0));
        }
        applyEffectiveVolume();
        activePlayer.setPlaybackSpeed(curSpeed);
        if (autoplay) {
            acquireLocksAndFocus();
        } else {
            releaseWakeAndWifiLocks();
            unregisterNoisyReceiver();
        }
        curPlaying = autoplay;
        curBuffering = true;
        curStatus = "loading";
        activePlayer.setPlayWhenReady(autoplay);
        activePlayer.prepare();
        if (autoplay) {
            mainHandler.post(progressTicker);
        }
        ensureForeground();
        postUpdatedNotification();
        emitPlayerEvent("state", null);
        scheduleNativeLookaheadPrebuffer();
    }

    private void scheduleNativeLookaheadPrebuffer() {
        if (!curPlaying || upcomingQueue.isEmpty()) return;
        final QueuedTrack next = upcomingQueue.get(0);
        if (next == null || next.id.isEmpty()) return;
        if (next.id.equals(standbyTrackId) && !standbyUrl.isEmpty()) return;
        if (next.id.equals(nativePrebufferInFlightId)) return;

        String offline = !next.offlineUri.isEmpty() ? next.offlineUri : findOfflineAudioUri(next.id);
        if (offline != null && !offline.isEmpty()) {
            prebufferTrackNative(next.id, offline);
            return;
        }

        nativePrebufferInFlightId = next.id;
        final String expectingCurId = curTrackId;
        queueResolverExecutor.execute(() -> {
            try {
                MobileStreamProxy proxy = MobileStreamProxy.getShared();
                proxy.ensureStarted();
                MobileStreamProxy.ResolvedStream resolved =
                        proxy.resolve(next.id, false, "", next.title, next.artist);
                final String url = resolved != null ? resolved.proxyUrl : "";
                mainHandler.post(() -> {
                    if (next.id.equals(nativePrebufferInFlightId)) {
                        nativePrebufferInFlightId = "";
                    }
                    if (!url.isEmpty() && expectingCurId.equals(curTrackId)
                            && !upcomingQueue.isEmpty() && next.id.equals(upcomingQueue.get(0).id)) {
                        prebufferTrackNative(next.id, url);
                    }
                });
            } catch (Exception ignored) {
                mainHandler.post(() -> {
                    if (next.id.equals(nativePrebufferInFlightId)) {
                        nativePrebufferInFlightId = "";
                    }
                });
            }
        });
    }

    void prebufferTrackNative(String trackId, String streamUrl) {
        if (streamUrl == null || streamUrl.isEmpty() || streamUrl.equals(standbyUrl)) return;
        releaseStandbyPlayer();
        standbyTrackId = trackId != null ? trackId : "";
        standbyUrl = streamUrl;
        standbyPlayer = createConfiguredPlayer(true);
        standbyPlayer.setPlayWhenReady(false);
        standbyPlayer.setMediaItem(MediaItem.fromUri(Uri.parse(streamUrl)));
        standbyPlayer.prepare();
    }

    private void releaseStandbyPlayer() {
        if (standbyPlayer != null) {
            try {
                standbyPlayer.stop();
                standbyPlayer.release();
            } catch (Exception ignored) {}
            standbyPlayer = null;
        }
        standbyTrackId = "";
        standbyUrl = "";
    }

    void playNative() {
        if (activePlayer == null) return;
        pausedForTransientFocus = false;
        acquireLocksAndFocus();
        if (activePlayer.getPlaybackState() == Player.STATE_ENDED) {
            activePlayer.seekTo(0);
        }
        applyEffectiveVolume();
        activePlayer.setPlayWhenReady(true);
        mainHandler.post(progressTicker);
        syncStateFromPlayer(activePlayer.getPlaybackState());
    }

    private void pauseForAudioFocus() {
        if (activePlayer != null) {
            activePlayer.setPlayWhenReady(false);
        }
        mainHandler.removeCallbacks(progressTicker);
        releaseWakeAndWifiLocks();
        unregisterNoisyReceiver();
        syncStateFromPlayer(activePlayer != null ? activePlayer.getPlaybackState() : Player.STATE_IDLE);
    }

    void pauseNative() {
        pausedForTransientFocus = false;
        pauseForAudioFocus();
    }

    void seekNative(double seconds) {
        double clamped = Math.max(0.0, seconds);
        if (curDurationSec > 0) clamped = Math.min(curDurationSec, clamped);
        curPositionSec = clamped;
        if (activePlayer != null && activePlayer.getMediaItemCount() > 0) {
            activePlayer.seekTo(Math.round(clamped * 1000.0));
        }
        postUpdatedNotification();
        emitPlayerEvent("position", null);
    }

    void setVolumeNative(float vol) {
        curVolume = Math.max(0.0f, Math.min(1.0f, vol));
        applyEffectiveVolume();
    }

    void setSpeedNative(float speed) {
        curSpeed = Math.max(0.5f, Math.min(2.0f, speed));
        if (activePlayer != null) {
            activePlayer.setPlaybackSpeed(curSpeed);
        }
    }

    void stopPlaybackNative() {
        mainHandler.removeCallbacks(progressTicker);
        releaseStandbyPlayer();
        if (activePlayer != null) {
            activePlayer.stop();
            activePlayer.clearMediaItems();
        }
        curStreamUrl = "";
        curPlaying = false;
        curBuffering = false;
        curStatus = "idle";
        releaseLocksAndFocus();
        emitPlayerEvent("state", null);
    }

    private void applyEffectiveVolume() {
        if (activePlayer != null) {
            activePlayer.setVolume(duckedForTransientFocus ? curVolume * 0.25f : curVolume);
        }
    }

    private void syncStateFromPlayer(int playbackState) {
        if (activePlayer == null) return;
        boolean playWhenReady = activePlayer.getPlayWhenReady();
        boolean hasItem = activePlayer.getMediaItemCount() > 0;
        long durMs = activePlayer.getDuration();
        if (durMs != C.TIME_UNSET && durMs > 0) {
            curDurationSec = durMs / 1000.0;
        }
        long posMs = activePlayer.getCurrentPosition();
        if (posMs >= 0) {
            curPositionSec = posMs / 1000.0;
        }

        boolean buffering = hasItem && playbackState == Player.STATE_BUFFERING;
        boolean playing = hasItem && playWhenReady && (playbackState == Player.STATE_READY || playbackState == Player.STATE_BUFFERING);

        curBuffering = buffering;
        curPlaying = playing;
        if (!hasItem || playbackState == Player.STATE_IDLE) {
            if (!"error".equals(curStatus)) curStatus = "idle";
        } else if (buffering) {
            curStatus = playWhenReady ? "loading" : "paused";
        } else if (playbackState == Player.STATE_READY) {
            curStatus = playWhenReady ? "playing" : "paused";
        } else if (playbackState == Player.STATE_ENDED) {
            curStatus = "paused";
        }

        if (playing) {
            acquireLocksAndFocus();
            mainHandler.removeCallbacks(progressTicker);
            mainHandler.post(progressTicker);
            if (playbackState == Player.STATE_READY) {
                scheduleNativeLookaheadPrebuffer();
            }
        } else {
            mainHandler.removeCallbacks(progressTicker);
            if (!pausedForTransientFocus) {
                releaseWakeAndWifiLocks();
            }
            unregisterNoisyReceiver();
        }

        postUpdatedNotification();
        emitPlayerEvent("state", null);
    }

    private void ensureForeground() {
        if (mediaSession != null && !mediaSession.isActive()) {
            mediaSession.setActive(true);
        }
        ArtEntry art = !curThumb.isEmpty() ? artCache.get(curThumb) : null;
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
        foregroundStarted = true;
    }

    private void handleStopFromUser() {
        stopPlaybackNative();
        dispatchMediaControl("stop");
        if (mediaSession != null) {
            mediaSession.setActive(false);
        }
        foregroundStarted = false;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void postUpdatedNotification() {
        if (!foregroundStarted) return;
        ArtEntry art = !curThumb.isEmpty() ? artCache.get(curThumb) : null;
        Notification notification = buildNotification(art);
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID, notification);
        }
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacks(progressTicker);
        releaseStandbyPlayer();
        if (activePlayer != null) {
            activePlayer.removeListener(playerListener);
            activePlayer.stop();
            activePlayer.release();
            activePlayer = null;
        }
        releaseLocksAndFocus();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        artExecutor.shutdownNow();
        queueResolverExecutor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    private void dispatchMediaControl(String action) {
        ServiceEventSink sink = this.eventSink;
        if (sink != null) {
            sink.onServiceControlAction(action, -1.0, curTrackId);
        } else {
            Intent i = new Intent(ACTION_MEDIA_CONTROL);
            i.setPackage(getPackageName());
            i.putExtra(EXTRA_CONTROL_ACTION, action);
            i.putExtra(EXTRA_TRACK_ID, curTrackId);
            sendBroadcast(i);
        }
    }

    private void dispatchMediaControlSeek(double seekSec) {
        ServiceEventSink sink = this.eventSink;
        if (sink != null) {
            sink.onServiceControlAction("seekTo", seekSec, curTrackId);
        } else {
            Intent i = new Intent(ACTION_MEDIA_CONTROL);
            i.setPackage(getPackageName());
            i.putExtra(EXTRA_CONTROL_ACTION, "seekTo");
            i.putExtra(EXTRA_SEEK_TIME, seekSec);
            i.putExtra(EXTRA_TRACK_ID, curTrackId);
            sendBroadcast(i);
        }
    }

    private void emitPlayerEvent(String type, String errorMsg) {
        ServiceEventSink sink = this.eventSink;
        if (sink != null) {
            sink.onServicePlayerEvent(
                    type,
                    curTrackId,
                    curPlaying,
                    curBuffering,
                    curStatus,
                    curPositionSec,
                    curDurationSec,
                    errorMsg,
                    curRequestId);
            return;
        }
        Intent i = new Intent(ACTION_PLAYER_EVENT);
        i.setPackage(getPackageName());
        i.putExtra(EXTRA_EVENT_TYPE, type);
        i.putExtra(EXTRA_TRACK_ID, curTrackId);
        i.putExtra(EXTRA_REQUEST_ID, curRequestId);
        i.putExtra(EXTRA_PLAYING, curPlaying);
        i.putExtra(EXTRA_BUFFERING, curBuffering);
        i.putExtra(EXTRA_STATUS, curStatus);
        i.putExtra(EXTRA_POSITION, curPositionSec);
        i.putExtra(EXTRA_DURATION, curDurationSec);
        if (errorMsg != null) i.putExtra(EXTRA_ERROR, errorMsg);
        sendBroadcast(i);
    }

    private void acquireLocksAndFocus() {
        mainHandler.removeCallbacks(endedLockReleaseTask);
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
                            .setWillPauseWhenDucked(false)
                            .setAcceptsDelayedFocusGain(true)
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
        duckedForTransientFocus = false;
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
        int state = curBuffering && curPlaying
                ? PlaybackStateCompat.STATE_BUFFERING
                : (curPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED);
        long posMs = Math.max(0L, Math.round(curPositionSec * 1000.0));
        PlaybackStateCompat.Builder pb = new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(state, posMs, (curPlaying && !curBuffering) ? curSpeed : 0.0f)
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
        final String trackIdSnap = curTrackId;
        artExecutor.execute(() -> {
            Bitmap bmp = loadLocalOfflineArt(trackIdSnap);
            if (bmp == null) {
                bmp = loadScaledBitmap(thumbUrl);
            }
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

    private Bitmap loadLocalOfflineArt(String trackId) {
        if (trackId == null || trackId.isEmpty()) return null;
        String safe = trackId.replaceAll("[^A-Za-z0-9_-]", "_");
        if (safe.isEmpty()) return null;
        File dir = new File(getFilesDir(), "offline_artwork");
        File[] files = dir.listFiles();
        if (files == null) return null;
        String prefix = safe + ".";
        for (File f : files) {
            if (f.isFile() && f.getName().startsWith(prefix) && f.length() > 64) {
                try (FileInputStream fis = new FileInputStream(f)) {
                    byte[] bytes = new byte[(int) Math.min(f.length(), 2 * 1024 * 1024)];
                    int read = fis.read(bytes);
                    if (read > 0) {
                        return decodeScaledBytes(read == bytes.length ? bytes : java.util.Arrays.copyOf(bytes, read));
                    }
                } catch (Exception ignored) {}
            }
        }
        return null;
    }

    private static Bitmap loadScaledBitmap(String urlStr) {
        if (urlStr == null || urlStr.isEmpty()) return null;
        if (urlStr.startsWith("file://")) {
            try {
                File f = new File(Uri.parse(urlStr).getPath());
                if (f.isFile() && f.length() > 64) {
                    try (FileInputStream fis = new FileInputStream(f)) {
                        byte[] bytes = new byte[(int) Math.min(f.length(), 2 * 1024 * 1024)];
                        int read = fis.read(bytes);
                        if (read > 0) {
                            return decodeScaledBytes(read == bytes.length ? bytes : java.util.Arrays.copyOf(bytes, read));
                        }
                    }
                }
            } catch (Exception ignored) {}
            return null;
        }
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
            hsv[1] = Math.min(0.88f, Math.max(0.45f, hsv[1] * 1.15f));
            hsv[2] = Math.min(0.44f, Math.max(0.24f, hsv[2] * 0.72f));
            return Color.HSVToColor(hsv);
        } catch (Exception ignored) {
            return DEFAULT_ACCENT_COLOR;
        }
    }
}
