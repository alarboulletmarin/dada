import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

// BASE_PATH permet de déployer sous un sous-chemin (GitHub Pages projet : /jeu-dada/).
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      workbox: {
        // Tout l'applicatif est mis en cache : le jeu doit démarrer hors-ligne.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: 'Jeu du Dada',
        short_name: 'Dada',
        description: 'Petits chevaux entre amis. Pas de compte, pas de pub, pas de serveur.',
        lang: 'fr',
        dir: 'ltr',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'any',
        background_color: '#FBF2DF',
        theme_color: '#FBF2DF',
        categories: ['games'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
    }),
  ],
})
