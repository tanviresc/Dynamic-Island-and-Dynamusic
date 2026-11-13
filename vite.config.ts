import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import branding from "./branding.json";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  define: {
    __APP_NAME__: JSON.stringify(branding.name),
    __APP_VERSION__: JSON.stringify(branding.version),
  },
  build: {
    target: "esnext",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
