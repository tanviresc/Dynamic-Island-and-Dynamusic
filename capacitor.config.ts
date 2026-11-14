import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "local.dynamusic.app",
  appName: "Dynamusic",
  webDir: "dist",
  server: {
    // Allow HTTP + ws:// LAN traffic to desktop sidecar (port 47822) without Mixed Content blocks
    androidScheme: "http",
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
    backgroundColor: "#0b0b0e",
  },
};

export default config;

