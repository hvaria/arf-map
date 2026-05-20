import type { CapacitorConfig } from "@capacitor/cli";

// ── Dev-only live-reload ─────────────────────────────────────────────────
// Set CAP_SERVER_URL in your shell (or a .env.local at the repo root
// loaded by Vite) to your laptop's LAN IP for live-reload-style dev:
//   $env:CAP_SERVER_URL = "http://192.168.1.42:5000"
//   npm run mobile:dev:android
// The Android WebView will load directly from your `npm run dev` server
// and pick up edits without a rebuild. Leave the env var UNSET for
// production builds so Capacitor uses the bundled `dist/public` assets.
const devServerUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: "com.arfmap.app",
  appName: "ARF Map",
  // Points at the Vite build output
  webDir: "dist/public",
  server: {
    // Use https scheme so cookies / fetch work correctly on Android
    androidScheme: "https",
    // Live-reload — only present when CAP_SERVER_URL is set so prod
    // builds stay clean. cleartext is required for plain http LAN dev.
    ...(devServerUrl ? { url: devServerUrl, cleartext: true } : {}),
  },
  plugins: {
    // Native splash is disabled — the brand-mark reveal is owned by
    // the React BrandSplash component (client/src/components/BrandSplash.tsx)
    // which has full motion control and matches every other in-app
    // loader. launchShowDuration: 0 makes Capacitor hide the splash
    // overlay immediately on launch; the launch theme's cream
    // windowBackground (see android/app/src/main/res/values/styles.xml)
    // covers the brief pre-WebView-paint moment.
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: "#FFF8F1",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: "DEFAULT",
      backgroundColor: "#ffffff",
      overlaysWebView: false,
    },
  },
};

export default config;
