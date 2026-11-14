/**
 * Dynamusic (ByTune) Local Node Sidecar Server (0.0.0.0:47822).
 * Boots the full ByTune Electron main process (`src/electron/main.ts`) via `electron-shim.ts`,
 * exposes all IPC channels over HTTP `/rpc` and Server-Sent Events `/events`,
 * and serves the built Dynamusic web / mobile PWA (`dist/`) for phone access over Wi-Fi.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import type { Duplex } from "stream";
import { app, emitProtocolUrl, invokeIpcChannel, onWebContentsSend } from "./electron-shim";
import * as locallib from "../src/electron/local-library";
import { getYT, resolveStream } from "../src/electron/music-service";
import { handleStreamProxyRequest, setStreamProxyPort } from "../src/electron/stream-proxy";

const PORT = Number(process.env.BYTUNE_BACKEND_PORT || 47822);
setStreamProxyPort(PORT);
const bootDeepLink = process.argv.slice(1).find((a) => /^bytune:\/\//i.test(a));

// Boot the entire ByTune main process (registers all IPC handlers, starts stream proxy, stats, sync, etc.)
import "../src/electron/main";

// Pre-warm YouTube Music InnerTube session immediately on startup so search & playback are instant
void getYT().catch(() => undefined);

const VAULT_DIR = path.join(app.getPath("userData"), "offline-vault");
try {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
} catch {
  /* ignore */
}

function safeVaultId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}

function vaultPaths(id: string): { bin: string; meta: string } {
  const safe = safeVaultId(id);
  return {
    bin: path.join(VAULT_DIR, `${safe}.bin`),
    meta: path.join(VAULT_DIR, `${safe}.json`),
  };
}

function listVaultIds(): string[] {
  try {
    const files = fs.readdirSync(VAULT_DIR);
    const ids: string[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(VAULT_DIR, f), "utf8"));
        if (meta && typeof meta.id === "string" && fs.existsSync(path.join(VAULT_DIR, f.replace(/\.json$/, ".bin")))) {
          ids.push(meta.id);
        }
      } catch {
        /* ignore */
      }
    }
    return ids;
  } catch {
    return [];
  }
}

const vaultInFlight = new Map<string, Promise<{ binPath: string; mime: string } | null>>();

async function ensureTrackInServerVault(trackId: string): Promise<{ binPath: string; mime: string } | null> {
  const { bin, meta } = vaultPaths(trackId);
  try {
    if (fs.existsSync(bin) && fs.statSync(bin).size > 4096) {
      let mime = "audio/mp4";
      try {
        const parsed = JSON.parse(fs.readFileSync(meta, "utf8"));
        if (typeof parsed.mime === "string") mime = parsed.mime;
      } catch {
        /* default */
      }
      return { binPath: bin, mime };
    }
  } catch {
    /* continue to download */
  }

  const existing = vaultInFlight.get(trackId);
  if (existing) return existing;

  const task = (async () => {
    try {
      const CHUNK_BYTES = 512 * 1024;
      const ua =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
      let stream = await resolveStream(trackId, false);
      let mime = "audio/mp4";
      let totalLength: number | null = null;
      let offset = 0;
      let retries = 0;
      const parts: Buffer[] = [];

      while (totalLength === null || offset < totalLength) {
        const end: number =
          totalLength !== null ? Math.min(offset + CHUNK_BYTES - 1, totalLength - 1) : offset + CHUNK_BYTES - 1;
        const resp: globalThis.Response | null = await fetch(stream.url, {
          headers: { "User-Agent": ua, Range: `bytes=${offset}-${end}` },
          signal: AbortSignal.timeout(25_000),
        }).catch(() => null);

        if (!resp || (!resp.ok && resp.status !== 206)) {
          if (retries < 2) {
            retries += 1;
            stream = await resolveStream(trackId, true);
            continue;
          }
          return null;
        }
        retries = 0;
        const ct = resp.headers.get("content-type");
        if (ct) mime = ct;

        if (totalLength === null) {
          const cr: string | null = resp.headers.get("content-range");
          const m: RegExpExecArray | null = cr ? /\/(\d+)$/.exec(cr) : null;
          if (m) totalLength = Number(m[1]);
        }

        const slice = Buffer.from(await resp.arrayBuffer());
        if (slice.byteLength === 0) break;
        parts.push(slice);
        offset += slice.byteLength;
        if (resp.status === 200 || (totalLength === null && slice.byteLength < CHUNK_BYTES)) {
          break;
        }
      }

      const buf = Buffer.concat(parts);
      if (buf.byteLength < 4096) return null;
      fs.writeFileSync(bin, buf);
      fs.writeFileSync(meta, JSON.stringify({ id: trackId, mime, size: buf.byteLength, savedAt: Date.now() }));
      broadcastSse("vault:saved", { id: trackId });
      return { binPath: bin, mime };
    } catch {
      return null;
    } finally {
      vaultInFlight.delete(trackId);
    }
  })();

  vaultInFlight.set(trackId, task);
  return task;
}

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

