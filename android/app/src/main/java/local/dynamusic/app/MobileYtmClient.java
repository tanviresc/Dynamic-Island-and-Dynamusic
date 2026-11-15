package local.dynamusic.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Native HTTPS bridge for YouTube Music InnerTube (WEB_REMIX) endpoints.
 * Keeps requests on the device network with required Origin/Referer headers
 * that the WebView cannot forge.
 */
final class MobileYtmClient {
    private static final String DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    private static final String CLIENT_NAME = "WEB_REMIX";
    private static final String CLIENT_VERSION = "1.20250115.01.00";
    private static final Set<String> ALLOWED_ENDPOINTS = new HashSet<>(Arrays.asList(
            "search",
            "browse",
            "next",
            "music/get_search_suggestions"
    ));

    private MobileYtmClient() {}

    static String deviceCountry() {
        String c = Locale.getDefault().getCountry();
        if (c != null && c.length() == 2 && c.matches("[A-Za-z]{2}")) {
            return c.toUpperCase(Locale.US);
        }
        return "US";
    }

    static String request(String endpoint, JSONObject bodyObj) throws IOException, JSONException {
        if (endpoint == null) throw new IOException("Missing YTM endpoint");
        String normEndpoint = endpoint.replaceFirst("^/+", "");
        if (!ALLOWED_ENDPOINTS.contains(normEndpoint)) {
            throw new IOException("Disallowed YTM endpoint: " + normEndpoint);
        }

        JSONObject payload = bodyObj != null ? new JSONObject(bodyObj.toString()) : new JSONObject();
        JSONObject client = new JSONObject();
        client.put("clientName", CLIENT_NAME);
        client.put("clientVersion", CLIENT_VERSION);
        client.put("hl", "en");
        client.put("gl", deviceCountry());
        JSONObject context = new JSONObject();
        context.put("client", client);
        payload.put("context", context);

        HttpURLConnection conn = (HttpURLConnection) new URL(
                "https://music.youtube.com/youtubei/v1/" + normEndpoint + "?prettyPrint=false")
                .openConnection();
        try {
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(10000);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", DESKTOP_UA);
            conn.setRequestProperty("Origin", "https://music.youtube.com");
            conn.setRequestProperty("Referer", "https://music.youtube.com/");
            conn.setRequestProperty("X-YouTube-Client-Name", "67");
            conn.setRequestProperty("X-YouTube-Client-Version", CLIENT_VERSION);

            byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bytes);
            }

            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new IOException("YTM HTTP " + code + " on " + normEndpoint);
            }
            return readText(conn.getInputStream());
        } finally {
            conn.disconnect();
        }
    }

    static String httpGet(String urlStr, int timeoutMs, String userAgent) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        try {
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setRequestProperty("Accept", "application/json, text/plain, */*");
            conn.setRequestProperty("User-Agent", userAgent != null ? userAgent : DESKTOP_UA);
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new IOException("HTTP " + code);
            }
            return readText(conn.getInputStream());
        } finally {
            conn.disconnect();
        }
    }

    private static String readText(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) != -1) {
            out.write(buf, 0, n);
        }
        return out.toString("UTF-8");
    }
}

