package local.dynamusic.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

public class MediaPlaybackService extends Service {
    public static final String CHANNEL_ID = "dynamusic_media_playback";
    public static final int NOTIFICATION_ID = 47822;
    public static final String ACTION_UPDATE = "local.dynamusic.app.ACTION_MEDIA_UPDATE";
    public static final String ACTION_STOP = "local.dynamusic.app.ACTION_MEDIA_STOP";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_PLAYING = "playing";

    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel();
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Dynamusic::PlaybackWakeLock");
            wakeLock.setReferenceCounted(false);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            releaseWakeLock();
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
            acquireWakeLock();
        } else {
            releaseWakeLock();
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
        releaseWakeLock();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void acquireWakeLock() {
        if (wakeLock != null && !wakeLock.isHeld()) {
            // Bounded 4-hour safety timeout so battery cannot leak indefinitely if killed abruptly
            wakeLock.acquire(4 * 60 * 60 * 1000L);
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception ignored) {}
        }
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

