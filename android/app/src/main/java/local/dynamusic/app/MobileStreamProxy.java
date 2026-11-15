package local.dynamusic.app;

import android.util.Base64;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletionService;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Embedded loopback HTTP proxy and native stream resolver for standalone Android playback.
 * Resolves direct playable audio streams from YouTube InnerTube, verified JioSaavn CDN,
 * and Piped mirrors on the device's own IP, then serves them from 127.0.0.1 with
 * Access-Control-Allow-Origin: *, upstream User-Agent forwarding, and HTTP Range support.
 */
final class MobileStreamProxy {
    private static final String DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    private static final String JIOSAAVN_DES_KEY = "38346591";
    private static final long MAX_CACHE_TTL_MS = 4L * 60L * 60L * 1000L;
    private static final long MIN_CACHE_TTL_MS = 10L * 60L * 1000L;
    private static final Pattern EXPIRE_PARAM = Pattern.compile("[?&]expire=(\\d+)");

    private static final ClientSpec[] INNERTUBE_CLIENTS = new ClientSpec[] {
        new ClientSpec(
                "IOS",
                "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)",
                "{\"clientName\":\"IOS\",\"clientVersion\":\"20.10.4\",\"deviceMake\":\"Apple\",\"deviceModel\":\"iPhone16,2\",\"osName\":\"iPhone\",\"osVersion\":\"18.3.2.22D82\",\"hl\":\"en\",\"gl\":\"US\"}"),
        new ClientSpec(
                "ANDROID_VR",
                "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
                "{\"clientName\":\"ANDROID_VR\",\"clientVersion\":\"1.60.19\",\"deviceMake\":\"Oculus\",\"deviceModel\":\"Quest 3\",\"osName\":\"Android\",\"osVersion\":\"12L\",\"androidSdkVersion\":32,\"hl\":\"en\",\"gl\":\"US\"}"),
        new ClientSpec(
                "ANDROID",
                "com.google.android.youtube/20.10.38 (Linux; U; Android 15) gzip",
                "{\"clientName\":\"ANDROID\",\"clientVersion\":\"20.10.38\",\"androidSdkVersion\":35,\"hl\":\"en\",\"gl\":\"US\"}")
    };

    private static final String[] PIPED_INSTANCES = new String[] {
        "https://api.piped.private.coffee",
        "https://pipedapi.adminforge.de",
        "https://pipedapi.kavin.rocks"
    };

    static final class ResolvedStream {
        final String proxyUrl;
        final String upstreamUrl;
        final String mimeType;
        final Double lufs;
        final String userAgent;
        final String source;
        final long expiresAtMs;

        ResolvedStream(
                String proxyUrl,
                String upstreamUrl,
                String mimeType,
                Double lufs,
                String userAgent,
                String source,
                long expiresAtMs) {
            this.proxyUrl = proxyUrl;
            this.upstreamUrl = upstreamUrl;
            this.mimeType = mimeType;
            this.lufs = lufs;
            this.userAgent = userAgent;
            this.source = source;
            this.expiresAtMs = expiresAtMs;
        }
    }

    private static final class ClientSpec {
        final String name;
        final String userAgent;
        final String clientJson;

        ClientSpec(String name, String userAgent, String clientJson) {
            this.name = name;
            this.userAgent = userAgent;
            this.clientJson = clientJson;
        }
    }

    private final ConcurrentHashMap<String, ResolvedStream> cache = new ConcurrentHashMap<>();
    private final ExecutorService proxyPool = Executors.newCachedThreadPool();
    private final ExecutorService resolverPool = Executors.newCachedThreadPool();
    private final AtomicInteger preferredClientIdx = new AtomicInteger(0);

    private ServerSocket serverSocket;
    private volatile int port = -1;

    synchronized int ensureStarted() throws IOException {
        if (port > 0 && serverSocket != null && !serverSocket.isClosed()) {
            return port;
        }
        serverSocket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        port = serverSocket.getLocalPort();
        Thread acceptThread = new Thread(this::acceptLoop, "dynamusic-stream-proxy");
        acceptThread.setDaemon(true);
        acceptThread.start();
        return port;
    }

