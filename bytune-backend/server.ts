/**
 * Dynamusic (ByTune) Local Node Sidecar Server (0.0.0.0:47822).
 * Boots the full ByTune Electron main process (`src/electron/main.ts`) via `electron-shim.ts`,
 * exposes all IPC channels over HTTP `/rpc` and Server-Sent Events `/events`,
 * and serves the built Dynamusic web / mobile PWA (`dist/`) for phone access over Wi-Fi.
 */
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { emitProtocolUrl, invokeIpcChannel, onWebContentsSend } from "./electron-shim";
import * as locallib from "../src/electron/local-library";
import { getYT } from "../src/electron/music-service";

const PORT = Number(process.env.BYTUNE_BACKEND_PORT || 47822);
const bootDeepLink = process.argv.slice(1).find((a) => /^bytune:\/\//i.test(a));

// Boot the entire ByTune main process (registers all IPC handlers, starts stream proxy, stats, sync, etc.)
import "../src/electron/main";

// Pre-warm YouTube Music InnerTube session immediately on startup so search & playback are instant
void getYT().catch(() => undefined);

function getLanUrls(): string[] {
  const urls: string[] = [];
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const iface of list) {
      if (iface.family === "IPv4" && !iface.internal) {
        urls.push(`http://${iface.address}:${PORT}`);
      }
    }
  }
  return urls;
}

const STATIC_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

function resolveStaticFile(reqPath: string): string | null {
  const clean = decodeURIComponent(reqPath).replace(/^\/+/, "");
  const distDir = path.resolve(process.cwd(), "dist");
  const publicDir = path.resolve(process.cwd(), "public");

  for (const base of [distDir, publicDir]) {
    const candidate = path.resolve(base, clean || "index.html");
    if (!candidate.startsWith(base)) continue;
    try {
      const st = fs.statSync(candidate);
      if (st.isFile()) return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

function encodeBinaryResult(val: any): any {
  if (val == null) return val;
  if (Buffer.isBuffer(val) || val instanceof Uint8Array) {
    return { __uint8__: Buffer.from(val.buffer, val.byteOffset, val.byteLength).toString("base64") };
  }
  if (Array.isArray(val)) {
    return val.map(encodeBinaryResult);
  }
  if (typeof val === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = encodeBinaryResult(v);
    }
    return out;
  }
  return val;
}

function decodeBinaryInput(val: any): any {
  if (val == null) return val;
  if (typeof val === "object" && typeof val.__uint8__ === "string") {
    const buf = Buffer.from(val.__uint8__, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  if (Array.isArray(val)) {
    return val.map(decodeBinaryInput);
  }
  if (typeof val === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = decodeBinaryInput(v);
    }
    return out;
  }
  return val;
}

const sseClients = new Set<http.ServerResponse>();

onWebContentsSend((channel, ...args) => {
  const payload = JSON.stringify({ channel, args: encodeBinaryResult(args) });
  for (const res of sseClients) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch {
      sseClients.delete(res);
    }
  }
});

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/lan-info") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, port: PORT, urls: getLanUrls() }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/oauth-callback") {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (typeof body.url === "string" && /^bytune:\/\//i.test(body.url)) {
          emitProtocolUrl(body.url);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/oauth/callback") {
    const code = url.searchParams.get("code");
    const errDesc = url.searchParams.get("error_description");
    const synthetic = code
      ? `bytune://oauth/callback?code=${encodeURIComponent(code)}`
      : `bytune://oauth/callback?error_description=${encodeURIComponent(errDesc || "Sign-in cancelled")}`;
    emitProtocolUrl(synthetic);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<!doctype html><html><body style='background:#0a0a0a;color:#fff;font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0'><div><h2>Signed in to Dynamusic</h2><p style='color:#999'>You can close this tab and return to Dynamusic.</p><script>window.close()</script></div></body></html>"
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ channel: "connected", args: [] })}\n\n`);
    sseClients.add(res);
    req.on("close", () => {
      sseClients.delete(res);
    });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/localart/")) {
    const name = decodeURIComponent(url.pathname.slice("/localart/".length)).replace(/^\/+|\/+$/g, "");
    const art = locallib.readArtFile(name);
    if (!art) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": art.mime,
      "Cache-Control": "public, max-age=86400",
    });
    res.end(art.data);
    return;
  }

  if (req.method === "POST" && url.pathname === "/rpc") {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total <= 30 * 1024 * 1024) chunks.push(chunk);
    });
    req.on("end", async () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const body = JSON.parse(raw || "{}");
        const channel = String(body.channel || "");
        const args = Array.isArray(body.args) ? decodeBinaryInput(body.args) : [];
        const result = await invokeIpcChannel(channel, args);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, result: encodeBinaryResult(result) }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: msg }));
      }
    });
    return;
  }

  if (req.method === "GET") {
    const file = resolveStaticFile(url.pathname) ?? resolveStaticFile("/index.html");
    if (file) {
      const ext = path.extname(file).toLowerCase();
      const mime = STATIC_MIME[ext] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": mime,
        "Cache-Control": ext === ".html" || file.endsWith("sw.js") ? "no-cache" : "public, max-age=86400",
      });
      fs.createReadStream(file).pipe(res);
      return;
    }
  }

  res.writeHead(404);
  res.end("Not found");
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    if (bootDeepLink) {
      fetch(`http://127.0.0.1:${PORT}/oauth-callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: bootDeepLink }),
      })
        .catch(() => {})
        .finally(() => process.exit(0));
      return;
    }
    console.log(`[dynamusic-backend] port ${PORT} already in use (sidecar already running)`);
    process.exit(0);
  }
  console.error("[dynamusic-backend] server error:", err);
});

server.listen(PORT, "0.0.0.0", () => {
  const lan = getLanUrls();
  console.log(`[dynamusic-backend] listening on http://127.0.0.1:${PORT}${lan.length ? ` (Phone Wi-Fi: ${lan.join(", ")})` : ""}`);
});

