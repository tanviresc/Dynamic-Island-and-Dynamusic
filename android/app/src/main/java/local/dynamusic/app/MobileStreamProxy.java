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
    private static final long INITIAL_SLICE_BYTES = 524_288L;
    private static final long GOOGLEVIDEO_SLICE_BYTES = 1_572_864L;
    private static final long CLIENT_COOLDOWN_MS = 90_000L;
    private static final long MIRROR_COOLDOWN_MS = 60_000L;
    private static final long VISITOR_TTL_MS = 30L * 60L * 1000L;
    private static final Pattern EXPIRE_PARAM = Pattern.compile("[?&]expire=(\\d+)");
    private static final Pattern CLEN_PARAM = Pattern.compile("[?&]clen=(\\d+)");
    private static final Pattern VIDEO_ID_PATTERN = Pattern.compile("^[A-Za-z0-9_-]{11}$");

    private static String deviceCountry() {
        String c = Locale.getDefault().getCountry();
        if (c != null && c.length() == 2 && c.matches("[A-Za-z]{2}")) {
            return c.toUpperCase(Locale.US);
        }
        return "US";
    }

    private static ClientSpec[] buildInnerTubeClients() {
        String gl = deviceCountry();
        return new ClientSpec[] {
            new ClientSpec(
                    "ANDROID_VR",
                    "28",
                    "1.65.10",
                    "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
                    "{\"clientName\":\"ANDROID_VR\",\"clientVersion\":\"1.65.10\",\"deviceMake\":\"Oculus\",\"deviceModel\":\"Quest 3\",\"osName\":\"Android\",\"osVersion\":\"12L\",\"androidSdkVersion\":32,\"hl\":\"en\",\"gl\":\"" + gl + "\"}",
                    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false"),
            new ClientSpec(
                    "ANDROID_VR_LEGACY",
                    "28",
                    "1.60.19",
                    "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
                    "{\"clientName\":\"ANDROID_VR\",\"clientVersion\":\"1.60.19\",\"deviceMake\":\"Oculus\",\"deviceModel\":\"Quest 3\",\"osName\":\"Android\",\"osVersion\":\"12L\",\"androidSdkVersion\":32,\"hl\":\"en\",\"gl\":\"" + gl + "\"}",
                    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false"),
            new ClientSpec(
                    "VISIONOS",
                    "101",
                    "1.02",
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
                    "{\"clientName\":\"VISIONOS\",\"clientVersion\":\"1.02\",\"deviceMake\":\"Apple\",\"deviceModel\":\"RealityDevice17,1\",\"osName\":\"visionOS\",\"osVersion\":\"26.5.23O471\",\"hl\":\"en\",\"gl\":\"" + gl + "\"}",
                    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false"),
            new ClientSpec(
                    "IOS",
                    "5",
                    "20.10.4",
                    "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)",
                    "{\"clientName\":\"IOS\",\"clientVersion\":\"20.10.4\",\"deviceMake\":\"Apple\",\"deviceModel\":\"iPhone16,2\",\"osName\":\"iPhone\",\"osVersion\":\"18.3.2.22D82\",\"hl\":\"en\",\"gl\":\"" + gl + "\"}",
                    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false"),
            new ClientSpec(
                    "ANDROID_MUSIC",
                    "21",
                    "5.34.51",
                    "com.google.android.apps.youtube.music/5.34.51 (Linux; U; Android 14) gzip",
                    "{\"clientName\":\"ANDROID_MUSIC\",\"clientVersion\":\"5.34.51\",\"androidSdkVersion\":34,\"hl\":\"en\",\"gl\":\"" + gl + "\"}",
                    "https://music.youtube.com/youtubei/v1/player?prettyPrint=false"),
            new ClientSpec(
                    "ANDROID",
                    "3",
                    "20.10.38",
                    "com.google.android.youtube/20.10.38 (Linux; U; Android 15) gzip",
                    "{\"clientName\":\"ANDROID\",\"clientVersion\":\"20.10.38\",\"androidSdkVersion\":35,\"hl\":\"en\",\"gl\":\"" + gl + "\"}",
                    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
        };
    }

    private static final String[] PIPED_INSTANCES = new String[] {
        "https://api.piped.private.coffee",
        "https://pipedapi.adminforge.de",
        "https://pipedapi.kavin.rocks"
    };

    private static final String[] INVIDIOUS_INSTANCES = new String[] {
        "https://inv.nadeko.net",
        "https://invidious.nerdvpn.de",
        "https://yewtu.be"
    };

    static final class ResolvedStream {
        final String proxyUrl;
        final String upstreamUrl;
        final String mimeType;
        final Double lufs;
        final String userAgent;
        final String source;
        final long contentLength;
        final long expiresAtMs;

        ResolvedStream(
                String proxyUrl,
                String upstreamUrl,
                String mimeType,
                Double lufs,
                String userAgent,
                String source,
                long contentLength,
                long expiresAtMs) {
            this.proxyUrl = proxyUrl;
            this.upstreamUrl = upstreamUrl;
            this.mimeType = mimeType;
            this.lufs = lufs;
            this.userAgent = userAgent;
            this.source = source;
            this.contentLength = contentLength;
            this.expiresAtMs = expiresAtMs;
        }
    }

    private static final class ClientSpec {
        final String name;
        final String clientId;
        final String clientVersion;
        final String userAgent;
        final String clientJson;
        final String endpointUrl;

        ClientSpec(
                String name,
                String clientId,
                String clientVersion,
                String userAgent,
                String clientJson,
                String endpointUrl) {
            this.name = name;
            this.clientId = clientId;
            this.clientVersion = clientVersion;
            this.userAgent = userAgent;
            this.clientJson = clientJson;
            this.endpointUrl = endpointUrl;
        }
    }

    private static final int LOCK_STRIPES = 64;
    private static final MobileStreamProxy SHARED = new MobileStreamProxy();

    static MobileStreamProxy getShared() {
        return SHARED;
    }

    private final ConcurrentHashMap<String, ResolvedStream> cache = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Long> clientCooldownUntil = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Long> mirrorCooldownUntil = new ConcurrentHashMap<>();
    private final ExecutorService proxyPool = Executors.newCachedThreadPool();
    // Separate orchestrator, resolver, and streaming pools so active audio reads never block stream API resolution
    private final ExecutorService orchestratorPool = Executors.newCachedThreadPool();
    private final ExecutorService resolverPool = Executors.newCachedThreadPool();
    private final ExecutorService streamPool = Executors.newCachedThreadPool();
    private final AtomicInteger preferredClientIdx = new AtomicInteger(0);
    private final Object[] resolveLocks = new Object[LOCK_STRIPES];
    private final Object visitorLock = new Object();
    private volatile String cachedVisitorData = "";
    private volatile long visitorDataExpiresAt = 0L;

    {
        for (int i = 0; i < LOCK_STRIPES; i++) {
            resolveLocks[i] = new Object();
        }
    }

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

        Object lock = resolveLocks[(key.hashCode() & 0x7fffffff) % LOCK_STRIPES];
        synchronized (lock) {
            previous = cache.get(key);
            if (!forceRotate && previous != null && System.currentTimeMillis() < previous.expiresAtMs) {
                return previous;
            }

            String skipSource = null;
            if (forceRotate) {
                cache.remove(key);
                if (previous != null) {
                    skipSource = previous.source;
                }
                preferredClientIdx.updateAndGet((i) -> (i + 1) % buildInnerTubeClients().length);
            }

            String proxyUrl = buildProxyUrl(boundPort, videoId, normQuality, title, artist);
            ResolvedStream fresh = resolveUpstream(videoId, normQuality, title, artist, proxyUrl, skipSource);
            cache.put(key, fresh);
            return fresh;
        }
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

    private void noteClientFailure(String source) {
        if (source == null || source.isEmpty()) return;
        clientCooldownUntil.put(source, System.currentTimeMillis() + CLIENT_COOLDOWN_MS);
    }

    private void noteClientSuccess(String source) {
        if (source == null || source.isEmpty()) return;
        clientCooldownUntil.remove(source);
        ClientSpec[] clients = buildInnerTubeClients();
        for (int i = 0; i < clients.length; i++) {
            if (source.equals(clients[i].name)) {
                preferredClientIdx.set(i);
                break;
            }
        }
    }

    private String getVisitorData() {
        long now = System.currentTimeMillis();
        if (!cachedVisitorData.isEmpty() && now < visitorDataExpiresAt) {
            return cachedVisitorData;
        }
        synchronized (visitorLock) {
            now = System.currentTimeMillis();
            if (!cachedVisitorData.isEmpty() && now < visitorDataExpiresAt) {
                return cachedVisitorData;
            }
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL("https://www.youtube.com/youtubei/v1/visitor_id?prettyPrint=false")
                        .openConnection();
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                conn.setConnectTimeout(2000);
                conn.setReadTimeout(2000);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("User-Agent", DESKTOP_UA);
                String body = "{\"context\":{\"client\":{\"clientName\":\"WEB\",\"clientVersion\":\"2.20250115.01.00\"}}}";
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.getBytes(StandardCharsets.UTF_8));
                }
                if (conn.getResponseCode() >= 200 && conn.getResponseCode() < 300) {
                    JSONObject obj = new JSONObject(readStreamText(conn.getInputStream()));
                    String vd = "";
                    JSONObject rc = obj.optJSONObject("responseContext");
                    if (rc != null) vd = rc.optString("visitorData", "");
                    if (!vd.isEmpty()) {
                        cachedVisitorData = vd;
                        visitorDataExpiresAt = System.currentTimeMillis() + VISITOR_TTL_MS;
                    }
                }
            } catch (Exception ignored) {
                // Keep empty or stale visitorData; InnerTube still works for most clients
            } finally {
                if (conn != null) conn.disconnect();
            }
            return cachedVisitorData;
        }
    }

    private ResolvedStream resolveUpstream(
            String videoId,
            String quality,
            String title,
            String artist,
            String proxyUrl,
            String skipSource) throws IOException {
        int maxKbps = qualityToMaxKbps(quality);

        // 1. Primary fast path: InnerTube (direct device-IP GoogleVideo URLs with 5.5s race cap)
        try {
            ResolvedStream yt = resolveViaInnerTube(videoId, maxKbps, proxyUrl, skipSource);
            if (yt != null) return yt;
        } catch (Exception ignored) {
            // Fall through to parallel third-party fallbacks
        }

        // 2. Parallel Piped + Invidious mirrors + JioSaavn fallback
        List<Future<ResolvedStream>> mirrorTasks = new ArrayList<>(3);
        CompletionService<ResolvedStream> mirrorEcs = new ExecutorCompletionService<>(orchestratorPool);
        mirrorTasks.add(mirrorEcs.submit(() -> resolveViaPiped(videoId, maxKbps, proxyUrl)));
        mirrorTasks.add(mirrorEcs.submit(() -> resolveViaInvidious(videoId, maxKbps, proxyUrl)));
        if (!"jiosaavn".equals(skipSource) && title != null && !title.trim().isEmpty()) {
            mirrorTasks.add(mirrorEcs.submit(() -> resolveViaJioSaavn(videoId, title, artist, proxyUrl)));
        }
        long mirrorDeadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(4500);
        for (int i = 0; i < mirrorTasks.size(); i++) {
            long remMs = TimeUnit.NANOSECONDS.toMillis(mirrorDeadline - System.nanoTime());
            if (remMs <= 0) break;
            try {
                Future<ResolvedStream> done = mirrorEcs.poll(remMs, TimeUnit.MILLISECONDS);
                if (done == null) break;
                ResolvedStream candidate = done.get();
                if (candidate != null) {
                    cancelFutures(mirrorTasks);
                    return candidate;
                }
            } catch (Exception ignored) {
                // Keep waiting for sibling fallback
            }
        }
        cancelFutures(mirrorTasks);

        // 3. Last-resort alternate track match on YouTube Music if videoId itself is unavailable/region-locked
        if (title != null && !title.trim().isEmpty()) {
            try {
                String altId = searchAlternateYtmVideoId(title, artist, videoId);
                if (altId != null) {
                    return resolveViaInnerTube(altId, maxKbps, proxyUrl, skipSource);
                }
            } catch (Exception ignored) {
                // Fall through to failure
            }
        }

        throw new IOException("All mobile stream sources failed for " + videoId);
    }

    private static void cancelFutures(List<Future<ResolvedStream>> tasks) {
        for (Future<ResolvedStream> f : tasks) {
            f.cancel(true);
        }
    }

    private ResolvedStream resolveViaInnerTube(String videoId, int maxKbps, String proxyUrl, String skipSource)
            throws IOException {
        ClientSpec[] clients = buildInnerTubeClients();
        int start = ((preferredClientIdx.get() % clients.length) + clients.length) % clients.length;
        long now = System.currentTimeMillis();
        List<ClientSpec> healthy = new ArrayList<>(clients.length);
        List<ClientSpec> cooled = new ArrayList<>(clients.length);
        for (int i = 0; i < clients.length; i++) {
            ClientSpec spec = clients[(start + i) % clients.length];
            if (spec.name.equals(skipSource)) continue;
            long until = clientCooldownUntil.getOrDefault(spec.name, 0L);
            if (until <= now) healthy.add(spec);
            else cooled.add(spec);
        }
        List<ClientSpec> ordered = healthy.isEmpty() ? (cooled.isEmpty() ? Arrays.asList(clients) : cooled) : healthy;

        // Warm visitorData once if empty, bounded cleanly at 2s
        String visitorData = cachedVisitorData;
        if (visitorData.isEmpty() && now >= visitorDataExpiresAt) {
            visitorData = getVisitorData();
        }
        final String vd = visitorData;

        CompletionService<ResolvedStream> ecs = new ExecutorCompletionService<>(resolverPool);
        List<Future<ResolvedStream>> futures = new ArrayList<>(ordered.size());
        for (int i = 0; i < ordered.size(); i++) {
            final ClientSpec client = ordered.get(i);
            futures.add(ecs.submit(() -> fetchInnerTubeClient(videoId, client, maxKbps, proxyUrl, vd)));
        }

        IOException lastErr = null;
        long deadlineNs = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(5500);
        for (int i = 0; i < futures.size(); i++) {
            long remMs = TimeUnit.NANOSECONDS.toMillis(deadlineNs - System.nanoTime());
            if (remMs <= 0) break;
            try {
                Future<ResolvedStream> done = ecs.poll(remMs, TimeUnit.MILLISECONDS);
                if (done == null) break;
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

    private ResolvedStream fetchInnerTubeClient(
            String videoId,
            ClientSpec client,
            int maxKbps,
            String proxyUrl,
            String visitorData) throws IOException {
        StringBuilder bodySb = new StringBuilder();
        bodySb.append("{\"videoId\":").append(JSONObject.quote(videoId));
        bodySb.append(",\"contentCheckOk\":true,\"racyCheckOk\":true");
        bodySb.append(",\"context\":{\"client\":").append(client.clientJson).append("}}");
        String body = bodySb.toString();

        HttpURLConnection conn = (HttpURLConnection) new URL(client.endpointUrl).openConnection();
        String jsonText;
        try {
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(3500);
            conn.setReadTimeout(4500);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("User-Agent", client.userAgent);
            conn.setRequestProperty("X-YouTube-Client-Name", client.clientId);
            conn.setRequestProperty("X-YouTube-Client-Version", client.clientVersion);
            if (visitorData != null && !visitorData.isEmpty()) {
                conn.setRequestProperty("X-Goog-Visitor-Id", visitorData);
            }
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body.getBytes(StandardCharsets.UTF_8));
            }

            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                noteClientFailure(client.name);
                throw new IOException("InnerTube HTTP " + code + " (" + client.name + ")");
            }
            jsonText = readStreamText(conn.getInputStream());
        } finally {
            conn.disconnect();
        }

        JSONObject root;
        try {
            root = new JSONObject(jsonText);
        } catch (JSONException e) {
            throw new IOException("Invalid InnerTube JSON", e);
        }
        JSONObject playability = root.optJSONObject("playabilityStatus");
        String status = playability != null ? playability.optString("status", "") : "";
        if (!"OK".equalsIgnoreCase(status)) {
            if ("LOGIN_REQUIRED".equalsIgnoreCase(status) || "UNPLAYABLE".equalsIgnoreCase(status)) {
                noteClientFailure(client.name);
            }
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
        if (picked == null) {
            noteClientFailure(client.name);
            throw new IOException("No direct audio format (" + client.name + ")");
        }

        String streamUrl = picked.optString("url", "");
        if (streamUrl.isEmpty()) {
            noteClientFailure(client.name);
            throw new IOException("Empty audio url (" + client.name + ")");
        }
        String rawMime = picked.optString("mimeType", "audio/mp4");
        String cleanMime = rawMime.split(";")[0].trim();
        if (cleanMime.isEmpty()) cleanMime = "audio/mp4";
        long clen = parseContentLength(picked, streamUrl);

        return new ResolvedStream(
                proxyUrl,
                streamUrl,
                cleanMime,
                lufs,
                client.userAgent,
                client.name,
                clen,
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
        JSONObject best = pickAudioFromList(formats, maxKbps, false);
        if (best != null) return best;
        return pickAudioFromList(formats, maxKbps, true);
    }

    private static JSONObject pickAudioFromList(JSONArray formats, int maxKbps, boolean allowDrc) {
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

            if (!allowDrc && fmt.optBoolean("isDrc", false)) continue;
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

    private static long parseContentLength(JSONObject fmt, String streamUrl) {
        if (fmt != null) {
            String raw = fmt.optString("contentLength", "");
            if (!raw.isEmpty()) {
                try {
                    long v = Long.parseLong(raw.trim());
                    if (v > 0) return v;
                } catch (NumberFormatException ignored) {}
            }
            long clen = fmt.optLong("contentLength", -1L);
            if (clen > 0) return clen;
        }
        return parseClenFromUrl(streamUrl);
    }

    private static long parseClenFromUrl(String url) {
        if (url == null || url.isEmpty()) return -1L;
        Matcher m = CLEN_PARAM.matcher(url);
        if (m.find()) {
            try {
                long v = Long.parseLong(m.group(1));
                if (v > 0) return v;
            } catch (NumberFormatException ignored) {}
        }
        return -1L;
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

        String searchTitle = cleanQueryTitle(title);
        String leadArtist = extractLeadArtist(author);
        List<String> queries = new ArrayList<>(2);
        String qLead = (searchTitle + " " + leadArtist).trim();
        String qFull = (searchTitle + " " + author).trim();
        if (!qLead.isEmpty()) queries.add(qLead);
        if (!qFull.isEmpty() && !qFull.equalsIgnoreCase(qLead)) queries.add(qFull);
        if (queries.isEmpty()) throw new IOException("Empty query for JioSaavn fallback");

        for (String q : queries) {
            String searchUrl = "https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=6&q="
                    + urlEncode(q);
            String jsonText = httpGetText(searchUrl, DESKTOP_UA, 4000);
            JSONObject data;
            try {
                data = new JSONObject(jsonText);
            } catch (JSONException e) {
                continue;
            }
            JSONArray results = data.optJSONArray("results");
            if (results == null) continue;

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
                            -1L,
                            System.currentTimeMillis() + MAX_CACHE_TTL_MS);
                }
            }
        }
        throw new IOException("No matching JioSaavn stream");
    }

    private static String cleanQueryTitle(String s) {
        if (s == null) return "";
        return s.replaceAll("(?i)\\s*[\\[(](?:feat\\.?|ft\\.?|with|from|official|lyric|lyrics|audio|video|4k|8k|hd|hq|uhd|remaster(?:ed)?|live|explicit|clean|deluxe|acoustic|visuali[sz]er)[^\\])]*[\\])]", " ")
                .replaceAll("(?i)\\s+-\\s+(?:official\\s+(?:music\\s+)?(?:video|audio|lyric(?:s)?\\s+video|visuali[sz]er)|remaster(?:ed)?(?:\\s+\\d{4})?|lyrics?|live(?:\\s+at\\b.*)?)$", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }

    private static String extractLeadArtist(String artist) {
        if (artist == null) return "";
        String[] parts = artist.split(",|&|\\b(?i)(?:feat\\.?|ft\\.?|with)\\b");
        return parts.length > 0 ? parts[0].trim() : artist.trim();
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

    private List<String> healthyHosts(String[] all) {
        long now = System.currentTimeMillis();
        List<String> ready = new ArrayList<>(all.length);
        for (String h : all) {
            if (mirrorCooldownUntil.getOrDefault(h, 0L) <= now) {
                ready.add(h);
            }
        }
        return ready.isEmpty() ? Arrays.asList(all) : ready;
    }

    private ResolvedStream resolveViaPiped(String videoId, int maxKbps, String proxyUrl) {
        List<String> hosts = healthyHosts(PIPED_INSTANCES);
        CompletionService<ResolvedStream> ecs = new ExecutorCompletionService<>(resolverPool);
        List<Future<ResolvedStream>> tasks = new ArrayList<>(hosts.size());
        for (final String host : hosts) {
            tasks.add(ecs.submit(() -> {
                try {
                    String jsonText = httpGetText(host + "/streams/" + urlEncode(videoId), DESKTOP_UA, 3500);
                    JSONObject data = new JSONObject(jsonText);
                    JSONArray streams = data.optJSONArray("audioStreams");
                    if (streams == null || streams.length() == 0) {
                        mirrorCooldownUntil.put(host, System.currentTimeMillis() + MIRROR_COOLDOWN_MS);
                        return null;
                    }

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
                    if (picked == null) return null;
                    String pickedUrl = picked.getString("url");
                    // Avoid returning third-party IP-locked googlevideo URLs unless reachable from device IP
                    if (isGoogleVideo(pickedUrl) && !probeRange(pickedUrl, DESKTOP_UA)) {
                        mirrorCooldownUntil.put(host, System.currentTimeMillis() + MIRROR_COOLDOWN_MS);
                        return null;
                    }
                    mirrorCooldownUntil.remove(host);
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
                            parseClenFromUrl(pickedUrl),
                            computeTtlMs(pickedUrl));
                } catch (Exception ignored) {
                    mirrorCooldownUntil.put(host, System.currentTimeMillis() + MIRROR_COOLDOWN_MS);
                    return null;
                }
            }));
        }
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(3800);
        for (int i = 0; i < tasks.size(); i++) {
            long remMs = TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime());
            if (remMs <= 0) break;
            try {
                Future<ResolvedStream> done = ecs.poll(remMs, TimeUnit.MILLISECONDS);
                if (done == null) break;
                ResolvedStream winner = done.get();
                if (winner != null) {
                    cancelFutures(tasks);
                    return winner;
                }
            } catch (Exception ignored) {
                // Keep racing healthy mirrors
            }
        }
        cancelFutures(tasks);
        return null;
    }

    private ResolvedStream resolveViaInvidious(String videoId, int maxKbps, String proxyUrl) {
        final int capBps = maxKbps > 0 ? maxKbps * 1000 : Integer.MAX_VALUE;
        List<String> hosts = healthyHosts(INVIDIOUS_INSTANCES);
        CompletionService<ResolvedStream> ecs = new ExecutorCompletionService<>(resolverPool);
        List<Future<ResolvedStream>> tasks = new ArrayList<>(hosts.size());
        for (final String host : hosts) {
            tasks.add(ecs.submit(() -> {
                try {
                    String jsonText = httpGetText(host + "/api/v1/videos/" + urlEncode(videoId), DESKTOP_UA, 3500);
                    JSONObject data = new JSONObject(jsonText);
                    JSONArray formats = data.optJSONArray("adaptiveFormats");
                    if (formats == null || formats.length() == 0) {
                        mirrorCooldownUntil.put(host, System.currentTimeMillis() + MIRROR_COOLDOWN_MS);
                        return null;
                    }

                    JSONObject bestMp4 = null;
                    int bestMp4Rate = -1;
                    JSONObject bestAny = null;
                    int bestAnyRate = -1;

                    for (int i = 0; i < formats.length(); i++) {
                        JSONObject f = formats.optJSONObject(i);
                        if (f == null) continue;
                        String u = f.optString("url", "");
                        String type = f.optString("type", "").toLowerCase(Locale.US);
                        if (!u.startsWith("https://") || !type.startsWith("audio/")) continue;
                        int bitrate = parseBitrate(f.opt("bitrate"));
                        if (type.contains("audio/mp4") && bitrate <= capBps && bitrate > bestMp4Rate) {
                            bestMp4Rate = bitrate;
                            bestMp4 = f;
                        }
                        if (bitrate <= capBps && bitrate > bestAnyRate) {
                            bestAnyRate = bitrate;
                            bestAny = f;
                        }
                    }
                    JSONObject picked = bestMp4 != null ? bestMp4 : bestAny;
                    if (picked == null) return null;
                    String pickedUrl = picked.getString("url");
                    if (isGoogleVideo(pickedUrl) && !probeRange(pickedUrl, DESKTOP_UA)) {
                        mirrorCooldownUntil.put(host, System.currentTimeMillis() + MIRROR_COOLDOWN_MS);
                        return null;
                    }
                    mirrorCooldownUntil.remove(host);
                    String rawMime = picked.optString("type", "audio/mp4");
                    String cleanMime = rawMime.split(";")[0].trim();
                    if (cleanMime.isEmpty()) cleanMime = "audio/mp4";
                    return new ResolvedStream(
                            proxyUrl,
                            pickedUrl,
                            cleanMime,
                            null,
                            DESKTOP_UA,
                            "invidious",
                            parseContentLength(picked, pickedUrl),
                            computeTtlMs(pickedUrl));
                } catch (Exception ignored) {
                    mirrorCooldownUntil.put(host, System.currentTimeMillis() + MIRROR_COOLDOWN_MS);
                    return null;
                }
            }));
        }
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(3800);
        for (int i = 0; i < tasks.size(); i++) {
            long remMs = TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime());
            if (remMs <= 0) break;
            try {
                Future<ResolvedStream> done = ecs.poll(remMs, TimeUnit.MILLISECONDS);
                if (done == null) break;
                ResolvedStream winner = done.get();
                if (winner != null) {
                    cancelFutures(tasks);
                    return winner;
                }
            } catch (Exception ignored) {
                // Keep racing healthy mirrors
            }
        }
        cancelFutures(tasks);
        return null;
    }

    private static int parseBitrate(Object raw) {
        if (raw instanceof Number) return ((Number) raw).intValue();
        if (raw instanceof String) {
            try {
                return Integer.parseInt(((String) raw).trim());
            } catch (NumberFormatException ignored) {}
        }
        return 0;
    }

    private String searchAlternateYtmVideoId(String title, String artist, String originalId) throws IOException {
        String q = (cleanQueryTitle(title) + " " + extractLeadArtist(artist)).trim();
        if (q.isEmpty()) return null;
        String gl = deviceCountry();
        String body = "{\"query\":" + JSONObject.quote(q)
                + ",\"params\":\"EgWKAQIIAWoKEAkQChAFEAMQBA==\""
                + ",\"context\":{\"client\":{\"clientName\":\"WEB_REMIX\",\"clientVersion\":\"1.20250115.01.00\",\"hl\":\"en\",\"gl\":\""
                + gl + "\"}}}";
        HttpURLConnection conn = (HttpURLConnection)
                new URL("https://music.youtube.com/youtubei/v1/search?prettyPrint=false").openConnection();
        try {
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(4500);
            conn.setReadTimeout(6000);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("User-Agent", DESKTOP_UA);
            conn.setRequestProperty("Origin", "https://music.youtube.com");
            conn.setRequestProperty("Referer", "https://music.youtube.com/");
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.getBytes(StandardCharsets.UTF_8));
            }
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return null;
            String text = readStreamText(conn.getInputStream());
            return findFirstVideoId(new JSONObject(text), originalId);
        } catch (JSONException ignored) {
            return null;
        } finally {
            conn.disconnect();
        }
    }

    private static String findFirstVideoId(Object node, String originalId) {
        if (node instanceof JSONObject) {
            JSONObject obj = (JSONObject) node;
            if (obj.has("videoId")) {
                String vid = obj.optString("videoId", "");
                if (!vid.isEmpty() && !vid.equals(originalId) && VIDEO_ID_PATTERN.matcher(vid).matches()) {
                    return vid;
                }
            }
            JSONArray names = obj.names();
            if (names != null) {
                for (int i = 0; i < names.length(); i++) {
                    String k = names.optString(i);
                    String found = findFirstVideoId(obj.opt(k), originalId);
                    if (found != null) return found;
                }
            }
        } else if (node instanceof JSONArray) {
            JSONArray arr = (JSONArray) node;
            for (int i = 0; i < arr.length(); i++) {
                String found = findFirstVideoId(arr.opt(i), originalId);
                if (found != null) return found;
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
            if (code != 200 && code != 206) return false;
            String ct = conn.getContentType();
            if (ct != null && ct.toLowerCase(Locale.US).contains("text/html")) return false;
            return true;
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
        if (isGoogleVideo(active.upstreamUrl)) {
            if (forwardGoogleVideoSliced(out, method, active, rangeHeader, videoId, quality, title, artist)) {
                return;
            }
        }

        HttpURLConnection conn = null;
        try {
            conn = openUpstream(active, method, rangeHeader);
            int code = conn.getResponseCode();
            if (code == 403 || code == 410 || code >= 500) {
                noteClientFailure(active.source);
                conn.disconnect();
                active = resolve(videoId, true, quality, title, artist);
                if (isGoogleVideo(active.upstreamUrl)) {
                    if (forwardGoogleVideoSliced(out, method, active, rangeHeader, videoId, quality, title, artist)) {
                        return;
                    }
                }
                conn = openUpstream(active, method, rangeHeader);
                code = conn.getResponseCode();
            }

            if (code < 200 || code >= 400) {
                noteClientFailure(active.source);
                writeSimpleResponse(out, 502, "Bad Gateway", "text/plain", "Upstream HTTP " + code);
                return;
            }
            noteClientSuccess(active.source);

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

    private static boolean isGoogleVideo(String url) {
        return url != null && url.contains("googlevideo.com");
    }

    private boolean forwardGoogleVideoSliced(
            OutputStream out,
            String method,
            ResolvedStream initialEntry,
            String rangeHeader,
            String videoId,
            String quality,
            String title,
            String artist) throws IOException {
        ResolvedStream active = initialEntry;
        long totalSize = resolveTotalLength(active);
        if (totalSize <= 0) {
            noteClientFailure(active.source);
            try {
                active = resolve(videoId, true, quality, title, artist);
                if (!isGoogleVideo(active.upstreamUrl)) {
                    return false;
                }
                totalSize = resolveTotalLength(active);
            } catch (IOException e) {
                return false;
            }
        }
        if (totalSize <= 0) return false;

        boolean hasRange = false;
        long reqStart = 0;
        long reqEnd = totalSize - 1;

        if (rangeHeader != null && !rangeHeader.trim().isEmpty()) {
            String trimmed = rangeHeader.trim().toLowerCase(Locale.US);
            if (!trimmed.startsWith("bytes=") || trimmed.contains(",")) {
                writeSimpleResponse(out, 416, "Range Not Satisfiable", "text/plain", "Unsupported range");
                return true;
            }
            String spec = trimmed.substring(6).trim();
            int dash = spec.indexOf('-');
            if (dash < 0) {
                writeSimpleResponse(out, 416, "Range Not Satisfiable", "text/plain", "Malformed range");
                return true;
            }
            String sPart = spec.substring(0, dash).trim();
            String ePart = spec.substring(dash + 1).trim();
            try {
                if (sPart.isEmpty()) {
                    long suffix = Long.parseLong(ePart);
                    if (suffix <= 0) {
                        writeSimpleResponse(out, 416, "Range Not Satisfiable", "text/plain", "Invalid suffix");
                        return true;
                    }
                    reqStart = Math.max(0L, totalSize - suffix);
                    reqEnd = totalSize - 1;
                } else {
                    reqStart = Long.parseLong(sPart);
                    reqEnd = ePart.isEmpty() ? totalSize - 1 : Math.min(Long.parseLong(ePart), totalSize - 1);
                }
            } catch (NumberFormatException e) {
                writeSimpleResponse(out, 416, "Range Not Satisfiable", "text/plain", "Invalid range numbers");
                return true;
            }
            hasRange = true;
        }

        if (reqStart < 0 || reqStart >= totalSize || reqStart > reqEnd) {
            StringBuilder hdr = new StringBuilder();
            hdr.append("HTTP/1.1 416 Range Not Satisfiable\r\n");
            hdr.append("Access-Control-Allow-Origin: *\r\n");
            hdr.append("Content-Range: bytes */").append(totalSize).append("\r\n");
            hdr.append("Content-Length: 0\r\n");
            hdr.append("Connection: close\r\n\r\n");
            out.write(hdr.toString().getBytes(StandardCharsets.US_ASCII));
            out.flush();
            return true;
        }

        if ("HEAD".equals(method)) {
            long responseLength = reqEnd - reqStart + 1;
            String contentRange = hasRange ? ("bytes " + reqStart + "-" + reqEnd + "/" + totalSize) : null;
            writeCorsHeaders(
                    out,
                    hasRange ? 206 : 200,
                    hasRange ? "Partial Content" : "OK",
                    active.mimeType,
                    responseLength,
                    contentRange,
                    true);
            return true;
        }

        // Open slice 0 upstream FIRST before sending 200/206 headers to ExoPlayer so 403s
        // rotate seamlessly to another InnerTube client without ever sending an empty body.
        long firstSliceEnd = Math.min(reqStart + INITIAL_SLICE_BYTES - 1, reqEnd);
        HttpURLConnection firstConn = null;
        int firstCode = -1;
        for (int attempt = 0; attempt < 2; attempt++) {
            try {
                firstConn = openUpstream(active, "GET", "bytes=" + reqStart + "-" + firstSliceEnd);
                firstCode = firstConn.getResponseCode();
                if (firstCode == 200 || firstCode == 206) {
                    noteClientSuccess(active.source);
                    break;
                }
            } catch (IOException ignored) {
                firstCode = -1;
            }
            if (firstConn != null) {
                firstConn.disconnect();
                firstConn = null;
            }
            noteClientFailure(active.source);
            if (attempt == 0) {
                try {
                    ResolvedStream rotated = resolve(videoId, true, quality, title, artist);
                    if (!isGoogleVideo(rotated.upstreamUrl)) {
                        return false;
                    }
                    long rotSize = resolveTotalLength(rotated);
                    if (rotSize > 0) {
                        totalSize = rotSize;
                        reqEnd = Math.min(reqEnd, totalSize - 1);
                        if (reqStart > reqEnd) return false;
                        firstSliceEnd = Math.min(reqStart + INITIAL_SLICE_BYTES - 1, reqEnd);
                    }
                    active = rotated;
                } catch (IOException ignored) {
                    return false;
                }
            }
        }
        if (firstConn == null || (firstCode != 200 && firstCode != 206)) {
            writeSimpleResponse(out, 502, "Bad Gateway", "text/plain", "Upstream HTTP " + firstCode);
            return true;
        }

        long responseLength = reqEnd - reqStart + 1;
        String contentRange = hasRange ? ("bytes " + reqStart + "-" + reqEnd + "/" + totalSize) : null;
        writeCorsHeaders(
                out,
                hasRange ? 206 : 200,
                hasRange ? "Partial Content" : "OK",
                active.mimeType,
                responseLength,
                contentRange,
                true);

        long offset = reqStart;
        Future<byte[]> prefetched = null;
        long prefetchedStart = -1;
        try {
            // Stream slice 0 immediately packet-by-packet as bytes arrive from upstream (zero 1.5MB startup stall)
            long nextAfterZero = firstSliceEnd + 1;
            if (nextAfterZero <= reqEnd) {
                final ResolvedStream snapEntry = active;
                final long ne = Math.min(nextAfterZero + GOOGLEVIDEO_SLICE_BYTES - 1, reqEnd);
                prefetchedStart = nextAfterZero;
                prefetched = streamPool.submit(() -> fetchSlice(snapEntry, nextAfterZero, ne));
            }
            long streamedZero = pipeConnectionToOutput(firstConn, out);
            firstConn.disconnect();
            firstConn = null;
            offset += streamedZero;
            if (streamedZero == 0) {
                return true;
            }

            while (offset <= reqEnd) {
                long sliceEnd = Math.min(offset + GOOGLEVIDEO_SLICE_BYTES - 1, reqEnd);
                byte[] chunk = null;
                if (prefetched != null && prefetchedStart == offset) {
                    try {
                        chunk = prefetched.get();
                    } catch (Exception ignored) {
                        chunk = null;
                    }
                    prefetched = null;
                } else if (prefetched != null) {
                    prefetched.cancel(true);
                    prefetched = null;
                }

                if (chunk != null) {
                    long nextStart = offset + chunk.length;
                    if (nextStart <= reqEnd) {
                        final ResolvedStream snapEntry = active;
                        final long ns = nextStart;
                        final long ne = Math.min(ns + GOOGLEVIDEO_SLICE_BYTES - 1, reqEnd);
                        prefetchedStart = ns;
                        prefetched = streamPool.submit(() -> fetchSlice(snapEntry, ns, ne));
                    }
                    writeByteArrayChunked(out, chunk);
                    offset += chunk.length;
                } else {
                    // Direct streaming without full slice buffering on miss
                    HttpURLConnection sliceConn = null;
                    try {
                        sliceConn = openUpstream(active, "GET", "bytes=" + offset + "-" + sliceEnd);
                        int sc = sliceConn.getResponseCode();
                        if (sc != 200 && sc != 206) {
                            throw new IOException("Slice HTTP " + sc);
                        }
                        long nextStart = sliceEnd + 1;
                        if (nextStart <= reqEnd) {
                            final ResolvedStream snapEntry = active;
                            final long ns = nextStart;
                            final long ne = Math.min(ns + GOOGLEVIDEO_SLICE_BYTES - 1, reqEnd);
                            prefetchedStart = ns;
                            prefetched = streamPool.submit(() -> fetchSlice(snapEntry, ns, ne));
                        }
                        long nWritten = pipeConnectionToOutput(sliceConn, out);
                        if (nWritten == 0) throw new IOException("Empty slice");
                        offset += nWritten;
                    } catch (IOException sliceErr) {
                        if (sliceConn != null) sliceConn.disconnect();
                        noteClientFailure(active.source);
                        ResolvedStream rotated = resolve(videoId, true, quality, title, artist);
                        if (!isGoogleVideo(rotated.upstreamUrl)
                                || (rotated.contentLength > 0 && rotated.contentLength != totalSize)) {
                            throw sliceErr;
                        }
                        active = rotated;
                        HttpURLConnection retryConn = openUpstream(active, "GET", "bytes=" + offset + "-" + sliceEnd);
                        try {
                            int rc = retryConn.getResponseCode();
                            if (rc < 200 || rc >= 300) throw sliceErr;
                            long nWritten = pipeConnectionToOutput(retryConn, out);
                            if (nWritten == 0) throw sliceErr;
                            offset += nWritten;
                        } finally {
                            retryConn.disconnect();
                        }
                    } finally {
                        if (sliceConn != null) sliceConn.disconnect();
                    }
                }
            }
        } finally {
            if (firstConn != null) firstConn.disconnect();
            if (prefetched != null) {
                prefetched.cancel(true);
            }
        }
        return true;
    }

    private static long pipeConnectionToOutput(HttpURLConnection conn, OutputStream out) throws IOException {
        long written = 0L;
        byte[] buf = new byte[16384];
        try (InputStream in = conn.getInputStream()) {
            int n;
            while ((n = in.read(buf)) != -1) {
                if (n > 0) {
                    out.write(buf, 0, n);
                    out.flush();
                    written += n;
                }
            }
        }
        return written;
    }

    private static void writeByteArrayChunked(OutputStream out, byte[] chunk) throws IOException {
        int pos = 0;
        while (pos < chunk.length) {
            int n = Math.min(32768, chunk.length - pos);
            out.write(chunk, pos, n);
            pos += n;
        }
        out.flush();
    }

    private static long resolveTotalLength(ResolvedStream entry) {
        if (entry.contentLength > 0) return entry.contentLength;
        long clen = parseClenFromUrl(entry.upstreamUrl);
        if (clen > 0) return clen;

        HttpURLConnection conn = null;
        try {
            conn = openUpstream(entry, "GET", "bytes=0-1");
            int code = conn.getResponseCode();
            if (code == 206) {
                String cr = conn.getHeaderField("Content-Range");
                if (cr != null) {
                    int slash = cr.lastIndexOf('/');
                    if (slash >= 0 && slash + 1 < cr.length()) {
                        String totStr = cr.substring(slash + 1).trim();
                        if (!"*".equals(totStr)) {
                            return Long.parseLong(totStr);
                        }
                    }
                }
            } else if (code == 200) {
                return conn.getContentLengthLong();
            }
        } catch (Exception ignored) {
            // Unreachable or invalid range response
        } finally {
            if (conn != null) conn.disconnect();
        }
        return -1L;
    }

    private static byte[] fetchSlice(ResolvedStream entry, long start, long end) throws IOException {
        int expected = (int) (end - start + 1);
        HttpURLConnection conn = null;
        try {
            conn = openUpstream(entry, "GET", "bytes=" + start + "-" + end);
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new IOException("Slice HTTP " + code);
            }
            ByteArrayOutputStream bufOut = new ByteArrayOutputStream(expected);
            byte[] buf = new byte[16384];
            try (InputStream in = conn.getInputStream()) {
                int n;
                while ((n = in.read(buf)) != -1) {
                    bufOut.write(buf, 0, n);
                }
            }
            byte[] data = bufOut.toByteArray();
            if (data.length == 0) {
                throw new IOException("Empty slice returned from upstream");
            }
            return data;
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

