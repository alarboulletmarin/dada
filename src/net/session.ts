/**
 * Session de jeu : orchestre le lobby, l'état de la partie et les pairs.
 *
 * Modèle **host-authoritative** : un seul appareil détient l'état et applique
 * les coups ; les autres envoient des intentions et affichent ce qu'ils
 * reçoivent. Sans arbitre, deux joueurs pourraient lancer le dé au même instant
 * et voir deux parties diverger.
 *
 * Le mode « on se passe le téléphone » n'est qu'un cas particulier : un hôte
 * sans aucun pair, qui contrôle tous les sièges. Une seule logique à maintenir.
 */

import { isBoardShape, type BoardShape } from '../game/board.ts'
import { chooseMove, choosePower } from '../game/bot.ts'
import { apply, createGame, forceSkipTurn, handOf, legalMoves, playablePowers, powerTargets } from '../game/engine.ts'
import { seedFrom } from '../game/rng.ts'
import type { Variant } from '../game/types.ts'
import type { PowerId } from '../game/powers.ts'
import { variantById } from '../game/variants.ts'
import type { Action, GameError, GameState, Seat } from '../game/types.ts'
import {
  AWAY_TO_BOT_MS,
  isBotSeat,
  shouldHandToBot,
  turnLeft,
  TURN_GRACE_MS,
  TURN_MS,
} from './presence.ts'
import { canAdmit, welcomeFor } from './admission.ts'
import { clientId, joinGameRoom, type ChatMessage, type Lobby, type LobbyPlayer, type Room } from './room.ts'
import { clearInvite, clearSave, writeInvite, writeSave, type Save } from './save.ts'

/**
 * Les règles de la variante, plus les réglages que la table s'est donnés.
 *
 * Forme et pouvoirs ne sont pas des règles de famille : ils vivent dans le
 * salon. Mais le moteur ne connaît qu'un objet `Variant`, et c'est bien lui
 * qui doit les porter — sinon chaque appel de géométrie devrait aller
 * redemander au salon ce que le plateau est censé être, jusque dans les tests.
 * Ils sont donc recopiés ici, une fois, au moment du lancement.
 */
export function tableVariant(lobby: Lobby): Variant {
  const base = variantById(lobby.variantId)
  return {
    ...base,
    shape: isBoardShape(lobby.shape) ? lobby.shape : 'croix',
    powers: lobby.powers === true,
  }
}

const MAX_SEATS = 4
const BOT_DELAY = 700
/**
 * Au-delà, on considère que l'invité ne trouvera personne. Mieux vaut le dire
 * que de le laisser devant un écran qui tourne : la mise en relation aboutit en
 * deux ou trois secondes quand elle aboutit.
 */
const LINK_TIMEOUT = 15000

export type SessionMode = 'local' | 'online'

/** Où en est la mise en relation, pour que l'écran d'attente puisse le dire. */
export type Link = 'searching' | 'linked' | 'lost'

/** Une demande d'entrée en attente de la décision de l'hôte. */
export type JoinRequest = { clientId: string; name: string; peer: string }

/**
 * Où en est *ma* demande, vue de l'invité.
 *
 * `unknown` couvre les deux cas où la question ne se pose pas : l'hôte, et
 * l'invité qui a déjà son siège. Un invité sans siège et sans réponse est
 * simplement en train de chercher — c'est `link` qui le dit.
 */
export type AskStatus = 'unknown' | 'pending' | 'denied'

/** De quoi ouvrir un canal — la vraie implémentation, ou un double de test. */
export type RoomFactory = (code: string, onError?: (message: string) => void) => Room

/**
 * Ce que la session a besoin de faire dire à l'écran. Elle transmet un motif et
 * ses paramètres, pas une phrase : la couche réseau n'a pas à connaître la
 * langue du joueur.
 */
export type NoticeCode =
  | GameError
  | 'linkFailed'
  | 'linkBlocked'
  | 'hostTaken'
  | 'seatToBot'
  | 'seatBack'

export type Notice = { code: NoticeCode; name?: string }

export type SessionListeners = {
  onChange: () => void
  onError: (notice: Notice) => void
  onChat: (message: ChatMessage) => void
}

