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
import {
  AWAY_TO_BOT_MS,
  isBotSeat,
  shouldHandToBot,
  turnLeft,
  TURN_GRACE_MS,
  TURN_MS,
} from './presence.ts'
import { clientId, joinGameRoom, type ChatMessage, type Lobby, type LobbyPlayer, type Room } from './room.ts'
import { clearInvite, clearSave, writeInvite, writeSave, type Save } from './save.ts'

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
    const known = this.lobby.players.find((p) => p.clientId === id)
    if (known) {
      known.peerId = peer
      known.connected = true
      known.name = name
      // Le siège lui appartient toujours, bot ou pas : il le retrouve intact,
      // qu'il revienne d'un départ ou qu'il reprenne la main après une absence.
      this.reclaim(known)
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
    this.onGameChanged()
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
      variant: variantById(this.lobby.variantId),
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