interface RemoteWsClient {
  socket: Duplex;
  buffer: Buffer;
  lastPongAt: number;
  role: "desktop" | "client";
}
const wsClients = new Set<RemoteWsClient>();
let commandSeq = 0;

function hasDesktopClient(): boolean {
  for (const c of wsClients) {
    if (c.role === "desktop" && !c.socket.destroyed) return true;
  }
  return false;
}

function broadcastDesktopStatus(): void {
  const online = hasDesktopClient();
  const payload = { type: "desktop_status", online };
  for (const client of wsClients) {
    if (client.role === "client") {
      sendWsJson(client, payload);
    }
  }
}

function forwardCommandToDesktop(command: string, payload: unknown): void {
  const commandId = `cmd-${Date.now()}-${++commandSeq}`;
  const msg = { type: "command", commandId, command, payload };
  for (const client of wsClients) {
    if (client.role === "desktop") {
      sendWsJson(client, msg);
    }
  }
  broadcastSse("pc:player_command", { commandId, command, payload });
}

function encodeWsFrame(opcode: number, payloadBuf: Buffer): Buffer {
  const len = payloadBuf.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payloadBuf]);
}

function sendWsJson(client: RemoteWsClient, data: unknown): void {
  if (client.socket.destroyed) {
    wsClients.delete(client);
    return;
  }
  try {
    client.socket.write(encodeWsFrame(0x1, Buffer.from(JSON.stringify(data), "utf8")));
  } catch {
    wsClients.delete(client);
  }
}

function broadcastWsJson(data: unknown): void {
  if (!wsClients.size) return;
  const frame = encodeWsFrame(0x1, Buffer.from(JSON.stringify(data), "utf8"));
  for (const client of wsClients) {
    if (client.socket.destroyed) {
      wsClients.delete(client);
      continue;
    }
    try {
      client.socket.write(frame);
    } catch {
      wsClients.delete(client);
    }
  }
}

// 3-second active WS ping/pong heartbeat & dead socket reaper
setInterval(() => {
  const now = Date.now();
  let desktopRemoved = false;
  for (const client of wsClients) {
    if (client.socket.destroyed || now - client.lastPongAt > 9_000) {
      try {
        client.socket.destroy();
      } catch {
        /* ignore */
      }
      wsClients.delete(client);
      if (client.role === "desktop") desktopRemoved = true;
      continue;
    }
    sendWsJson(client, { type: "ping", ts: now });
  }
  if (desktopRemoved) broadcastDesktopStatus();
}, 3_000);

// 15-second SSE keepalive
setInterval(() => {
  for (const res of sseClients) {
    try {
      res.write(": keepalive\n\n");
    } catch {
      sseClients.delete(res);
    }
  }
}, 15_000);

let latestPlayerState: any = null;

function stampAndPublishState(rawState: any): void {
  const stamped = {
    ...rawState,
    serverTimestamp: typeof rawState?.serverTimestamp === "number" ? rawState.serverTimestamp : Date.now(),
  };
  latestPlayerState = stamped;
  broadcastSse("pc:player_state", stamped);
  broadcastWsJson({ type: "state", state: stamped });
}

function broadcastSse(channel: string, ...args: any[]): void {
  const payload = JSON.stringify({ channel, args: encodeBinaryResult(args) });
  for (const res of sseClients) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch {
      sseClients.delete(res);
    }
  }
}

