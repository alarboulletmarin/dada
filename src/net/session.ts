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

import { chooseMove } from '../game/bot.ts'
import { apply, createGame, forceSkipTurn, legalMoves } from '../game/engine.ts'
import { seedFrom } from '../game/rng.ts'
import { variantById } from '../game/variants.ts'
import type { Action, GameError, GameState, Seat } from '../game/types.ts'
import { clientId, joinGameRoom, type Lobby, type LobbyPlayer, type Room } from './room.ts'
import { clearSave, writeSave, type Save } from './save.ts'

const MAX_SEATS = 4
const BOT_DELAY = 700
/**
 * Au-delà, on considère qu'un pair distant déconnecté ne reviendra pas dans
 * un délai raisonnable : mieux vaut passer son tour que figer la partie pour
 * tout le monde.
 */
const DISCONNECT_TIMEOUT = 25000
/**
 * Au-delà, on considère que l'invité ne trouvera personne. Mieux vaut le dire
 * que de le laisser devant un écran qui tourne : la mise en relation aboutit en
 * deux ou trois secondes quand elle aboutit.
 */
const LINK_TIMEOUT = 15000

export type SessionMode = 'local' | 'online'

/** Où en est la mise en relation, pour que l'écran d'attente puisse le dire. */
export type Link = 'searching' | 'linked' | 'lost'

/**
 * Ce que la session a besoin de faire dire à l'écran. Elle transmet un motif,
 * pas une phrase : la couche réseau n'a pas à connaître la langue du joueur.
 */
export type Notice =
  | GameError
  | 'linkFailed'
  | 'linkBlocked'
  | 'hostTaken'

export type SessionListeners = {
  onChange: () => void
  onError: (notice: Notice) => void
}

export class Session {
  readonly mode: SessionMode
  readonly self = clientId()
  lobby: Lobby
  game: GameState | null = null
  link: Link = 'linked'

