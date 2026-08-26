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
import { botTurn, BOT_DELAY, DEFAULT_LEVEL, isBotLevel, type BotLevel } from '../game/bot.ts'
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
  SILENCE_MS,
  TICK_MS,
  turnLeft,
  TURN_GRACE_MS,
  TURN_MS,
} from './presence.ts'
import { canAdmit, welcomeFor } from './admission.ts'
import {
  clientId,
  joinGameRoom,
  type Ack,
  type ChatMessage,
  type Intent,
  type IntentError,
  type Lobby,
  type LobbyPlayer,
  type Room,
  type StateMessage,
} from './room.ts'
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
/**
 * Au-delà, on considère que l'invité ne trouvera personne. Mieux vaut le dire
 * que de le laisser devant un écran qui tourne : la mise en relation aboutit en
 * deux ou trois secondes quand elle aboutit.
 */
const LINK_TIMEOUT = 15000

/**
 * Délai de réémission d'une intention non acquittée.
 *
 * Un coup part une fois, et s'il se perd le joueur ne le sait pas : il voit un
 * dé qui ne bouge pas, retape, et l'hôte compte pendant ce temps un tour sauté.
 * Sept dixièmes de seconde couvrent un aller-retour très large sans doubler le
 * trafic d'une table qui va bien — l'hôte, lui, reconnaît une réémission et ne
 * joue le coup qu'une fois.
 */
const INTENT_RETRY_MS = 700
/** Au-delà, ce n'est plus un creux : le lien est coupé, et il faut le dire. */
const INTENT_GIVE_UP_MS = 5000

/**
 * Intentions dont on garde le verdict, pour répondre à une réémission sans
 * rejouer le coup. Une table de quatre ne joue pas cent coups par seconde :
 * de quoi couvrir les réémissions récentes suffit largement.
 */
const ACK_MEMORY = 64

/**
 * Combien de temps une bulle de réaction reste en l'air.
 *
 * Écrit ici et pas seulement dans l'écran : c'est cette durée qui définit ce
 * que « en vol » veut dire pour le plafond ci-dessous. Le CSS la reçoit depuis
 * le JS (voir `--react-life`), les deux ne peuvent donc pas diverger.
 */
export const REACT_LIFE_MS = 1800
/**
 * Intervalle minimal entre deux réactions du même appareil.
 *
 * Une réaction part d'un seul appui, et un seul appui se répète très vite : sans
 * ce garde-fou, un doigt qui tambourine noie la table sous ses propres bulles.
 * Sept dixièmes de seconde laissent enchaîner deux expressions — on rit puis on
 * applaudit — sans jamais permettre la mitraillette.
 */
export const REACT_MIN_MS = 700
/**
 * Bulles en l'air, au plus, pour un même siège.
 *
 * Le frein d'en face vit chez l'émetteur, et un émetteur peut mentir — ou
 * simplement tourner une version d'avant. Le récepteur ne fait donc pas
 * confiance : au-delà de trois bulles simultanées d'un même siège, la carte du
 * joueur disparaît sous la pile et le reste ne dit plus rien de neuf.
 */
export const REACT_IN_FLIGHT_MAX = 3

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
 *
 * `watching` n'est pas un refus : la table est pleine ou la partie a commencé,
 * il n'y a rien à demander à personne. Sans cette réponse, le pair se
 * representait à chaque publication du salon, et chaque publication en
 * déclenchait une autre — une tempête que quatre allers-retours suffisaient à
 * déclencher.
 */
export type AskStatus = 'unknown' | 'pending' | 'denied' | 'watching'

/** De quoi ouvrir un canal — la vraie implémentation, ou un double de test. */
export type RoomFactory = (code: string, onError?: (message: string) => void) => Room

/**
 * Ce que la session a besoin de faire dire à l'écran. Elle transmet un motif et
 * ses paramètres, pas une phrase : la couche réseau n'a pas à connaître la
 * langue du joueur.
 */
