import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// 3.1(a) Offline resilience: precache the app shell. Google Maps Embed is a
// network iframe and intentionally falls back to the local route illustration
// when unavailable; third-party map responses are not copied into the PWA cache.
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
  server: {
    port: 5173,
    host: '0.0.0.0',
    // Tunnels forward their generated subdomain as the Host header. Keep the
    // suffixes explicit instead of allowing arbitrary Host headers.
    allowedHosts: ['.trycloudflare.com'],
  }
});
