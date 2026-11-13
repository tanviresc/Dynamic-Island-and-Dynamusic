import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";

const outdir = "dist";
if (!fs.existsSync(outdir)) {
  fs.mkdirSync(outdir, { recursive: true });
}

// Copy manifest.json
fs.copyFileSync("manifest.json", path.join(outdir, "manifest.json"));

// Build background service worker
await esbuild.build({
  entryPoints: ["src/background/service-worker.ts"],
  bundle: true,
  outfile: path.join(outdir, "background.js"),
  format: "esm",
  target: "es2022",
});

// Build content script
await esbuild.build({
  entryPoints: ["src/content/detector.ts"],
  bundle: true,
  outfile: path.join(outdir, "content.js"),
  format: "iife",
  target: "es2022",
});

console.log("Extension build completed successfully.");
