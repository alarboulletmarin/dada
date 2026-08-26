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
import type { BoardShape } from '../game/board.ts'
import type { BotLevel } from '../game/bot.ts'
import type { Action, GameError, GameState, Seat } from '../game/types.ts'
import { turnServers } from './turn.ts'

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
  /**
   * Le tirage du portrait de ce siège (voir `ui/avatar.ts`).
   *
   * Un nombre, et pas le dessin : le portrait se recompose de zéro sur chaque
   * appareil à partir du nom et de ce nombre. Il est tiré une fois, à la
   * création du siège, puis il voyage avec le salon — c'est ce qui fait qu'une
   * nouvelle partie donne de nouveaux visages, et que le bouton « relancer »
   * les change chez tout le monde à la fois.
   *
   * Optionnel : un pair resté sur une version d'avant envoie un salon qui n'en
   * porte pas, et les portraits doivent quand même s'afficher. Ils retombent
   * alors sur le nom seul — ce qu'ils faisaient avant ce champ.
   */
  face?: number
  /**
   * Le niveau de ce bot (voir `game/bot.ts`).
   *
   * **Par siège, et non par table.** Une table de quatre où l'on est seul veut
   * souvent un adversaire sérieux et deux qui laissent respirer ; un réglage
   * unique l'interdit. Et un bot qui tient le siège d'un joueur parti
   * (`botFill`) n'a rien choisi du tout : il ne peut pas hériter d'un niveau
   * que l'absent n'a jamais demandé, et son champ reste vide.
   *
   * Il vit dans le salon plutôt que dans la variante, qui ne porte que des
   * RÈGLES et voyage jusque dans la sauvegarde : le niveau d'un bot n'est pas
   * une règle du jeu. Et comme le bot ne joue que chez l'hôte, ce champ n'a
   * jamais besoin d'être exact ailleurs — il n'y sert qu'à être lu.
   *
   * Optionnel, pour la même raison que `face` : un pair resté sur une version
   * d'avant envoie un salon qui ne le porte pas, et chaque lecture doit donc
   * porter son repli (`?? DEFAULT_LEVEL`).
   */
  level?: BotLevel
}

export type Lobby = {
  code: string
  hostClientId: string
  /**
   * Numéro de règne de l'hôte.
   *
   * Sans lui, deux appareils coupés l'un de l'autre pouvaient se croire tous
   * les deux arbitres et n'avaient aucun moyen d'en sortir : chacun ignorait
   * les salons de l'autre, et chacun mettait un bot sur le siège de l'autre.
   * L'époque donne un ordre à ces deux vérités — celle du règne le plus récent
   * gagne, et le perdant redevient invité sans perdre son siège.
   */
  epoch: number
  /**
   * Numéro de manche, incrémenté à chaque revanche.
   *
   * Le numéro d'état (`seq`) repart de zéro à chaque nouvelle partie : sans ce
   * compteur-ci, un invité qui gardait l'état final de la manche précédente
   * rejetait le premier état de la suivante comme périmé, et restait devant son
   * podium pendant que les autres jouaient.
   */
  round: number
  variantId: string
  /**
   * Réglages de table, décidés par l'hôte avant le lancement. Ils voyagent avec
   * le salon plutôt qu'avec la variante : ce ne sont pas des règles de famille,
   * c'est ce dont la table a envie ce soir.
   *
   * Optionnels : un pair resté sur une version d'avant en envoie un salon qui
   * ne les porte pas, et la partie doit continuer de se lancer.
   */
  shape?: BoardShape
  powers?: boolean
  players: LobbyPlayer[]
  started: boolean
}

export type Hello = { clientId: string; name: string }
/**
 * Réponse de l'hôte à qui demande une place.
 *
 * `pending`  : la demande est posée, l'hôte n'a pas encore tranché.
 * `denied`   : refusée.
 * `watching` : table pleine ou partie lancée — il n'y a rien à trancher, et
 *              sans cette réponse le pair se representait indéfiniment.
 * Il n'y a pas de `granted` — un siège accordé se voit dans le salon publié, et
 * deux façons de dire la même chose finiraient par se contredire.
 */
export type JoinVerdict = { clientId: string; status: 'pending' | 'denied' | 'watching' }

/**
 * L'état de la partie, tel qu'il voyage.
 *
 * L'enveloppe porte le règne et la manche : le moteur n'a pas à les connaître —
 * il ne sait rien du réseau — mais le destinataire, lui, a besoin des deux pour
 * décider si cet état-là est plus récent que le sien.
 *
 * Et `from`, l'identité de l'expéditeur : un identifiant de pair ne dit rien de
 * qui arbitre, et sans ce champ n'importe qui pouvait imposer son état à toute
 * la table. Ce n'est pas une signature — le modèle reste « on se fait confiance
 * entre amis » — c'est ce qui permet d'ignorer un ancien arbitre qui s'ignore.
 */
export type StateMessage = { from: string; epoch: number; round: number; game: GameState }

/**
 * Une intention de coup, adressée à l'hôte.
 *
 * `seq` dit sur quel état elle se fonde — l'hôte reconnaît ainsi un coup parti
 * à temps mais arrivé tard. `nonce` la rend rejouable sans risque : l'invité
 * réémet jusqu'à l'accusé de réception, l'hôte n'applique qu'une fois. `epoch`
 * dit sous quel règne elle a été décidée : un coup destiné à l'arbitre d'avant
 * n'a pas à s'appliquer à la partie de celui d'après.
 */