  private room: Room | null = null
  private listeners: SessionListeners
  private botTimer: ReturnType<typeof setTimeout> | null = null
  private linkTimer: ReturnType<typeof setTimeout> | null = null
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null
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
    if (this.mode !== 'local') return
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
    })
    session.scheduleBot()
    return session
  }

  static online(code: string, name: string, asHost: boolean, listeners: SessionListeners): Session {
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
    session.connect(code, name)
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

  private connect(code: string, name: string): void {
    const room = joinGameRoom(code, (error) => this.reportLinkError(error))
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

    room.on('lobby', (lobby) => {
      // Seul l'hôte fait autorité sur la composition de la table.
      if (this.isHost) return
      this.lobby = lobby
      this.listeners.onChange()
    })

    room.on('state', (state) => {
      if (this.isHost) return
      // Un état plus ancien peut arriver après un changement d'hôte : on l'ignore.
      if (this.game && state.seq < this.game.seq) return
      this.game = state
      this.listeners.onChange()
    })

    room.on('intent', (intent) => {
      if (!this.isHost) return
      const seat = this.seatOfClient(intent.clientId)
      if (seat === null) return
      this.applyAsHost(intent.action, seat)
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
      const player = this.lobby.players.find((p) => p.peerId === peer)
      if (player) {
        player.connected = false
        player.peerId = null
      }
      if (player?.clientId === this.lobby.hostClientId) this.electHost()
      else if (this.isHost) this.publishLobby()
      this.scheduleDisconnectSkip()
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
    this.listeners.onError(/turn/i.test(error) ? 'linkBlocked' : 'linkFailed')
    this.listeners.onChange()
  }

  private welcome(id: string, name: string, peer: string): void {
    const known = this.lobby.players.find((p) => p.clientId === id)
    if (known) {
      known.peerId = peer
      known.connected = true
      known.name = name
    } else if (!this.lobby.started && this.lobby.players.length < MAX_SEATS) {
      this.lobby.players.push(seatFor(this.freeSeat(), name, id, 'human', peer))
    } else {
      // Table pleine ou partie lancée : le pair reste spectateur.
      this.room?.send('lobby', this.lobby, peer)
      if (this.game) this.room?.send('state', this.game, peer)
      return
    }

    this.publishLobby()
    if (this.game) this.room?.send('state', this.game)
    this.scheduleDisconnectSkip()
    this.listeners.onChange()
  }

  /**
   * L'hôte est parti : on en désigne un nouveau de façon déterministe, pour que
   * tous les pairs aboutissent au même résultat sans se concerter. Chacun ayant
   * une copie complète de l'état, la partie reprend sans rien perdre.
   */
  private electHost(): void {
    const candidates = this.lobby.players
      .filter((p) => p.kind === 'human' && p.connected)
      .map((p) => p.clientId)
      .sort()

    const next = candidates[0]
    if (!next) return

    this.lobby.hostClientId = next
    if (next === this.self) {
      this.listeners.onError('hostTaken')
      this.publishLobby()
      if (this.game) this.room?.send('state', this.game)
      this.scheduleBot()
      this.scheduleDisconnectSkip()
    }
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

  /** Ce siège est-il jouable depuis cet appareil ? */
  controls(seat: Seat): boolean {
    const player = this.lobby.players.find((p) => p.seat === seat)
    if (!player || player.kind === 'bot') return false
    return player.clientId === this.self
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

    this.lobby.started = true
    this.game = createGame({
      players: this.lobby.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        kind: p.kind === 'bot' ? 'bot' : p.clientId === this.self ? 'local' : 'remote',
        peerId: p.peerId,
        connected: p.connected,
      })),
      variant: variantById(this.lobby.variantId),
      seed: seedFrom(`${this.lobby.code}:${Date.now()}`),
    })

    this.publishLobby()
    this.room?.send('state', this.game)
    this.listeners.onChange()
    this.scheduleBot()
    this.scheduleDisconnectSkip()
  }

  /** Point d'entrée unique de l'UI pour jouer un coup. */
  dispatch(action: Action): void {
    if (!this.game) return
    const seat = this.game.turn
    if (!this.controls(seat)) {
      this.listeners.onError('notYourTurn')
      return
    }

    if (this.isHost) this.applyAsHost(action, seat)
    else this.room?.send('intent', { clientId: this.self, action })
  }

  private applyAsHost(action: Action, seat: Seat): void {
    if (!this.game) return

    const { state, error } = apply(this.game, action, seat)
    if (error) {
      this.listeners.onError(error)
      return
    }

    this.game = state
    this.room?.send('state', state)
    this.listeners.onChange()
    this.scheduleBot()
    this.scheduleDisconnectSkip()
  }

  /** L'hôte joue pour les sièges tenus par un bot. */
  private scheduleBot(): void {
    if (this.botTimer) clearTimeout(this.botTimer)
    if (!this.isHost || !this.game || this.game.phase === 'finished') return

    const seat = this.game.turn
    const player = this.lobby.players.find((p) => p.seat === seat)
    if (player?.kind !== 'bot') return

    this.botTimer = setTimeout(() => {
      if (!this.game || this.game.turn !== seat) return
      if (this.game.phase === 'rolling') {
        this.applyAsHost({ type: 'roll' }, seat)
        return
      }
      const move = chooseMove(this.game)
      this.applyAsHost(move ? { type: 'move', pawnId: move.pawnId } : { type: 'pass' }, seat)
    }, BOT_DELAY)
  }

  /** L'hôte passe le tour d'un pair distant resté déconnecté trop longtemps. */
  private scheduleDisconnectSkip(): void {
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer)
    if (!this.isHost || !this.game || this.game.phase === 'finished') return

    const seat = this.game.turn
    const player = this.lobby.players.find((p) => p.seat === seat)
    // Ni un bot (déjà couvert par scheduleBot), ni un siège de cet appareil
    // (mode local, ou l'hôte lui-même), ni un pair déjà connecté.
    if (!player || player.kind === 'bot' || player.clientId === this.self || player.connected) return

    this.disconnectTimer = setTimeout(() => {
      if (!this.game || this.game.turn !== seat) return
      const stillGone = this.lobby.players.find((p) => p.seat === seat)
      if (!stillGone || stillGone.connected) return
      this.game = forceSkipTurn(this.game, seat)
      this.room?.send('state', this.game)
      this.listeners.onChange()
      this.scheduleBot()
      this.scheduleDisconnectSkip()
    }, DISCONNECT_TIMEOUT)
  }

  /** Rejouer une nouvelle manche avec la même table. */
  restart(): void {
    if (!this.isHost) return
    this.lobby.started = false
    this.game = null
    this.publishLobby()
    this.listeners.onChange()
  }

  /** Ferme la session. `forget` efface la sauvegarde : c'est un abandon. */
  destroy(forget = false): void {
    if (this.botTimer) clearTimeout(this.botTimer)
    if (this.linkTimer) clearTimeout(this.linkTimer)
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer)
    this.room?.leave()
    this.room = null
    if (forget) clearSave()
  }

  /** Coups jouables affichés à l'écran, uniquement si c'est bien notre tour. */
  moves() {
    return this.game && this.myTurn ? legalMoves(this.game) : []
  }
}

function seatFor(
  seat: Seat,
  name: string,
  clientId: string,
  kind: 'human' | 'bot',
  peerId: string | null = null,
): LobbyPlayer {
  return { seat, name, clientId, peerId, kind, connected: true }
}