    ResolvedStream resolve(String videoId, boolean forceRotate, String quality, String title, String artist)
            throws IOException {
        if (videoId == null || videoId.trim().isEmpty() || videoId.startsWith("local:")) {
            throw new IOException("Unsupported videoId for mobile stream resolution");
        }
        int boundPort = ensureStarted();
        String normQuality = quality != null ? quality.trim().toLowerCase(Locale.US) : "";
        String key = videoId + "|" + normQuality;

        ResolvedStream previous = cache.get(key);
        if (!forceRotate && previous != null && System.currentTimeMillis() < previous.expiresAtMs) {
            return previous;
        }

        String skipSource = null;
        if (forceRotate) {
            cache.remove(key);
            if (previous != null) {
                skipSource = previous.source;
            }
            preferredClientIdx.updateAndGet((i) -> (i + 1) % INNERTUBE_CLIENTS.length);
        }

        String proxyUrl = buildProxyUrl(boundPort, videoId, normQuality, title, artist);
        ResolvedStream fresh = resolveUpstream(videoId, normQuality, title, artist, proxyUrl, skipSource);
        cache.put(key, fresh);
        return fresh;
    }

    private String buildProxyUrl(int boundPort, String videoId, String quality, String title, String artist) {
        StringBuilder sb = new StringBuilder();
        sb.append("http://127.0.0.1:").append(boundPort).append("/stream?id=").append(urlEncode(videoId));
        if (quality != null && !quality.isEmpty()) {
            sb.append("&quality=").append(urlEncode(quality));
        }
        if (title != null && !title.isEmpty()) {
            sb.append("&title=").append(urlEncode(title));
        }
        if (artist != null && !artist.isEmpty()) {
            sb.append("&artist=").append(urlEncode(artist));
        }
        return sb.toString();
    }

    private ResolvedStream resolveUpstream(
            String videoId,
            String quality,
            String title,
            String artist,
            String proxyUrl,
            String skipSource) throws IOException {
        int maxKbps = qualityToMaxKbps(quality);

        // Race InnerTube against strictly-verified JioSaavn CDN when we can skip neither or only non-skipped sources
        List<Future<ResolvedStream>> tasks = new ArrayList<>();
        CompletionService<ResolvedStream> ecs = new ExecutorCompletionService<>(resolverPool);
        tasks.add(ecs.submit(() -> resolveViaInnerTube(videoId, maxKbps, proxyUrl, skipSource)));
        if (!"jiosaavn".equals(skipSource)) {
            tasks.add(ecs.submit(() -> resolveViaJioSaavn(videoId, title, artist, proxyUrl)));
        }

        long deadlineNs = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        for (int i = 0; i < tasks.size(); i++) {
            long remMs = Math.max(200L, TimeUnit.NANOSECONDS.toMillis(deadlineNs - System.nanoTime()));
            try {
                Future<ResolvedStream> done = ecs.poll(remMs, TimeUnit.MILLISECONDS);
                if (done == null) break;
                ResolvedStream candidate = done.get();
                if (candidate != null) {
                    cancelFutures(tasks);
                    return candidate;
                }
            } catch (Exception ignored) {
                // Keep waiting for sibling task
            }
        }
        cancelFutures(tasks);

        // Emergency Piped fallback
        ResolvedStream piped = resolveViaPiped(videoId, maxKbps, proxyUrl);
        if (piped != null) return piped;

        throw new IOException("All mobile stream sources failed for " + videoId);
    }

    private static void cancelFutures(List<Future<ResolvedStream>> tasks) {
        for (Future<ResolvedStream> f : tasks) {
            f.cancel(true);
        }
    }

