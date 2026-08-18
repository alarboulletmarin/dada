/// <reference types="vite/client" />

/** Réglages fournis au build. Voir `.env.example`. */
interface ImportMetaEnv {
  /** URLs du serveur TURN, séparées par des virgules. */
  readonly VITE_TURN_URLS?: string
  readonly VITE_TURN_USER?: string
  readonly VITE_TURN_PASS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Version du paquet, injectée au build depuis `package.json` (source unique). */
declare const __APP_VERSION__: string

/** Vrai quand `PWA_DEV=1` : le service worker tourne en développement. */
declare const __PWA_DEV__: boolean