export type Intent = { clientId: string; epoch: number; action: Action; seq: number; nonce: string }

/** Accusé de réception d'une intention, renvoyé au seul émetteur. */
export type Ack = { nonce: string; ok: boolean; error?: IntentError }

/**
 * Ce qui peut être reproché à une intention.
 *
 * Ni l'une ni l'autre n'est une faute de jeu : `tooLate` dit que le coup était
 * bon mais qu'il est arrivé après le couperet, `noGame` que l'arbitre n'a pas
 * encore la partie sous les yeux — il vient de reprendre la main et attend
 * qu'on la lui rende. Les taire serait pire : un accusé de réception favorable
 * sur un coup que personne n'a appliqué fige la table sans un message.
 */
export type IntentError = GameError | 'tooLate' | 'noGame'

/** Battement de l'hôte. `at` revient tel quel dans le `pong` : l'hôte mesure
 *  ainsi un aller-retour sur sa seule horloge, sans jamais avoir à la comparer
 *  à celle des autres. */
export type Tick = { from: string; epoch: number; seq: number; at: number }
export type Pong = { clientId: string; at: number }

/**
 * Le nom voyage avec chaque message : un renommage en cours de partie ne
 * doit pas réécrire l'historique déjà affiché chez les autres.
 *
 * `kind` distingue une réaction d'un message écrit, et rien d'autre : une
 * réaction EST un message de chat, avec un emoji pour texte. Un canal dédié
 * aurait doublé le relais, le journal et la déduplication pour transporter la
 * même chose — et surtout, un pair resté sur une version d'avant ignore un
 * champ qu'il ne connaît pas : il reçoit une réaction comme le message d'un
 * seul emoji qu'elle est, bulle de chat comprise. Une action Trystero de plus
 * lui aurait simplement fait disparaître la moitié de la conversation.
 */
export type ChatMessage = {
  clientId: string
  name: string
  text: string
  at: number
  kind?: 'reaction'
}

type Messages = {
  hello: Hello
  join: JoinVerdict
  lobby: Lobby
  state: StateMessage
  intent: Intent
  ack: Ack
  tick: Tick
  pong: Pong
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
  /** Rendue : rejoindre le même salon avant que l'ancien ne soit vraiment fermé
   *  rend le même objet, détruit une fraction de seconde plus tard. */
  leave: () => Promise<void>
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
const turnConfig = turnServers(
  import.meta.env.VITE_TURN_URLS,
  import.meta.env.VITE_TURN_USER,
  import.meta.env.VITE_TURN_PASS,
)

/**
 * Relais Nostr pour la mise en relation.
 *
 * Trystero tire ses relais parmi quarante-sept par défaut, mais le tirage est
 * déterministe : tous les joueurs de cette app tapent toujours les mêmes cinq,
 * sans repli si l'un tombe — et il y en a un de mort. Huit au lieu de cinq :
 * la signalisation ne coûte que quelques messages éphémères, et c'est elle qui
 * décide si deux amis se trouvent ou passent la soirée devant un écran qui
 * tourne.
 *
 * On garde la liste par défaut plutôt qu'une sélection maison : les relais les
 * plus connus sont aussi les plus filtrants, et refusent en pratique de relayer
 * les événements éphémères que Trystero utilise pour la signalisation. Vérifié
 * à la main : une liste de six relais réputés ne mettait plus deux pairs en
 * relation, là où les défauts le font en deux secondes.
 */
const relayConfig = { redundancy: 8 }

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
    join: room.makeAction<JoinVerdict>('join') as unknown as AnyChannel,
    lobby: room.makeAction<Lobby>('lobby') as unknown as AnyChannel,
    state: room.makeAction<StateMessage>('state') as unknown as AnyChannel,
    intent: room.makeAction<Intent>('intent') as unknown as AnyChannel,
    ack: room.makeAction<Ack>('ack') as unknown as AnyChannel,
    tick: room.makeAction<Tick>('tick') as unknown as AnyChannel,
    pong: room.makeAction<Pong>('pong') as unknown as AnyChannel,
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
    leave: () => room.leave(),
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

/**
 * Code de partie, lisible au téléphone et transmissible par SMS.
 *
 * **Huit caractères, et non cinq.** Le code n'est pas qu'une commodité : c'est
 * l'adresse du rendez-vous sur les relais publics *et* le seul secret qui
 * protège le salon. L'identifiant d'app est public — le dépôt est libre — donc
 * qui veut peut précalculer le sujet de chaque code possible et repérer les
 * parties en cours. À cinq caractères sur un alphabet de 32, cela fait 32⁵ ≈
 * 33 millions de possibilités : quelques minutes de calcul. À huit, 32⁸ ≈ 10¹²,
 * et le jeu n'en vaut plus la chandelle.
 *
 * Trois caractères de plus à dicter, donc, contre un espace de recherche trente
 * mille fois plus grand. Et l'accord de l'hôte reste le vrai verrou : un code
 * deviné ne donne plus une place, seulement une demande à refuser.
 */
export function makeCode(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}