    private ResolvedStream resolveViaInnerTube(String videoId, int maxKbps, String proxyUrl, String skipSource)
            throws IOException {
        int start = preferredClientIdx.get() % INNERTUBE_CLIENTS.length;
        List<ClientSpec> ordered = new ArrayList<>(INNERTUBE_CLIENTS.length);
        for (int i = 0; i < INNERTUBE_CLIENTS.length; i++) {
            ClientSpec spec = INNERTUBE_CLIENTS[(start + i) % INNERTUBE_CLIENTS.length];
            if (!spec.name.equals(skipSource)) {
                ordered.add(spec);
            }
        }
        if (ordered.isEmpty()) {
            ordered.addAll(Arrays.asList(INNERTUBE_CLIENTS));
        }

        CompletionService<ResolvedStream> ecs = new ExecutorCompletionService<>(resolverPool);
        List<Future<ResolvedStream>> futures = new ArrayList<>(ordered.size());
        for (int i = 0; i < ordered.size(); i++) {
            final int clientIdx = (start + i) % INNERTUBE_CLIENTS.length;
            final ClientSpec client = ordered.get(i);
            futures.add(ecs.submit(() -> {
                ResolvedStream res = fetchInnerTubeClient(videoId, client, maxKbps, proxyUrl);
                if (res != null) {
                    preferredClientIdx.set(clientIdx);
                }
                return res;
            }));
        }

        IOException lastErr = null;
        for (int i = 0; i < futures.size(); i++) {
            try {
                Future<ResolvedStream> done = ecs.take();
                ResolvedStream winner = done.get();
                if (winner != null) {
                    cancelFutures(futures);
                    return winner;
                }
            } catch (Exception e) {
                lastErr = new IOException(e.getMessage(), e);
            }
        }
        cancelFutures(futures);
        throw lastErr != null ? lastErr : new IOException("InnerTube clients failed");
    }

    private ResolvedStream fetchInnerTubeClient(String videoId, ClientSpec client, int maxKbps, String proxyUrl)
            throws IOException {
        String body = "{\"videoId\":" + JSONObject.quote(videoId) + ",\"context\":{\"client\":" + client.clientJson + "}}";
        HttpURLConnection conn = (HttpURLConnection)
                new URL("https://www.youtube.com/youtubei/v1/player?prettyPrint=false").openConnection();
        conn.setRequestMethod("POST");
        conn.setDoOutput(true);
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(7000);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("User-Agent", client.userAgent);
        try (OutputStream out = conn.getOutputStream()) {
            out.write(body.getBytes(StandardCharsets.UTF_8));
        }

        int code = conn.getResponseCode();
        if (code < 200 || code >= 300) {
            throw new IOException("InnerTube HTTP " + code + " (" + client.name + ")");
        }
        String jsonText = readStreamText(conn.getInputStream());
        conn.disconnect();

        JSONObject root;
        try {
            root = new JSONObject(jsonText);
        } catch (JSONException e) {
            throw new IOException("Invalid InnerTube JSON", e);
        }
        JSONObject playability = root.optJSONObject("playabilityStatus");
        String status = playability != null ? playability.optString("status", "") : "";
        if (!"OK".equalsIgnoreCase(status)) {
            throw new IOException("InnerTube status " + status + " (" + client.name + ")");
        }

        JSONObject streamingData = root.optJSONObject("streamingData");
        if (streamingData == null) throw new IOException("Missing streamingData");
        JSONArray formats = streamingData.optJSONArray("adaptiveFormats");
        if (formats == null || formats.length() == 0) {
            throw new IOException("No adaptiveFormats");
        }

        Double lufs = extractLufs(root);
        JSONObject picked = pickBestAudioFormat(formats, maxKbps);
        if (picked == null) throw new IOException("No direct audio format (" + client.name + ")");

        String streamUrl = picked.optString("url", "");
        if (streamUrl.isEmpty() || !probeRange(streamUrl, client.userAgent)) {
            throw new IOException("Range probe failed (" + client.name + ")");
        }
        String rawMime = picked.optString("mimeType", "audio/mp4");
        String cleanMime = rawMime.split(";")[0].trim();
        if (cleanMime.isEmpty()) cleanMime = "audio/mp4";

        return new ResolvedStream(
                proxyUrl,
                streamUrl,
                cleanMime,
                lufs,
                client.userAgent,
                client.name,
                computeTtlMs(streamUrl));
    }