export class Session {
  readonly mode: SessionMode
  readonly self = clientId()
  lobby: Lobby
  game: GameState | null = null
  link: Link = 'linked'
  /**
   * Côté hôte : les demandes d'entrée en attente de sa décision, dans l'ordre
   * d'arrivée. Elles ne voyagent pas dans le salon publié — c'est un état de
   * l'hôte, pas une propriété de la table, et un pair n'a pas à savoir qui
   * d'autre frappe à la porte.
   */
  private requests: JoinRequest[] = []
  /** Côté hôte : appareils déjà refusés. Ils ne redemandent plus. */
  private refused = new Set<string>()
  /** Côté invité : où en est ma propre demande. */
  private askStatus: AskStatus = 'unknown'
  /** Comment ouvrir un canal. Voir `Session.online`. */
  private join: RoomFactory = joinGameRoom
  /** En mémoire seulement : rien n'est stocké ni relayé par un hôte pour les
   *  pairs qui n'étaient pas encore là. */
  chatLog: ChatMessage[] = []

  private room: Room | null = null
  private listeners: SessionListeners
  private botTimer: ReturnType<typeof setTimeout> | null = null
  private linkTimer: ReturnType<typeof setTimeout> | null = null
  /** Sanction du temps de réflexion écoulé — armée chez l'hôte seul. */
  private turnTimer: ReturnType<typeof setTimeout> | null = null
  /** Fin du temps de réflexion du siège courant, en temps local. */
  private turnEndsAt: number | null = null
  /** Ce que la minuterie en cours décompte : état, siège, et rôle qu'on tenait. */
  private turnFor: string | null = null
  /** Tours sautés d'affilée, par siège. Remis à zéro dès qu'on joue. */
  private missed = new Map<Seat, number>()
  /** Relève d'un siège abandonné, par siège : chaque pair l'arme, l'hôte l'exécute. */
  private awayTimers = new Map<Seat, ReturnType<typeof setTimeout>>()
  /** Retenu pour pouvoir refaire une tentative sans repasser par l'accueil. */
  private myName = ''

  private constructor(mode: SessionMode, lobby: Lobby, listeners: SessionListeners) {
    this.mode = mode
    this.lobby = lobby
    // Chaque changement d'état est l'occasion de sauvegarder : c'est le seul
    // point de passage obligé, donc le seul où l'on ne peut pas en oublier un.
    this.listeners = {
      ...listeners,
      onChange: () => {
        this.persist()
        listeners.onChange()
      },
    }
  }

  /**
   * Sauvegarde la partie en cours, si elle est reprenable. Une partie en ligne
   * ne l'est pas : elle vit sur la table, pas sur cet appareil.
   */
  private persist(): void {
    // D'une partie en ligne on ne garde que le code : le siège reste le nôtre
    // même après un départ, encore faut-il pouvoir revenir le prendre.
    if (this.mode === 'online') {
      if (this.game && this.lobby.started && this.game.phase !== 'finished') writeInvite(this.lobby.code)
      else clearInvite()
      return
    }
    if (!this.game || !this.lobby.started || this.game.phase === 'finished') return clearSave()
    writeSave(this.lobby, this.game)
  }

  // ───────────────────────────── fabriques ─────────────────────────────

  static local(name: string, listeners: SessionListeners): Session {
    const self = clientId()
    return new Session(
      'local',
      {
        code: 'LOCAL',
        hostClientId: self,
        variantId: 'petits-chevaux',
        players: [seatFor(0, name, self, 'human')],
        started: false,
      },
      listeners,
    )
  }

  /**
   * Reprend une partie locale sauvegardée. Les bots ne se relancent pas tout
   * seuls — leur minuterie est morte avec la page — d'où le `scheduleBot()`
   * final, sans lequel une reprise sur un tour de bot resterait figée.
   */
  static resume(save: Save, listeners: SessionListeners): Session {
    const session = new Session('local', save.lobby, listeners)
    session.game = save.game
    // L'hôte d'une partie locale, c'est forcément cet appareil : l'identifiant
    // stocké appartient peut-être à une installation précédente.
    session.lobby.hostClientId = session.self
    session.lobby.players.forEach((p) => {
      p.clientId = session.self
      p.peerId = null
      p.connected = true
      // Personne n'est absent d'une partie qu'on reprend seul sur son téléphone.
      p.botFill = false
    })
    session.onGameChanged()
    return session
  }

  /**
   * `join` n'existe que pour les tests.
   *
   * L'admission d'un joueur est la seule règle de sécurité du jeu, et elle vit
   * dans le va-et-vient entre `hello`, la liste d'attente et `admit()` — pas
   * dans une fonction pure qu'on pourrait tester à côté. Sans cette couture, il
   * faudrait un vrai relais public pour vérifier qu'un inconnu n'entre pas tout
   * seul : autant dire qu'on ne le vérifierait pas.
   */
  static online(
    code: string,
    name: string,
    asHost: boolean,
    listeners: SessionListeners,
    join: RoomFactory = joinGameRoom,
  ): Session {
    const self = clientId()
    const lobby: Lobby = {
      code,
      hostClientId: asHost ? self : '',
      variantId: 'petits-chevaux',
      players: asHost ? [seatFor(0, name, self, 'human')] : [],
      started: false,
    }

    const session = new Session('online', lobby, listeners)
    session.myName = name
    session.connect(code, name, join)
    return session
  }

