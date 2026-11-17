import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";

const outdir = "dist";
if (!fs.existsSync(outdir)) {
  fs.mkdirSync(outdir, { recursive: true });
}

// Copy manifest.json and options.html
fs.copyFileSync("manifest.json", path.join(outdir, "manifest.json"));
if (fs.existsSync("src/options/options.html")) {
  fs.copyFileSync("src/options/options.html", path.join(outdir, "options.html"));
}

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

// Build Gmail content script
await esbuild.build({
  entryPoints: ["src/content/gmail.ts"],
  bundle: true,
  outfile: path.join(outdir, "gmail.js"),
  format: "iife",
  target: "es2022",
});

// Build MAIN-world network lifecycle hook
await esbuild.build({
  entryPoints: ["src/content/page-hook.ts"],
  bundle: true,
  outfile: path.join(outdir, "page-hook.js"),
  format: "iife",
  target: "es2022",
});

// Build options script
await esbuild.build({
  entryPoints: ["src/options/options.ts"],
  bundle: true,
  outfile: path.join(outdir, "options.js"),
  format: "iife",
  target: "es2022",
});

console.log("Extension build completed successfully.");