onWebContentsSend((channel, ...args) => {
  broadcastSse(channel, ...args);
});

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, desktopOnline: hasDesktopClient(), hasState: latestPlayerState !== null }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/player/state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, desktopOnline: hasDesktopClient(), state: latestPlayerState }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/player/sync") {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (body.state) {
          stampAndPublishState(body.state);
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

  if (req.method === "POST" && url.pathname === "/player/command") {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        const cmd = body.command || "";
        const payload = body.payload;
        if (cmd) {
          forwardCommandToDesktop(cmd, payload);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, desktopOnline: hasDesktopClient() }));
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/lan-info") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, port: PORT, urls: getLanUrls() }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/vault-list") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, ids: listVaultIds() }));
    return;
  }

  if (url.pathname.startsWith("/vault/")) {
    const id = decodeURIComponent(url.pathname.slice("/vault/".length)).replace(/^\/+|\/+$/g, "");
    if (!id) {
      res.writeHead(400);
      res.end("missing id");
      return;
    }
    if (req.method === "DELETE") {
      const { bin, meta } = vaultPaths(id);
      try {
        if (fs.existsSync(bin)) fs.unlinkSync(bin);
        if (fs.existsSync(meta)) fs.unlinkSync(meta);
      } catch {
        /* ignore */
      }
      broadcastSse("vault:removed", { id });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === "GET" || req.method === "POST") {
      const saved = await ensureTrackInServerVault(id);
      if (!saved) {
        res.writeHead(404);
        res.end("unable to cache track");
        return;
      }
      if (req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, id, mime: saved.mime }));
        return;
      }
      try {
        const size = fs.statSync(saved.binPath).size;
        res.writeHead(200, {
          "Content-Type": saved.mime,
          "Content-Length": String(size),
          "Cache-Control": "public, max-age=31536000",
        });
        fs.createReadStream(saved.binPath).pipe(res);
      } catch {
        res.writeHead(404);
        res.end("missing vault file");
      }
      return;
    }
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
        if (channel === "data:write" && typeof args[0] === "string" && args[0] === "library") {
          broadcastSse("store:updated", { name: "library", updatedAt: Date.now() });
        }
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

  if (
    req.method === "GET" &&
    (url.pathname === "/stream" || (url.pathname === "/" && (url.searchParams.has("id") || url.searchParams.has("lid"))))
  ) {
    await handleStreamProxyRequest(req, res);
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

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

server.on("upgrade", (req, socket) => {
  const reqUrl = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  if (reqUrl.pathname !== "/ws/remote") {
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string" || !key) {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash("sha1").update(key + WS_MAGIC).digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n")
  );
  if ("setNoDelay" in socket && typeof (socket as any).setNoDelay === "function") {
    (socket as any).setNoDelay(true);
  }

  const role: "desktop" | "client" = reqUrl.searchParams.get("role") === "desktop" ? "desktop" : "client";
  const client: RemoteWsClient = { socket, buffer: Buffer.alloc(0), lastPongAt: Date.now(), role };
  wsClients.add(client);

  if (role === "desktop") {
    broadcastDesktopStatus();
  } else {
    sendWsJson(client, { type: "desktop_status", online: hasDesktopClient() });
    if (latestPlayerState) {
      sendWsJson(client, { type: "state", state: latestPlayerState });
    }
    // Ask any connected desktop UI to push an up-to-date snapshot immediately
    for (const c of wsClients) {
      if (c.role === "desktop") sendWsJson(c, { type: "request_sync" });
    }
  }

  socket.on("data", (chunk: Buffer) => {
    client.lastPongAt = Date.now();
    client.buffer = Buffer.concat([client.buffer, chunk]);
    while (client.buffer.length >= 2) {
      const b0 = client.buffer[0];
      const b1 = client.buffer[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (client.buffer.length < 4) return;
        len = client.buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (client.buffer.length < 10) return;
        len = Number(client.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const need = offset + (masked ? 4 : 0) + len;
      if (client.buffer.length < need) return;

      let payload = Buffer.from(client.buffer.subarray(offset + (masked ? 4 : 0), need));
      if (masked) {
        const maskKey = client.buffer.subarray(offset, offset + 4);
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i & 3];
        }
      }
      client.buffer = client.buffer.subarray(need);

      if (opcode === 0x8) {
        wsClients.delete(client);
        if (client.role === "desktop") broadcastDesktopStatus();
        socket.destroy();
        return;
      }
      if (opcode === 0x9) {
        try {
          socket.write(encodeWsFrame(0xa, payload));
        } catch {
          /* ignore */
        }
        continue;
      }
      if (opcode === 0xa) continue;
      if (opcode === 0x1) {
        try {
          const msg = JSON.parse(payload.toString("utf8")) as {
            type?: string;
            command?: string;
            payload?: unknown;
            state?: unknown;
          };
          if (msg.type === "request_state") {
            sendWsJson(client, { type: "desktop_status", online: hasDesktopClient() });
            if (latestPlayerState) {
              sendWsJson(client, { type: "state", state: latestPlayerState });
            }
            for (const c of wsClients) {
              if (c.role === "desktop") sendWsJson(c, { type: "request_sync" });
            }
          } else if (msg.type === "sync_state" && client.role === "desktop" && msg.state) {
            stampAndPublishState(msg.state);
          } else if (msg.type === "command" && msg.command) {
            forwardCommandToDesktop(msg.command, msg.payload);
          }
        } catch {
          /* ignore malformed WS JSON */
        }
      }
    }
  });

  const cleanupClient = () => {
    const wasPresent = wsClients.delete(client);
    if (wasPresent && client.role === "desktop") {
      broadcastDesktopStatus();
    }
  };
  socket.on("close", cleanupClient);
  socket.on("error", cleanupClient);
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