    private static Double extractLufs(JSONObject root) {
        JSONObject playerConfig = root.optJSONObject("playerConfig");
        if (playerConfig == null) return null;
        JSONObject audioConfig = playerConfig.optJSONObject("audioConfig");
        if (audioConfig == null) return null;
        if (audioConfig.has("trackAbsoluteLoudnessLkfs")) {
            double abs = audioConfig.optDouble("trackAbsoluteLoudnessLkfs", Double.NaN);
            if (!Double.isNaN(abs) && !Double.isInfinite(abs)) return abs;
        }
        if (audioConfig.has("loudnessDb")) {
            double db = audioConfig.optDouble("loudnessDb", Double.NaN);
            if (!Double.isNaN(db) && !Double.isInfinite(db)) return db - 14.0;
        }
        return null;
    }

    private static JSONObject pickBestAudioFormat(JSONArray formats, int maxKbps) {
        JSONObject bestMp4WithinCap = null;
        int bestMp4WithinRate = -1;
        JSONObject lowestMp4 = null;
        int lowestMp4Rate = Integer.MAX_VALUE;

        JSONObject bestAnyWithinCap = null;
        int bestAnyWithinRate = -1;
        JSONObject lowestAny = null;
        int lowestAnyRate = Integer.MAX_VALUE;

        int capBps = maxKbps > 0 ? maxKbps * 1000 : Integer.MAX_VALUE;

        for (int i = 0; i < formats.length(); i++) {
            JSONObject fmt = formats.optJSONObject(i);
            if (fmt == null) continue;
            String url = fmt.optString("url", "");
            String mime = fmt.optString("mimeType", "").toLowerCase(Locale.US);
            if (!url.startsWith("https://") || !mime.startsWith("audio/")) continue;

            // Skip DRC / non-original audio tracks when bitrate ties exist
            if (fmt.optBoolean("isDrc", false)) continue;
            int bitrate = fmt.optInt("bitrate", fmt.optInt("averageBitrate", 0));
            boolean isMp4 = mime.contains("audio/mp4");

            if (isMp4) {
                if (bitrate <= capBps && bitrate > bestMp4WithinRate) {
                    bestMp4WithinRate = bitrate;
                    bestMp4WithinCap = fmt;
                }
                if (bitrate > 0 && bitrate < lowestMp4Rate) {
                    lowestMp4Rate = bitrate;
                    lowestMp4 = fmt;
                }
            }
            if (bitrate <= capBps && bitrate > bestAnyWithinRate) {
                bestAnyWithinRate = bitrate;
                bestAnyWithinCap = fmt;
            }
            if (bitrate > 0 && bitrate < lowestAnyRate) {
                lowestAnyRate = bitrate;
                lowestAny = fmt;
            }
        }

        if (bestMp4WithinCap != null) return bestMp4WithinCap;
        if (lowestMp4 != null) return lowestMp4;
        if (bestAnyWithinCap != null) return bestAnyWithinCap;
        return lowestAny;
    }