  /** Nouvelle tentative de mise en relation, après un échec. */
  retry(): void {
    if (this.mode !== 'online') return
    this.room?.leave()
    this.room = null
    this.connect(this.lobby.code, this.myName)
    this.listeners.onChange()
  }

  /** Relais de signalisation joignables — zéro veut dire « pas de réseau ». */
  relaysUp(): number {
    return this.room?.relaysUp() ?? 0
  }

  // ───────────────────────────── réseau ─────────────────────────────

  private connect(code: string, name: string, join: RoomFactory = this.join): void {
    this.join = join
    const room = join(code, (error) => this.reportLinkError(error))
    this.room = room
    this.myName = name

    // L'hôte, lui, attend ses amis : son attente n'a pas de raison d'échouer.
    // L'invité, en revanche, cherche quelqu'un de précis, qui devrait répondre.
    if (!this.isHost) {
      this.link = 'searching'
      this.armLinkTimeout()
    }

    // Sans cela, les autres ne peuvent pas reconnaître le départ de l'hôte :
    // ils ne verraient qu'un identifiant de pair anonyme quitter la salle.
    const me = this.lobby.players.find((p) => p.clientId === this.self)
    if (me) me.peerId = room.selfId

    room.on('hello', (hello, peer) => {
      if (!this.isHost) return
      this.welcome(hello.clientId, hello.name, peer)
    })

    room.on('join', (verdict) => {
      if (verdict.clientId !== this.self) return
      this.askStatus = verdict.status
      this.listeners.onChange()
    })

    room.on('lobby', (lobby) => {
      // Seul l'hôte fait autorité sur la composition de la table.
      if (this.isHost) return
      this.lobby = lobby
      // Un salon où je n'ai pas de siège : soit ma demande attend, soit l'hôte
      // a changé et le nouveau n'en sait rien. On se represente — c'est aussi
      // ce qui rattrape un `hello` perdu, et l'hôte déduplique.
      if (lobby.players.some((p) => p.clientId === this.self)) this.askStatus = 'unknown'
      else if (this.askStatus !== 'denied') {
        room.send('hello', { clientId: this.self, name: this.myName })
      }
      // Un bot vient peut-être de prendre le siège dont c'est le tour : il n'y
      // a plus personne à décompter. Le tour en cours, lui, garde son échéance.
      this.armTurnClock()
      this.listeners.onChange()
    })

    room.on('state', (state) => {
      if (this.isHost) return
      // Un état plus ancien peut arriver après un changement d'hôte : on l'ignore.
      if (this.game && state.seq < this.game.seq) return
      this.game = state
      // Le compte à rebours repart à la réception, AVANT le rendu : c'est lui
      // qui dit à l'écran s'il y a un contour à peindre. Chacun compte sur sa
      // propre horloge, sans jamais avoir à la comparer à celle des autres.
      this.onGameChanged()
      this.listeners.onChange()
    })

    room.on('intent', (intent) => {
      if (!this.isHost) return
      const seat = this.seatOfClient(intent.clientId)
      if (seat === null) return
      this.applyAsHost(intent.action, seat)
    })

    room.on('chat', (message) => {
      this.chatLog.push(message)
      this.listeners.onChat(message)
    })

    room.onPeerJoin((peer) => {
      this.link = 'linked'
      if (this.linkTimer) clearTimeout(this.linkTimer)
      this.linkTimer = null

      if (this.isHost) {
        // Le nouveau venu se présentera ; on lui envoie déjà la table.
        room.send('lobby', this.lobby, peer)
        if (this.game) room.send('state', this.game, peer)
      } else {
        // Le `hello` d'ouverture se perd s'il part avant qu'un pair soit joignable :
        // on se represente à chaque arrivée, l'hôte déduplique par clientId.
        room.send('hello', { clientId: this.self, name }, peer)
      }
      this.listeners.onChange()
    })

    room.onPeerLeave((peer) => {
      // Une demande dont l'auteur est parti n'a plus d'objet : l'accepter
      // donnerait un siège fantôme, occupé par personne.
      if (this.requests.some((r) => r.peer === peer)) {
        this.requests = this.requests.filter((r) => r.peer !== peer)
        this.listeners.onChange()
      }
      const player = this.lobby.players.find((p) => p.peerId === peer)
      if (player) {
        player.connected = false
        player.peerId = null
        // Chaque pair arme la relève, seul celui qui sera hôte à l'échéance
        // l'exécutera : le départ de l'hôte lui-même reste ainsi couvert.
        this.armBotTakeover(player.seat)
      }
      if (player?.clientId === this.lobby.hostClientId) this.electHost()
      else if (this.isHost) this.publishLobby()
      this.onGameChanged()
      this.listeners.onChange()
    })

    room.send('hello', { clientId: this.self, name })
  }

