package local.dynamusic.app;

import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MediaKeepalive")
public class MediaKeepalivePlugin extends Plugin {
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
}
