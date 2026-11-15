package local.dynamusic.app;

import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.CompletionService;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Native multi-source lyrics resolver for standalone mobile playback.
 * Races LyricsPlus (word/syllable-synced), LRCLIB (line-synced & plain),
 * and YouTube Music's own Lyrics tab on-device without CORS restrictions.
 */
final class MobileLyricsResolver {
    private static final String LYRICS_UA = "ByTune/1.0 (https://github.com/bytune-music)";
    private static final Pattern LRC_LINE = Pattern.compile("^((?:\\[\\d{1,3}:\\d{2}(?:[.:]\\d{1,3})?\\])+)(.*)$");
    private static final Pattern LRC_TAG = Pattern.compile("\\[(\\d{1,3}):(\\d{2})(?:[.:](\\d{1,3}))?\\]");
    private static final Pattern VIDEO_ID = Pattern.compile("^[A-Za-z0-9_-]{11}$");
    private static final String[] LYRICSPLUS_MIRRORS = new String[] {
        "https://lyricsplus.prjktla.my.id",
        "https://lyricsplus.atomix.one",
        "https://lyricsplus.binimum.org",
        "https://lyricsplus.prjktla.workers.dev"
    };
    private static final ExecutorService LEAF_POOL = Executors.newCachedThreadPool();

    private MobileLyricsResolver() {}