  /** L'hôte accueille un pair : nouveau siège, ou reprise du siège d'origine. */
  private armLinkTimeout(): void {
    if (this.linkTimer) clearTimeout(this.linkTimer)
    this.linkTimer = setTimeout(() => {
      if (this.link === 'linked') return
      this.link = 'lost'
      this.listeners.onChange()
    }, LINK_TIMEOUT)
  }

  /**
   * Trystero ne signale que les échecs survenus après avoir trouvé un pair —
   * typiquement : SDP échangé, mais aucun chemin réseau entre les deux. C'est le
   * symptôme d'un NAT symétrique sans serveur TURN.
   */
  private reportLinkError(error: string): void {
    this.link = 'lost'
    if (this.linkTimer) clearTimeout(this.linkTimer)
    this.linkTimer = null
    this.listeners.onError({ code: /turn/i.test(error) ? 'linkBlocked' : 'linkFailed' })
    this.listeners.onChange()
  }

  private welcome(id: string, name: string, peer: string): void {
    const verdict = welcomeFor(this.admission(), id)

    if (verdict.kind === 'reclaim') {
      const known = this.lobby.players.find((p) => p.clientId === id)!
      known.peerId = peer
      known.connected = true
      known.name = name
      // Le siège lui appartient toujours, bot ou pas : il le retrouve intact,
      // qu'il revienne d'un départ ou qu'il reprenne la main après une absence.
      // Aucun accord à redemander : un rechargement de page n'est pas une
      // arrivée, et une porte qui claque dans le dos serait la pire des règles.
      this.reclaim(known)
      this.publishLobby()
      if (this.game) this.room?.send('state', this.game)
      this.onGameChanged()
      this.listeners.onChange()
      return
    }

    if (verdict.kind === 'ask') {
      // Le pair se represente à chaque publication du salon : une même demande
      // ne s'empile pas, elle se met simplement à jour.
      const already = this.requests.find((r) => r.clientId === id)
      if (already) {
        already.name = name
        already.peer = peer
      } else {
        this.requests.push({ clientId: id, name, peer })
      }
      this.room?.send('join', { clientId: id, status: 'pending' }, peer)
      this.listeners.onChange()
      return
    }

    // Refusé, table pleine ou partie lancée : le pair regarde. On lui envoie
    // quand même la table, faute de quoi il resterait devant un écran d'attente
    // sans jamais savoir pourquoi.
    if (verdict.kind === 'refused') this.room?.send('join', { clientId: id, status: 'denied' }, peer)
    this.room?.send('lobby', this.lobby, peer)
    if (this.game) this.room?.send('state', this.game, peer)
  }

  private admission() {
    return {
      lobby: this.lobby,
      refused: this.refused,
      pending: new Set(this.requests.map((r) => r.clientId)),
      maxSeats: MAX_SEATS,
    }
  }

  // ───────────────────────── qui entre, qui n'entre pas ─────────────────────────

  /** Les demandes en attente, pour que l'hôte les voie. Vide chez les autres. */
  pendingJoins(): readonly JoinRequest[] {
    return this.isHost ? this.requests : []
  }

  /** Où en est ma propre demande, vue de l'invité. */
  get joinStatus(): AskStatus {
    return this.askStatus
  }

  /** L'hôte accorde une place. */
  admit(id: string): void {
    if (!this.isHost) return
    const request = this.requests.find((r) => r.clientId === id)
    if (!request || !canAdmit(this.admission(), id)) {
      this.requests = this.requests.filter((r) => r.clientId !== id)
      this.listeners.onChange()
      return
    }

    this.requests = this.requests.filter((r) => r.clientId !== id)
    this.refused.delete(id)
    this.lobby.players.push(seatFor(this.freeSeat(), request.name, id, 'human', request.peer))
    this.publishLobby()
    if (this.game) this.room?.send('state', this.game)
    this.onGameChanged()
    this.listeners.onChange()
  }

