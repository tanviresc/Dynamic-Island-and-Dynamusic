package local.dynamusic.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static volatile String pendingOAuthUrl = null;
    private OnBackPressedCallback backCallback;

    public static String consumePendingOAuthUrl() {
        String url = pendingOAuthUrl;
        pendingOAuthUrl = null;
        return url;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaKeepalivePlugin.class);
        super.onCreate(savedInstanceState);
        captureOAuthIntent(getIntent());

        backCallback = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (MediaKeepalivePlugin.dispatchBackPressed()) {
                    return;
                }
                setEnabled(false);
                try {
                    getOnBackPressedDispatcher().onBackPressed();
                } finally {
                    setEnabled(true);
                }
            }
        };
        getOnBackPressedDispatcher().addCallback(this, backCallback);
    }

    @Override
    public void onResume() {
        super.onResume();
        MediaKeepalivePlugin.dispatchAppResume();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureOAuthIntent(intent);
    }

    private void captureOAuthIntent(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data == null) return;
        String url = data.toString();
        if (!url.startsWith("bytune://oauth/callback")) return;
        pendingOAuthUrl = url;
        dispatchOAuthToWebView(url);
    }

    private void dispatchOAuthToWebView(String url) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        final WebView webView = getBridge().getWebView();
        final String js = "window.dispatchEvent(new CustomEvent('dynamusic:oauth-callback', { detail: { url: "
                + JSONObject.quote(url)
                + " } }));";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    @Override
    public void onStart() {
        super.onStart();
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebSettings settings = getBridge().getWebView().getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            settings.setDomStorageEnabled(true);
            String pending = pendingOAuthUrl;
            if (pending != null) {
                dispatchOAuthToWebView(pending);
            }
        }
    }
}
