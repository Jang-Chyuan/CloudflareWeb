import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [VitePWA({
    registerType: 'prompt',
    injectRegister: false,
    includeAssets: ['icons/*.png', 'icons/icon.svg'],
    manifest: {
      id: '/', name: 'DogTracker · Slave 追蹤', short_name: 'DogTracker',
      description: '犬隻位置、項圈狀態與歷史軌跡', lang: 'zh-Hant',
      start_url: '/', scope: '/', display: 'standalone',
      theme_color: '#247a61', background_color: '#f7f7f7',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/auth\//, /^\/api\//, /^\/functions\//],
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      // Only precache our app files. Auth, telemetry and map tiles use the network.
      runtimeCaching: [],
    },
  })],
  esbuild: { jsx: 'automatic' },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          map: ['leaflet'],
          react: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