  /**
   * L'hôte refuse.
   *
   * L'appareil est retenu : sans cela il se representerait à la publication
   * suivante du salon, et l'hôte passerait sa soirée à refuser le même.
   */
  refuse(id: string): void {
    if (!this.isHost) return
    const request = this.requests.find((r) => r.clientId === id)
    this.requests = this.requests.filter((r) => r.clientId !== id)
    this.refused.add(id)
    if (request) this.room?.send('join', { clientId: id, status: 'denied' }, request.peer)
    this.listeners.onChange()
  }

  /**
   * L'hôte est parti : on en désigne un nouveau de façon déterministe, pour que
   * tous les pairs aboutissent au même résultat sans se concerter. Chacun ayant
   * une copie complète de l'état, la partie reprend sans rien perdre.
   */
  private electHost(): void {
    const gone = this.lobby.hostClientId
    const candidates = this.lobby.players
      .filter((p) => p.kind === 'human' && p.connected && !p.botFill)
      .map((p) => p.clientId)
      .sort()

    const next = candidates[0]
    if (!next) return

    this.lobby.hostClientId = next
    if (next !== this.self) return

    // Les sièges que l'ancien hôte avait ajoutés — bots, joueurs partageant son
    // téléphone — portaient son identifiant : plus personne ne les jouerait.
    // Ils passent au nouvel arbitre. Le siège de l'hôte lui-même, non : c'est le
    // sien, un bot le tiendra le temps qu'il revienne (voir `armBotTakeover`).
    // Son siège à lui est celui que son départ vient de faire tomber hors ligne ;
    // les autres, ajoutés depuis son téléphone, n'ont jamais eu de pair à perdre.
    const hisOwn =
      this.lobby.players.find((p) => p.clientId === gone && !p.connected) ??
      this.lobby.players.find((p) => p.clientId === gone)
    for (const p of this.lobby.players) {
      if (p.clientId !== gone || p === hisOwn) continue
      p.clientId = this.self
      p.peerId = null
      p.kind = 'bot'
      p.botFill = false
      p.connected = true
    }

    this.listeners.onError({ code: 'hostTaken' })
    this.publishLobby()
    if (this.game) this.room?.send('state', this.game)
    this.onGameChanged()
  }

  private publishLobby(): void {
    if (this.isHost) this.room?.send('lobby', this.lobby)
  }

  // ───────────────────────────── lectures ─────────────────────────────

  get isHost(): boolean {
    return this.lobby.hostClientId === this.self
  }

  /** Le siège occupé par l'hôte en personne — le premier qu'il a pris. */
  get hostSeat(): Seat | null {
    return this.lobby.players.find((p) => p.clientId === this.lobby.hostClientId)?.seat ?? null
  }

  private seatOfClient(id: string): Seat | null {
    return this.lobby.players.find((p) => p.clientId === id)?.seat ?? null
  }

  /** Ce siège est-il tenu par cet appareil, bot de remplacement ou non ? */
  mine(seat: Seat): boolean {
    const player = this.lobby.players.find((p) => p.seat === seat)
    return player !== undefined && player.kind === 'human' && player.clientId === this.self
  }

  /** Ce siège est-il jouable depuis cet appareil ? */
  controls(seat: Seat): boolean {
    const player = this.lobby.players.find((p) => p.seat === seat)
    if (!player || isBotSeat(player)) return false
    return player.clientId === this.self
  }

  /** Un bot tient-il ce siège — à demeure, ou en l'absence de son joueur ? */
  botAt(seat: Seat): boolean {
    const player = this.lobby.players.find((p) => p.seat === seat)
    return player !== undefined && isBotSeat(player)
  }

  /** Un bot tient-il un siège qui nous appartient, et qu'on pourrait reprendre ? */
  get seatToTakeBack(): Seat | null {
    return this.lobby.players.find((p) => p.botFill && this.mine(p.seat))?.seat ?? null
  }

  /**
   * Part du temps de réflexion qu'il reste au joueur courant, de 1 à 0, ou null
   * s'il n'y a rien à décompter (bot, partie finie, salon).
   */
  turnLeft(): number | null {
    return turnLeft(this.turnEndsAt, Date.now())
  }

  /** Secondes restantes, arrondies vers le haut : « 3 », « 2 », « 1 ». */
  turnSeconds(): number {
    return Math.ceil(((this.turnLeft() ?? 0) * TURN_MS) / 1000)
  }

