/**
 * Dynamusic (ByTune) Local Node Sidecar Server (127.0.0.1:47822).
 * Boots the full ByTune Electron main process (`src/electron/main.ts`) via `electron-shim.ts`
 * and exposes all IPC channels over HTTP `/rpc` and Server-Sent Events `/events`.
 */
import * as http from "http";
import { invokeIpcChannel, onWebContentsSend } from "./electron-shim";
import * as locallib from "../src/electron/local-library";

// Boot the entire ByTune main process (registers all IPC handlers, starts stream proxy, stats, sync, etc.)
import "../src/electron/main";

const PORT = Number(process.env.BYTUNE_BACKEND_PORT || 47822);

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

  res.writeHead(404);
  res.end("Not found");
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.log(`[dynamusic-backend] port ${PORT} already in use (sidecar already running)`);
    process.exit(0);
  }
  console.error("[dynamusic-backend] server error:", err);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[dynamusic-backend] listening on http://127.0.0.1:${PORT}`);
});
