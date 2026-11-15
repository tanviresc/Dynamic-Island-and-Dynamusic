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
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

public class MediaPlaybackService extends Service {
    public static final String CHANNEL_ID = "dynamusic_media_playback";
    public static final int NOTIFICATION_ID = 47822;
    public static final String ACTION_UPDATE = "local.dynamusic.app.ACTION_MEDIA_UPDATE";
    public static final String ACTION_STOP = "local.dynamusic.app.ACTION_MEDIA_STOP";
    public static final String ACTION_MEDIA_CONTROL = "local.dynamusic.app.ACTION_MEDIA_CONTROL";
    public static final String EXTRA_CONTROL_ACTION = "control_action";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_PLAYING = "playing";

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private boolean hasAudioFocus = false;
    private boolean noisyReceiverRegistered = false;
    private boolean pausedForTransientFocus = false;

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
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            releaseLocksAndFocus();
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }

        String title = intent != null && intent.getStringExtra(EXTRA_TITLE) != null
            ? intent.getStringExtra(EXTRA_TITLE)
            : "Dynamusic";
        String artist = intent != null && intent.getStringExtra(EXTRA_ARTIST) != null
            ? intent.getStringExtra(EXTRA_ARTIST)
            : "Playing in background";
        boolean playing = intent == null || intent.getBooleanExtra(EXTRA_PLAYING, true);

        if (playing) {
            acquireLocksAndFocus();
        } else {
            releaseWakeAndWifiLocks();
            unregisterNoisyReceiver();
        }

        Notification notification = buildNotification(title, artist, playing);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        releaseLocksAndFocus();
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
                    NotificationManager.IMPORTANCE_LOW
                );
                channel.setDescription("Keeps audio playing when screen is locked or minimized");
                channel.setShowBadge(false);
                nm.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification(String title, String artist, boolean playing) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT |
            (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, openIntent, piFlags);

        String sub = artist + (playing ? "" : " (Paused)");
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(sub)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentIntent)
            .setOngoing(playing)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build();
    }
}

