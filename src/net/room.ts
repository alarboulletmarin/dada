/**
 * Transport pair-à-pair. Ne connaît rien aux règles du jeu.
 *
 * WebRTC exige toujours une phase de « signaling » pour que deux navigateurs se
 * trouvent. Trystero la fait passer par une infrastructure publique existante
 * (ici le réseau Nostr) : il n'y a donc aucun serveur à déployer ni à payer.
 *
 * Le point faible connu de ce montage est le NAT symétrique — fréquent en 4G/5G —
 * où deux pairs n'arrivent pas à établir de lien direct. Un relais TURN sert
 * alors de filet ; voir `rtcConfig` plus bas.
 */

import { getRelaySockets, joinRoom, selfId } from 'trystero/nostr'
import type { Action, GameState, Seat } from '../game/types.ts'

/**
 * Le nom de scène du jeu sur les relais publics : c'est lui qui isole nos
 * salons de ceux des autres applications qui passent par la même
 * infrastructure.
 *
 * Il garde volontairement l'ancien nom du dépôt. Ce n'est pas un oubli du
 * renommage : c'est un identifiant qui circule sur le réseau, pas une adresse
 * de code source. Deux appareils qui n'annoncent pas le même ne se voient
 * jamais, même avec le bon code de partie — et une PWA déjà installée garde sa
 * version en cache un moment après une mise en ligne. Le changer ferait donc
 * échouer les parties entre un ami à jour et un ami qui ne l'est pas encore,
 * sans que ni l'un ni l'autre ne puisse comprendre pourquoi.
 */
export const APP_ID = 'jeu-dada-v1'

export type LobbyPlayer = {
  seat: Seat
  name: string
  /** Identité stable d'un appareil, survit à un rechargement de page. */
  clientId: string
  peerId: string | null
  kind: 'human' | 'bot'
  connected: boolean
  /**
   * Un bot tient ce siège humain — son joueur est parti, ou n'a pas joué trois
   * tours de suite. Le siège reste le sien : `clientId` et `name` ne bougent
   * pas, et son retour efface simplement ce drapeau.
   */
  botFill: boolean
}

export type Lobby = {
  code: string
  hostClientId: string
  variantId: string
  players: LobbyPlayer[]
  started: boolean
}

export type Hello = { clientId: string; name: string }
export type Intent = { clientId: string; action: Action }
/** Le nom voyage avec chaque message : un renommage en cours de partie ne
 *  doit pas réécrire l'historique déjà affiché chez les autres. */
export type ChatMessage = { clientId: string; name: string; text: string; at: number }

type Messages = {
  hello: Hello
  lobby: Lobby
  state: GameState
  intent: Intent
  chat: ChatMessage
}

export type Room = {
  selfId: string
  /** Relais de signalisation réellement connectés, pour diagnostiquer une panne. */
  relaysUp: () => number
  peers: () => string[]
  send: <K extends keyof Messages>(kind: K, data: Messages[K], to?: string) => void
  on: <K extends keyof Messages>(kind: K, cb: (data: Messages[K], peer: string) => void) => void
  onPeerJoin: (cb: (peer: string) => void) => void
  onPeerLeave: (cb: (peer: string) => void) => void
  leave: () => void
}

/**
 * Serveur TURN, optionnel, fourni au build.
 *
 * Sans TURN, deux joueurs derrière un NAT symétrique — cas courant en 4G/5G et
 * sur les réseaux d'entreprise — ne peuvent pas s'atteindre directement. STUN
 * seul couvre la majorité des situations, pas toutes.
 *
 * Le TURN passe par `turnConfig` et surtout PAS par `rtcConfig.iceServers` :
 * Trystero construit sa connexion avec `{iceServers: défauts.concat(turnConfig),
 * ...rtcConfig}`, donc un `rtcConfig.iceServers` écraserait silencieusement ses
 * quatre STUN par défaut *et* ce turnConfig.
 *
 * Renseignez VITE_TURN_URLS / VITE_TURN_USER / VITE_TURN_PASS pour l'activer
 * (voir .env.example). Un compte gratuit à identifiants statiques suffit : les
 * fournisseurs à jetons éphémères exigent un serveur, ce que ce jeu n'a pas.
 */