    private ResolvedStream resolveViaJioSaavn(String videoId, String reqTitle, String reqArtist, String proxyUrl)
            throws IOException {
        String title = reqTitle != null ? stripTags(reqTitle) : "";
        String author = reqArtist != null ? reqArtist.replaceAll("(?i)\\s*-\\s*Topic$", "").trim() : "";

        if (title.isEmpty()) {
            try {
                String oembedUrl = "https://www.youtube.com/oembed?url="
                        + urlEncode("https://www.youtube.com/watch?v=" + videoId) + "&format=json";
                String metaText = httpGetText(oembedUrl, DESKTOP_UA, 3000);
                JSONObject meta = new JSONObject(metaText);
                title = stripTags(meta.optString("title", ""));
                author = meta.optString("author_name", "").replaceAll("(?i)\\s*-\\s*Topic$", "").trim();
            } catch (Exception ignored) {
                // Continue; query check below handles empty title
            }
        }

        String q = (title + " " + author).trim();
        if (q.isEmpty()) throw new IOException("Empty query for JioSaavn fallback");

        String searchUrl = "https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=5&q="
                + urlEncode(q);
        String jsonText = httpGetText(searchUrl, DESKTOP_UA, 4000);
        JSONObject data;
        try {
            data = new JSONObject(jsonText);
        } catch (JSONException e) {
            throw new IOException("Invalid JioSaavn JSON", e);
        }
        JSONArray results = data.optJSONArray("results");
        if (results == null) throw new IOException("No JioSaavn results");

        for (int i = 0; i < results.length(); i++) {
            JSONObject item = results.optJSONObject(i);
            if (item == null) continue;
            String candTitle = decodeEntities(item.optString("title", item.optString("song", "")));
            JSONObject moreInfo = item.optJSONObject("more_info");
            String candArtist = extractJioArtist(item, moreInfo);
            if (!isMatchingTrack(title, author, candTitle, candArtist)) {
                continue;
            }
            if (moreInfo == null) continue;
            String enc = moreInfo.optString("encrypted_media_url", "");
            if (enc.length() <= 10) continue;
            String decrypted = decryptJioSaavnUrl(enc);
            if (decrypted.startsWith("https://") && probeRange(decrypted, DESKTOP_UA)) {
                return new ResolvedStream(
                        proxyUrl,
                        decrypted,
                        "audio/mp4",
                        null,
                        DESKTOP_UA,
                        "jiosaavn",
                        System.currentTimeMillis() + MAX_CACHE_TTL_MS);
            }
        }
        throw new IOException("No matching JioSaavn stream");
    }

    private static String extractJioArtist(JSONObject item, JSONObject moreInfo) {
        if (moreInfo != null) {
            JSONObject artistMap = moreInfo.optJSONObject("artistMap");
            if (artistMap != null) {
                JSONArray primary = artistMap.optJSONArray("primary_artists");
                if (primary != null && primary.length() > 0) {
                    JSONObject first = primary.optJSONObject(0);
                    if (first != null && !first.optString("name", "").isEmpty()) {
                        return first.optString("name", "").trim();
                    }
                }
            }
        }
        String fallback = item.optString("primary_artists", item.optString("singers", ""));
        return fallback.trim();
    }

    private static String decryptJioSaavnUrl(String encryptedBase64) throws IOException {
        try {
            byte[] cipherBytes = Base64.decode(encryptedBase64, Base64.DEFAULT);
            Cipher cipher = Cipher.getInstance("DES/ECB/NoPadding");
            SecretKeySpec keySpec = new SecretKeySpec(JIOSAAVN_DES_KEY.getBytes(StandardCharsets.UTF_8), "DES");
            cipher.init(Cipher.DECRYPT_MODE, keySpec);
            byte[] plain = cipher.doFinal(cipherBytes);
            int len = plain.length;
            while (len > 0 && (plain[len - 1] & 0xFF) < 16) {
                len--;
            }
            String decoded = new String(plain, 0, len, StandardCharsets.UTF_8).trim();
            return decoded.replace("_96.mp4", "_320.mp4").replace("http://", "https://");
        } catch (Exception e) {
            throw new IOException("DES decrypt failed", e);
        }
    }

