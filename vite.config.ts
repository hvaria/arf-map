import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Service worker lives at the root so it can intercept all requests
      scope: "/",
      base: "/",
      manifest: {
        name: "ARF Map – Residential Facilities",
        short_name: "ARF Map",
        description: "Browse residential care facilities and open job positions in Amador County.",
        theme_color: "#2563eb",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "/icons/apple-touch-icon.png",
            sizes: "180x180",
            type: "image/png",
          },
        ],
      },
      workbox: {
        // Precache all build output
        globPatterns: ["**/*.{js,css,html,png,svg,ico,woff2,json}"],
        // Don't try to precache large data file through workbox — it's inlined
        globIgnores: ["**/facilities.json"],
        runtimeCaching: [
          // Cache the externalized maplibre-gl bundle from CDN
          {
            urlPattern: /^https:\/\/esm\.sh\/maplibre-gl.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "maplibre-js",
              expiration: { maxEntries: 5, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          // Cache MapLibre CSS from unpkg
          {
            urlPattern: /^https:\/\/unpkg\.com\/maplibre-gl.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "maplibre-css",
              expiration: { maxEntries: 5, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          // Cache map tiles (OpenFreeMap)
          {
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "map-tiles",
              expiration: { maxEntries: 500, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          // Cache map style JSON
          {
            urlPattern: /^https:\/\/.*\.openfreemap\.org\/styles\/.*/i,
            handler: "NetworkFirst",
            options: { cacheName: "map-styles" },
          },
          // API calls — network-first, fall back to cache
          {
            urlPattern: /^\/api\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 5,
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
  },
  root: path.resolve(__dirname, "client"),
  base: "./",
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      external: ["maplibre-gl"],
      output: {
        globals: { "maplibre-gl": "maplibregl" },
        format: "es",
        paths: { "maplibre-gl": "https://esm.sh/maplibre-gl@5.21.1" },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
