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