export type NoticeCode =
  | GameError
  | IntentError
  | 'linkFailed'
  | 'linkBlocked'
  | 'linkLost'
  | 'hostTaken'
  | 'seatToBot'
  | 'seatBack'
  | 'teamsNeedFour'

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
  /** Quand ce téléphone a réagi pour la dernière fois. Voir `REACT_MIN_MS`. */
  private lastReactAt = 0
  /**
   * Dates des réactions encore en l'air, par appareil.
   *
   * Par appareil et non par siège : c'est la même chose pour un joueur assis —
   * un `clientId` tient un siège et un seul — mais ça reste défini pour qui
   * n'en a pas, et ça survit à un siège qui change de main en cours de partie.
   */
  private reactsInFlight = new Map<string, number[]>()

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
  /** Depuis quand ce siège ne dit plus rien. La minuterie ci-dessus donne le
   *  coup d'œil rapide ; celle-ci reste vraie quand ce n'est pas son tour. */
  private awaySince = new Map<Seat, number>()
  /** Le battement de l'hôte, et la surveillance du silence chez les invités. */
  private beatTimer: ReturnType<typeof setInterval> | null = null
  /** Côté hôte : dernier message applicatif reçu, par identité d'appareil. */
  private lastSeen = new Map<string, number>()
  /** Côté hôte : aller-retour lissé, par identité d'appareil. */
  private rtt = new Map<string, number>()
  /** Côté invité : dernier message venu de l'hôte en titre. */
  private lastHostAt = 0
  /** Côté invité : par où l'hôte nous parle. Le salon porte bien un `peerId`,
   *  mais c'est l'hôte qui le tient à jour — et il vaut `null` dès qu'il nous a
   *  crus partis, au moment précis où l'on a besoin de le joindre. */
  private hostPeerId: string | null = null
  /** Côté invité : la grâce laissée à l'hôte avant d'en élire un autre. */
  private hostGrace: ReturnType<typeof setTimeout> | null = null
  /** Côté invité : intentions parties, en attente d'accusé de réception. */
  private outbox = new Map<string, ReturnType<typeof setTimeout>>()
  /** Côté hôte : verdicts déjà rendus, pour répondre sans rejouer le coup. */
  private judged = new Map<string, Ack>()
  /** Côté hôte : le dernier état qu'on a fait sauter, par siège, et quand. */
  private skipped = new Map<Seat, { seq: number; at: number }>()
  private nonces = 0
  /** Tentatives de reconnexion : seule la dernière a le droit d'aboutir. */
  private attempts = 0
  /** Partie figée à la demande du joueur. Voir `setPaused`. */
  private frozen = false
  /**
   * Partie suspendue par l'écran, sans le dire. Voir `hold`.
   *
   * Distinct de `frozen` parce que ce n'est pas la même chose : `frozen` est un
   * état du jeu, que la feuille de pause annonce et que le joueur lève ;
   * celui-ci n'est qu'une parenthèse d'affichage, et rien à l'écran ne doit le
   * nommer. `paused` ne le rapporte donc pas.
   */
  private held = false
  /** La session est close : plus rien ne doit se reconnecter derrière. */
  private closed = false
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
      // Seul humain de la table : il n'y a pas de partie à retrouver, seulement
      // des bots qui s'éteindront avec l'onglet. « Revenir dans la partie »
      // aurait promis une salle où personne ne répond.
      const others = this.lobby.players.some((p) => p.kind === 'human' && p.clientId !== this.self)
      const alive = this.game !== null && this.lobby.started && this.game.phase !== 'finished'
      if (alive && others) writeInvite(this.lobby.code)
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
        epoch: 0,
        round: 0,
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
      epoch: 0,
      round: 0,
      variantId: 'petits-chevaux',
      players: asHost ? [seatFor(0, name, self, 'human')] : [],
      started: false,
    }

    const session = new Session('online', lobby, listeners)
    session.myName = name
    session.connect(code, name, join)
    return session
  }

  /**
   * Nouvelle tentative de mise en relation, après un échec.
   *
   * On **attend** la fermeture du salon précédent. Rejoindre le même code avant
   * que Trystero n'ait fini de fermer rendait le même objet, détruit une
   * fraction de seconde plus tard : le bouton « Réessayer » raccrochait au nez
   * de la tentative qu'il venait de lancer.
   */
  retry(): void {
    if (this.mode !== 'online') return
    const previous = this.room
    this.room = null
    this.link = 'searching'
    // Deux réveils coup sur coup — `visibilitychange` puis `online` — ouvraient
    // deux salons de plus, dont un seul était refermé. L'orphelin restait
    // branché, et ses battements rassuraient une session qui ne l'écoutait plus.
    const attempt = ++this.attempts
    // Les coups en attente visent un état d'avant la coupure : les réémettre
    // après coup ne produirait qu'un refus incompréhensible.
    this.dropOutbox()
    this.listeners.onChange()
    void Promise.resolve(previous?.leave()).then(() => {
      if (this.closed || attempt !== this.attempts) return
      this.connect(this.lobby.code, this.myName)
      this.listeners.onChange()
    })
  }

  private dropOutbox(): void {
    this.outbox.forEach((timer) => clearTimeout(timer))
    this.outbox.clear()
  }

  /**
   * Retour au premier plan, ou retour du réseau.
   *
   * Un téléphone en veille gèle ses minuteries et laisse mourir ses liens
   * WebRTC sans prévenir personne. Au réveil on se represente — l'hôte
   * déduplique, c'est sans conséquence s'il nous voyait déjà — et si plus aucun
   * pair n'est joignable alors que la table compte d'autres humains, on refait
   * carrément le canal.
   */
  wakeUp(): void {
    if (this.mode !== 'online' || !this.room) return
    this.room.send('hello', { clientId: this.self, name: this.myName })
    // L'hôte, lui, ne cherche personne : ses amis viennent à lui, et refaire son
    // salon à chaque retour au premier plan couperait la table qui l'attend —
    // y compris quand il joue seul contre des bots, où `peers()` est vide par
    // construction.
    if (this.isHost) return
    const others = this.lobby.players.some((p) => p.kind === 'human' && p.clientId !== this.self)
    if (others && this.room.peers().length === 0) this.retry()
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
    this.lastHostAt = Date.now()

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

    // Un salon qu'on vient de quitter garde ses écouteurs vivants jusqu'à ce que
    // `leave()` aboutisse : sans ce garde, un battement tardu de l'ancien canal
    // venait rassurer une session qui ne l'écoutait plus.
    const current = (): boolean => this.room === room

    room.on('hello', (hello, peer) => {
      if (!current()) return
      this.noteAlive(hello.clientId, peer)
      if (this.isHost) return this.welcome(hello.clientId, hello.name, peer)
      // Un membre de la table qui se represente alors qu'on n'est pas l'arbitre :
      // c'est souvent l'hôte lui-même, revenu d'un rechargement de page et sans
      // aucun souvenir de sa table. Le salon qu'on lui renvoie le renomme
      // arbitre, avec les sièges de tout le monde intacts. On ne le fait que
      // pour qui a déjà un siège : la composition de la table n'a pas à fuiter
      // vers un inconnu que l'hôte n'a pas accepté.
      if (!this.lobby.players.some((p) => p.clientId === hello.clientId)) return
      room.send('lobby', this.tableSeenBy(hello.clientId, peer), peer)
    })

    room.on('join', (verdict) => {
      if (!current() || verdict.clientId !== this.self) return
      this.noteHostAlive()
      this.askStatus = verdict.status
      this.listeners.onChange()
    })

    room.on('lobby', (lobby) => {
      if (!current()) return
      this.onLobby(lobby)
    })

    room.on('state', (message, peer) => {
      if (!current()) return
      // L'arbitre, lui, n'adopte l'état de personne — sauf s'il vient de
      // reprendre la main les mains vides (voir `adoptRelayedState`).
      if (this.isHost) return this.adoptRelayedState(message)
      // **De l'arbitre en titre, et de lui seul.** Une époque inventée ne fait
      // pas un arbitre : n'importe quel pair pouvait sinon imposer un état à
      // toute la table, museler le vrai hôte, et détourner les intentions.
      if (message.from !== this.lobby.hostClientId) return
      if (this.stale(message)) return
      this.noteHostAlive(peer)
      this.game = message.game
      // Le compte à rebours repart à la réception, AVANT le rendu : c'est lui
      // qui dit à l'écran s'il y a un contour à peindre. Chacun compte sur sa
      // propre horloge, sans jamais avoir à la comparer à celle des autres.
      this.onGameChanged()
      this.listeners.onChange()
    })

    // Le battement de l'hôte. C'est lui, et non l'avis du transport, qui dit
    // qui est encore là : Trystero déclare un pair perdu au bout de cinq
    // secondes de silence ICE, puis ne dit plus rien — ni qu'il est revenu, ni
    // qu'il ne l'est pas.
    room.on('tick', (tick, peer) => {
      if (!current()) return
      const arbiter = this.lobby.hostClientId

      // Un arbitre qui n'est pas celui qu'on reconnaît : règne périmé, ou
      // prétendant au même règne. Il ne sait pas qu'il a perdu, et personne ne
      // le lui dira jamais s'il ne reçoit plus les salons du vainqueur. On lui
      // renvoie donc la table qu'on tient pour vraie : c'est ce qui le fait
      // abdiquer proprement, avec la composition et le règne à jour.
      const rival =
        tick.epoch < this.lobby.epoch ||
        (tick.epoch === this.lobby.epoch && tick.from !== arbiter)
      if (arbiter && rival) {
        room.send('lobby', this.tableSeenBy(tick.from, peer), peer)
        return
      }

      if (this.isHost) {
        // Un règne plus récent que le nôtre, et on se croit encore arbitre :
        // on se represente, ce qui vaut demande de la table à jour. L'autre
        // moitié de la réparation est juste au-dessus.
        if (tick.epoch > this.lobby.epoch) {
          room.send('hello', { clientId: this.self, name: this.myName }, peer)
        }
        return
      }
      if (!this.fromArbiter(tick.from, tick.epoch)) return
      this.noteHostAlive(peer)
      room.send('pong', { clientId: this.self, at: tick.at }, peer)

      // L'arbitre annonce un état plus ancien que le nôtre — souvent : il n'en
      // a aucun, parce qu'il vient de reprendre la main après un rechargement
      // de page. On le lui rend. Sans cela il acquittait les coups sans rien
      // appliquer, et la table se figeait sans un message.
      if (this.game && this.lobby.started && tick.seq < this.game.seq) this.sendState(peer)
    })

    room.on('pong', (pong, peer) => {
      if (!current() || !this.isHost) return
      // L'aller-retour se mesure sur la seule horloge de l'hôte : `at` est
      // reparti tel quel, il n'y a aucune horloge à accorder. Plafonné, parce
      // qu'un téléphone qui se réveille renvoie le pong du battement d'avant :
      // sans borne, l'hôte en déduisait deux minutes de latence et n'osait plus
      // faire sauter un seul tour.
      const sample = Math.min(Date.now() - pong.at, SILENCE_MS)
      const previous = this.rtt.get(pong.clientId)
      this.rtt.set(pong.clientId, previous === undefined ? sample : previous * 0.7 + sample * 0.3)
      this.noteAlive(pong.clientId, peer)
    })

    room.on('intent', (intent, peer) => {
      if (!current()) return
      this.noteAlive(intent.clientId, peer)
      if (!this.isHost) return
      // Un coup décidé sous un autre règne visait une autre partie.
      if (intent.epoch !== this.lobby.epoch) return
      this.onIntent(intent, peer)
    })

    room.on('ack', (ack) => {
      if (!current()) return
      const waiting = this.outbox.get(ack.nonce)
      if (!waiting) return
      this.noteHostAlive()
      clearTimeout(waiting)
      this.outbox.delete(ack.nonce)
      // L'erreur s'affiche chez celui qui a joué, et non chez l'arbitre : c'est
      // lui qu'elle concerne, et lui seul qui peut en faire quelque chose.
      if (!ack.ok && ack.error) this.listeners.onError({ code: ack.error })
    })

    room.on('chat', (message, peer) => {
      if (!current()) return
      // Un mot dans le chat prouve la présence, une réaction aussi : la
      // vivacité se note avant tout filtrage, sinon un joueur qui n'a fait que
      // réagir pendant une minute passerait pour parti.
      this.noteAlive(message.clientId, peer)
      if (message.kind === 'reaction') {
        this.deliverReaction(message)
        return
      }
      this.chatLog.push(message)
      this.listeners.onChat(message)
    })

    room.onPeerJoin((peer) => {
      if (!current()) return
      this.link = 'linked'
      if (this.linkTimer) clearTimeout(this.linkTimer)
      this.linkTimer = null

      if (this.isHost) {
        // Le nouveau venu se présentera ; on lui envoie déjà la table.
        room.send('lobby', this.lobby, peer)
        this.sendState(peer)
      } else {
        // Le `hello` d'ouverture se perd s'il part avant qu'un pair soit joignable :
        // on se represente à chaque arrivée, l'hôte déduplique par clientId.
        room.send('hello', { clientId: this.self, name }, peer)
      }
      this.listeners.onChange()
    })

    room.onPeerLeave((peer) => {
      if (!current()) return
      // Une demande dont l'auteur est parti n'a plus d'objet : l'accepter
      // donnerait un siège fantôme, occupé par personne.
      if (this.requests.some((r) => r.peer === peer)) {
        this.requests = this.requests.filter((r) => r.peer !== peer)
        this.listeners.onChange()
      }
      if (this.hostPeerId === peer) this.hostPeerId = null
      const player = this.lobby.players.find((p) => p.peerId === peer)
      // Le transport n'a qu'un avis, et c'est le battement qui tranche — mais un
      // départ franc n'a aucune raison d'attendre huit secondes de silence.
      if (player) this.markAway(player)

      // Perdre le lien de l'hôte ne fait pas de nous l'arbitre : c'est
      // peut-être nous qui sommes isolés. On le laisse revenir (voir
      // `armHostGrace`), et on le dit à l'écran en attendant.
      if (player?.clientId === this.lobby.hostClientId && !this.isHost) {
        this.link = 'lost'
        this.armHostGrace()
      } else if (this.isHost) this.publishLobby()
      this.onGameChanged()
      this.listeners.onChange()
    })

    if (this.beatTimer) clearInterval(this.beatTimer)
    this.beatTimer = setInterval(() => this.beat(), TICK_MS)
    room.send('hello', { clientId: this.self, name })
  }

  // ───────────────────────── battement de cœur ─────────────────────────

  /**
   * Toutes les deux secondes : l'hôte bat la mesure et fait le tour de sa
   * table ; les autres vérifient qu'ils l'entendent encore.
   */
  private beat(): void {
    if (!this.room || this.mode !== 'online') return
    if (this.isHost) {
      this.room.send('tick', {
        from: this.self,
        epoch: this.lobby.epoch,
        seq: this.game?.seq ?? -1,
        at: Date.now(),
      })
      this.sweep()
      return
    }
    if (!this.lobby.hostClientId) return
    if (Date.now() - this.lastHostAt <= SILENCE_MS) return
    // Personne n'est « parti » — c'est bien le problème : le lien est mort sans
    // que rien ne le dise, et le joueur tapait dans le vide en croyant jouer.
    if (this.link !== 'lost') {
      this.link = 'lost'
      this.listeners.onChange()
    }
    this.armHostGrace()
  }

  /** Côté hôte : qui ne s'est plus manifesté depuis assez longtemps ? */
  private sweep(): void {
    const now = Date.now()
    let changed = false
    for (const player of this.lobby.players) {
      if (player.kind === 'bot' || player.clientId === this.self || !player.connected) continue
      if (now - (this.lastSeen.get(player.clientId) ?? 0) <= SILENCE_MS) continue
      this.markAway(player)
      changed = true
    }
    if (!changed) return
    this.publishLobby()
    this.onGameChanged()
    this.listeners.onChange()
  }

  /**
   * Un message est arrivé de cet appareil : il est là.
   *
   * N'importe lequel suffit — un `pong`, une intention, un mot dans le chat.
   * Et si un bot tenait son siège, il le lui rend sur-le-champ : attendre un
   * `hello` en bonne et due forme, c'était laisser le bot jouer un tour de plus
   * pendant que le revenant regardait.
   */
  private noteAlive(id: string, peer?: string): void {
    this.lastSeen.set(id, Date.now())
    if (!this.isHost) return
    const player = this.lobby.players.find((p) => p.clientId === id)
    if (!player) return

    const wasAway = !player.connected || player.botFill
    if (peer) player.peerId = peer
    player.connected = true
    this.reclaim(player)
    if (!wasAway) return
    this.publishLobby()
    this.onGameChanged()
    this.listeners.onChange()
  }

  /** Un message venu de l'hôte en titre : le lien tient, la grâce s'annule. */
  private noteHostAlive(peer?: string): void {
    this.lastHostAt = Date.now()
    if (this.isHost) return
    if (peer) this.hostPeerId = peer
    this.clearHostGrace()
    if (this.linkTimer) clearTimeout(this.linkTimer)
    this.linkTimer = null
    if (this.link === 'linked') return
    this.link = 'linked'
    this.listeners.onChange()
  }

  private markAway(player: LobbyPlayer): void {
    player.connected = false
    player.peerId = null
    if (!this.awaySince.has(player.seat)) this.awaySince.set(player.seat, Date.now())
    // Chaque pair arme la relève, seul celui qui sera hôte à l'échéance
    // l'exécutera : le départ de l'hôte lui-même reste ainsi couvert.
    this.armBotTakeover(player.seat)
  }

  private clearAway(seat: Seat): void {
    const timer = this.awayTimers.get(seat)
    if (timer) clearTimeout(timer)
    this.awayTimers.delete(seat)
    this.awaySince.delete(seat)
  }

  // ───────────────────────── salon reçu, règne comparé ─────────────────────────

  /**
   * Un salon publié par quelqu'un d'autre.
   *
   * C'est ici que se règle le « split brain » : deux appareils coupés l'un de
   * l'autre pouvaient se croire tous les deux arbitres, chacun ignorant les
   * salons de l'autre — et chacun mettant un bot sur le siège de l'autre. Le
   * règne le plus récent l'emporte ; à égalité, le plus petit identifiant, un
   * ordre que les deux calculent à l'identique sans avoir à se parler.
   */
  private onLobby(lobby: Lobby): void {
    if (lobby.epoch < this.lobby.epoch) return
    if (this.isHost) {
      if (lobby.epoch === this.lobby.epoch && lobby.hostClientId >= this.lobby.hostClientId) return
      // On rend l'arbitrage, pas son siège : le clientId reste l'identité.
      this.stopHosting()
      this.adopt(lobby)
      this.noteHostAlive()
      this.room?.send('hello', { clientId: this.self, name: this.myName })
      return
    }

    // Deux prétendants au même règne peuvent être joignables tous les deux : le
    // même départage que ci-dessus, sinon le salon d'un invité changerait de
    // main à chaque message reçu.
    const known = this.lobby.hostClientId
    if (known && lobby.epoch === this.lobby.epoch && lobby.hostClientId > known) return

    const handover = lobby.hostClientId !== known
    const wasClosed = this.lobby.started || this.lobby.players.length >= MAX_SEATS
    const free = lobby.players.length < MAX_SEATS
    this.noteHostAlive()
    this.adopt(lobby)
    // Un nouvel arbitre n'a pas la liste d'attente de l'ancien, et ne sait
    // peut-être rien de nous. On se represente — une fois, au changement, et
    // non à chaque publication : c'était la tempête de `hello` d'avant.
    //
    // Un refusé a une réponse définitive et ne redemande rien : c'est son
    // insistance qui nourrissait la tempête. Un spectateur, non — il n'a jamais
    // été refusé, la table était seulement pleine ou lancée. Quand elle se
    // rouvre, il redemande, une seule fois par réouverture.
    const reopened = this.askStatus === 'watching' && wasClosed && !lobby.started && free
    if (this.askStatus === 'denied') return
    if (handover || reopened) this.room?.send('hello', { clientId: this.self, name: this.myName })
  }

  private adopt(lobby: Lobby): void {
    // Une nouvelle manche a été annoncée : la partie d'avant n'existe plus.
    // Sans cela l'invité gardait son état final, rejetait le premier état de la
    // manche suivante — plus petit — et restait devant son podium.
    if (!lobby.started) this.game = null
    this.lobby = lobby
    if (lobby.players.some((p) => p.clientId === this.self)) this.askStatus = 'unknown'
    // Un siège que le salon montre connecté n'attend plus de relève : sans
    // cela, un invité promu hôte héritait de minuteries fantômes qui mettaient
    // un bot sur des sièges occupés.
    for (const player of lobby.players) if (player.connected) this.clearAway(player.seat)
    // Un bot vient peut-être de prendre le siège dont c'est le tour : il n'y
    // a plus personne à décompter. Le tour en cours, lui, garde son échéance.
    this.armTurnClock()
    this.listeners.onChange()
  }

  /**
   * Ce message vient-il de quelqu'un qui fait autorité ?
   *
   * L'arbitre en titre, ou un règne plus récent — dont le salon est déjà en
   * route, l'hôte publiant toujours la table avant l'état. Sans ce filtre, un
   * second arbitre à égalité d'époque imposait son état à toute la table, et le
   * battement de n'importe quel pair masquait la mort de l'hôte.
   */
  private fromArbiter(from: string, epoch: number): boolean {
    if (epoch > this.lobby.epoch) return true
    return from === this.lobby.hostClientId
  }

  /** Cet état est-il plus vieux que ce qu'on sait déjà ? */
  private stale(message: StateMessage): boolean {
    if (message.epoch !== this.lobby.epoch) return message.epoch < this.lobby.epoch
    // Le numéro d'état repart de zéro à chaque manche : entre deux manches, il
    // ne dit plus rien de l'ancienneté.
    if (message.round !== this.lobby.round) return message.round < this.lobby.round
    return this.game !== null && message.game.seq < this.game.seq
  }

  /**
   * Tout ce qu'un hôte tenait et qu'un invité n'a plus à tenir — **l'état de la
   * partie compris**.
   *
   * Le garder serait ne pas abdiquer : le nouvel arbitre repart d'un numéro
   * plus petit, tous ses états seraient rejetés comme périmés, et l'ex-hôte
   * jouerait des coups datés d'une partie que plus personne ne joue. Le `hello`
   * qui suit l'abdication déclenche la reprise de siège, donc le renvoi de
   * l'état : le trou ne dure qu'un aller-retour.
   */
  private stopHosting(): void {
    this.game = null
    if (this.turnTimer) clearTimeout(this.turnTimer)
    this.turnTimer = null
    if (this.botTimer) clearTimeout(this.botTimer)
    this.botTimer = null
    this.awayTimers.forEach((timer) => clearTimeout(timer))
    this.awayTimers.clear()
    this.awaySince.clear()
    this.missed.clear()
    this.judged.clear()
    this.skipped.clear()
    this.requests = []
  }

  private sendState(to?: string): void {
    if (!this.game) return
    this.room?.send(
      'state',
      { from: this.self, epoch: this.lobby.epoch, round: this.lobby.round, game: this.game },
      to,
    )
  }

  /**
   * Le pair de l'arbitre, avec un repli.
   *
   * Le salon porte un `peerId` par siège, mais c'est l'arbitre qui l'entretient,
   * et il le met à `null` dès qu'il nous a crus partis — exactement l'instant où
   * l'on cherche à le joindre. On garde donc de notre côté le pair d'où viennent
   * ses battements. Sans ce repli, un envoi sans cible partait à la cantonade.
   */
  private hostPeer(): string | undefined {
    const seated = this.lobby.players.find((p) => p.clientId === this.lobby.hostClientId)?.peerId
    return seated ?? this.hostPeerId ?? undefined
  }

  /**
   * La table telle qu'on la connaît, corrigée de ce qu'on vient d'apprendre.
   *
   * Notre copie est une photo, et elle peut dater : celle où ce joueur était
   * parti et où un bot tenait son siège. La lui renvoyer telle quelle, à la
   * seconde où il se manifeste, c'est lui annoncer qu'il a été remplacé — et
   * chez un hôte qui revient d'un rechargement de page, c'est le premier
   * message qu'il lit.
   */
  private tableSeenBy(id: string, peer: string): Lobby {
    return {
      ...this.lobby,
      players: this.lobby.players.map((p) =>
        p.clientId === id ? { ...p, connected: true, botFill: false, peerId: peer } : p,
      ),
    }
  }

  /**
   * L'arbitre adopte l'état qu'un joueur lui rend.
   *
   * Un seul cas, et il est étroit : on vient de reprendre la couronne les mains
   * vides — rechargement de page, salon relayé par un invité — alors que la
   * partie est lancée. Sans cela on acquittait les coups sans rien appliquer, et
   * la table se figeait sans le moindre message. Hors de ce cas, l'arbitre
   * n'adopte l'état de personne : c'est lui qui le fabrique.
   */
  private adoptRelayedState(message: StateMessage): void {
    if (this.game !== null || !this.lobby.started) return
    if (message.epoch !== this.lobby.epoch || message.round !== this.lobby.round) return
    // Et seulement d'un joueur de la table : un état venu de nulle part n'a pas
    // à devenir la partie de tout le monde.
    if (!this.lobby.players.some((p) => p.clientId === message.from)) return

    this.game = message.game
    // Rediffusé aussitôt : à partir de maintenant, c'est la référence.
    this.sendState()
    this.onGameChanged()
    this.listeners.onChange()
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
    // Trystero signale une tentative ratée, pas une panne générale : en pleine
    // partie, ou avec des pairs déjà au bout du fil, c'est une paire parmi
    // d'autres qui n'a pas abouti. L'annoncer faisait clignoter « la connexion
    // a échoué » chez l'hôte d'une table qui tournait très bien.
    if (this.lobby.started || (this.room?.peers().length ?? 0) > 0) return
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
      // Se represénter est un geste explicite : la série de tours sautés repart
      // de zéro, ce qu'un simple message de présence ne fait pas.
      this.missed.set(known.seat, 0)
      this.reclaim(known)
      this.publishLobby()
      this.sendState()
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

    // Refusé, table pleine ou partie lancée : le pair regarde. On le lui dit —
    // sans réponse, il se representait à chaque publication du salon, et chaque
    // publication en déclenchait une autre. On lui envoie aussi la table, faute
    // de quoi il resterait devant un écran d'attente sans savoir pourquoi.
    const status = verdict.kind === 'refused' ? 'denied' : 'watching'
    this.room?.send('join', { clientId: id, status }, peer)
    this.room?.send('lobby', this.lobby, peer)
    this.sendState(peer)
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
    this.lastSeen.set(id, Date.now())
    this.publishLobby()
    this.sendState()
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
   * La grâce laissée à l'hôte avant d'en désigner un autre.
   *
   * Sans elle, un invité qui perdait son seul lien vers l'hôte s'élisait
   * aussitôt : la table se retrouvait avec deux arbitres qui s'ignoraient, et
   * chacun mettait un bot sur le siège de l'autre. C'est exactement le symptôme
   * rapporté par une vraie table. La même durée que la relève par un bot : ce
   * sont les deux faces d'une seule question — « est-il vraiment parti ? »
   */
  private armHostGrace(): void {
    if (this.mode !== 'online' || this.isHost || this.hostGrace) return
    this.hostGrace = setTimeout(() => {
      this.hostGrace = null
      this.electHost()
    }, AWAY_TO_BOT_MS)
  }

  private clearHostGrace(): void {
    if (this.hostGrace) clearTimeout(this.hostGrace)
    this.hostGrace = null
  }

  /**
   * L'hôte n'est pas revenu : on en désigne un nouveau de façon déterministe,
   * pour que tous les pairs aboutissent au même résultat sans se concerter.
   * Chacun ayant une copie complète de l'état, la partie reprend sans rien
   * perdre — et le nouveau règne porte un numéro, pour que l'ancien hôte sache
   * s'effacer s'il réapparaît.
   */
  private electHost(): void {
    const gone = this.lobby.hostClientId
    if (gone === this.self) return
    const candidates = this.lobby.players
      .filter((p) => p.kind === 'human' && p.clientId !== gone && p.connected && !p.botFill)
      .map((p) => p.clientId)
      .sort()

    // Le même ordre pour tout le monde : ce n'est pas à nous d'être élu.
    if (candidates[0] !== this.self) return

    // Et surtout : celui qui ne voit plus la moitié de la table n'est pas
    // l'arbitre, c'est lui qui est isolé. S'élire dans ce cas, c'est fabriquer
    // le second hôte qui mettra des bots sur les sièges des autres.
    const others = this.lobby.players.filter(
      (p) => p.kind === 'human' && p.clientId !== gone && p.clientId !== this.self,
    )
    if (others.filter((p) => p.connected).length * 2 < others.length) return

    this.lobby.hostClientId = this.self
    this.lobby.epoch += 1
    // On n'a jamais reçu un mot des autres invités : ils ne parlaient qu'à
    // l'ancien arbitre. Sans cette mise à l'heure, le premier tour de table les
    // déclarait tous absents — et un « Lancer » dans cette fenêtre mettait un
    // bot sur chaque siège.
    const now = Date.now()
    for (const p of this.lobby.players) if (p.connected) this.lastSeen.set(p.clientId, now)

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

    this.link = 'linked'
    this.listeners.onError({ code: 'hostTaken' })
    this.publishLobby()
    this.sendState()
    this.onGameChanged()
    this.listeners.onChange()
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
   * Les joueurs que l'hôte n'entend plus. Vide chez les autres : eux ne savent
   * pas qui l'hôte entend, et l'inventer donnerait deux écrans qui se
   * contredisent au même moment.
   */
  get silentNames(): string[] {
    if (!this.isHost) return []
    return this.lobby.players
      .filter((p) => p.kind === 'human' && p.clientId !== this.self && !p.connected)
      .map((p) => p.name)
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

  /**
   * La partie peut-elle se mettre en pause ?
   *
   * Sur un seul téléphone seulement. Une partie en ligne n'appartient à
   * personne en particulier : figer les bots et la pendule chez soi ne
   * figerait rien chez les autres, et le siège mis en pause finirait sauté
   * par l'hôte au bout de son temps de réflexion. Contre des bots, en
   * revanche, il n'y a personne à faire attendre — la partie entière tient
   * sur cet appareil, et elle a le droit de s'arrêter le temps d'un métro.
   */
  get canPause(): boolean {
    return (
      this.mode === 'local' &&
      this.lobby.started &&
      this.game !== null &&
      this.game.phase !== 'finished'
    )
  }

  /** La partie est-elle figée ? C'est ce que la feuille de pause annonce. */
  get paused(): boolean {
    return this.frozen
  }

  /** Rien ne doit avancer : mis en pause par le joueur, ou suspendu par l'écran. */
  private get stopped(): boolean {
    return this.frozen || this.held
  }

  /**
   * Fige la partie, ou la relance.
   *
   * **Tout s'arrête** : le bot qui allait jouer, la pendule du tour, et les
   * coups eux-mêmes (voir `dispatch`). Une pause qui laisserait le bot avancer
   * ne serait pas une pause, et une pendule qui continuerait de tourner
   * derrière la feuille sanctionnerait le joueur d'avoir posé son téléphone.
   *
   * À la reprise, le tour repart d'une pendule pleine : mémoriser le reste
   * exact pour rendre trois secondes au lieu de dix ferait de la pause une
   * punition.
   */
  setPaused(on: boolean): void {
    if (on && !this.canPause) return
    if (this.frozen === on) return
    this.frozen = on

    if (on) {
      if (this.botTimer) clearTimeout(this.botTimer)
      this.botTimer = null
      if (this.turnTimer) clearTimeout(this.turnTimer)
      this.turnTimer = null
      this.turnEndsAt = null
      this.turnFor = null
    } else {
      this.onGameChanged()
    }
    this.listeners.onChange()
  }

  /**
   * Suspendre la partie le temps d'une feuille d'explication, sans l'annoncer.
   *
   * **Sur un seul téléphone seulement**, et pour la même raison que la pause :
   * figer les bots et la pendule chez soi ne figerait rien chez les autres, et
   * le siège suspendu finirait sauté par l'hôte au bout de son temps de
   * réflexion. En ligne, l'écran attend plutôt que le tour ne soit plus le
   * nôtre pour ouvrir sa feuille (voir `flushGuide` côté `app.ts`).
   *
   * Ce n'est pas une pause : rien ne l'annonce, `paused` reste faux, la feuille
   * de pause ne s'ouvre pas. C'est une parenthèse de quelques secondes pendant
   * laquelle le jeu ne doit ni jouer à notre place ni nous compter le temps
   * qu'on passe à lire ce qu'il vient de nous expliquer.
   *
   * À la reprise, le tour repart d'une pendule pleine — comme après une pause :
   * rendre trois secondes au lieu de dix ferait payer l'explication.
   */
  hold(on: boolean): void {
    if (on && !this.canPause) return
    if (this.held === on) return
    this.held = on

    if (on) {
      if (this.botTimer) clearTimeout(this.botTimer)
      this.botTimer = null
      if (this.turnTimer) clearTimeout(this.turnTimer)
      this.turnTimer = null
      this.turnEndsAt = null
      this.turnFor = null
    } else {
      this.onGameChanged()
    }
    this.listeners.onChange()
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

  /**
   * Le niveau d'un bot, siège par siège.
   *
   * Réservé à l'hôte, comme les autres réglages de table : c'est chez lui que
   * les bots jouent, et deux appareils qui régleraient chacun le leur ne
   * seraient d'accord sur rien.
   *
   * Un siège humain n'a pas de niveau, même quand un bot le tient en l'absence
   * de son joueur : ce bot-là n'a rien choisi, il dépanne, et il joue au niveau
   * du jeu (voir `scheduleBot`).
   */
  setBotLevel(seat: Seat, level: BotLevel): void {
    if (!this.isHost || this.lobby.started) return
    const player = this.lobby.players.find((p) => p.seat === seat)
    if (!player || player.kind !== 'bot') return
    player.level = level
    this.publishLobby()
    this.listeners.onChange()
  }

  /**
   * Le niveau auquel ce siège joue.
   *
   * Le repli n'est pas de la timidité : un pair resté sur une version d'avant
   * renvoie un salon sans ce champ, et `adopt` écrase le nôtre en bloc.
   */
  botLevel(seat: Seat): BotLevel {
    const level = this.lobby.players.find((p) => p.seat === seat)?.level
    return isBotLevel(level) ? level : DEFAULT_LEVEL
  }

  rename(seat: Seat, name: string): void {
    const player = this.lobby.players.find((p) => p.seat === seat)
    if (!player) return
    if (!this.isHost && player.clientId !== this.self) return
    player.name = name
    this.publishLobby()
    this.listeners.onChange()
  }

  /**
   * Relance le portrait d'un siège.
   *
   * Mêmes droits que le renommage : son occupant, ou l'hôte. Un nouveau tirage
   * et non le suivant d'une liste — il n'y a pas de liste, le jeu de visages est
   * une combinatoire, et « le suivant » ne voudrait rien dire.
   *
   * Comme un renommage, ça repasse par le salon publié : le portrait change
   * chez tout le monde en même temps, sinon la table verrait quatre visages
   * différents pour la même personne.
   */
  reface(seat: Seat): void {
    const player = this.lobby.players.find((p) => p.seat === seat)
    if (!player) return
    if (!this.isHost && player.clientId !== this.self) return
    player.face = drawFace()
    this.publishLobby()
    this.listeners.onChange()
  }

  /**
   * `label` vient de l'appelant : la couche réseau ne connaît pas la langue du
   * joueur, et un « Bot 2 » en dur dans un salon français ou anglais aurait été
   * la seule chaîne du jeu à ne pas être traduite. Un repli existe pour les
   * tests, qui n'ont pas de dictionnaire sous la main.
   */
  addSeat(kind: 'human' | 'bot', label?: string): void {
    if (!this.isHost || this.lobby.started || this.lobby.players.length >= MAX_SEATS) return
    const seat = this.freeSeat()
    const name = label ?? (kind === 'bot' ? `Bot ${seat + 1}` : `Joueur ${seat + 1}`)
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

  /**
   * Deux joueurs échangent leur place à table.
   *
   * C'est le seul geste qui compose les équipes, et ce n'est pas un détour :
   * l'équipe EST la parité du siège (`teamOf`), parce que les coéquipiers sont
   * les deux coins opposés du plateau. Un champ « équipe » posé à côté du
   * siège aurait laissé deux camps assis côte à côte, et le plateau n'aurait
   * plus rien dit de qui joue avec qui.
   *
   * Ce qui bouge, c'est la place — le nom, le portrait et l'appareil qui tient
   * le siège suivent la personne. `hostSeat` se déduit du `clientId` : l'hôte
   * peut donc se déplacer comme les autres, sans qu'on ait à le recoller.
   *
   * Réservé à l'hôte, comme la variante et les sièges : à quatre doigts sur
   * quatre téléphones, deux échanges simultanés se seraient écrasés l'un
   * l'autre, et personne n'aurait su quelle table était la vraie.
   */
  swapSeats(a: Seat, b: Seat): void {
    if (!this.isHost || this.lobby.started || a === b) return
    const one = this.lobby.players.find((p) => p.seat === a)
    const two = this.lobby.players.find((p) => p.seat === b)
    // Une place vide n'est pas un siège : l'échanger déplacerait un joueur sans
    // que rien ne le remplace, ce qui n'est plus un échange mais un
    // déménagement — un geste que le salon ne propose pas.
    if (!one || !two) return
    one.seat = b
    two.seat = a
    this.publishLobby()
    this.listeners.onChange()
  }

  start(): void {
    if (!this.isHost || this.lobby.players.length < 2) return
    // Une table en équipes se joue à quatre, ou ne se joue pas : `createGame`
    // LÈVE sur une table incomplète, et une exception qui remonte jusqu'à
    // l'écran, c'est une partie qui disparaît sans un mot. Le salon grise déjà
    // le bouton — mais un bouton n'est qu'un bouton, et il y a plus de chemins
    // vers `start()` que d'endroits où l'on peut en griser un.
    if (tableVariant(this.lobby).teams === true && this.lobby.players.length !== 4) {
      // Et on le dit : un bouton qui ne fait rien est un bouton cassé. Le salon
      // grise déjà le sien, donc personne ne devrait passer ici — mais si un
      // autre chemin y mène, le silence serait la pire des réponses.
      this.listeners.onError({ code: 'teamsNeedFour' })
      return
    }

    this.frozen = false
    this.held = false
    this.missed.clear()
    this.skipped.clear()
    this.lobby.started = true
    // Un siège que personne ne tient au moment du lancement est un siège
    // confié : sans cela la table perdait dix secondes de pendule à chaque tour
    // d'un absent, et personne n'avait décidé de le remplacer.
    for (const p of this.lobby.players) if (p.kind === 'human' && !p.connected) p.botFill = true
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
    this.sendState()
    this.onGameChanged()
    this.listeners.onChange()
  }

  /** Point d'entrée unique de l'UI pour jouer un coup. */
  dispatch(action: Action): void {
    if (!this.game || this.stopped) return
    const seat = this.game.turn
    if (!this.controls(seat)) {
      this.listeners.onError({ code: 'notYourTurn' })
      return
    }

    if (this.isHost) {
      const error = this.applyAsHost(action, seat)
      if (error) this.listeners.onError({ code: error })
      return
    }
    // Envoyer dans le vide n'est pas jouer. Sans ce refus, le joueur coupé de
    // l'hôte tapait le dé, ne voyait rien bouger, recommençait — et l'hôte
    // comptait pendant ce temps des tours sautés à son crédit.
    if (this.link === 'lost') {
      this.listeners.onError({ code: 'linkLost' })
      return
    }
    this.sendIntent(action)
  }

  /**
   * Une intention part, et repart jusqu'à ce que l'hôte en accuse réception.
   *
   * Elle porte le numéro de l'état sur lequel le joueur a décidé — l'hôte
   * reconnaît ainsi un coup parti à temps mais arrivé tard — et un jeton unique,
   * qui rend la réémission sans danger.
   */
  private sendIntent(action: Action): void {
    const nonce = `${this.self}:${++this.nonces}`
    const intent: Intent = {
      clientId: this.self,
      epoch: this.lobby.epoch,
      action,
      seq: this.game?.seq ?? -1,
      nonce,
    }
    const giveUpAt = Date.now() + INTENT_GIVE_UP_MS

    // Adressée à l'arbitre, et **jamais** à la cantonade : une intention réémise
    // cinq fois vers trois pairs, c'est quinze messages pour un coup — et un
    // second arbitre qui traînerait l'appliquerait aussi. Sans cible connue on
    // n'envoie rien : le coup repartira au prochain essai, ou l'abandon dira
    // franchement que le lien est coupé.
    const send = (): void => {
      const to = this.hostPeer()
      if (to !== undefined) this.room?.send('intent', intent, to)
    }

    const again = (): void => {
      if (Date.now() >= giveUpAt) {
        this.outbox.delete(nonce)
        this.listeners.onError({ code: 'linkLost' })
        return
      }
      send()
      this.outbox.set(nonce, setTimeout(again, INTENT_RETRY_MS))
    }

    send()
    this.outbox.set(nonce, setTimeout(again, INTENT_RETRY_MS))
  }

  /** L'hôte reçoit une intention : il tranche une fois, et répond à l'émetteur. */
  private onIntent(intent: Intent, peer: string): void {
    const seat = this.seatOfClient(intent.clientId)
    if (seat === null) return

    // Une intention réémise ne se rejoue pas : on redit ce qu'on avait répondu.
    // Sans cela, un accusé perdu faisait jouer le coup une seconde fois.
    const already = this.judged.get(intent.nonce)
    if (already) return this.room?.send('ack', already, peer)

    const answer = this.judge(intent, seat)
    this.judged.set(intent.nonce, answer)
    if (this.judged.size > ACK_MEMORY) {
      const oldest = this.judged.keys().next().value
      if (oldest !== undefined) this.judged.delete(oldest)
    }
    this.room?.send('ack', answer, peer)
  }

  private judge(intent: Intent, seat: Seat): Ack {
    // Le coup était bon, il est arrivé après le couperet. **Jouer tard prouve
    // la présence**, et c'est tout ce qu'on demande à ce joueur : la série de
    // tours sautés repart de zéro. L'ancien code lui répondait « ce n'est pas
    // votre tour » — chez l'hôte, en plus — et lui collait un bot au troisième.
    //
    // Le pardon dure ce que dure un aller-retour, et pas plus : il couvre un
    // coup qui était déjà en vol quand le couperet est tombé. Sans cette
    // limite, un joueur systématiquement en retard n'a jamais laissé sa place,
    // et la table payait onze secondes par tour pour toujours.
    const late = this.skipped.get(seat)
    if (late?.seq === intent.seq && Date.now() - late.at <= this.graceFor(intent.clientId)) {
      this.missed.set(seat, 0)
      return { nonce: intent.nonce, ok: false, error: 'tooLate' }
    }
    const error = this.applyAsHost(intent.action, seat)
    return error ? { nonce: intent.nonce, ok: false, error } : { nonce: intent.nonce, ok: true }
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

  /**
   * Réagir : un emoji, un appui, et rien à composer.
   *
   * Elle emprunte le canal du chat plutôt qu'un canal à elle. Ce n'est pas une
   * économie de code : une réaction *est* un message d'un seul emoji, elle a le
   * même auteur, la même horodate, le même relais — chacun diffuse à tous, sans
   * passer par l'arbitre — et la même trace dans l'historique. Deux canaux
   * auraient donné deux ordres d'arrivée possibles pour deux choses que l'écran
   * range dans la même conversation.
   *
   * Rend `false` quand le frein a mangé l'appui : l'écran s'en sert pour ne pas
   * refermer l'éventail sur un envoi qui n'a pas eu lieu.
   */
  sendReaction(emoji: string): boolean {
    const trimmed = emoji.trim()
    if (!trimmed || !this.room) return false

    const now = Date.now()
    if (now - this.lastReactAt < REACT_MIN_MS) return false
    this.lastReactAt = now

    const name = this.lobby.players.find((p) => p.clientId === this.self)?.name ?? this.myName
    const message: ChatMessage = { clientId: this.self, name, text: trimmed, at: now, kind: 'reaction' }
    // Trystero ne renvoie pas l'émetteur à lui-même : on se sert son propre
    // message, et par le même guichet que celui des autres — le plafond doit
    // valoir pour tout le monde, y compris pour soi.
    this.room.send('chat', message)
    this.deliverReaction(message)
    return true
  }

  /**
   * Le guichet unique des réactions : celles qui arrivent du réseau et la
   * sienne passent par ici, et le plafond de bulles en vol s'applique aux deux.
   *
   * Une réaction refusée ne laisse aucune trace — ni bulle, ni ligne dans
   * l'historique. C'est du bruit : l'archiver reviendrait à le déplacer.
   */
  private deliverReaction(message: ChatMessage): boolean {
    const now = Date.now()
    const seen = (this.reactsInFlight.get(message.clientId) ?? []).filter((at) => now - at < REACT_LIFE_MS)
    if (seen.length >= REACT_IN_FLIGHT_MAX) {
      this.reactsInFlight.set(message.clientId, seen)
      return false
    }
    seen.push(now)
    this.reactsInFlight.set(message.clientId, seen)
    this.chatLog.push(message)
    this.listeners.onChat(message)
    return true
  }

  /**
   * L'arbitre applique un coup. Il rend le refus plutôt que de l'afficher :
   * l'erreur d'un coup distant concerne celui qui l'a joué, et elle s'affichait
   * chez l'hôte — qui n'y pouvait rien et ne comprenait pas d'où elle sortait.
   */
  private applyAsHost(action: Action, seat: Seat): IntentError | null {
    // Arbitre sans partie : cela n'arrive qu'un instant, le temps qu'un joueur
    // nous rende l'état. Répondre « c'est fait » serait le pire des mensonges —
    // c'est ce qui figeait la table sans un message d'erreur.
    if (!this.game) return 'noGame'

    const { state, error } = apply(this.game, action, seat)
    if (error) return error

    // Jouer, c'est être là : la série de tours sautés repart de zéro.
    this.missed.set(seat, 0)
    this.skipped.delete(seat)
    this.game = state
    this.sendState()
    this.onGameChanged()
    this.listeners.onChange()
    return null
  }

  /** L'hôte joue pour les sièges tenus par un bot. */
  private scheduleBot(): void {
    if (this.botTimer) clearTimeout(this.botTimer)
    if (this.stopped) return
    if (!this.isHost || !this.game || this.game.phase === 'finished') return

    const seat = this.game.turn
    const player = this.lobby.players.find((p) => p.seat === seat)
    // Un bot à demeure, ou un bot qui tient le siège d'un absent : même arbitre.
    if (!player || !isBotSeat(player)) return

    // Un bot de dépannage joue au niveau du jeu : le siège appartient à
    // quelqu'un qui n'a rien choisi, et lui coller le niveau d'un autre siège
    // serait décider à sa place de la difficulté de sa propre partie.
    const level = player.kind === 'bot' ? this.botLevel(seat) : DEFAULT_LEVEL

    this.botTimer = setTimeout(() => {
      if (!this.game || this.game.turn !== seat) return
      // Une carte d'abord, s'il en a une qui vaut le coup : la jouer ne consomme
      // pas le tour, et `applyAsHost` rappellera `scheduleBot` pour la suite.
      this.applyAsHost(botTurn(this.game, level), seat)
    }, BOT_DELAY[level])
  }

  /** Tout ce qui suit un changement d'état : à qui de jouer, et jusqu'à quand. */
  private onGameChanged(): void {
    this.checkTurnHolder()
    this.scheduleBot()
    this.armTurnClock()
  }

  /**
   * Le tour arrive sur un siège que personne ne tient plus.
   *
   * C'est le seul moment où l'absence coûte quelque chose à la table : tant que
   * ce n'est pas son tour, un joueur parti ne gêne personne, et lui retirer son
   * siège pendant qu'un autre joue, c'est le remplacer pour rien.
   */
  private checkTurnHolder(): void {
    if (!this.isHost || !this.game) return
    const since = this.awaySince.get(this.game.turn)
    if (since === undefined) return
    this.considerBotTakeover(this.game.turn, Date.now() - since)
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
      !this.stopped &&
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
    const grace = player!.clientId === this.self ? 0 : this.graceFor(player!.clientId)
    const seq = game!.seq
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null
      if (!this.game || this.game.seq !== seq || this.game.turn !== seat) return
      this.skipIdleTurn(seat!)
    }, TURN_MS + grace)
  }

  /**
   * La marge que l'hôte s'accorde avant de trancher, pour ce joueur-là.
   *
   * Une seconde et demie fixe supposait un réseau qui ne l'est pas : sur un
   * relais TURN en 4G, l'aller de l'état plus le retour de l'intention passent
   * les deux secondes, et le coup joué à temps arrivait après le couperet. La
   * marge suit donc l'aller-retour mesuré, sans jamais descendre sous l'ancien
   * plancher.
   */
  private graceFor(id: string): number {
    // Bornée des deux côtés : un réseau lent mérite qu'on l'attende, pas qu'on
    // suspende la partie. Au-delà de trois fois le plancher, ce n'est plus une
    // marge, c'est un tour qui ne saute jamais.
    return Math.min(3 * TURN_GRACE_MS, Math.max(TURN_GRACE_MS, 2 * (this.rtt.get(id) ?? 0)))
  }

  /**
   * Le temps est écoulé : le tour saute, et rien n'est joué à la place du
   * joueur. Ne pas jouer est toute la peine — mais trois fois de suite, un bot
   * prend la main pour que la table n'attende plus.
   */
  private skipIdleTurn(seat: Seat): void {
    if (!this.game) return
    this.missed.set(seat, (this.missed.get(seat) ?? 0) + 1)
    // On retient l'état qu'on vient de sauter, et l'heure : un coup joué pour
    // CET état-là, s'il arrive dans la foulée, prouve que le joueur était bien
    // devant son écran.
    this.skipped.set(seat, { seq: this.game.seq, at: Date.now() })
    this.game = forceSkipTurn(this.game, seat)
    this.sendState()
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
    // Une absence ne se paie qu'à son tour ; trois tours sautés, en revanche,
    // sont déjà la réponse à la question et n'attendent rien.
    if (awayFor !== null && this.game?.turn !== seat) return
    if (!shouldHandToBot(player, { missed: this.missed.get(seat) ?? 0, awayFor })) return

    player.botFill = true
    this.publishLobby()
    // Pas à l'intéressé : son écran le lui dit à la deuxième personne, avec le
    // bouton qui reprend le siège (voir `seatToTakeBack`). Un « un bot prend la
    // place de Camille » chez Camille se lisait comme la nouvelle d'à côté.
    if (!this.mine(seat)) this.listeners.onError({ code: 'seatToBot', name: player.name })
    this.onGameChanged()
    this.listeners.onChange()
  }

  /**
   * Le joueur est de retour, ou reprend la main : le bot lui rend son siège.
   * Appelé par l'hôte, pour lui-même comme pour le pair qui vient de se
   * represénter.
   */
  private reclaim(player: LobbyPlayer): void {
    this.clearAway(player.seat)
    if (!player.botFill) return
    player.botFill = false
    this.missed.set(player.seat, 0)
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
      this.missed.set(seat, 0)
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
    this.frozen = false
    this.held = false
    this.lobby.started = false
    // Le numéro de manche est ce qui dit aux invités que le prochain état, qui
    // repart de zéro, n'est pas un vieil état en retard.
    this.lobby.round += 1
    this.game = null
    this.missed.clear()
    this.skipped.clear()
    this.judged.clear()
    // Une nouvelle manche rend son siège à qui est encore là : seuls les absents
    // repartent avec un bot à leur place.
    for (const p of this.lobby.players) if (p.connected) p.botFill = false
    this.publishLobby()
    this.armTurnClock()
    this.listeners.onChange()
  }

  /** Ferme la session. `forget` efface la sauvegarde : c'est un abandon. */
  destroy(forget = false): void {
    this.closed = true
    if (this.botTimer) clearTimeout(this.botTimer)
    if (this.linkTimer) clearTimeout(this.linkTimer)
    if (this.turnTimer) clearTimeout(this.turnTimer)
    this.linkTimer = null
    if (this.beatTimer) clearInterval(this.beatTimer)
    this.beatTimer = null
    this.skipped.clear()
    this.hostPeerId = null
    this.clearHostGrace()
    this.outbox.forEach((timer) => clearTimeout(timer))
    this.outbox.clear()
    this.awayTimers.forEach((timer) => clearTimeout(timer))
    this.awayTimers.clear()
    this.awaySince.clear()
    this.turnEndsAt = null
    this.turnFor = null
    void this.room?.leave()
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

  /** Les sièges que cet appareil tient, dans l'ordre du plateau. */
  get mySeats(): Seat[] {
    return this.lobby.players.filter((p) => this.controls(p.seat)).map((p) => p.seat)
  }

  /**
   * Le siège dont on montre la main sous le dé, ou null s'il n'y en a pas.
   *
   * Le siège courant **quand on le tient** — c'est le cas du téléphone qu'on se
   * passe, où les quatre mains sont à tour de rôle celle du joueur devant
   * l'écran. Sinon le sien : en ligne, on garde ses cartes sous les yeux pendant
   * le tour des autres, sans jamais voir les leurs.
   */
  get handSeat(): Seat | null {
    if (!this.game) return null
    const mine = this.mySeats
    if (mine.includes(this.game.turn)) return this.game.turn
    return mine[0] ?? null
  }

  /**
   * Ses propres cartes, et celles qui sont jouables tout de suite.
   *
   * **Les siennes, et jamais celles des autres.** Elles voyagent bien dans
   * l'état de la partie — un jeu pair-à-pair sans serveur n'a pas d'endroit où
   * les cacher — mais les afficher était un aveu : on lisait la main de
   * l'adversaire au moment où il prenait la main, et un bouclier annoncé n'est
   * plus un bouclier. L'écran ne montre donc que ce qu'on a le droit de savoir ;
   * de la main des autres, il ne dit que le nombre (voir `handSize`).
   */
  hand(): { seat: Seat | null; cards: PowerId[]; playable: PowerId[] } {
    const seat = this.handSeat
    if (!this.game || seat === null) return { seat: null, cards: [], playable: [] }
    return {
      seat,
      cards: handOf(this.game, seat),
      playable: this.myTurn && seat === this.game.turn ? playablePowers(this.game) : [],
    }
  }

  /** Combien de cartes ce siège garde devant lui — le nombre, pas lesquelles. */
  handSize(seat: Seat): number {
    return this.game ? handOf(this.game, seat).length : 0
  }

  /** Tours que ce siège doit encore sauter — un malus qui dure. */
  skipsOwed(seat: Seat): number {
    return this.game?.skips?.[seat] ?? 0
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
  return { seat, name, clientId, peerId, kind, connected: true, botFill: false, face: drawFace() }
}

/**
 * Un visage au hasard, pour un siège qui vient d'être créé.
 *
 * `Math.random()` alors que tout le reste du jeu tire ses nombres d'une graine
 * (voir `rng.ts`) : c'est délibéré, et ça ne contredit rien. La règle vaut pour
 * l'état de la PARTIE, qui doit se rejouer à l'identique depuis sa graine ; un
 * portrait n'entre dans aucune décision de règle, ne se rejoue jamais, et sa
 * valeur n'a pas besoin d'être recalculable — elle est tirée une fois par
 * l'appareil qui crée le siège, puis transmise avec le salon comme un nom.
 *
 * Un entier court : il voyage en JSON à chaque publication du salon, et seize
 * bits suffisent largement à ne jamais retomber deux fois de suite sur le même
 * visage.
 */
function drawFace(): number {
  return Math.floor(Math.random() * 0x10000)
}