const turnConfig = (() => {
  const urls = import.meta.env.VITE_TURN_URLS
  const username = import.meta.env.VITE_TURN_USER
  const credential = import.meta.env.VITE_TURN_PASS
  if (!urls || !username || !credential) return undefined
  return [{ urls: urls.split(',').map((u) => u.trim()), username, credential }]
})()

/**
 * Relais Nostr pour la mise en relation.
 *
 * Trystero tire ses relais parmi quarante-sept par défaut, mais le tirage est
 * déterministe : tous les joueurs de cette app tapent toujours les mêmes cinq,
 * sans repli si l'un tombe — et il y en a un de mort. On monte la redondance
 * pour en ouvrir davantage.
 *
 * On garde la liste par défaut plutôt qu'une sélection maison : les relais les
 * plus connus sont aussi les plus filtrants, et refusent en pratique de relayer
 * les événements éphémères que Trystero utilise pour la signalisation. Vérifié
 * à la main : une liste de six relais réputés ne mettait plus deux pairs en
 * relation, là où les défauts le font en deux secondes.
 */
const relayConfig = undefined

/**
 * Vue neutre d'un canal Trystero. Le cast est confiné ici : au-dessus, `send`
 * et `on` restent typés par `Messages`, donc impossible d'envoyer un `Lobby`
 * sur le canal `state`.
 */
type AnyChannel = {
  send: (data: unknown, options?: { target?: string }) => Promise<void>
  onMessage: ((data: never, context: { peerId: string }) => void) | null
}

export function joinGameRoom(code: string, onError?: (message: string) => void): Room {
  const room = joinRoom({ appId: APP_ID, turnConfig, relayConfig }, code, {
    // Trystero ne signale que les échecs survenus APRÈS avoir trouvé un pair
    // (SDP échangé mais connexion impossible : typiquement l'absence de TURN).
    // L'attente sans aucun pair, elle, relève du minuteur côté session.
    onJoinError: ({ error }) => onError?.(error),
  })

  // Trystero limite les noms d'action à 12 octets.
  const channels: Record<keyof Messages, AnyChannel> = {
    hello: room.makeAction<Hello>('hello') as unknown as AnyChannel,
    lobby: room.makeAction<Lobby>('lobby') as unknown as AnyChannel,
    state: room.makeAction<GameState>('state') as unknown as AnyChannel,
    intent: room.makeAction<Intent>('intent') as unknown as AnyChannel,
    chat: room.makeAction<ChatMessage>('chat') as unknown as AnyChannel,
  }

  return {
    selfId,
    relaysUp: () =>
      Object.values(getRelaySockets() as Record<string, { readyState: number }>).filter(
        (socket) => socket.readyState === 1,
      ).length,
    peers: () => Object.keys(room.getPeers()),
    send: (kind, data, to) => {
      // Un envoi échoue si le pair vient de partir : sans conséquence pour la partie.
      void channels[kind].send(data, to ? { target: to } : undefined).catch(() => {})
    },
    on: (kind, cb) => {
      channels[kind].onMessage = ((data: never, context: { peerId: string }) =>
        cb(data, context.peerId)) as AnyChannel['onMessage']
    },
    onPeerJoin: (cb) => {
      room.onPeerJoin = cb
    },
    onPeerLeave: (cb) => {
      room.onPeerLeave = cb
    },
    leave: () => {
      void room.leave()
    },
  }
}

/** Identité de l'appareil, pour retrouver son siège après un rechargement. */
export function clientId(): string {
  const KEY = 'dada.clientId'
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(KEY, id)
  }
  return id
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // sans I/O/0/1, ambigus à l'oral

/** Code de partie court, lisible au téléphone et transmissible par SMS. */
export function makeCode(length = 5): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}