    static JSONObject resolve(
            ExecutorService pool,
            String videoId,
            String rawTitle,
            String rawArtist,
            String rawAlbum,
            double durationSec) throws JSONException {
        String title = rawTitle != null ? rawTitle.trim() : "";
        String artist = rawArtist != null ? rawArtist.replaceAll("(?i)\\s*-\\s*Topic$", "").trim() : "";
        String album = rawAlbum != null ? rawAlbum.trim() : "";
        if (title.isEmpty()) {
            return notFound();
        }

        List<Future<JSONObject>> tasks = new ArrayList<>();
        CompletionService<JSONObject> ecs = new ExecutorCompletionService<>(LEAF_POOL);

        tasks.add(ecs.submit(() -> fetchLyricsPlus(LEAF_POOL, title, artist, album, durationSec)));
        tasks.add(ecs.submit(() -> fetchLrclib(title, artist, album, durationSec)));
        if (videoId != null && VIDEO_ID.matcher(videoId).matches()) {
            tasks.add(ecs.submit(() -> fetchYtmLyrics(videoId)));
        }

        JSONObject bestWord = null;
        JSONObject bestSynced = null;
        JSONObject bestPlain = null;
        long hardDeadlineNs = System.nanoTime() + TimeUnit.SECONDS.toNanos(7);
        long wordGraceNs = -1L;

        try {
            for (int i = 0; i < tasks.size(); i++) {
                long nowNs = System.nanoTime();
                long remNs = hardDeadlineNs - nowNs;
                if (wordGraceNs > 0) {
                    remNs = Math.min(remNs, wordGraceNs - nowNs);
                }
                if (remNs <= 0) break;

                Future<JSONObject> done = ecs.poll(remNs, TimeUnit.NANOSECONDS);
                if (done == null) break;
                try {
                    JSONObject res = done.get();
                    if (res == null || !res.optBoolean("found", false)) continue;
                    boolean word = res.optBoolean("wordSynced", false);
                    boolean synced = res.optJSONArray("synced") != null && res.optJSONArray("synced").length() > 0;
                    if (word) {
                        bestWord = res;
                        break;
                    } else if (synced) {
                        if (bestSynced == null) {
                            bestSynced = res;
                            // Give LyricsPlus a brief grace window to deliver word-synced timings
                            wordGraceNs = Math.min(hardDeadlineNs, System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(900));
                        }
                    } else if (bestPlain == null) {
                        bestPlain = res;
                    }
                } catch (Exception ignored) {
                    // Try remaining providers
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            for (Future<JSONObject> f : tasks) {
                f.cancel(true);
            }
        }

        if (bestWord != null) return bestWord;
        if (bestSynced != null) return bestSynced;
        if (bestPlain != null) return bestPlain;
        return notFound();
    }

    private static JSONObject notFound() throws JSONException {
        JSONObject obj = new JSONObject();
        obj.put("found", false);
        return obj;
    }

    private static JSONObject fetchLyricsPlus(
            ExecutorService pool, String title, String artist, String album, double durationSec) {
        String cleanT = stripBrackets(title);
        String leadA = leadArtist(artist);
        if (cleanT.isEmpty()) return null;

        CompletionService<JSONObject> ecs = new ExecutorCompletionService<>(pool);
        List<Future<JSONObject>> futures = new ArrayList<>(LYRICSPLUS_MIRRORS.length);

        for (String host : LYRICSPLUS_MIRRORS) {
            futures.add(ecs.submit(() -> {
                StringBuilder url = new StringBuilder(host)
                        .append("/v2/lyrics/get?title=").append(enc(cleanT))
                        .append("&artist=").append(enc(leadA.isEmpty() ? artist : leadA));
                if (durationSec > 0) {
                    url.append("&duration=").append(Math.round(durationSec));
                }
                if (!album.isEmpty()) {
                    url.append("&album=").append(enc(stripBrackets(album)));
                }
                String body = MobileYtmClient.httpGet(url.toString(), 4500, LYRICS_UA);
                JSONObject json = new JSONObject(body);
                return parseLyricsPlusJson(json, title, artist);
            }));
        }

        try {
            long deadlineNs = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(4800);
            for (int i = 0; i < futures.size(); i++) {
                long remNs = deadlineNs - System.nanoTime();
                if (remNs <= 0) break;
                Future<JSONObject> f = ecs.poll(remNs, TimeUnit.NANOSECONDS);
                if (f == null) break;
                try {
                    JSONObject parsed = f.get();
                    if (parsed != null && parsed.optBoolean("found", false)) {
                        return parsed;
                    }
                } catch (Exception ignored) {
                    // Continue polling sibling mirrors
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            for (Future<JSONObject> f : futures) {
                f.cancel(true);
            }
        }
        return null;
    }

    private static JSONObject parseLyricsPlusJson(JSONObject json, String reqTitle, String reqArtist)
            throws JSONException {
        JSONObject meta = json.optJSONObject("metadata");
        if (meta != null) {
            String metaTitle = meta.optString("title", "");
            String metaArtist = meta.optString("artist", "");
            if (!metaTitle.isEmpty() && !looseMatch(reqTitle, reqArtist, metaTitle, metaArtist)) {
                return null;
            }
        }

        JSONArray rawLines = json.optJSONArray("lyrics");
        if (rawLines == null || rawLines.length() == 0) return null;

        JSONArray outLines = new JSONArray();
        boolean hasWords = false;

        for (int i = 0; i < rawLines.length(); i++) {
            JSONObject line = rawLines.optJSONObject(i);
            if (line == null || !line.has("time")) continue;
            double startSec = line.optDouble("time", -1) / 1000.0;
            if (startSec < 0) continue;

            JSONArray syls = line.optJSONArray("syllabus");
            JSONArray words = mergeSyllables(syls);
            JSONObject outLine = new JSONObject();

            if (words.length() > 0) {
                hasWords = true;
                StringBuilder full = new StringBuilder();
                double firstStart = startSec;
                double lastEnd = startSec;
                for (int w = 0; w < words.length(); w++) {
                    JSONObject wo = words.getJSONObject(w);
                    if (w == 0) firstStart = Math.min(startSec, wo.getDouble("start"));
                    lastEnd = Math.max(lastEnd, wo.getDouble("end"));
                    if (w > 0) full.append(' ');
                    full.append(wo.getString("text"));
                }
                outLine.put("time", firstStart);
                outLine.put("text", full.toString());
                outLine.put("words", words);
                outLine.put("end", lastEnd);
                outLines.put(outLine);
            } else {
                String text = line.optString("text", "").trim();
                if (!text.isEmpty()) {
                    outLine.put("time", startSec);
                    outLine.put("text", text);
                    double dur = line.optDouble("duration", 0);
                    if (dur > 0) outLine.put("end", startSec + dur / 1000.0);
                    outLines.put(outLine);
                }
            }
        }

        if (outLines.length() == 0) return null;
        JSONObject result = new JSONObject();
        result.put("found", true);
        result.put("source", "LyricsPlus");
        result.put("wordSynced", hasWords);
        result.put("synced", outLines);
        result.put("plain", JSONObject.NULL);
        return result;
    }

    private static JSONArray mergeSyllables(JSONArray syls) throws JSONException {
        JSONArray words = new JSONArray();
        if (syls == null || syls.length() == 0) return words;

        StringBuilder curText = new StringBuilder();
        double curStart = 0;
        double curEnd = 0;
        boolean sawSpaceBoundary = false;

        for (int i = 0; i < syls.length(); i++) {
            JSONObject s = syls.optJSONObject(i);
            if (s == null || !s.has("time")) continue;
            String raw = s.optString("text", "");
            String trimmed = raw.trim();
            if (trimmed.isEmpty()) continue;

            double st = s.optDouble("time", 0) / 1000.0;
            double en = st + Math.max(0.0, s.optDouble("duration", 0) / 1000.0);
            if (curText.length() == 0) curStart = st;
            curText.append(trimmed);
            curEnd = Math.max(en, curStart);

            if (raw.length() > 0 && Character.isWhitespace(raw.charAt(raw.length() - 1))) {
                JSONObject w = new JSONObject();
                w.put("start", curStart);
                w.put("end", curEnd);
                w.put("text", curText.toString());
                words.put(w);
                curText.setLength(0);
                sawSpaceBoundary = true;
            }
        }

        if (curText.length() > 0) {
            if (sawSpaceBoundary) {
                JSONObject w = new JSONObject();
                w.put("start", curStart);
                w.put("end", curEnd);
                w.put("text", curText.toString());
                words.put(w);
            } else {
                // No whitespace boundary convention: keep each token separate
                words = new JSONArray();
                for (int i = 0; i < syls.length(); i++) {
                    JSONObject s = syls.optJSONObject(i);
                    if (s == null || !s.has("time")) continue;
                    String t = s.optString("text", "").trim();
                    if (t.isEmpty()) continue;
                    double st = s.optDouble("time", 0) / 1000.0;
                    double en = Math.max(st, st + s.optDouble("duration", 0) / 1000.0);
                    JSONObject w = new JSONObject();
                    w.put("start", st);
                    w.put("end", en);
                    w.put("text", t);
                    words.put(w);
                }
            }
        }
        return words;
    }

    private static JSONObject fetchLrclib(String title, String artist, String album, double durationSec) {
        String cleanT = stripBrackets(title);
        String leadA = leadArtist(artist);
        if (cleanT.isEmpty()) return null;

        JSONObject plainFallback = null;

        // 1. Exact /api/get when artist & duration exist
        if (!leadA.isEmpty() && durationSec > 0) {
            try {
                StringBuilder url = new StringBuilder("https://lrclib.net/api/get?track_name=")
                        .append(enc(cleanT))
                        .append("&artist_name=").append(enc(leadA))
                        .append("&duration=").append(Math.round(durationSec));
                if (!album.isEmpty()) url.append("&album_name=").append(enc(stripBrackets(album)));
                String body = MobileYtmClient.httpGet(url.toString(), 4500, LYRICS_UA);
                JSONObject rec = new JSONObject(body);
                JSONObject parsed = fromLrclibRecord(rec);
                if (parsed != null) {
                    if (parsed.optJSONArray("synced") != null) return parsed;
                    plainFallback = parsed;
                }
            } catch (Exception ignored) {}
        }

        // 2. Structured /api/search?track_name=...&artist_name=...
        if (!leadA.isEmpty()) {
            try {
                String url = "https://lrclib.net/api/search?track_name=" + enc(cleanT) + "&artist_name=" + enc(leadA);
                String body = MobileYtmClient.httpGet(url, 4500, LYRICS_UA);
                JSONObject hit = pickBestLrclibHit(new JSONArray(body), title, artist, durationSec);
                if (hit != null) {
                    if (hit.optJSONArray("synced") != null) return hit;
                    if (plainFallback == null) plainFallback = hit;
                }
            } catch (Exception ignored) {}
        }

        // 3. Broad /api/search?q=...
        try {
            String q = (cleanT + " " + leadA).trim();
            String url = "https://lrclib.net/api/search?q=" + enc(q);
            String body = MobileYtmClient.httpGet(url, 4500, LYRICS_UA);
            JSONObject hit = pickBestLrclibHit(new JSONArray(body), title, artist, durationSec);
            if (hit != null) return hit;
        } catch (Exception ignored) {}

        return plainFallback;
    }

    private static JSONObject pickBestLrclibHit(
            JSONArray results, String reqTitle, String reqArtist, double durationSec) throws JSONException {
        if (results == null || results.length() == 0) return null;

        JSONObject bestSynced = null;
        double bestSyncedDiff = Double.MAX_VALUE;
        JSONObject bestPlain = null;

        for (int i = 0; i < results.length(); i++) {
            JSONObject rec = results.optJSONObject(i);
            if (rec == null) continue;
            String recTrack = rec.optString("trackName", "");
            String recArtist = rec.optString("artistName", "");
            if (!looseMatch(reqTitle, reqArtist, recTrack, recArtist)) continue;

            double recDur = rec.optDouble("duration", 0);
            double diff = (durationSec > 0 && recDur > 0) ? Math.abs(recDur - durationSec) : 0;
            if (durationSec > 0 && recDur > 0 && diff > 15) continue;

            JSONObject parsed = fromLrclibRecord(rec);
            if (parsed == null) continue;
            if (parsed.optJSONArray("synced") != null) {
                if (diff < bestSyncedDiff) {
                    bestSyncedDiff = diff;
                    bestSynced = parsed;
                }
            } else if (bestPlain == null) {
                bestPlain = parsed;
            }
        }
        return bestSynced != null ? bestSynced : bestPlain;
    }

    private static JSONObject fromLrclibRecord(JSONObject rec) throws JSONException {
        String syncedLrc = rec.optString("syncedLyrics", "").trim();
        String plain = rec.optString("plainLyrics", "").trim();

        JSONArray syncedArr = !syncedLrc.isEmpty() ? parseLrc(syncedLrc) : null;
        if (syncedArr != null && syncedArr.length() >= 3) {
            JSONObject obj = new JSONObject();
            obj.put("found", true);
            obj.put("source", "LRCLIB");
            obj.put("wordSynced", false);
            obj.put("synced", syncedArr);
            obj.put("plain", plain.isEmpty() ? JSONObject.NULL : plain);
            return obj;
        }
        if (!plain.isEmpty()) {
            JSONObject obj = new JSONObject();
            obj.put("found", true);
            obj.put("source", "LRCLIB");
            obj.put("wordSynced", false);
            obj.put("synced", JSONObject.NULL);
            obj.put("plain", plain);
            return obj;
        }
        if (syncedArr != null && syncedArr.length() > 0) {
            JSONObject obj = new JSONObject();
            obj.put("found", true);
            obj.put("source", "LRCLIB");
            obj.put("wordSynced", false);
            obj.put("synced", syncedArr);
            obj.put("plain", JSONObject.NULL);
            return obj;
        }
        return null;
    }

    private static JSONArray parseLrc(String lrc) throws JSONException {
        List<double[]> times = new ArrayList<>();
        List<String> texts = new ArrayList<>();
        for (String line : lrc.split("\\r?\\n")) {
            Matcher m = LRC_LINE.matcher(line.trim());
            if (!m.matches()) continue;
            String tags = m.group(1);
            String text = m.group(2).trim();
            if (text.isEmpty()) continue;
            Matcher tm = LRC_TAG.matcher(tags);
            while (tm.find()) {
                double mins = Double.parseDouble(tm.group(1));
                double secs = Double.parseDouble(tm.group(2));
                String frac = tm.group(3);
                double ms = 0;
                if (frac != null && !frac.isEmpty()) {
                    ms = frac.length() == 3 ? Double.parseDouble(frac) / 1000.0
                            : frac.length() == 2 ? Double.parseDouble(frac) / 100.0
                            : Double.parseDouble(frac) / 10.0;
                }
                times.add(new double[] { mins * 60.0 + secs + ms, times.size() });
                texts.add(text);
            }
        }
        if (times.isEmpty()) return null;
        List<Integer> order = new ArrayList<>(times.size());
        for (int i = 0; i < times.size(); i++) order.add(i);
        Collections.sort(order, Comparator.comparingDouble(a -> times.get(a)[0]));

        JSONArray arr = new JSONArray();
        for (int idx : order) {
            JSONObject row = new JSONObject();
            row.put("time", times.get(idx)[0]);
            row.put("text", texts.get(idx));
            arr.put(row);
        }
        return arr;
    }

    private static JSONObject fetchYtmLyrics(String videoId) {
        try {
            JSONObject nextBody = new JSONObject().put("videoId", videoId);
            String nextRaw = MobileYtmClient.request("next", nextBody);
            String lyricsBrowseId = findLyricsBrowseId(new JSONObject(nextRaw));
            if (lyricsBrowseId == null || lyricsBrowseId.isEmpty()) return null;

            JSONObject browseBody = new JSONObject().put("browseId", lyricsBrowseId);
            String browseRaw = MobileYtmClient.request("browse", browseBody);
            JSONObject browseJson = new JSONObject(browseRaw);

            JSONArray timed = extractYtmTimedLyrics(browseJson);
            if (timed != null && timed.length() > 0) {
                JSONObject out = new JSONObject();
                out.put("found", true);
                out.put("source", "YouTube Music");
                out.put("wordSynced", false);
                out.put("synced", timed);
                out.put("plain", JSONObject.NULL);
                return out;
            }

            String plain = extractYtmDescriptionLyrics(browseJson);
            if (plain != null && !plain.isEmpty()) {
                JSONObject out = new JSONObject();
                out.put("found", true);
                out.put("source", "YouTube Music");
                out.put("wordSynced", false);
                out.put("synced", JSONObject.NULL);
                out.put("plain", plain);
                return out;
            }
        } catch (Exception ignored) {}
        return null;
    }

    private static String findLyricsBrowseId(Object node) {
        if (node instanceof JSONObject) {
            JSONObject obj = (JSONObject) node;
            JSONObject ep = obj.optJSONObject("browseEndpoint");
            if (ep != null) {
                String bid = ep.optString("browseId", "");
                if (bid.startsWith("MPLY")) return bid;
            }
            JSONArray names = obj.names();
            if (names != null) {
                for (int i = 0; i < names.length(); i++) {
                    String found = findLyricsBrowseId(obj.opt(names.optString(i)));
                    if (found != null) return found;
                }
            }
        } else if (node instanceof JSONArray) {
            JSONArray arr = (JSONArray) node;
            for (int i = 0; i < arr.length(); i++) {
                String found = findLyricsBrowseId(arr.opt(i));
                if (found != null) return found;
            }
        }
        return null;
    }

    private static JSONArray extractYtmTimedLyrics(Object node) throws JSONException {
        if (node instanceof JSONObject) {
            JSONObject obj = (JSONObject) node;
            if (obj.has("timedLyricsData")) {
                JSONArray items = obj.optJSONArray("timedLyricsData");
                if (items != null && items.length() > 0) {
                    JSONArray out = new JSONArray();
                    for (int i = 0; i < items.length(); i++) {
                        JSONObject item = items.optJSONObject(i);
                        if (item == null) continue;
                        String text = item.optString("lyricLine", "").trim();
                        JSONObject cue = item.optJSONObject("cueRange");
                        if (text.isEmpty() || cue == null) continue;
                        double startSec = cue.optDouble("startTimeMilliseconds", 0) / 1000.0;
                        double endSec = cue.optDouble("endTimeMilliseconds", 0) / 1000.0;
                        JSONObject row = new JSONObject();
                        row.put("time", startSec);
                        row.put("text", text);
                        if (endSec > startSec) row.put("end", endSec);
                        out.put(row);
                    }
                    if (out.length() > 0) return out;
                }
            }
            JSONArray names = obj.names();
            if (names != null) {
                for (int i = 0; i < names.length(); i++) {
                    JSONArray found = extractYtmTimedLyrics(obj.opt(names.optString(i)));
                    if (found != null) return found;
                }
            }
        } else if (node instanceof JSONArray) {
            JSONArray arr = (JSONArray) node;
            for (int i = 0; i < arr.length(); i++) {
                JSONArray found = extractYtmTimedLyrics(arr.opt(i));
                if (found != null) return found;
            }
        }
        return null;
    }

    private static String extractYtmDescriptionLyrics(Object node) {
        if (node instanceof JSONObject) {
            JSONObject obj = (JSONObject) node;
            JSONObject descShelf = obj.optJSONObject("musicDescriptionShelfRenderer");
            if (descShelf != null) {
                JSONObject desc = descShelf.optJSONObject("description");
                if (desc != null) {
                    JSONArray runs = desc.optJSONArray("runs");
                    if (runs != null) {
                        StringBuilder sb = new StringBuilder();
                        for (int i = 0; i < runs.length(); i++) {
                            JSONObject r = runs.optJSONObject(i);
                            if (r != null) sb.append(r.optString("text", ""));
                        }
                        String s = sb.toString().trim();
                        if (!s.isEmpty()) return s;
                    }
                }
            }
            JSONArray names = obj.names();
            if (names != null) {
                for (int i = 0; i < names.length(); i++) {
                    String found = extractYtmDescriptionLyrics(obj.opt(names.optString(i)));
                    if (found != null) return found;
                }
            }
        } else if (node instanceof JSONArray) {
            JSONArray arr = (JSONArray) node;
            for (int i = 0; i < arr.length(); i++) {
                String found = extractYtmDescriptionLyrics(arr.opt(i));
                if (found != null) return found;
            }
        }
        return null;
    }

    private static String stripBrackets(String s) {
        if (s == null) return "";
        return s.replaceAll("(?i)\\s*[\\[(][^\\])]*[\\])]", " ")
                .replaceAll("(?i)\\s+-\\s+(?:official\\s+(?:music\\s+)?(?:video|audio|lyric(?:s)?\\s+video|visuali[sz]er)|remaster(?:ed)?(?:\\s+\\d{4})?|lyrics?|radio\\s+edit|explicit|clean|live(?:\\s+at\\b.*)?)$", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }

    private static String leadArtist(String artist) {
        if (artist == null) return "";
        String[] parts = artist.split(",|&|/|\\b(?i)(?:feat\\.?|ft\\.?|with)\\b");
        return parts.length > 0 ? parts[0].trim() : artist.trim();
    }

    private static String norm(String s) {
        if (s == null) return "";
        return stripBrackets(s).toLowerCase(Locale.US)
                .replaceAll("[^\\p{L}\\p{N}]+", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }

    private static boolean looseMatch(String reqTitle, String reqArtist, String candTitle, String candArtist) {
        String rt = norm(reqTitle);
        String ct = norm(candTitle);
        if (rt.isEmpty() || ct.isEmpty()) return false;
        boolean titleOk = rt.equals(ct) || rt.contains(ct) || ct.contains(rt);
        if (!titleOk) {
            Set<String> rw = tokenSet(rt);
            Set<String> cw = tokenSet(ct);
            int hits = 0;
            for (String w : rw) if (cw.contains(w)) hits++;
            titleOk = !rw.isEmpty() && hits * 2 >= rw.size();
        }
        if (!titleOk) return false;

        String ra = norm(reqArtist);
        String ca = norm(candArtist);
        if (ra.isEmpty() || ca.isEmpty()) return true;
        if (ra.contains(ca) || ca.contains(ra)) return true;
        Set<String> raw = tokenSet(ra);
        Set<String> caw = tokenSet(ca);
        for (String w : raw) {
            if (w.length() >= 3 && caw.contains(w)) return true;
        }
        return raw.isEmpty();
    }

    private static Set<String> tokenSet(String normText) {
        Set<String> set = new HashSet<>();
        for (String p : normText.split(" ")) {
            if (p.length() >= 2) set.add(p);
        }
        return set;
    }

    private static String enc(String v) {
        try {
            return URLEncoder.encode(v != null ? v : "", "UTF-8");
        } catch (Exception e) {
            return "";
        }
    }
}