    private ResolvedStream resolveViaPiped(String videoId, int maxKbps, String proxyUrl) {
        for (String host : PIPED_INSTANCES) {
            try {
                String jsonText = httpGetText(host + "/streams/" + urlEncode(videoId), DESKTOP_UA, 5000);
                JSONObject data = new JSONObject(jsonText);
                JSONArray streams = data.optJSONArray("audioStreams");
                if (streams == null || streams.length() == 0) continue;

                JSONObject bestMp4 = null;
                int bestMp4Rate = -1;
                JSONObject bestAny = null;
                int bestAnyRate = -1;
                int capBps = maxKbps > 0 ? maxKbps * 1000 : Integer.MAX_VALUE;

                for (int i = 0; i < streams.length(); i++) {
                    JSONObject s = streams.optJSONObject(i);
                    if (s == null) continue;
                    String u = s.optString("url", "");
                    String mime = s.optString("mimeType", "").toLowerCase(Locale.US);
                    if (!u.startsWith("https://")) continue;
                    int bitrate = s.optInt("bitrate", 0);
                    if (mime.contains("audio/mp4") && bitrate <= capBps && bitrate > bestMp4Rate) {
                        bestMp4Rate = bitrate;
                        bestMp4 = s;
                    }
                    if (bitrate <= capBps && bitrate > bestAnyRate) {
                        bestAnyRate = bitrate;
                        bestAny = s;
                    }
                }
                JSONObject picked = bestMp4 != null ? bestMp4 : bestAny;
                if (picked == null) continue;
                String pickedUrl = picked.getString("url");
                if (!probeRange(pickedUrl, DESKTOP_UA)) continue;
                String rawMime = picked.optString("mimeType", "audio/mp4");
                String cleanMime = rawMime.split(";")[0].trim();
                if (cleanMime.isEmpty()) cleanMime = "audio/mp4";
                return new ResolvedStream(
                        proxyUrl,
                        pickedUrl,
                        cleanMime,
                        null,
                        DESKTOP_UA,
                        "piped",
                        computeTtlMs(pickedUrl));
            } catch (Exception ignored) {
                // Try next Piped mirror
            }
        }
        return null;
    }

    private static boolean probeRange(String targetUrl, String userAgent) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(targetUrl).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(3500);
            conn.setReadTimeout(3500);
            conn.setRequestProperty("User-Agent", userAgent);
            conn.setRequestProperty("Range", "bytes=0-1023");
            int code = conn.getResponseCode();
            return code == 200 || code == 206;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void acceptLoop() {
        while (serverSocket != null && !serverSocket.isClosed()) {
            try {
                Socket client = serverSocket.accept();
                proxyPool.execute(() -> handleClient(client));
            } catch (IOException ignored) {
                if (serverSocket == null || serverSocket.isClosed()) break;
            }
        }
    }

    private void handleClient(Socket socket) {
        try (Socket s = socket) {
            s.setSoTimeout(20000);
            BufferedInputStream in = new BufferedInputStream(s.getInputStream());
            OutputStream out = s.getOutputStream();

            String requestLine = readHttpLine(in);
            if (requestLine == null || requestLine.isEmpty()) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            String method = parts[0].toUpperCase(Locale.US);
            String target = parts[1];

            Map<String, String> headers = new HashMap<>();
            String headerLine;
            while ((headerLine = readHttpLine(in)) != null && !headerLine.isEmpty()) {
                int idx = headerLine.indexOf(':');
                if (idx > 0) {
                    headers.put(
                            headerLine.substring(0, idx).trim().toLowerCase(Locale.US),
                            headerLine.substring(idx + 1).trim());
                }
            }

            if ("OPTIONS".equals(method)) {
                writeCorsHeaders(out, 204, "No Content", null, -1, null, false);
                return;
            }

            String path = target;
            String query = "";
            int qIdx = target.indexOf('?');
            if (qIdx >= 0) {
                path = target.substring(0, qIdx);
                query = target.substring(qIdx + 1);
            }
            if (!"/stream".equals(path)) {
                writeSimpleResponse(out, 404, "Not Found", "text/plain", "Not found");
                return;
            }

            Map<String, String> params = parseQuery(query);
            String videoId = params.get("id");
            if (videoId == null || videoId.isEmpty()) {
                writeSimpleResponse(out, 400, "Bad Request", "text/plain", "Missing id");
                return;
            }

            String quality = params.get("quality");
            String title = params.get("title");
            String artist = params.get("artist");
            boolean forceRotate = "1".equals(params.get("rotate"));

            ResolvedStream entry;
            try {
                entry = resolve(videoId, forceRotate, quality, title, artist);
            } catch (Exception e) {
                writeSimpleResponse(out, 502, "Bad Gateway", "text/plain", "Stream unavailable");
                return;
            }

            if ("1".equals(params.get("meta"))) {
                String json = entry.lufs != null ? "{\"lufs\":" + entry.lufs + "}" : "{\"lufs\":null}";
                writeSimpleResponse(out, 200, "OK", "application/json", json);
                return;
            }

            String rangeHeader = headers.get("range");
            forwardStream(out, method, entry, rangeHeader, videoId, quality, title, artist);
        } catch (IOException ignored) {
            // Normal client disconnect during seek/skip
        }
    }

