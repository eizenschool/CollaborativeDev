import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// 3.1(a) Offline resilience: precache the app shell + Leaflet tiles (once Module 4/5 add mapping)
// so a Client can still view cached screens (e.g. itinerary, chat history) without a connection.
// Write actions still require connectivity - this config only ever caches GET requests.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: "Let's Tumpang - Community Carpooling",
        short_name: "Let's Tumpang",
        description: "Let's Tumpang: community carpooling & ride-hazard platform",
        theme_color: '#16a34a',
        background_color: '#f6faf7',
        display: 'standalone', // 3.1(b) installable, app-like demo experience
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        // Core GUI screens (app shell) - cached for read-only offline viewing
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            // Leaflet.js map tiles (Module 4/5) - cache-first so a cached itinerary route
            // is still viewable offline on signal-weak highway stretches.
            urlPattern: /^https:\/\/[a-z]\.tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles-cache',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Supabase reads (GET) may be served stale-while-revalidate for offline resilience.
            // Supabase writes are POST/PATCH/DELETE and are never matched by this GET-only pattern,
            // so "read-only offline access" is enforced at the caching layer, not just by convention.
            urlPattern: ({ url, request }) =>
              url.hostname.endsWith('.supabase.co') && request.method === 'GET',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-read-cache',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 }
            }
          }
        ]
      }
    })
  ],
  server: { port: 5173 }
});