  /** Le joueur local peut-il agir maintenant ? */
  get myTurn(): boolean {
    return this.game !== null && this.game.phase !== 'finished' && this.controls(this.game.turn)
  }

  private freeSeat(): Seat {
    const taken = new Set(this.lobby.players.map((p) => p.seat))
    for (let s = 0; s < MAX_SEATS; s++) if (!taken.has(s as Seat)) return s as Seat
    return 0
  }

  // ───────────────────────────── écritures ─────────────────────────────

  setVariant(id: string): void {
    if (!this.isHost || this.lobby.started) return
    this.lobby.variantId = id
    this.publishLobby()
    this.listeners.onChange()
  }

  /** Le décor du plateau. Ne change aucune règle ni aucune distance. */
  setShape(shape: BoardShape): void {
    if (!this.isHost || this.lobby.started) return
    this.lobby.shape = shape
    this.publishLobby()
    this.listeners.onChange()
  }

  /** Les cases pouvoir sont-elles de la partie ? */
  setPowers(on: boolean): void {
    if (!this.isHost || this.lobby.started) return
    this.lobby.powers = on
    this.publishLobby()
    this.listeners.onChange()
  }

  rename(seat: Seat, name: string): void {
    const player = this.lobby.players.find((p) => p.seat === seat)
    if (!player) return
    if (!this.isHost && player.clientId !== this.self) return
    player.name = name
    this.publishLobby()
    this.listeners.onChange()
  }

  addSeat(kind: 'human' | 'bot'): void {
    if (!this.isHost || this.lobby.started || this.lobby.players.length >= MAX_SEATS) return
    const seat = this.freeSeat()
    const name = kind === 'bot' ? `Bot ${seat + 1}` : `Joueur ${seat + 1}`
    // En local, un siège « humain » est simplement un joueur de plus sur cet appareil.
    this.lobby.players.push(seatFor(seat, name, this.self, kind))
    this.publishLobby()
    this.listeners.onChange()
  }

  removeSeat(seat: Seat): void {
    if (!this.isHost || this.lobby.started) return
    const player = this.lobby.players.find((p) => p.seat === seat)
    // Comparer les `clientId` ne suffit pas : les sièges ajoutés par l'hôte
    // (bots, joueurs sur le même téléphone) portent le sien. Seul le
    // siège qu'il occupe lui-même est intouchable.
    if (!player || seat === this.hostSeat) return
    this.lobby.players = this.lobby.players.filter((p) => p.seat !== seat)
    this.publishLobby()
    this.listeners.onChange()
  }

