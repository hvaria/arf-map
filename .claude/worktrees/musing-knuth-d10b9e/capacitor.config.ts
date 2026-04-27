import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.arfmap.app",
  appName: "ARF Map",
  // Points at the Vite build output
  webDir: "dist/public",
  server: {
    // Use https scheme so cookies / fetch work correctly on Android
    androidScheme: "https",
    // When developing against a local server, set this to your machine's IP:
    // url: "http://192.168.x.x:5000",
    // cleartext: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#ffffff",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
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