    private void forwardStream(
            OutputStream out,
            String method,
            ResolvedStream entry,
            String rangeHeader,
            String videoId,
            String quality,
            String title,
            String artist) throws IOException {
        ResolvedStream active = entry;
        HttpURLConnection conn = null;
        try {
            conn = openUpstream(active, method, rangeHeader);
            int code = conn.getResponseCode();
            if (code == 403 || code == 410 || code >= 500) {
                conn.disconnect();
                active = resolve(videoId, true, quality, title, artist);
                conn = openUpstream(active, method, rangeHeader);
                code = conn.getResponseCode();
            }

            if (code < 200 || code >= 400) {
                writeSimpleResponse(out, 502, "Bad Gateway", "text/plain", "Upstream HTTP " + code);
                return;
            }

            String statusText = code == 206 ? "Partial Content" : "OK";
            String ct = conn.getContentType();
            String mime = (ct != null && !ct.isEmpty()) ? ct.split(";")[0].trim() : active.mimeType;
            long contentLength = conn.getContentLengthLong();
            String contentRange = conn.getHeaderField("Content-Range");

            writeCorsHeaders(out, code, statusText, mime, contentLength, contentRange, true);
            if ("HEAD".equals(method)) return;

            try (InputStream upstreamIn = conn.getInputStream()) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = upstreamIn.read(buf)) != -1) {
                    out.write(buf, 0, n);
                }
                out.flush();
            }
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static HttpURLConnection openUpstream(ResolvedStream entry, String method, String rangeHeader)
            throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(entry.upstreamUrl).openConnection();
        conn.setRequestMethod("HEAD".equals(method) ? "HEAD" : "GET");
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(10000);
        conn.setReadTimeout(25000);
        conn.setRequestProperty("User-Agent", entry.userAgent);
        if (rangeHeader != null && !rangeHeader.isEmpty()) {
            conn.setRequestProperty("Range", rangeHeader);
        }
        return conn;
    }

    private static void writeCorsHeaders(
            OutputStream out,
            int statusCode,
            String statusText,
            String contentType,
            long contentLength,
            String contentRange,
            boolean includeAcceptRanges) throws IOException {
        StringBuilder sb = new StringBuilder();
        sb.append("HTTP/1.1 ").append(statusCode).append(' ').append(statusText).append("\r\n");
        sb.append("Access-Control-Allow-Origin: *\r\n");
        sb.append("Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n");
        sb.append("Access-Control-Allow-Headers: Range, Content-Type\r\n");
        sb.append("Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges\r\n");
        sb.append("Cache-Control: no-store\r\n");
        sb.append("Connection: close\r\n");
        if (includeAcceptRanges) {
            sb.append("Accept-Ranges: bytes\r\n");
        }
        if (contentType != null && !contentType.isEmpty()) {
            sb.append("Content-Type: ").append(contentType).append("\r\n");
        }
        if (contentLength >= 0) {
            sb.append("Content-Length: ").append(contentLength).append("\r\n");
        }
        if (contentRange != null && !contentRange.isEmpty()) {
            sb.append("Content-Range: ").append(contentRange).append("\r\n");
        }
        sb.append("\r\n");
        out.write(sb.toString().getBytes(StandardCharsets.US_ASCII));
        out.flush();
    }

    private static void writeSimpleResponse(
            OutputStream out, int code, String statusText, String contentType, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        writeCorsHeaders(out, code, statusText, contentType, bytes.length, null, false);
        out.write(bytes);
        out.flush();
    }

    private static String readHttpLine(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int b;
        while ((b = in.read()) != -1) {
            if (b == '\n') break;
            if (b != '\r') buf.write(b);
            if (buf.size() > 8192) break;
        }
        if (b == -1 && buf.size() == 0) return null;
        return buf.toString("ISO-8859-1");
    }

    private static Map<String, String> parseQuery(String query) {
        Map<String, String> map = new HashMap<>();
        if (query == null || query.isEmpty()) return map;
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0) {
                String k = urlDecode(pair.substring(0, eq));
                String v = urlDecode(pair.substring(eq + 1));
                map.put(k, v);
            }
        }
        return map;
    }

    private static String httpGetText(String targetUrl, String userAgent, int timeoutMs) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(targetUrl).openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(timeoutMs);
        conn.setReadTimeout(timeoutMs);
        conn.setRequestProperty("User-Agent", userAgent);
        try {
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) throw new IOException("HTTP " + code);
            return readStreamText(conn.getInputStream());
        } finally {
            conn.disconnect();
        }
    }

    private static String readStreamText(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) {
            out.write(buf, 0, n);
        }
        return out.toString("UTF-8");
    }

    private static int qualityToMaxKbps(String quality) {
        if ("low".equals(quality)) return 64;
        if ("medium".equals(quality)) return 160;
        return 0;
    }

    private static long computeTtlMs(String url) {
        long now = System.currentTimeMillis();
        Matcher m = EXPIRE_PARAM.matcher(url);
        if (m.find()) {
            try {
                long expireMs = Long.parseLong(m.group(1)) * 1000L;
                long ttl = expireMs - now - MIN_CACHE_TTL_MS;
                if (ttl > MIN_CACHE_TTL_MS) return Math.min(ttl, MAX_CACHE_TTL_MS);
            } catch (NumberFormatException ignored) {
                // Fall back to default TTL
            }
        }
        return MAX_CACHE_TTL_MS;
    }

    private static String stripTags(String s) {
        return s.replaceAll("(?i)\\(Official.*?\\)|\\[Official.*?\\]", "").trim();
    }

    private static String decodeEntities(String s) {
        return s.replace("&quot;", "\"").replace("&#039;", "'").replace("&amp;", "&").trim();
    }

    private static String cleanMatchText(String s) {
        if (s == null) return "";
        return s.toLowerCase(Locale.US)
                .replaceAll("\\([^)]*\\)|\\[[^\\]]*\\]", "")
                .replaceAll("[^a-z0-9]", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }

    private static boolean isMatchingTrack(String reqTitle, String reqArtist, String candTitle, String candArtist) {
        String rt = cleanMatchText(reqTitle);
        String ct = cleanMatchText(candTitle);
        if (rt.isEmpty() || ct.isEmpty()) return false;

        boolean titleMatch = rt.equals(ct) || rt.contains(ct) || ct.contains(rt);
        List<String> rWords = longWords(rt);
        Set<String> cWords = new HashSet<>(longWords(ct));
        int overlap = 0;
        for (String w : rWords) {
            if (cWords.contains(w)) overlap++;
        }
        double ratio = rWords.isEmpty() ? 0.0 : ((double) overlap / (double) rWords.size());
        boolean isTitleMatch = titleMatch || ratio >= 0.6;

        String ra = cleanMatchText(reqArtist);
        String ca = cleanMatchText(candArtist);
        boolean isArtistMatch = true;
        if (!ra.isEmpty() && !ca.isEmpty()) {
            List<String> raWords = longWords(ra);
            Set<String> caWords = new HashSet<>(longWords(ca));
            int aMatches = 0;
            for (String w : raWords) {
                if (caWords.contains(w)) aMatches++;
            }
            isArtistMatch = raWords.isEmpty() || aMatches > 0 || ra.contains(ca) || ca.contains(ra);
        }
        return isTitleMatch && isArtistMatch;
    }

    private static List<String> longWords(String normalized) {
        List<String> out = new ArrayList<>();
        if (normalized.isEmpty()) return out;
        for (String w : normalized.split(" ")) {
            if (w.length() > 2) out.add(w);
        }
        return out;
    }

    private static String urlEncode(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8");
        } catch (Exception e) {
            return value;
        }
    }

    private static String urlDecode(String value) {
        try {
            return URLDecoder.decode(value, "UTF-8");
        } catch (Exception e) {
            return value;
        }
    }
}