  start(): void {
    if (!this.isHost || this.lobby.players.length < 2) return

    this.missed.clear()
    this.lobby.started = true
    this.game = createGame({
      players: this.lobby.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        kind: p.kind === 'bot' ? 'bot' : p.clientId === this.self ? 'local' : 'remote',
        peerId: p.peerId,
        connected: p.connected,
      })),
      variant: tableVariant(this.lobby),
      seed: seedFrom(`${this.lobby.code}:${Date.now()}`),
    })

    this.publishLobby()
    this.room?.send('state', this.game)
    this.onGameChanged()
    this.listeners.onChange()
  }

  /** Point d'entrée unique de l'UI pour jouer un coup. */
  dispatch(action: Action): void {
    if (!this.game) return
    const seat = this.game.turn
    if (!this.controls(seat)) {
      this.listeners.onError({ code: 'notYourTurn' })
      return
    }

    if (this.isHost) this.applyAsHost(action, seat)
    else this.room?.send('intent', { clientId: this.self, action })
  }

  /**
   * Diffuse un message à tous les pairs présents. Trystero ne renvoie pas
   * l'émetteur à lui-même : on s'ajoute donc son propre message en local.
   */
  sendChat(text: string): void {
    const trimmed = text.trim()
    if (!trimmed || !this.room) return

    const name = this.lobby.players.find((p) => p.clientId === this.self)?.name ?? this.myName
    const message: ChatMessage = { clientId: this.self, name, text: trimmed, at: Date.now() }
    this.chatLog.push(message)
    this.room.send('chat', message)
    this.listeners.onChat(message)
  }

  private applyAsHost(action: Action, seat: Seat): void {
    if (!this.game) return

    const { state, error } = apply(this.game, action, seat)
    if (error) {
      this.listeners.onError({ code: error })
      return
    }

    // Jouer, c'est être là : la série de tours sautés repart de zéro.
    this.missed.set(seat, 0)
    this.game = state
    this.room?.send('state', state)
    this.onGameChanged()
    this.listeners.onChange()
  }

  /** L'hôte joue pour les sièges tenus par un bot. */
  private scheduleBot(): void {
    if (this.botTimer) clearTimeout(this.botTimer)
    if (!this.isHost || !this.game || this.game.phase === 'finished') return

    const seat = this.game.turn
    const player = this.lobby.players.find((p) => p.seat === seat)
    // Un bot à demeure, ou un bot qui tient le siège d'un absent : même arbitre.
    if (!player || !isBotSeat(player)) return

    this.botTimer = setTimeout(() => {
      if (!this.game || this.game.turn !== seat) return
      // Une carte d'abord, s'il en a une qui vaut le coup : la jouer ne consomme
      // pas le tour, et `applyAsHost` rappellera `scheduleBot` pour la suite.
      const card = choosePower(this.game)
      if (card) {
        this.applyAsHost(card, seat)
        return
      }
      if (this.game.phase === 'rolling') {
        this.applyAsHost({ type: 'roll' }, seat)
        return
      }
      const move = chooseMove(this.game)
      this.applyAsHost(move ? { type: 'move', pawnId: move.pawnId } : { type: 'pass' }, seat)
    }, BOT_DELAY)
  }

  /** Tout ce qui suit un changement d'état : à qui de jouer, et jusqu'à quand. */
  private onGameChanged(): void {
    this.scheduleBot()
    this.armTurnClock()
  }

  /**
   * Le temps de réflexion du siège courant.
   *
   * Tout le monde l'arme — c'est lui qui alimente le contour qui se vide sur la
   * carte du joueur — mais seul l'hôte en tire les conséquences. Chacun compte
   * depuis la réception de l'état, sur sa propre horloge : deux téléphones n'ont
   * aucune raison d'être à la même heure, et n'ont pas besoin de l'être.
   */
  private armTurnClock(): void {
    const game = this.game
    const seat = game?.turn
    const player = this.lobby.players.find((p) => p.seat === seat)
    const running =
      game !== null &&
      this.lobby.started &&
      game.phase !== 'finished' &&
      player !== undefined &&
      // Un bot joue en `BOT_DELAY` : lui compter dix secondes n'aurait pas de sens.
      !isBotSeat(player)

    // Un même tour ne se recompte pas depuis le début : sans cela, un ami qui
    // arrive, un renommage, n'importe quel remous du salon rendrait dix
    // secondes de plus au joueur en place — et décalerait l'affichage de la
    // sanction que l'hôte, lui, a déjà programmée. La clé porte aussi le rôle :
    // devenir hôte en cours de tour, c'est devoir armer la sanction.
    const key = running ? `${game!.seq}:${seat}:${this.isHost}` : null
    if (key !== null && key === this.turnFor && this.turnEndsAt !== null) return

    if (this.turnTimer) clearTimeout(this.turnTimer)
    this.turnTimer = null
    this.turnEndsAt = null
    this.turnFor = key
    if (!running) return

    this.turnEndsAt = Date.now() + TURN_MS
    if (!this.isHost) return

    // La marge n'a de raison d'être que pour un siège tenu par un autre
    // appareil : c'est le voyage de son coup qu'elle couvre. Sur un siège d'ici,
    // elle ne ferait qu'une seconde et demie de décompte à zéro avant que rien
    // ne se passe.
    const grace = player!.clientId === this.self ? 0 : TURN_GRACE_MS
    const seq = game!.seq
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null
      if (!this.game || this.game.seq !== seq || this.game.turn !== seat) return
      this.skipIdleTurn(seat!)
    }, TURN_MS + grace)
  }

  /**
   * Le temps est écoulé : le tour saute, et rien n'est joué à la place du
   * joueur. Ne pas jouer est toute la peine — mais trois fois de suite, un bot
   * prend la main pour que la table n'attende plus.
   */
  private skipIdleTurn(seat: Seat): void {
    if (!this.game) return
    this.missed.set(seat, (this.missed.get(seat) ?? 0) + 1)
    this.game = forceSkipTurn(this.game, seat)
    this.room?.send('state', this.game)
    this.considerBotTakeover(seat)
    this.onGameChanged()
    this.listeners.onChange()
  }

  /**
   * Le siège d'un joueur parti passe à un bot au bout d'un moment — le temps
   * qu'un rechargement de page ou un tunnel ne coûte rien. Chaque pair arme sa
   * minuterie : celui qui se retrouve hôte à l'échéance est celui qui tranche,
   * y compris quand c'est le départ de l'hôte qui l'a mis là.
   */
  private armBotTakeover(seat: Seat): void {
    const previous = this.awayTimers.get(seat)
    if (previous) clearTimeout(previous)
    this.awayTimers.set(
      seat,
      setTimeout(() => {
        this.awayTimers.delete(seat)
        this.considerBotTakeover(seat, AWAY_TO_BOT_MS)
      }, AWAY_TO_BOT_MS),
    )
  }

  private considerBotTakeover(seat: Seat, awayFor: number | null = null): void {
    // En local, tous les sièges sont sur ce téléphone : personne n'est parti, et
    // un joueur qui prend son temps n'empêche personne d'autre de jouer.
    if (this.mode !== 'online' || !this.isHost || !this.lobby.started) return
    const player = this.lobby.players.find((p) => p.seat === seat)
    if (!player) return
    if (!shouldHandToBot(player, { missed: this.missed.get(seat) ?? 0, awayFor })) return

    player.botFill = true
    this.publishLobby()
    this.listeners.onError({ code: 'seatToBot', name: player.name })
    this.onGameChanged()
    this.listeners.onChange()
  }

  /**
   * Le joueur est de retour, ou reprend la main : le bot lui rend son siège.
   * Appelé par l'hôte, pour lui-même comme pour le pair qui vient de se
   * represénter.
   */
  private reclaim(player: LobbyPlayer): void {
    const away = this.awayTimers.get(player.seat)
    if (away) clearTimeout(away)
    this.awayTimers.delete(player.seat)
    this.missed.set(player.seat, 0)
    if (!player.botFill) return
    player.botFill = false
    this.listeners.onError({ code: 'seatBack', name: player.name })
  }

  /**
   * « Je suis là » : le siège que tient un bot nous revient. L'hôte le fait
   * chez lui ; les autres le demandent en se representant, ce qui est déjà le
   * message que l'hôte attend d'un pair qui arrive.
   */
  takeBack(seat: Seat): void {
    const player = this.lobby.players.find((p) => p.seat === seat)
    if (!player || !this.mine(seat)) return

    if (this.isHost) {
      this.reclaim(player)
      player.connected = true
      this.publishLobby()
      this.onGameChanged()
      this.listeners.onChange()
      return
    }
    this.room?.send('hello', { clientId: this.self, name: player.name })
  }

  /** Rejouer une nouvelle manche avec la même table. */
  restart(): void {
    if (!this.isHost) return
    this.lobby.started = false
    this.game = null
    this.missed.clear()
    // Une nouvelle manche rend son siège à qui est encore là : seuls les absents
    // repartent avec un bot à leur place.
    for (const p of this.lobby.players) if (p.connected) p.botFill = false
    this.publishLobby()
    this.armTurnClock()
    this.listeners.onChange()
  }

  /** Ferme la session. `forget` efface la sauvegarde : c'est un abandon. */
  destroy(forget = false): void {
    if (this.botTimer) clearTimeout(this.botTimer)
    if (this.linkTimer) clearTimeout(this.linkTimer)
    if (this.turnTimer) clearTimeout(this.turnTimer)
    this.awayTimers.forEach((timer) => clearTimeout(timer))
    this.awayTimers.clear()
    this.turnEndsAt = null
    this.turnFor = null
    this.room?.leave()
    this.room = null
    if (forget) {
      clearSave()
      clearInvite()
    }
  }

  /** Coups jouables affichés à l'écran, uniquement si c'est bien notre tour. */
  moves() {
    return this.game && this.myTurn ? legalMoves(this.game) : []
  }

  /**
   * Les cartes du joueur dont c'est le tour, et celles qui sont jouables tout
   * de suite.
   *
   * Celles du joueur courant, et non les siennes : la barre est sous le dé, et
   * le dé appartient à qui joue. Elles ne sont d'ailleurs pas secrètes — elles
   * voyagent dans l'état de la partie, et voir ce que tient l'adversaire fait
   * partie du jeu. Seule la possibilité de les jouer dépend du siège.
   */
  hand(): { cards: PowerId[]; playable: PowerId[] } {
    if (!this.game) return { cards: [], playable: [] }
    return {
      cards: handOf(this.game, this.game.turn),
      playable: this.myTurn ? playablePowers(this.game) : [],
    }
  }

  /** Les chevaux sur lesquels une carte peut se poser. */
  targetsFor(power: PowerId): string[] {
    return this.game && this.myTurn ? powerTargets(this.game, power) : []
  }
}

function seatFor(
  seat: Seat,
  name: string,
  clientId: string,
  kind: 'human' | 'bot',
  peerId: string | null = null,
): LobbyPlayer {
  return { seat, name, clientId, peerId, kind, connected: true, botFill: false }
}
