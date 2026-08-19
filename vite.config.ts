import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

// BASE_PATH permet de déployer sous un sous-chemin (GitHub Pages projet : /dada/).
const base = process.env.BASE_PATH ?? '/'

// Source unique de la version : package.json. La recopier dans le source ferait
// deux copies, et celle du source serait la fausse dès la première publication.
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

/**
 * La notice de licence que porte le JavaScript servi.
 *
 * C'est le raisonnement des licences de fontes appliqué au code : ce qui voyage
 * porte sa licence. Le fichier `LICENSE` reste dans le dépôt, la minification
 * efface tous les commentaires du source, et l'article 13 de l'AGPL demande
 * justement qu'un programme accessible par le réseau offre sa source à qui s'en
 * sert. Sans ces quatre lignes, le bundle servi est anonyme.
 *
 * `generateBundle` et non `build.rollupOptions.output.banner` : le minifieur
 * passe avant l'option `banner` et supprime les commentaires, y compris ceux
 * marqués `/*!`. `generateBundle` passe après lui.
 */
function noticeAGPL(): Plugin {
  const notice = [
    `/*! Dada v${version} — Copyright (C) 2026 Andréa Larboullet Marin`,
    ' * Licence : GNU AGPL-3.0-or-later <https://www.gnu.org/licenses/agpl-3.0.html>',
    ' * Source complète : https://github.com/alarboulletmarin/dada',
    ' * Fourni SANS AUCUNE GARANTIE, dans les limites permises par la loi. */',
  ].join('\n')

  return {
    name: 'dada:notice-agpl',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk' && output.isEntry) output.code = `${notice}\n${output.code}`
      }
    },
  }
}

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(version),
    // `main.ts` doit savoir si le worker de développement est allumé : sans ce
    // drapeau il désenregistrerait celui que `PWA_DEV=1` vient d'installer.
    __PWA_DEV__: JSON.stringify(process.env.PWA_DEV === '1'),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  plugins: [
    noticeAGPL(),
    VitePWA({
      /*
       * `prompt`, et non `autoUpdate`.
       *
       * Une partie en ligne est un lien WebRTC entre plusieurs téléphones :
       * recharger, c'est le rompre — pour soi, et pour les autres qui attendent
       * un arbitre. `autoUpdate` décidait ce rechargement tout seul, au pire
       * moment possible. Désormais le nouveau worker s'installe, précache, puis
       * attend ; c'est `mountUpdatePrompt` (`src/ui/update.ts`) qui lui donne la
       * main, quand quelqu'un le demande.
       *
       * Corollaire : aucun `skipWaiting` ci-dessous. Il annulerait l'attente, et
       * avec elle le choix.
       */
      registerType: 'prompt',
      // L'enregistrement passe par `src/ui/update.ts`, qui a besoin de la
      // `registration` pour redemander la mise à jour au retour au premier plan.
      // Le script que le plugin injecte d'office referait le travail sans rien
      // à quoi s'accrocher.
      injectRegister: null,
      includeAssets: [
        'icon.svg',
        'icon-32.png',
        'icon-192.png',
        'icon-512.png',
        'icon-maskable-512.png',
        'apple-touch-icon.png',
      ],
      workbox: {
        // Tout l'applicatif est mis en cache : le jeu doit démarrer hors-ligne.
        // `txt` pour la notice des licences tierces : elle couvre les deux
        // fontes que le worker précache, et une licence joignable seulement en
        // ligne n'accompagne pas vraiment ce qui, lui, part hors ligne.
        globPatterns: ['**/*.{js,css,html,svg,png,txt,woff2}'],
        navigateFallback: `${base}index.html`,
        // Ce qui n'est pas un écran du jeu ne doit pas recevoir sa coquille : on
        // arrive à la notice par un lien, donc par une navigation, et sans cette
        // ligne le lien rendrait `index.html` sous le nom d'un fichier texte.
        navigateFallbackDenylist: [/licences-tierces\.txt$/],
        cleanupOutdatedCaches: true,
        /*
         * Sans cela, la toute première visite reste non contrôlée : le worker
         * s'installe, précache, et n'attrape la page qu'au chargement suivant.
         * Quelqu'un qui ouvre le jeu puis descend dans le métro trouverait une
         * page blanche.
         *
         * Ce n'est pas la porte dérobée que serait `skipWaiting` : la
         * revendication n'a lieu qu'à l'activation, et une mise à jour n'active
         * rien tant que le bandeau n'a pas eu sa réponse. Elle ne joue donc
         * qu'à la première installation, quand il n'y a pas d'ancienne version
         * à emporter.
         */
        clientsClaim: true,
        // Aucune requête réseau à l'usage : tout est précaché, rien n'est
        // récupéré à la volée. Pas de `runtimeCaching` par construction — le
        // signaling Nostr et le TURN ne passent pas par `fetch`.
        runtimeCaching: [],
      },
      manifest: {
        // L'identité de l'app aux yeux du navigateur, indépendante de
        // `start_url` : sans elle, changer un jour la page d'arrivée ferait de
        // l'app une seconde app, à installer à côté de la première.
        id: base,
        name: 'Dada',
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
        /*
         * `any` et `maskable` sont deux dessins, pas deux usages du même.
         *
         * Un système qui applique son gabarit rogne jusqu'au cercle inscrit à
         * 80 % du côté : servir l'icône `any` en maskable, comme on le faisait,
         * c'était lui laisser mordre le dé. Le fichier `-maskable` reprend le
         * même dé, plus petit et à bord perdu, pour que le rognage ne tombe que
         * sur de l'encre. L'`any` garde ses coins arrondis, pour les systèmes
         * qui affichent le fichier tel quel.
         */
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      /*
       * Le service worker ne s'enregistre pas en développement : il resservirait
       * du code figé à chaque rechargement, ce qui est le contraire de ce qu'on
       * attend d'un serveur de dev — et `main.ts` va jusqu'à désenregistrer ceux
       * qu'un build précédent aurait laissés sur le même hôte.
       *
       * Mais on ne pouvait alors pas essayer le bandeau de mise à jour sans
       * construire. `PWA_DEV=1 npm run dev` l'allume pour la session où c'est
       * lui qu'on regarde ; `main.ts` lit le même drapeau et se tait.
       */
      devOptions: {
        enabled: process.env.PWA_DEV === '1',
        type: 'module',
        navigateFallback: 'index.html',
      },
    }),
  ],
})
