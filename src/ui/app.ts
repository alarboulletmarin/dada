/**
 * Écrans et interactions. Toute décision de règle appartient au moteur ;
 * ce fichier ne fait qu'afficher un état et transmettre des intentions.
 *
 * Le parcours suit la maquette : accueil → choix du jeu → salon → partie,
 * avec un détour possible par « rejoindre » et par les règles.
 */

import { BOARD_SHAPES, geometryFor, isBoardShape, type BoardShape } from '../game/board.ts'
import { mercyOf, pawnsOf, statsOf } from '../game/engine.ts'
import {
  bonusCount,
  DECK_SIZE,
  HAND_LIMIT,
  POWERS,
  POWER_LIST,
  type Power,
  type PowerId,
  type PowerKind,
} from '../game/powers.ts'
import { STABLE, type GameState, type Move, type Seat, type SeatStats, type Variant } from '../game/types.ts'
import { VARIANTS } from '../game/variants.ts'
import { makeCode, type ChatMessage } from '../net/room.ts'
import { clearInvite, clearSave, readInvite, readSave } from '../net/save.ts'
import { Session, type Notice, type NoticeCode } from '../net/session.ts'
import { aboutLabel, renderAbout } from './about.ts'
import { armedReady, keepArmed, needsPawn, type Armed } from './aim.ts'
import { BoardView, SEAT_MARKS } from './board-view.ts'
import { fill, h, setKeepAwake } from './dom.ts'
import { icon, type IconName } from './icons.ts'
import { lang, LANG_LABEL, nextLang, setLang, since, t, type Key } from './i18n.ts'
import { renderRulebook } from './rulebook.ts'
import { swipeAway } from './swipe.ts'
import { applyTheme, nextTheme, readTheme, THEME_ICON } from './theme.ts'

const NAME_KEY = 'dada.name'
/** Temps laissé au dé pour retomber avant qu'un coup évident ne se joue seul. */
const AUTO_MS = 800
/**
 * Le même délai, mais quand une carte jouable attend en main.
 *
 * Un coup sans choix se joue tout seul — c'est la promesse, et elle vaut aussi
 * avec des cartes en main : sans cela, ramasser un bonus condamnait la partie
 * entière à confirmer d'un doigt chaque tour à coup unique, et le jeu
 * s'arrêtait de couler. Mais une carte **est** un choix, et le rejeu qu'on
 * garde justement pour un dé mort n'a aucune raison de partir avec le tour. On
 * ne supprime donc pas l'automatisme : on lui laisse le temps qu'il faut pour
 * qu'un doigt arrive avant lui. Toucher une carte annule le coup programmé.
 *
 * Trois secondes deux, et non deux : le cas qui compte est « rien à jouer, mais
 * un rejeu en main ». Il faut lire la ligne, comprendre qu'on peut relancer, et
 * atteindre la carte — et la main se perd si l'on n'y arrive pas.
 */
const AUTO_HOLD_MS = 3200
/**
 * Longueur du code de partie. Voir `makeCode` dans `room.ts` : c'est une mesure
 * de sécurité avant d'être un réglage de confort.
 */
const CODE_LENGTH = 8
/**
 * En dessous, le bouton « Rejoindre » reste éteint.
 *
 * Cinq et non huit : un ami dont la PWA sert encore une version d'avant
 * l'allongement produit des codes de cinq caractères, et il doit rester
 * joignable. Un code trop court ne trouvera simplement aucun salon — ce n'est
 * pas au champ de saisie de le décréter.
 */
const MIN_CODE_LENGTH = 5
const PIPS: Record<number, number[]> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
}

/**
 * La vignette d'une forme de plateau : le contour du circuit, en un tracé.
 *
 * Un nom seul ne dit rien — « serpent » peut vouloir dire n'importe quoi. Le
 * dessin, lui, montre exactement ce qu'on obtient, et tient dans un bouton.
 */
function shapeGlyph(shape: BoardShape): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('stroke-linecap', 'round')

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', SHAPE_PATHS[shape])
  svg.append(path)
  return svg
}

/** Les quatre contours, sur une grille de 24. */
const SHAPE_PATHS: Record<BoardShape, string> = {
  croix: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z',
  carre: 'M3.5 3.5h17v17h-17Z',
  rond: 'M12 3.2a8.8 8.8 0 1 0 0 17.6 8.8 8.8 0 0 0 0-17.6Z',
  // Un cercle qui ondule : quatre bosses lues d'un coup, là où le plateau en
  // porte huit. Une vignette n'a pas à être une maquette, elle a à être lisible.
  serpent:
    'M12 3.2c2 2 5.6.4 7 1.8s-.2 5 1.8 7c-2 2-.4 5.6-1.8 7s-5-.2-7 1.8c-2-2-5.6-.4-7-1.8s.2-5-1.8-7c2-2 .4-5.6 1.8-7s5 .2 7-1.8Z',
}

/**
 * Un « coup » factice servant à faire cercler un cheval par le plateau pendant
 * qu'on désigne la cible d'une carte.
 *
 * `BoardView` ne connaît que des coups : lui apprendre un second mode de
 * sélection reviendrait à dupliquer tout ce qu'il fait déjà — cercler, rendre
 * cliquable au doigt et au clavier, annoncer au lecteur d'écran. Un coup qui
 * ne va nulle part suffit.
 */
function aimMove(state: GameState, pawnId: string): Move {
  const steps = state.pawns.find((p) => p.id === pawnId)?.steps ?? 0
  return { pawnId, from: steps, to: steps, captures: [], shielded: [], finishes: false, exits: false }
}

/** Pastille de chaque variante : de la présentation, pas des règles. */
const BADGES: Record<string, 'die' | 'pawn' | 'bolt'> = {
  'petits-chevaux': 'die',
  ludo: 'pawn',
  rapide: 'bolt',
}

/**
 * La figure de chaque pouvoir.
 *
 * Dans un paquet, une carte se reconnaît à son dessin bien avant qu'on ait lu
 * son nom : c'est ce qui distingue un jeu de cartes d'une liste de courses.
 */
const POWER_ICON: Record<PowerId, IconName> = {
  bouclier: 'shield',
  galop: 'gallop',
  rejeu: 'replay',
  des: 'loaded',
  fauxpas: 'stumble',
  saute: 'skip',
  ecurie: 'stable',
}

/** Les réactions du chat : une poignée d'expressions, pas une bibliothèque
 *  entière. Un appui envoie — c'est tout l'intérêt d'une réaction : on ne
 *  compose pas un message avec, on répond du tac au tac pendant son tour. */
const EMOJI = ['😀', '😂', '😍', '😮', '😢', '😡', '👍', '👎', '🙌', '🎉', '🔥', '❤️', '🐴', '🎲', '⭐', '💀']
/**
 * Combien de temps une nouvelle reste à l'écran, selon ce qu'elle annonce.
 *
 * Trois secondes quatre pour tout le monde, c'était le temps de la lire et pas
 * celui de la comprendre — et un malus qu'on n'a pas eu le temps de lire se
 * lit comme un bug le tour suivant, quand son effet se manifeste. Ce qui fait
 * mal reste donc plus longtemps que ce qui fait plaisir, et ce qui ne dit
 * qu'un fait (« une carte a été gardée ») repart le premier.
 */
const NOTE_MS: Record<PowerKind | 'neutral', number> = {
  malus: 6500,
  bonus: 5200,
  neutral: 4200,
}
/**
 * Nouvelles affichées en même temps, au plus.
 *
 * Elles s'empilaient à une, chacune chassant la précédente : un tour de bot qui
 * joue une carte, lance, avance et mange produisait quatre nouvelles dont on ne
 * lisait aucune. Trois tiennent en haut d'un écran de téléphone ; au-delà, la
 * plus ancienne s'en va — c'est celle qu'on a déjà eu le temps de lire.
 */
const NOTE_STACK = 3
/** Durée d'affichage de la bulle sur la carte du joueur. */
const CHAT_BUBBLE_MS = 4000
/** Au-delà, la bulle coupe : `-webkit-line-clamp` s'en charge visuellement,
 *  ceci n'est qu'un filet contre un pavé de texte collé sans espaces. */
const CHAT_BUBBLE_MAX = 200
/** Deux messages du même auteur à moins d'une minute d'écart forment un bloc :
 *  un seul nom, des bulles serrées. Au-delà, la conversation a repris. */
const CHAT_GROUP_MS = 60_000

/** Sous ce reste de temps de réflexion, le contour vire au rouge et les
 *  secondes s'affichent : jusque-là, la minuterie reste une affaire de coin
 *  de l'œil. */
const URGENT_LEFT = 0.3

/**
 * Chaque motif rapporté par la session a sa phrase. Sans cette table, un refus
 * du moteur s'afficherait tel quel — « notYourTurn » en travers de l'écran.
 */
const NOTICE_KEY: Record<NoticeCode, Key> = {
  finished: 'error.finished',
  notYourTurn: 'error.notYourTurn',
  alreadyRolled: 'error.alreadyRolled',
  rollFirst: 'error.rollFirst',
  illegal: 'error.illegal',
  nothingToPass: 'error.nothingToPass',
  noSuchPower: 'error.noSuchPower',
  powerNotNow: 'error.powerNotNow',
  moveExists: 'error.moveExists',
  linkFailed: 'link.failed',
  linkBlocked: 'link.blocked',
  linkLost: 'notice.linkLost',
  tooLate: 'notice.tooLate',
  noGame: 'notice.noGame',
  hostTaken: 'notice.hostTaken',
  seatToBot: 'notice.seatToBot',
  seatBack: 'notice.seatBack',
}

/** Contient au moins un pictogramme et rien d'autre : une réaction, pas une
 *  phrase. Ces messages-là s'affichent en grand et sans cartouche — un pouce
 *  levé perdu dans une bulle de 13 px ne se lit pas de l'autre bout de la
 *  table. Chiffres et lettres disqualifient (`\p{N}` couvre « 1️⃣ », tant pis :
 *  se tromper vers la petite taille est sans conséquence). */
function emojiOnly(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || [...trimmed].length > 8) return false
  return /\p{Extended_Pictographic}/u.test(trimmed) && !/[\p{L}\p{N}]/u.test(trimmed)
}

const variantName = (id: string) => t(`variant.${id}.name` as Key)

/**
 * « de Sami », mais « d'Ines » : l'élision, sinon la phrase accroche. L'anglais
 * n'en a pas besoin — sa tournure possessive est portée par la traduction.
 */
const turnOf = (name: string): string =>
  t('play.turnOf', {
    name:
      lang() === 'fr'
        ? /^[aeiouyàâäéèêëîïôöûüh]/i.test(name)
          ? `d’${name}`
          : `de ${name}`
        : name,
  })

type Screen = 'home' | 'pick' | 'join' | 'lobby' | 'play' | 'rules' | 'rulebook' | 'about'

/**
 * Les écrans qui se consultent *pendant* une partie sans y toucher : le
 * règlement, les mentions. Ils ne montrent aucun état de jeu, donc rien ne
 * justifie de les redessiner quand cet état change — et tout justifie de ne pas
 * les fermer sous les yeux de qui les lit.
 */
const DETOURS = new Set<Screen | null>(['rules', 'rulebook', 'about'])

export class App {
  private session: Session | null = null
  private board: BoardView | null = null
  private screen: Screen | null = null
  private mounts: {
    players: HTMLElement[]
    turn: HTMLElement
    /** La ligne entière, qui porte aussi le bouton de la main. */
    turnLine: HTMLElement
    dieBtn: HTMLButtonElement
    die: HTMLElement
    diceRow: HTMLElement
    boostLowBtn: HTMLButtonElement
    boostHighBtn: HTMLButtonElement
    boostCounts: HTMLElement[]
    hand: HTMLElement
    pauseBtn: HTMLButtonElement | null
    /** Ce que le réseau a à dire, entre la barre du haut et le plateau. */
    linkBar: HTMLElement
  } | null = null
  private name = localStorage.getItem(NAME_KEY) ?? ''
  /** Ce qu'on fera de la variante choisie sur l'écran « on joue à quoi ? ». */
  private picking: 'online' | 'local' | 'change' = 'online'
  private variantId = VARIANTS[0]!.id
  /** Dernier événement du journal déjà annoncé — voir `announce`. */
  private announced = -1
  /**
   * La carte armée : choisie, posée devant soi, pas encore jouée.
   *
   * **Choisir n'est pas jouer.** La carte attend son cheval s'il en faut un
   * (`pawnId`), puis attend le dé : c'est le lancer qui la valide. Rien ne part
   * tant que le joueur n'a pas touché le dé — un bonus qui se déclencherait au
   * moment où on le regarde n'est pas un bonus, c'est un tirage au sort.
   */
  private armed: Armed | null = null
  /** Dernier résultat de dé connu : le dé du bas garde toujours une face visible. */
  private lastDie: number | null = null
  /** Valeur déjà affichée, pour repérer le lancer qui vient d'arriver. */
  private shownDice: number | null = null
  private tumbling = false
  /** Coup évident déjà programmé, repéré par le numéro d'état du moteur. */
  private autoAt = -1
  private autoTimer: ReturnType<typeof setTimeout> | null = null
  /** Le tiroir de la main, tant qu'il est ouvert. */
  private handTray: { overlay: HTMLElement; body: HTMLElement; foot: HTMLElement } | null = null
  /** Le panneau de chat est ouvert : les messages qui arrivent s'y affichent
   *  directement plutôt que de compter dans le badge du bouton. */
  private chatOpen = false
  private chatUnread = 0
  private chatList: HTMLElement | null = null
  private chatDot: HTMLElement | null = null
  /** Bulles actives par siège, avec leur minuterie d'effacement. */
  private chatBubbles = new Map<Seat, { text: string; timer: ReturnType<typeof setTimeout> }>()
  /** Le contour qui se vide sur la carte du joueur dont c'est le tour. */
  private turnRing: HTMLElement | null = null
  /** Les secondes qui restent, affichées à la toute fin du décompte. */
  private turnClock: HTMLElement | null = null
  private clockFrame: number | null = null
  /** La feuille de pause, tant qu'elle est à l'écran. */
  private pauseSheet: HTMLElement | null = null
  /** Un bot tenait déjà notre siège à la passe précédente : sans ce souvenir,
   *  la nouvelle se redirait à chaque changement d'état. */
  private botHeldMySeat = false

  constructor(private root: HTMLElement) {}

  start(): void {
    // Ouvrir le lien d'un ami alors que le jeu tourne déjà ne recharge pas la
    // page : sans cela, on resterait sur l'écran précédent sans rien comprendre.
    // `replaceState` (utilisé à la création et en quittant) ne déclenche pas
    // l'événement, donc seul un vrai clic sur un lien passe ici.
    addEventListener('hashchange', () => {
      const code = location.hash.replace('#', '').toUpperCase()
      if (!code || code === this.session?.lobby.code) return
      // Le même démontage que « Quitter », moins le retour à l'accueil : sans
      // lui, les calques, la feuille de pause et l'écran maintenu allumé
      // restaient là, posés sur la partie suivante.
      this.teardown()
      this.enterCode(code)
    })

    // Un téléphone qui se rendort gèle ses minuteries et laisse mourir ses
    // liens WebRTC sans prévenir personne. Au retour, on se represente.
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.session?.wakeUp()
    })
    addEventListener('online', () => {
      this.session?.wakeUp()
      if (this.screen === 'play') this.update()
    })
    // Le bandeau de lien doit pouvoir le dire tout de suite. Seulement en
    // partie : ailleurs, un rafraîchissement fermerait l'écran qu'on lisait.
    addEventListener('offline', () => {
      if (this.screen === 'play') this.update()
    })

    const code = location.hash.replace('#', '').toUpperCase()
    if (code) this.enterCode(code)
    else this.renderHome()
  }

  /**
   * Un code arrivé par un lien.
   *
   * Si c'est la partie qu'on vient de quitter, on y retourne directement : le
   * siège est encore le nôtre, le prénom aussi, et redemander « Rejoindre »
   * n'aurait servi qu'à faire retaper ce qu'on savait déjà.
   */
  private enterCode(code: string): void {
    if (code === readInvite()?.code) return this.openOnline(code, false)
    this.renderJoin(code)
  }

  // ─────────────────────────── session ───────────────────────────

  private listeners() {
    return {
      onChange: () => this.update(),
      onError: (notice: Notice) => this.notify(NOTICE_KEY[notice.code], { name: notice.name ?? '' }),
      onChat: (message: ChatMessage) => this.onChat(message),
    }
  }

  /**
   * Le prénom est retenu à la frappe, et non au moment de continuer : changer
   * de thème, de langue, ou aller lire les mentions redessine l'accueil, et la
   * saisie repartait de l'ancien nom sous les doigts de qui venait de le taper.
   *
   * Aucun repli ici : « Joueur » est le nom d'un joueur qui n'a rien tapé, pas
   * celui d'un joueur en train d'effacer. Le repli se pose à l'ouverture d'une
   * partie, où il a un sens.
   */
  private saveName(value: string): void {
    this.name = value.trim()
    localStorage.setItem(NAME_KEY, this.name)
  }

  private resumeSaved(): void {
    const save = readSave()
    if (!save) return this.renderHome()
    this.session = Session.resume(save, this.listeners())
    this.update()
  }

  private openLocal(): void {
    this.session = Session.local(this.name || 'Joueur 1', this.listeners())
    this.session.setVariant(this.variantId)
    this.session.addSeat('bot', t('common.bot', { n: 2 }))
    this.update()
  }

  private openOnline(code: string, asHost: boolean): void {
    // Pour tout le monde, et pas seulement pour l'hôte : un invité qui
    // rechargeait sa page perdait le code de la table où il était assis.
    history.replaceState(null, '', `#${code}`)
    this.session = Session.online(code, this.name || 'Joueur', asHost, this.listeners())
    if (asHost) this.session.setVariant(this.variantId)
    this.update()
  }

  /**
   * Tout ce qu'une partie laisse derrière elle : calques, minuteries, feuille
   * de pause, écran maintenu allumé. Factorisé parce qu'on en sort par deux
   * portes — « Quitter », et le lien d'un ami ouvert en pleine partie — et que
   * la seconde n'en balayait que la moitié.
   */
  private teardown(): void {
    if (this.autoTimer) clearTimeout(this.autoTimer)
    this.autoTimer = null
    this.autoAt = -1
    document.querySelector('.cardnotes')?.remove()
    document.querySelector('.overlay.podium')?.remove()
    this.closeHandTray()
    this.closePause()
    this.armed = null
    // Avant de fermer quoi que ce soit : plus d'écran de jeu, donc plus rien à
    // y reposer.
    this.screen = null
    this.closeChat()
    this.chatUnread = 0
    this.chatBubbles.forEach((b) => clearTimeout(b.timer))
    this.chatBubbles.clear()
    this.stopClock()
    this.session?.destroy()
    this.session = null
    this.board = null
    this.mounts = null
    this.screen = null
    this.lastDie = null
    this.botHeldMySeat = false
    setKeepAwake(false)
  }

  private quit(): void {
    this.teardown()
    history.replaceState(null, '', location.pathname)
    this.renderHome()
  }

  private update(): void {
    const session = this.session
    if (!session) return this.renderHome()

    // Un détour par les règles n'arrête pas la partie : les bots jouent, les
    // pairs jouent, et chacun de leurs coups passe par ici. Sans ce garde-fou,
    // l'écran des règles se faisait remplacer par le plateau à la première
    // nouvelle venue — c'est-à-dire aussitôt ouvert, quand ce n'était pas notre
    // tour. Ce qu'on a manqué se rattrape en une passe au retour (`backToGame`).
    if (DETOURS.has(this.screen)) return

    // Le spectateur suit la partie — c'est ce que la carte « vous regardez »
    // lui promet, et l'hôte lui envoie déjà l'état. Sans siège il n'a ni main
    // ni tour : le plateau se rend tout seul en lecture seule, et le bandeau
    // rappelle où il en est. Une demande en attente ou refusée, en revanche,
    // n'a rien à regarder : le salon, lui, sait dire pourquoi (voir `askCard`).
    const seated = session.joinStatus === 'unknown' || session.joinStatus === 'watching'
    if (session.game && session.lobby.started && seated) {
      if (this.screen !== 'play') this.renderPlay()
      this.refreshPlay(session.game)
    } else {
      this.renderLobby()
    }
  }

  // ─────────────────────────── fragments partagés ───────────────────────────

  /** Fond et couleur de texte d'un siège, à poser sur n'importe quel bloc coloré. */
  private seatVars(seat: Seat): Partial<CSSStyleDeclaration> {
    return { '--seat': `var(--seat-${seat})`, '--on': `var(--on-${seat})` } as Partial<CSSStyleDeclaration>
  }

  private token(seat: Seat | null, extra = ''): HTMLElement {
    return h('span', {
      class: `token${extra ? ` ${extra}` : ''}`,
      text: seat === null ? '' : SEAT_MARKS[seat],
      style: seat === null ? {} : this.seatVars(seat),
    })
  }

  /** Une face de dé : les points d'un vrai dé, disposés sur une grille 3×3. */
  private face(value: number | null, className = 'face'): HTMLElement {
    const el = h('div', { class: className })
    for (const i of PIPS[value ?? 0] ?? []) {
      el.append(
        h('b', { style: { gridRow: String(Math.ceil(i / 3)), gridColumn: String(((i - 1) % 3) + 1) } }),
      )
    }
    return el
  }

  /**
   * Le code de partie. Seul, il ressemble à une décoration : on lui met un
   * label et une icône pour qu'on comprenne ce que c'est et qu'on peut le
   * toucher pour envoyer le lien.
   */
  private codePill(code: string): HTMLElement {
    return h(
      'button',
      {
        class: 'pill',
        attrs: {
          'aria-label': t('lobby.code.aria', { code: code.split('').join(' ') }),
          title: t('lobby.code.copy'),
        },
        on: { click: () => void this.share(code) },
      },
      h('small', { text: t('lobby.code.pill') }),
      code,
      icon('copy', 18),
    )
  }

  /**
   * Une question à laquelle on répond avant que le geste ne soit fait.
   *
   * Quitter une partie est irréversible pour la table : un doigt qui frôle la
   * flèche de retour ne doit pas en décider. La feuille reprend celle du podium,
   * pour qu'on reconnaisse la boîte plutôt que d'avoir à la lire.
   */
  private ask(opts: { title: string; body: string; confirm: string; onConfirm: () => void }): void {
    if (document.querySelector('.overlay.ask')) return

    const close = (): void => {
      removeEventListener('keydown', onKey)
      overlay.remove()
    }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') close()
    }

    const cancel = h('button', { class: 'btn', text: t('common.cancel'), on: { click: () => close() } })
    const overlay = h(
      'div',
      {
        class: 'overlay ask',
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },
        on: {
          click: (ev) => {
            if (ev.target === overlay) close()
          },
        },
      },
      h(
        'div',
        { class: 'sheet ask__sheet' },
        h(
          'div',
          { class: 'card' },
          h('h2', { style: { textAlign: 'center' }, text: opts.title }),
          h('p', { class: 'hint center', text: opts.body }),
        ),
        h('button', {
          class: 'btn red',
          text: opts.confirm,
          on: {
            click: () => {
              close()
              opts.onConfirm()
            },
          },
        }),
        cancel,
      ),
    )
    addEventListener('keydown', onKey)
    document.body.append(overlay)
    // Le doigt part vers « Annuler » : c'est aussi ce que doit faire un Entrée
    // réflexe, et c'est la réponse sans conséquence des deux.
    cancel.focus()
  }

  /** Le retour d'un écran de jeu : on demande, sauf quand il n'y a rien à perdre. */
  private askQuit(): void {
    const session = this.session
    if (!session) return this.quit()
    // Sans siège — en attente, refusé, spectateur — il n'y a rien à quitter et
    // personne à prévenir : la question serait une porte de plus à pousser.
    if (session.joinStatus !== 'unknown') return this.quit()

    const playing = session.lobby.started && session.game !== null && session.game.phase !== 'finished'
    const others = session.lobby.players.filter((p) => p.clientId !== session.self).length
    // Un salon qu'on est seul à occuper, une partie déjà finie : personne n'est
    // laissé en plan, et rien n'attend derrière la question.
    if (!playing && others === 0) return this.quit()

    this.ask({
      title: t('quit.title'),
      body: !playing ? t('quit.lobby') : session.mode === 'online' ? t('quit.online') : t('quit.local'),
      confirm: t('quit.confirm'),
      onConfirm: () => this.quit(),
    })
  }

  /**
   * Le retour d'un détour vers la partie.
   *
   * `this.screen = null` d'abord : `update` refuse de dessiner par-dessus un
   * écran de détour (voir `DETOURS`), et sans cet oubli le retour ne ramènerait
   * nulle part.
   */
  private backToGame(): void {
    this.screen = null
    this.update()
  }

  private backButton(onClick: () => void, label = t('common.back')): HTMLElement {
    return h(
      'button',
      { class: 'icon-btn', attrs: { 'aria-label': label }, on: { click: onClick } },
      icon('back'),
    )
  }

  // ─────────────────────────── 01 · accueil ───────────────────────────

  private renderHome(): void {
    this.screen = 'home'
    const nameInput = h('input', {
      value: this.name,
      attrs: {
        placeholder: t('home.name.placeholder'),
        maxlength: '16',
        'aria-label': t('home.name.placeholder'),
      },
      on: { input: () => this.saveName(nameInput.value) },
    })

    const go = (mode: 'online' | 'local') => {
      this.saveName(nameInput.value)
      this.picking = mode
      this.renderPick()
    }

    fill(
      this.root,
      h(
        'div',
        { class: 'screen' },
        h(
          'div',
          { class: 'logo' },
          ...['D', 'A', 'D', 'A'].map((c) => h('span', { text: c })),
        ),
        h('p', { class: 'tagline', text: t('app.tagline') }),
        // Le dé crème porte la marque de l'application : un 4, une pastille par
        // siège. C'est l'icône installée sur l'écran d'accueil, posée ici parmi
        // les dés — la même image des deux côtés du lancement.
        h('div', { class: 'dice-pair' }, this.face(4), this.face(6)),
        h('div', { class: 'field' }, h('span', { class: 'label', text: t('home.name') }), nameInput),
        h(
          'div',
          { class: 'stack push' },
          ...this.inviteCard(),
          ...this.resumeCard(),
          h('button', { class: 'btn red', text: t('home.create'), on: { click: () => go('online') } }),
          h('button', {
            class: 'btn blue',
            text: t('home.join'),
            on: {
              click: () => {
                this.saveName(nameInput.value)
                this.renderJoin('')
              },
            },
          }),
          h('button', { class: 'btn', text: t('home.local'), on: { click: () => go('local') } }),
        ),
        h('button', {
          class: 'btn small',
          text: t('home.rules'),
          on: { click: () => this.renderRules(() => this.renderHome()) },
        }),
        h(
          'div',
          { class: 'settings' },
          h(
            'button',
            {
              attrs: { 'aria-label': t('theme.change', { theme: t(`theme.${readTheme()}`) }) },
              on: {
                click: () => {
                  applyTheme(nextTheme())
                  this.renderHome()
                },
              },
            },
            icon(THEME_ICON[readTheme()], 19),
            t(`theme.${readTheme()}`),
          ),
          h(
            'button',
            {
              attrs: { 'aria-label': t('lang.change', { lang: LANG_LABEL[lang()] }) },
              on: {
                click: () => {
                  setLang(nextLang())
                  this.renderHome()
                },
              },
            },
            icon('globe', 19),
            LANG_LABEL[lang()],
          ),
          // Confidentialité, conditions, mentions, licences et lien vers la
          // source — ce dernier est ce que l'AGPL demande à l'app d'offrir.
          h(
            'button',
            {
              attrs: { 'aria-label': aboutLabel() },
              on: {
                click: () => {
                  this.screen = 'about'
                  renderAbout(this.root, () => this.renderHome())
                },
              },
            },
            icon('info', 19),
            aboutLabel(),
          ),
        ),
        h('p', {
          class: 'hint center',
          html: t('home.footer'),
        }),
      ),
    )
  }

  /**
   * Une partie laissée en plan se reprend d'un geste. Rien à afficher s'il n'y
   * en a pas : l'accueil ne doit pas parler d'une partie qui n'existe plus.
   */
  private resumeCard(): HTMLElement[] {
    const save = readSave()
    if (!save) return []

    const players = save.lobby.players.length

    return [
      h(
        'div',
        { class: 'resume' },
        h('button', {
          class: 'btn green',
          text: t('save.resume'),
          on: { click: () => this.resumeSaved() },
        }),
        h(
          'div',
          { class: 'resume-foot' },
          h('span', {
            class: 'hint',
            text: t('save.detail', {
              variant: variantName(save.lobby.variantId),
              players,
              when: since(save.at),
            }),
          }),
          h('button', {
            class: 'link',
            text: t('common.forget'),
            attrs: { 'aria-label': t('save.forget.label') },
            on: {
              click: () => {
                clearSave()
                this.renderHome()
              },
            },
          }),
        ),
      ),
    ]
  }

  /**
   * On a quitté une partie en ligne : le siège y est toujours, tenu par un bot.
   * Le code seul suffit à y retourner — c'est tout ce qu'on avait besoin de
   * garder, et cela n'a de sens que le temps que la partie dure.
   */
  private inviteCard(): HTMLElement[] {
    const invite = readInvite()
    if (!invite) return []

    return [
      h(
        'div',
        { class: 'resume' },
        h('button', {
          class: 'btn blue',
          text: t('invite.resume'),
          on: { click: () => this.openOnline(invite.code, false) },
        }),
        h(
          'div',
          { class: 'resume-foot' },
          h('span', {
            class: 'hint',
            text: t('invite.detail', { code: invite.code, when: since(invite.at) }),
          }),
          h('button', {
            class: 'link',
            text: t('common.forget'),
            attrs: { 'aria-label': t('invite.forget.label') },
            on: {
              click: () => {
                clearInvite()
                this.renderHome()
              },
            },
          }),
        ),
      ),
    ]
  }

  // ─────────────────────────── 02 · choisir le jeu ───────────────────────────

  private renderPick(): void {
    this.screen = 'pick'
    const back = () => (this.picking === 'change' ? this.renderLobby() : this.renderHome())

    const cards = h(
      'div',
      { class: 'stack' },
      ...VARIANTS.map((v) =>
        h(
          'button',
          {
            class: 'game-card',
            attrs: { 'aria-pressed': String(v.id === this.variantId) },
            on: {
              click: () => {
                this.variantId = v.id
                this.renderPick()
              },
            },
          },
          this.variantBadge(v),
          h(
            'div',
            { class: 'body' },
            h(
              'div',
              { class: 'head' },
              h('strong', { text: variantName(v.id) }),
              h('span', { class: 'tag', text: t(`variant.${v.id}.tag` as Key) }),
            ),
            h('p', { class: 'desc', text: t(`variant.${v.id}.desc` as Key) }),
            h('span', { class: 'desc', text: t(`variant.${v.id}.meta` as Key) }),
          ),
        ),
      ),
    )

    const confirm = () => {
      if (this.picking === 'change') {
        this.session?.setVariant(this.variantId)
        this.renderLobby()
      } else if (this.picking === 'local') {
        this.openLocal()
      } else {
        this.openOnline(makeCode(CODE_LENGTH), true)
      }
    }

    fill(
      this.root,
      h(
        'div',
        { class: 'screen' },
        h('div', { class: 'topbar' }, this.backButton(back), h('h2', { text: t('pick.title') })),
        cards,
        h('p', { class: 'hint center', text: t('pick.hint') }),
        h('button', { class: 'btn red push', text: t('common.continue'), on: { click: confirm } }),
      ),
    )
  }

  // ─────────────────────────── 04 · rejoindre ───────────────────────────

  private renderJoin(prefill: string): void {
    this.screen = 'join'
    let value = prefill.slice(0, CODE_LENGTH).toUpperCase()

    const boxes = h('div', { class: 'code-boxes' })
    const input = h('input', {
      value,
      attrs: {
        maxlength: String(CODE_LENGTH),
        autocapitalize: 'characters',
        autocomplete: 'off',
        spellcheck: 'false',
        'aria-label': t('join.code.label'),
        inputmode: 'text',
      },
    })
    const submit = h('button', { class: 'btn blue', text: t('join.action') })
    // Sans ce champ, tous ceux qui arrivaient par un lien partagé s'asseyaient
    // sous le nom « Joueur » : l'accueil, où le prénom se tape, avait été sauté.
    const nameInput = h('input', {
      value: this.name,
      attrs: {
        placeholder: t('home.name.placeholder'),
        maxlength: '16',
        'aria-label': t('home.name.placeholder'),
      },
      on: { input: () => this.saveName(nameInput.value) },
    })

    const paint = () => {
      value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH)
      input.value = value
      fill(
        boxes,
        ...Array.from({ length: CODE_LENGTH }, (_, i) =>
          h('span', {
            class: i < value.length ? (i === value.length - 1 ? 'filling' : '') : 'empty',
            text: value[i] ?? '·',
          }),
        ),
      )
      submit.disabled = value.length < MIN_CODE_LENGTH
    }
    input.addEventListener('input', paint)

    const join = () => {
      if (value.length < MIN_CODE_LENGTH) return this.notify('join.tooShort')
      this.saveName(nameInput.value)
      this.openOnline(value, false)
    }
    submit.addEventListener('click', join)
    input.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') join()
    })

    fill(
      this.root,
      h(
        'div',
        { class: 'screen' },
        h(
          'div',
          { class: 'topbar' },
          this.backButton(() => this.renderHome()),
          h('h2', { text: t('join.title') }),
        ),
        h('p', { class: 'hint', text: t('join.hint', { n: CODE_LENGTH }) }),
        h(
          'div',
          // `preventScroll` : le champ réel est un calque invisible posé sur les
          // cases dessinées. Sans cela le navigateur fait défiler la page pour
          // « montrer » un élément déjà entièrement visible, et l'écran saute au
          // moment précis où le clavier s'ouvre.
          { class: 'code-input', on: { click: () => input.focus({ preventScroll: true }) } },
          boxes,
          input,
        ),
        h(
          'div',
          { class: 'field' },
          h('span', { class: 'label', text: t('home.name') }),
          nameInput,
        ),
        h('p', { class: 'hint', text: t('join.name.hint') }),
        submit,
        h('p', {
          class: 'hint center push',
          text: t('join.footer'),
        }),
      ),
    )
    paint()
    if (!prefill) setTimeout(() => input.focus({ preventScroll: true }), 60)
  }

  // ─────────────────────────── 03 + 05 · salon ───────────────────────────

  private renderLobby(): void {
    const session = this.session!
    // Le salon se redessine en entier à chaque changement — un joueur qui
    // rejoint, un siège ajouté par un clic à soi. Sans ceci, chacun de ces
    // instants ramènerait le défilement en haut, l'écran étant reconstruit
    // et non mis à jour en place. `.screen` défile rarement (voir la marge
    // élastique de la feuille de style) mais reste le filet de sécurité des
    // très petits écrans, et il doit rester où on l'avait laissé.
    const wasLobby = this.screen === 'lobby'
    const scrollTop = wasLobby ? this.root.querySelector('.screen')?.scrollTop : 0
    // La feuille de match d'une manche précédente n'a rien à faire au-dessus du
    // salon de la suivante : côté invité, elle restait posée là et le salon se
    // redessinait dessous, invisible.
    document.querySelector('.overlay.podium')?.remove()
    this.screen = 'lobby'
    const { lobby } = session
    const online = session.mode === 'online'
    const waiting = online && lobby.players.length === 0
    const variant = VARIANTS.find((v) => v.id === lobby.variantId) ?? VARIANTS[0]!

    // Sans siège, il n'y a pas de salon : la liste des joueurs, les réglages et
    // « en attente du lancement » décrivaient une table où l'on n'entrera
    // peut-être jamais. Seule la réponse qu'on attend compte.
    if (online && session.joinStatus !== 'unknown') {
      fill(
        this.root,
        h(
          'div',
          { class: 'screen' },
          h(
            'div',
            { class: 'topbar' },
            this.backButton(() => this.askQuit(), t('lobby.quit')),
            h('h2', { text: t('lobby.title') }),
          ),
          this.askCard(session),
        ),
      )
      return
    }

    // Un champ en cours de saisie ne se reconstruit pas sous les doigts : le
    // salon se redessine en entier au moindre remous, et chaque remous écrasait
    // le prénom à moitié tapé.
    const focused = this.root.querySelector<HTMLInputElement>('.seat input:focus')
    const typing = focused
      ? { seat: focused.dataset.seat ?? '', value: focused.value, at: focused.selectionStart }
      : null

    const seats = h(
      'div',
      { class: 'seats' },
      ...lobby.players.map((p) => {
        const editable = session.isHost || p.clientId === session.self
        const nameField = h('input', {
          value: p.name,
          attrs: {
            maxlength: '16',
            'aria-label': t('lobby.rename', { n: p.seat + 1 }),
            'data-seat': String(p.seat),
          },
          on: {
            change: () =>
              session.rename(p.seat, nameField.value.trim() || t('common.player', { n: p.seat + 1 })),
          },
        })
        if (!editable) nameField.disabled = true

        const tag = session.botAt(p.seat) ? t('lobby.bot') : !p.connected ? t('lobby.offline') : ''
        const isHostSeat = p.seat === session.hostSeat

        return h(
          'div',
          { class: `seat${p.connected ? '' : ' offline'}` },
          this.token(p.seat),
          nameField,
          h('span', {
            class: 'tag',
            text: tag || (isHostSeat ? t('lobby.host') : p.clientId === session.self ? t('common.you') : ''),
          }),
          session.isHost && !isHostSeat
            ? h(
                'button',
                {
                  class: 'icon-btn danger',
                  attrs: { 'aria-label': t('lobby.remove', { name: p.name }) },
                  on: { click: () => session.removeSeat(p.seat) },
                },
                icon('close', 20),
              )
            : null,
        )
      }),
      ...Array.from({ length: Math.max(0, 4 - lobby.players.length) }, () =>
        h(
          'div',
          { class: 'seat empty' },
          this.token(null, 'ghost'),
          h('span', { class: 'who', text: t('lobby.free') }),
        ),
      ),
    )

    const canAdd = session.isHost && lobby.players.length < 4

    fill(
      this.root,
      h(
        'div',
        { class: 'screen' },
        h(
          'div',
          { class: 'topbar' },
          this.backButton(() => this.askQuit(), t('lobby.quit')),
          h('h2', { text: t('lobby.title') }),
          online && !session.isHost ? this.codePill(lobby.code) : null,
          online ? this.chatButton() : null,
        ),

        online && session.isHost ? this.codeCard(lobby.code) : null,
        online && session.isHost ? this.requestsCard(session) : null,
        online && !session.isHost ? this.askCard(session) : null,

        waiting
          ? this.linkCard(session)
          : h(
              'div',
              { class: 'stack' },
              h('span', { class: 'label', text: t('lobby.players', { n: lobby.players.length }) }),
              seats,
              canAdd
                ? h(
                    'div',
                    { class: 'row' },
                    h('button', {
                      class: 'btn small',
                      text: t('lobby.addPlayer'),
                      on: {
                        click: () =>
                          session.addSeat('human', t('common.player', { n: lobby.players.length + 1 })),
                      },
                    }),
                    h('button', {
                      class: 'btn small',
                      text: t('lobby.addBot'),
                      on: {
                        click: () => session.addSeat('bot', t('common.bot', { n: lobby.players.length + 1 })),
                      },
                    }),
                  )
                : null,
            ),

        this.rulesCard(session, variant),
        this.tableCard(session),

        h(
          'div',
          { class: 'stack push' },
          session.isHost
            ? h('button', {
                class: 'btn red',
                text: lobby.players.length < 2 ? t('lobby.needTwo') : t('lobby.start'),
                disabled: lobby.players.length < 2,
                on: { click: () => session.start() },
              })
            : !waiting
              ? h('p', { class: 'hint center', text: t('lobby.waitHost') })
              : null,
          h('p', { class: 'hint center', text: t('lobby.footer', { n: variant.pawnsPerPlayer }) }),
        ),
      ),
    )
    if (scrollTop) this.root.querySelector('.screen')!.scrollTop = scrollTop
    if (!typing) return
    const again = this.root.querySelector<HTMLInputElement>(`.seat input[data-seat="${typing.seat}"]`)
    if (!again) return
    again.value = typing.value
    again.focus()
    if (typing.at !== null) again.setSelectionRange(typing.at, typing.at)
  }

  /**
   * « X veut rejoindre. » — la porte, et qui l'ouvre.
   *
   * Le code de partie amène jusqu'ici ; il n'ouvre plus. C'est tout l'objet de
   * cette carte : un code deviné ne donne plus une place, seulement une demande
   * que l'hôte voit et refuse d'un doigt.
   */
  private requestsCard(session: Session): HTMLElement | null {
    const requests = session.pendingJoins()
    if (requests.length === 0) return null

    return h(
      'div',
      { class: 'stack' },
      h('span', {
        class: 'label',
        text: t(requests.length === 1 ? 'join.asking.one' : 'join.asking', { n: requests.length }),
      }),
      ...requests.map((request) =>
        h(
          'div',
          { class: 'card request' },
          h(
            'div',
            { class: 'request__who' },
            this.token(null, 'ghost'),
            h('strong', { text: request.name }),
          ),
          h(
            'div',
            { class: 'row' },
            h('button', {
              class: 'btn small green',
              text: t('join.admit'),
              attrs: { 'aria-label': t('join.admit.label', { name: request.name }) },
              on: { click: () => session.admit(request.clientId) },
            }),
            h('button', {
              class: 'btn small',
              text: t('join.refuse'),
              attrs: { 'aria-label': t('join.refuse.label', { name: request.name }) },
              on: { click: () => session.refuse(request.clientId) },
            }),
          ),
        ),
      ),
    )
  }

  /** Côté invité : ce que devient ma demande, tant qu'elle n'a pas de siège. */
  private askCard(session: Session): HTMLElement | null {
    if (session.joinStatus === 'unknown') return null

    if (session.joinStatus === 'denied' || session.joinStatus === 'watching') {
      const watching = session.joinStatus === 'watching'
      return h(
        'div',
        { class: 'card' },
        h('h3', { text: t(watching ? 'join.watching' : 'join.denied') }),
        h('p', { class: 'hint', text: t(watching ? 'join.watching.hint' : 'join.denied.hint') }),
        h('button', {
          class: 'btn small',
          text: t('link.otherCode'),
          on: {
            click: () => {
              this.quit()
              this.renderJoin('')
            },
          },
        }),
      )
    }

    return h(
      'div',
      { class: 'card' },
      h('h3', { text: t('join.pending') }),
      h('p', { class: 'hint', text: t('join.pending.hint') }),
      h('div', { class: 'link-dots' }, h('i'), h('i'), h('i')),
    )
  }

  /**
   * L'écran d'attente d'un invité. Une attente muette est la pire des réponses :
   * au bout de quinze secondes, on dit ce qui a échoué et on propose la suite.
   */
  private linkCard(session: Session): HTMLElement {
    if (session.link !== 'lost') {
      return h(
        'div',
        { class: 'card' },
        h('h3', { text: t('link.connecting') }),
        h('p', { class: 'hint', text: t('link.connecting.hint') }),
        h('div', { class: 'link-dots' }, h('i'), h('i'), h('i')),
      )
    }

    const relays = session.relaysUp()
    return h(
      'div',
      { class: 'card' },
      h('h3', { text: t('link.lost') }),
      h('p', { class: 'hint', text: t(relays === 0 ? 'link.lost.offline' : 'link.lost.hint') }),
      h(
        'div',
        { class: 'row' },
        h('button', {
          class: 'btn small green',
          text: t('common.retry'),
          on: {
            click: () => {
              session.retry()
              this.renderLobby()
            },
          },
        }),
        h('button', {
          class: 'btn small',
          text: t('link.otherCode'),
          on: {
            click: () => {
              this.quit()
              this.renderJoin('')
            },
          },
        }),
      ),
    )
  }

  /** Le code, en grand, avec de quoi l'envoyer en un geste. */
  private codeCard(code: string): HTMLElement {
    return h(
      'div',
      { class: 'card' },
      h('span', { class: 'label', text: t('lobby.code') }),
      h(
        'div',
        { class: 'code-boxes' },
        ...code.split('').map((c) => h('span', { text: c })),
      ),
      h(
        'div',
        { class: 'row' },
        h('button', {
          class: 'btn small green',
          text: t('lobby.share'),
          on: { click: () => void this.share(code) },
        }),
        h('button', {
          class: 'btn small',
          text: t('lobby.copy'),
          on: { click: () => void this.copy(code) },
        }),
      ),
      h('p', { class: 'hint', text: t('lobby.code.hint') }),
    )
  }

  /** La pastille d'une variante : le dé, le pion, l'éclair. */
  private variantBadge(v: Variant, small = false): HTMLElement {
    const badge = h('span', { class: `badge b${VARIANTS.indexOf(v) + 1}${small ? ' badge--sm' : ''}` })
    const kind = BADGES[v.id] ?? 'die'
    if (kind === 'die') badge.append(this.face(5))
    else if (kind === 'pawn') badge.append(this.token(null))
    else badge.append(icon('bolt', small ? 24 : 30))
    return badge
  }

  /**
   * Le jeu de la table, et ce qu'il change.
   *
   * Une rangée de pastilles vertes ne disait pas grand-chose : huit libellés
   * de la même couleur se lisent comme une décoration, et les règles éteintes
   * — les plus intéressantes, justement, celles qu'on n'a PAS ce soir — s'y
   * perdaient en gris pâle. Le tout s'appelait « règles maison » sans jamais
   * dire de quel jeu il s'agissait.
   *
   * Une carte, donc, bâtie comme celle des réglages de table juste dessous :
   * le jeu en titre avec sa pastille, son format en sous-titre, et les huit
   * règles en deux colonnes — chacune cochée ou barrée. Le bouton qui change
   * de jeu vit dans l'en-tête de la carte, à côté du nom qu'il remplace, au
   * lieu de traîner en pleine largeur sous les pastilles.
   */
  private rulesCard(session: Session, variant: Variant): HTMLElement {
    const change =
      session.isHost && !session.lobby.started
        ? h('button', {
            class: 'btn small rules-card__change',
            text: t('lobby.change'),
            on: {
              click: () => {
                this.picking = 'change'
                this.variantId = variant.id
                this.renderPick()
              },
            },
          })
        : null

    return h(
      'div',
      { class: 'stack' },
      h('span', { class: 'label', text: t('lobby.rules') }),
      h(
        'div',
        { class: 'card rules-card' },
        h(
          'div',
          { class: 'rules-card__head' },
          this.variantBadge(variant, true),
          h(
            'div',
            { class: 'rules-card__name' },
            h('strong', { text: variantName(variant.id) }),
            h('span', { class: 'meta', text: t(`variant.${variant.id}.meta` as Key) }),
          ),
          change,
        ),
        h('hr'),
        this.ruleGrid(variant),
      ),
    )
  }

  /**
   * Les huit règles qui changent d'une famille à l'autre.
   *
   * Cochées ou barrées, et toujours toutes les huit : une règle absente de la
   * liste et une règle éteinte ne se distinguaient pas, alors que c'est
   * exactement ce qu'on vient vérifier — « chez nous, manger renvoie ».
   */
  private ruleGrid(v: Variant): HTMLElement {
    const rules: [string, boolean][] = [
      [t('chip.exit', { rolls: v.exitRolls.join(t('chip.or')) }), true],
      [t('chip.six'), v.extraTurnOnSix],
      [t('chip.capture'), true],
      [t('chip.star'), v.starSquaresAreSafe],
      [t('chip.exact'), v.exactFinish],
      [t('chip.single'), v.onePerSquare],
      [t('chip.bonus'), v.extraTurnOnCapture],
    ]
    return h(
      'div',
      { class: 'rule-grid' },
      ...rules.map(([text, on]) =>
        h(
          'span',
          { class: `rule${on ? ' on' : ''}` },
          icon(on ? 'check' : 'close', 15),
          h('span', { text }),
        ),
      ),
    )
  }

  /**
   * Les réglages de table : la forme du plateau et les cases pouvoir.
   *
   * Ils sont dans le salon et pas dans l'écran « on joue à quoi ? » parce
   * qu'ils ne changent pas de jeu — ils changent de soirée. On les voit tous
   * les deux d'un coup d'œil, y compris quand on n'est pas l'hôte et qu'on ne
   * peut rien y toucher : savoir sur quoi on s'apprête à jouer vaut mieux que
   * de le découvrir au premier tour.
   */
  private tableCard(session: Session): HTMLElement {
    const host = session.isHost && !session.lobby.started
    const shape = isBoardShape(session.lobby.shape) ? session.lobby.shape : 'croix'
    const powers = session.lobby.powers === true

    const shapes = h(
      'div',
      { class: 'shapes' },
      ...BOARD_SHAPES.map((id) =>
        h(
          'button',
          {
            class: `shape-btn${id === shape ? ' on' : ''}`,
            disabled: !host,
            attrs: { 'aria-pressed': String(id === shape), title: t(`shape.${id}.desc` as Key) },
            on: { click: () => session.setShape(id) },
          },
          shapeGlyph(id),
          h('span', { text: t(`shape.${id}` as Key) }),
        ),
      ),
    )

    // L'interrupteur porte son état écrit ET dessiné : « Activées » se lit sans
    // distinguer le vert du gris, le curseur se voit sans lire, et un lecteur
    // d'écran annonce l'un des deux. L'ancienne pastille de texte, elle, ne
    // ressemblait pas à un réglage — juste à un bouton de plus dans une carte
    // qui en avait déjà cinq.
    const toggle = h(
      'button',
      {
        class: `switch${powers ? ' on' : ''}`,
        disabled: !host,
        attrs: { role: 'switch', 'aria-checked': String(powers), 'aria-label': t('table.powers') },
        on: { click: () => session.setPowers(!powers) },
      },
      h('span', { class: 'switch__state', text: t(powers ? 'table.powers.on' : 'table.powers.off') }),
      h('span', { class: 'switch__track' }, h('i')),
    )

    return h(
      'div',
      { class: 'stack' },
      h('span', { class: 'label', text: t('table.title') }),
      h(
        'div',
        { class: 'card table-card' },
        h('strong', { text: t('table.shape') }),
        shapes,
        h('p', { class: 'hint', text: t(`shape.${shape}.desc` as Key) }),
        h('hr'),
        // La case pouvoir telle qu'elle sera sur le plateau — le losange
        // d'encre sur fond neutre. Un réglage se comprend mieux quand il montre
        // ce qu'il ajoute au plateau plutôt que de le décrire.
        h(
          'div',
          { class: `table-card__row table-card__powers${powers ? '' : ' off'}` },
          h('span', { class: 'power-cell', attrs: { 'aria-hidden': 'true' } }, h('i')),
          h('strong', { text: t('table.powers') }),
          toggle,
        ),
        h('p', { class: 'hint', text: t('table.powers.hint') }),
        h(
          'button',
          {
            class: 'btn small deck-btn',
            on: { click: () => this.showPowers() },
          },
          h('span', { class: 'deck-btn__pile', attrs: { 'aria-hidden': 'true' } }, h('i'), h('i'), h('i')),
          t('table.powers.see', { n: POWER_LIST.length }),
        ),
      ),
    )
  }

  /**
   * Une carte du paquet, dessinée comme une carte.
   *
   * Le compte d'exemplaires est en haut à droite, là où un jeu de cartes met
   * sa valeur ; la figure est au milieu ; le nom et l'effet dessous. C'est ce
   * qui fait qu'on la reconnaît plus tard, en une demi-seconde, quand elle
   * remonte du paquet au milieu d'un tour.
   */
  private powerCard(power: Power, focus = false): HTMLElement {
    return h(
      'div',
      { class: `power-card power-card--${power.kind}${focus ? ' power-card--focus' : ''}` },
      h(
        'div',
        { class: 'power-card__top' },
        h('span', { class: 'power-card__glyph' }, icon(POWER_ICON[power.id], 26)),
        h('span', { class: 'power-card__copies', text: t('powers.copies', { n: power.copies }) }),
      ),
      h('strong', { class: 'power-card__name', text: t(`power.${power.id}` as Key) }),
      h('span', { class: 'power-card__desc', text: t(`power.${power.id}.desc` as Key) }),
    )
  }

  /**
   * Le catalogue des pouvoirs, en entier.
   *
   * Un bonus qu'on découvre en le ramassant est une surprise ; un malus qu'on
   * découvre en le ramassant est une injustice. Les sept cartes sont donc
   * lisibles avant la partie, avec le nombre d'exemplaires de chacune — c'est
   * ce nombre, et non une promesse, qui dit à quel point le paquet est équitable.
   */
  private showPowers(focus?: PowerId): void {
    if (document.querySelector('.overlay.powers')) return

    const close = (): void => {
      removeEventListener('keydown', onKey)
      overlay.remove()
      // La partie a pu se terminer pendant qu'on lisait les cartes : plus aucun
      // état n'arrivera pour rappeler la feuille de match.
      this.showPodiumIfOver()
    }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') close()
    }

    const group = (kind: PowerKind) =>
      h(
        'div',
        { class: `powers-group powers-group--${kind}` },
        h('span', { class: 'label', text: t(kind === 'bonus' ? 'powers.bonus' : 'powers.malus') }),
        h(
          'div',
          { class: 'power-cards' },
          ...POWER_LIST.filter((p) => p.kind === kind).map((p) => this.powerCard(p, p.id === focus)),
        ),
      )

    const grab = h(
      'div',
      { class: 'sheet__grab' },
      h('span', { class: 'sheet__grip', attrs: { 'aria-hidden': 'true' } }),
      // Un en-tête, et non une carte de plus : la feuille est déjà pleine de
      // cartes, et une boîte qui les annonce leur volerait le premier coup
      // d'œil.
      h(
        'div',
        { class: 'powers__head' },
        h('h2', { text: t('powers.title') }),
        h('p', {
          class: 'hint center',
          text: t('table.powers.fair', {
            n: DECK_SIZE,
            bonus: bonusCount,
            malus: DECK_SIZE - bonusCount,
          }),
        }),
      ),
    )
    const sheet = h(
      'div',
      { class: 'sheet powers__sheet' },
      this.sheetClose(close),
      grab,
      // Le corps défile, la feuille non : la croix et le titre restent où on
      // les a laissés. Une croix qui flotte au-dessus du texte qui défile
      // sous elle se lit comme une carte de plus, mal placée.
      h('div', { class: 'powers__body' }, group('bonus'), group('malus')),
    )
    const overlay = h(
      'div',
      {
        class: 'overlay powers',
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('powers.title') },
        on: {
          click: (ev) => {
            if (ev.target === overlay) close()
          },
        },
      },
      sheet,
    )
    swipeAway(grab, { moves: sheet, way: 'down', tapAway: false, onDismiss: close })
    addEventListener('keydown', onKey)
    document.body.append(overlay)
    // Ouvert depuis une carte en main : elle est cerclée, et l'on va la
    // chercher. Sept cartes tiennent rarement sur un écran de téléphone, et
    // une réponse qu'il faut faire défiler pour trouver n'est pas une réponse.
    overlay.querySelector('.power-card--focus')?.scrollIntoView({ block: 'center' })
  }

  private linkFor(code: string): string {
    return `${location.origin}${location.pathname}#${code}`
  }

  private async share(code: string): Promise<void> {
    const url = this.linkFor(code)
    const text = t('lobby.invite', { code })
    try {
      if (navigator.share) await navigator.share({ title: t('app.title'), text, url })
      else await this.copy(code)
    } catch {
      // Partage annulé : rien à signaler.
    }
  }

  private async copy(code: string): Promise<void> {
    const url = this.linkFor(code)
    try {
      await navigator.clipboard.writeText(url)
      this.notify('lobby.copied')
    } catch {
      this.toast(url)
    }
  }

  // ─────────────────────────── 09 · comment on joue ───────────────────────────

  private renderRules(back: () => void): void {
    this.screen = 'rules'
    fill(
      this.root,
      h(
        'div',
        { class: 'screen' },
        h('div', { class: 'topbar' }, this.backButton(back), h('h2', { text: t('rules.title') })),
        h(
          'div',
          { class: 'steps' },
          ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) =>
            h(
              'div',
              { class: 'step', style: this.seatVars(((n - 1) % 4) as Seat) },
              h('span', { class: 'num', text: String(n) }),
              h(
                'div',
                { class: 'body' },
                h('strong', { text: t(`rules.${n}.title` as Key) }),
                h('span', { text: t(`rules.${n}.body` as Key) }),
              ),
            ),
          ),
        ),
        h('button', {
          class: 'btn small',
          text: t('rules.full'),
          on: { click: () => this.renderRulebook(back) },
        }),
        h('p', { class: 'hint center push', text: t('rules.footer') }),
      ),
    )
  }

  /**
   * Le règlement complet — ce qui est permis, ce qui ne l'est pas, et ce qui
   * change d'un jeu à l'autre.
   *
   * Un second écran plutôt qu'un chapitre de plus dans le premier : « Comment
   * on joue » sert à lancer sa première partie en neuf étapes, et l'allonger de
   * quarante paragraphes lui ferait rater ce travail-là. On vient ici plus tard,
   * avec une question précise, souvent au milieu d'une dispute.
   */
  private renderRulebook(back: () => void): void {
    this.screen = 'rulebook'
    renderRulebook(this.root, () => this.renderRules(back))
  }

  // ─────────────────────────── 06 + 07 · partie ───────────────────────────

  private renderPlay(): void {
    this.screen = 'play'
    setKeepAwake(true)
    // Une manche qui commence n'a pas à démarrer sous la feuille de match de la
    // précédente.
    document.querySelector('.overlay.podium')?.remove()

    const boardHost = h('div')
    // Les deux rangées se distinguent par une classe et non par leur rang : la
    // disposition paysage les place dans des lignes différentes, et compter les
    // enfants en CSS se serait cassé au premier bloc inséré.
    const top = h('div', { class: 'players players--top' })
    const bottom = h('div', { class: 'players players--bottom' })
    // La ligne de tour porte désormais deux choses : ce qui se passe, et la main.
    // La rangée de cartes vivait sous elle, sur une ligne à hauteur fixe qu'elle
    // gardait même vide — quarante-cinq pixels pris au plateau pendant les trois
    // quarts d'une partie, pour un rang vide. Elle tient maintenant dans un
    // bouton, et le plateau récupère la ligne entière.
    // `aria-live` sur le bloc de texte et non sur la ligne entière : le bouton
    // des cartes vit dans la même ligne, et ses changements se feraient lire à
    // voix haute à chaque passe d'affichage.
    const turnMain = h('div', { class: 'turnline__main', attrs: { 'aria-live': 'polite' } })
    const turn = h('div', { class: 'turnline' }, turnMain)
    const die = h('div', { class: 'face' })
    const dieBtn = h(
      'button',
      {
        class: 'dice',
        attrs: { 'aria-label': t('play.roll') },
        on: { click: () => this.throwDie() },
      },
      die,
    )

    // Chaque bouton lance le dé ET applique le bonus en un seul geste, comme
    // le bouton du dé lui-même. Ils encadrent le dé au lieu de s'empiler
    // dessous : la réserve de bonus est commune, elle se lit sur la pastille
    // que chaque bouton porte, et la ligne entière ne coûte que la hauteur du
    // dé — celle qu'elle occupait déjà. Ce qui est gagné là revient au plateau.
    const boost = (side: 'low' | 'high') => {
      const count = h('span', { class: 'boost__n' })
      const btn = h(
        'button',
        {
          class: `boost boost--${side}`,
          on: { click: () => this.throwDie(side) },
        },
        h('span', { class: 'boost__label', text: t(side === 'low' ? 'play.boost.low' : 'play.boost.high') }),
        count,
      )
      return { btn, count }
    }
    const low = boost('low')
    const high = boost('high')
    const diceRow = h('div', { class: 'dice-row' }, low.btn, dieBtn, high.btn)
    // Le bouton de la main, à droite de la ligne de tour : il porte les figures
    // des cartes gardées, et l'ouvre au doigt. Il est dans la ligne de tour et
    // non dans la rangée du dé parce qu'une carte se joue *avant* de lancer
    // aussi bien qu'après — la ranger sous le dé la ferait lire comme une
    // conséquence du lancer.
    const hand = h('button', {
      class: 'handbtn',
      attrs: { 'aria-haspopup': 'dialog', 'aria-label': t('hand.title') },
      on: { click: () => this.showHand() },
    })
    turn.append(hand)

    // La pause n'existe que sur un seul téléphone : voir `canPause` côté
    // session. En ligne, un bouton qui ne figerait que son propre écran
    // mentirait sur ce qu'il fait.
    // Vide et replié tant que le réseau se tient bien : il n'a rien à dire, et
    // une ligne réservée « au cas où » aurait rogné le plateau toute la partie.
    const linkBar = h('div', { class: 'linkbar', attrs: { role: 'status', 'aria-live': 'polite' } })

    const pauseBtn = this.session!.mode === 'local'
      ? h(
          'button',
          {
            class: 'icon-btn',
            attrs: { 'aria-label': t('play.pause') },
            on: { click: () => this.session?.setPaused(true) },
          },
          icon('pause'),
        )
      : null

    fill(
      this.root,
      h(
        'div',
        { class: 'play' },
        h(
          'div',
          { class: 'topbar' },
          this.backButton(() => this.askQuit(), t('lobby.quit')),
          h('span', { style: { flex: '1' } }),
          this.session!.mode === 'online' ? this.codePill(this.session!.lobby.code) : null,
          this.session!.mode === 'online' ? this.chatButton() : null,
          pauseBtn,
          h(
            'button',
            {
              class: 'icon-btn',
              attrs: { 'aria-label': t('rules.title') },
              on: { click: () => this.renderRules(() => this.backToGame()) },
            },
            icon('help'),
          ),
        ),
        linkBar,
        top,
        // Le plateau ne se dimensionne pas sur la largeur mais sur la place qui
        // reste : c'est ce créneau qui la mesure (voir `.board-slot`). Sans lui,
        // un écran court poussait le dé hors de l'écran.
        h('div', { class: 'board-slot' }, boardHost),
        bottom,
        turn,
        diceRow,
      ),
    )

    this.board = new BoardView(boardHost, this.session!.game!.variant)
    this.mounts = {
      players: [top, bottom],
      turn: turnMain,
      turnLine: turn,
      dieBtn,
      die,
      diceRow,
      boostLowBtn: low.btn,
      boostHighBtn: high.btn,
      boostCounts: [low.count, high.count],
      hand,
      pauseBtn,
      linkBar,
    }
    this.armed = null
    this.shownDice = null
    this.tumbling = false
    this.autoAt = -1
    // Une manche qui commence ne rejoue pas les annonces de la précédente.
    this.announced = this.session!.game!.log[this.session!.game!.log.length - 1]?.seq ?? -1
    this.paintDie(this.lastDie, false)
  }

  private refreshPlay(state: GameState): void {
    const session = this.session!
    const mounts = this.mounts!
    // La feuille de pause passe avant tout le reste : elle doit apparaître
    // même quand le dé roule encore, et la passe s'arrête là (voir plus bas).
    if (mounts.pauseBtn) mounts.pauseBtn.disabled = !session.canPause
    this.paintPause()
    const moves = session.moves()
    if (state.dice !== null) this.lastDie = state.dice

    // La carte armée est vérifiée d'abord : le tour a pu passer, le cheval
    // désigné rentrer ou se faire manger. Une carte qui ne mène plus à rien se
    // range, et une désignation périmée s'oublie — sinon le reste de la passe
    // dessine un état qui n'existe plus.
    //
    // `needsPawn` d'abord : une carte qui ne vise personne n'a aucune cible à
    // proposer, et la traiter comme une carte sans cible restante la rangeait
    // aussitôt armée. Le rejeu et le dé pipé étaient injouables pour cette
    // seule raison — voir `aim.ts`, où la règle est désormais tenue par un test.
    const aimTargets =
      this.armed !== null && needsPawn(this.armed.power) ? session.targetsFor(this.armed.power) : []
    this.armed = keepArmed(this.armed, { playable: session.hand().playable, targets: aimTargets })

    // Un dé pipé armé compte déjà : il garnit la réserve au moment où le lancer
    // le valide, si bien qu'un même geste peut ranger la carte et pencher le dé.
    // Sans ce +1, les boutons restaient éteints devant la carte qui les allume.
    const boosts = state.diceBoosts + (this.armed?.power === 'des' ? 1 : 0)
    const canBoost = session.myTurn && state.phase === 'rolling' && boosts > 0
    mounts.boostLowBtn.disabled = !canBoost
    mounts.boostHighBtn.disabled = !canBoost
    // Réserve épuisée : les boutons s'effacent au lieu de rester grisés à vie.
    // Le dé garde sa place, la ligne garde sa hauteur — rien ne bouge sous le
    // plateau, et l'écran ne se réorganise pas au dernier bonus dépensé.
    mounts.diceRow.classList.toggle('spent', boosts === 0)
    const remaining = t(boosts === 1 ? 'play.boost.remaining.one' : 'play.boost.remaining', {
      n: boosts,
    })
    for (const el of mounts.boostCounts) el.textContent = String(boosts)
    // La pastille ne porte qu'un chiffre : la phrase entière est pour qui écoute.
    mounts.boostLowBtn.setAttribute('aria-label', `${t('play.boost.low')} · ${remaining}`)
    mounts.boostHighBtn.setAttribute('aria-label', `${t('play.boost.high')} · ${remaining}`)

    // Un dé qui apparaît, c'est quelqu'un — moi, un pair ou un bot — qui vient
    // de lancer : on le fait rouler pour tout le monde de la même façon.
    const justRolled = state.dice !== null && this.shownDice === null
    this.shownDice = state.dice
    if (justRolled) this.tumble(state.dice!)
    // Face vide tant que personne n'a lancé : un ancien résultat ferait croire
    // à une valeur déjà tirée.
    else if (!this.tumbling) {
      const shown = state.phase === 'rolling' ? null : (state.dice ?? this.lastDie)
      this.paintDie(shown, state.dice !== null)
    }

    // Tant que le dé roule, rien ne doit vendre la mèche : ni la phrase du
    // dessus, ni les chevaux cerclés. Le rendu complet reprend à la réception.
    if (this.tumbling) return this.renderTurn(mounts.turn, state, moves.length)

    // Carte armée qui vise un cheval : le plateau ne montre plus les coups mais
    // les chevaux que la carte peut viser, et un appui **désigne** le cheval —
    // il ne joue rien. La carte part au lancer du dé, jamais avant.
    //
    // Une carte qui ne vise personne, elle, laisse le plateau tranquille : ses
    // coups restent jouables, et le joueur garde le droit de changer d'avis.
    const aiming = this.armed !== null && needsPawn(this.armed.power)
    this.board!.setAiming(aiming)
    if (aiming) {
      const aimed = this.armed!.pawnId
      this.board!.render(
        state,
        aimTargets.map((pawnId) => aimMove(state, pawnId)),
        (pawnId) => {
          // Retoucher le cheval désigné le désigne à nouveau : sans effet, et
          // c'est bien — le seul geste qui joue la carte est le dé.
          this.armed = { power: this.armed!.power, pawnId }
          this.update()
        },
        aimed,
      )
    } else {
      // Partie figée : les chevaux restent à leur place mais ne prennent plus le
      // doigt. La feuille couvre déjà l'écran ; ceci couvre le clavier, qui
      // sait très bien atteindre un bouton caché.
      this.board!.render(
        state,
        session.paused ? [] : moves,
        (pawnId) => session.dispatch({ type: 'move', pawnId }),
      )
    }
    this.renderHand(mounts.hand)
    this.renderPlayers(mounts.players, state)
    this.renderTurn(mounts.turn, state, moves.length)
    this.paintValidator(state, moves.length)
    // Un coup évident ne doit pas se jouer tout seul pendant qu'on choisit une
    // carte : le doigt est sur le plateau, pas sur le dé.
    this.scheduleObvious(state, moves)

    this.announce(state)
    this.paintLinkBar()
    this.tellSeatToBot()

    if (state.phase === 'finished') this.renderPodium(state)
  }

  /**
   * Ce que le réseau a à dire, en pleine partie.
   *
   * C'était le trou le plus coûteux : un invité coupé de l'hôte ne voyait
   * strictement rien. Il touchait le dé, rien ne bougeait, il recommençait —
   * pendant que l'hôte, de son côté, comptait des tours sautés et finissait par
   * confier son siège à un bot. Deux phrases, deux points de vue : « je n'ai
   * plus l'hôte » chez l'invité, « je n'ai plus X » chez l'hôte.
   */
  private paintLinkBar(): void {
    const session = this.session
    const bar = this.mounts?.linkBar
    if (!bar || !session) return

    const online = session.mode === 'online'
    // Le téléphone n'a plus de réseau du tout : le dire franchement, et ne pas
    // proposer un bouton qui ne peut rien faire. C'est aussi vrai chez l'hôte,
    // qui n'a pourtant pas d'hôte à perdre.
    const offline = online && !navigator.onLine
    const lost = online && !session.isHost && session.link !== 'linked'
    const watching = session.joinStatus === 'watching'
    const silent = session.silentNames

    if (lost || offline) {
      fill(
        bar,
        h(
          'div',
          { class: 'linkbar__text' },
          h('strong', { text: t(lost ? 'link.host.lost' : 'link.lost') }),
          h('span', { text: t(offline ? 'link.lost.offline' : 'link.host.lost.hint') }),
        ),
        offline
          ? null
          : h('button', {
              class: 'btn small green',
              text: t('link.reconnect'),
              on: { click: () => session.retry() },
            }),
      )
    } else if (watching) {
      fill(
        bar,
        h(
          'div',
          { class: 'linkbar__text' },
          h('strong', { text: t('join.watching') }),
          h('span', { text: t('lobby.waitHost') }),
        ),
      )
    } else if (silent.length > 0) {
      fill(
        bar,
        h(
          'div',
          { class: 'linkbar__text' },
          h('strong', {
            text:
              silent.length === 1
                ? t('link.silent.one', { name: silent[0]! })
                : t('link.silent', { n: silent.length }),
          }),
        ),
      )
    } else {
      bar.replaceChildren()
    }

    bar.classList.toggle('show', lost || offline || watching || silent.length > 0)
    // Informé, pas alarmé : le spectateur et l'hôte n'ont rien à réparer, et la
    // partie continue autour d'eux. Le rouge est pour celui qui, lui, ne joue
    // plus.
    bar.classList.toggle('linkbar--quiet', !lost && !offline)
  }

  /**
   * « Un bot prend votre place. »
   *
   * À la deuxième personne, et chez le seul intéressé : la nouvelle vient du
   * salon publié, pas d'un message adressé, et l'hôte est souvent le seul à
   * savoir. On la dit une fois — pas à chaque état reçu.
   */
  private tellSeatToBot(): void {
    const held = this.session?.seatToTakeBack !== null && this.session?.seatToTakeBack !== undefined
    if (held && !this.botHeldMySeat) this.notify('notice.seatToBot.you')
    this.botHeldMySeat = held
  }

  /**
   * Ce qui vient d'arriver et ne se lit nulle part ailleurs.
   *
   * Le plateau montre où sont les chevaux, pas pourquoi ils y sont : un cheval
   * qui recule de trois cases sans explication ressemble à un bug. Les
   * événements de pouvoir sont donc annoncés au passage, ainsi que les
   * captures — l'événement le plus violent du jeu était jusqu'ici le seul à ne
   * rien dire.
   *
   * **À qui, en revanche, dépend de la carte.** Un malus s'abat sur le plateau,
   * tout le monde le voit et tout le monde doit savoir lequel. Un bonus rejoint
   * une main : l'annoncer à la table revenait à retourner les cartes de son
   * voisin — un bouclier qu'on sait posé n'en est plus un. Les autres apprennent
   * donc qu'une carte a été ramassée, pas laquelle.
   *
   * **Et après le plateau, jamais avant.** Les nouvelles attendent que les
   * chevaux aient fini de marcher (voir `settled` dans `board-view.ts`) :
   * annoncer une capture pendant que le cheval qui mange est encore à quatre
   * cases de sa victime, c'est la raconter avant qu'elle n'arrive.
   */
  private announce(state: GameState): void {
    const fresh = state.log.filter((entry) => entry.seq > this.announced)
    if (state.log.length > 0) this.announced = state.log[state.log.length - 1]!.seq
    const session = this.session
    const mine = (seat: Seat) => session?.controls(seat) === true

    type Note = {
      kind: PowerKind | 'neutral'
      who: string
      title: string
      desc?: string
      power?: PowerId
    }
    /** Une carte nommée : sa figure, son mot, sa couleur, son effet. */
    const card = (power: PowerId, who: string): Note => ({
      kind: POWERS[power].kind,
      who,
      title: t(`power.${power}` as Key),
      desc: t(`power.${power}.desc` as Key),
      power,
    })

    // Dans l'ordre où les choses sont arrivées, et non à l'envers : la pile se
    // lit de haut en bas, elle doit donc se remplir dans le sens du récit.
    const notes: Note[] = []
    for (const entry of fresh) {
      const { event } = entry
      if (event.kind === 'power') {
        const spec = POWERS[event.power]
        // Sa propre carte, ou un malus qui s'abat à la vue de tous : on la nomme.
        // Celle d'un autre : on dit qu'elle existe, pas ce qu'elle est.
        notes.push(
          !spec.held || mine(entry.seat)
            ? card(event.power, entry.actor)
            : { kind: 'neutral', who: entry.actor, title: t('toast.drew.title') },
        )
      } else if (event.kind === 'handFull') {
        // La carte perdue est une mauvaise nouvelle personnelle : elle n'a pas
        // à s'afficher chez les autres, qui la lisaient comme la leur.
        if (mine(entry.seat)) {
          notes.push({
            kind: 'malus',
            who: entry.actor,
            title: t(`power.${event.power}` as Key),
            desc: t('hand.full'),
            power: event.power,
          })
        }
      } else if (event.kind === 'shielded') {
        notes.push({
          kind: 'bonus',
          who: event.owner,
          title: t('power.bouclier'),
          desc: t('toast.shielded', { pawn: event.pawn, owner: event.owner }),
          power: 'bouclier',
        })
      } else if (event.kind === 'skipped') {
        notes.push({
          kind: 'malus',
          who: entry.actor,
          title: t('power.saute'),
          desc: t('power.saute.desc'),
          power: 'saute',
        })
      } else if (event.kind === 'voided') {
        // Le tour perdu ne se lit que sur la ligne de tour, et seulement chez
        // celui qui le perd — or c'est un événement de table : le joueur qui
        // enchaînait les 6 s'arrête net, et sans un mot personne ne sait
        // pourquoi. Chez lui, la ligne de tour passe en une seconde ; la
        // nouvelle, elle, reste le temps qu'on la lise.
        notes.push({
          kind: 'malus',
          who: entry.actor,
          title: t('play.voided'),
          desc: t('play.voided.hint', { n: event.sixes }),
        })
      } else if (event.kind === 'timeout') {
        // Un tour qui saute sans un mot ressemble à une partie qui bafouille :
        // le dé change de main, personne n'a rien joué, et rien ne le dit.
        notes.push({
          kind: 'malus',
          who: entry.actor,
          title: t('play.timeout'),
          desc: mine(entry.seat)
            ? t('play.timeout.you')
            : t('play.timeout.hint', { name: entry.actor }),
        })
      } else if (event.kind === 'capture') {
        // Un cheval disparaît d'un bout du plateau et reparaît dans une écurie.
        // Sans un mot, c'est le coup qu'on ne comprend qu'en refaisant le
        // trajet des yeux — quand on l'a vu partir.
        notes.push({
          kind: 'malus',
          who: entry.actor,
          title: t('toast.eaten.title'),
          desc: t('toast.eaten', { pawn: event.pawn, victim: event.victim }),
        })
      } else if (event.kind === 'played' && !mine(entry.seat)) {
        // Une carte jouée par soi n'a pas besoin d'être annoncée : on vient de
        // la taper. Celles des autres, si — c'est la seule trace qu'il en reste.
        //
        // La comparaison se fait avec SON siège, et non avec le siège courant :
        // jouer une carte ne rend pas la main, si bien que `entry.seat` valait
        // toujours `state.turn` et que l'annonce ne sortait jamais.
        notes.push(card(event.power, entry.actor))
      }
    }

    if (notes.length === 0) return
    const show = (): void => {
      for (const n of notes.slice(-NOTE_STACK)) this.note(n.kind, n.who, n.title, n.desc, n.power)
    }
    const board = this.board
    if (board) void board.settled().then(show)
    else show()
  }

  /** Le bandeau des nouvelles, créé au premier besoin. */
  private noteHost(): HTMLElement {
    const found = document.querySelector<HTMLElement>('.cardnotes')
    if (found) return found
    const host = h('div', { class: 'cardnotes' })
    document.body.append(host)
    return host
  }

  /**
   * Une nouvelle de pouvoir, montrée sans déranger la partie.
   *
   * Discrète, visible, et **par-dessus** le reste : c'est une nouvelle, pas un
   * élément d'interface. Elle flotte en position fixe en haut de l'écran, ne
   * prend aucune place dans la colonne — le plateau ne se redimensionne pas
   * derrière elle, l'écran ne bouge plus — et ne capte aucun appui : le dé reste
   * jouable pendant qu'on la lit. L'ancien bandeau, lui, se posait sur le dé.
   *
   * Une seule exception à « ne capte aucun appui » : le ⓘ, quand la nouvelle
   * nomme une carte. Une annonce qui passe laisse une question derrière elle,
   * et il faut un endroit où la poser.
   */
  private note(
    kind: PowerKind | 'neutral',
    who: string,
    title: string,
    desc?: string,
    power?: PowerId,
  ): void {
    const el = h(
      'div',
      { class: `cardnote cardnote--${kind}`, attrs: { role: 'status', 'aria-live': 'polite' } },
      // La figure de la carte quand on sait laquelle c'est ; la pastille nue
      // quand on ne le sait pas — la carte d'un autre joueur existe, on ne dit
      // rien de plus.
      power
        ? h('span', { class: `power-badge power-badge--${kind}` }, icon(POWER_ICON[power], 22))
        : h('span', { class: `power-mark power-mark--${kind}` }),
      h(
        'div',
        { class: 'cardnote__text' },
        who ? h('span', { class: 'cardnote__who', text: who }) : null,
        h('strong', { class: 'cardnote__name', text: title }),
        desc ? h('span', { class: 'cardnote__desc', text: desc }) : null,
      ),
      power
        ? h(
            'button',
            {
              class: 'cardnote__info',
              attrs: { 'aria-label': t('hand.info', { power: title }) },
              on: {
                click: () => {
                  el.remove()
                  this.showPowers(power)
                },
              },
            },
            icon('info', 14),
          )
        : null,
    )

    const host = this.noteHost()
    host.append(el)
    // La plus ancienne s'efface quand la pile déborde : c'est celle qu'on a
    // déjà eu le temps de lire.
    while (host.children.length > NOTE_STACK) host.firstElementChild?.remove()
    const timer = setTimeout(() => el.remove(), NOTE_MS[kind])
    // Et elle part au doigt, sans attendre son tour. Six secondes et demie sont
    // le bon délai pour qui n'a pas encore lu ; pour qui a lu, c'est une attente
    // qu'on subit devant une information qu'on possède déjà.
    swipeAway(el, {
      onDismiss: () => {
        clearTimeout(timer)
        el.remove()
      },
    })
  }

  /**
   * Les cartes reprennent la place des camps sur le plateau : vert en haut à
   * gauche, jaune en haut à droite, rouge en bas à gauche, bleu en bas à
   * droite. Chaque carte prolonge visuellement son quadrant.
   */
  private renderPlayers(hosts: HTMLElement[], state: GameState): void {
    const session = this.session!
    const rows: Seat[][] = [
      [0, 1],
      [3, 2],
    ]

    // Le contour minuté est recréé à chaque passage : la référence d'avant
    // pointerait sur une carte qui n'est plus à l'écran.
    this.turnRing = null

    const card = (seat: Seat) => {
      const p = state.players.find((x) => x.seat === seat)
      // Siège inoccupé : une carte fantôme, pour que la carte voisine reste du
      // côté de son quadrant.
      if (!p) return h('div', { class: 'pcard ghost' })

      const lastStep = geometryFor(state.variant).lastStep
      const pawns = pawnsOf(state, seat)
      const done = pawns.filter((x) => x.steps === lastStep).length
      const running = pawns.filter((x) => x.steps > STABLE && x.steps < lastStep).length
      const rank = state.ranking.indexOf(seat)
      const active = state.turn === seat && state.phase !== 'finished'

      const meta =
        rank >= 0
          ? rank === 0
            ? t('play.place.first')
            : t('play.place', { n: rank + 1 })
          : done > 0
            ? t(done > 1 ? 'play.homed.other' : 'play.homed.one', { n: done })
            : running > 0
              ? t('play.running', { n: running })
              : t('play.stable')

      // Un pair distant déconnecté ne joue plus : sans ce signal, un tour qui
      // se termine tout seul (voir `armTurnClock` côté session) resterait
      // inexpliqué à l'écran. `state.players[].connected` est une photo figée au
      // lancement de la partie : seul le lobby, tenu à jour en continu, sait qui
      // est là maintenant.
      const lobbyPlayer = session.lobby.players.find((x) => x.seat === seat)
      const offline =
        lobbyPlayer !== undefined &&
        lobbyPlayer.kind !== 'bot' &&
        lobbyPlayer.clientId !== session.self &&
        !lobbyPlayer.connected
      // Un bot tient ce siège en l'absence de son joueur : le dire, sinon on
      // croirait que le joueur d'à côté s'est mis à jouer tout seul.
      const held = lobbyPlayer?.botFill === true

      // « vous · tenu par un bot · 2 en piste » : ce qu'on est, ce qui joue à
      // notre place, et où en sont les chevaux.
      const line = [
        session.mine(seat) ? t('common.you') : '',
        held ? t('play.bot') : offline ? t('lobby.offline') : '',
        meta,
      ].filter(Boolean)

      const bubble = this.chatBubbles.get(seat)

      // Ce qui pèse encore sur ce siège, et qui ne se lit pas sur le plateau.
      //
      // Un pouvoir peut durer : un bouclier tient tant que personne ne vient
      // manger le cheval, un tour sauté attend son tour. Le bouclier se voit sur
      // le cheval ; le reste n'avait aucune trace, et un joueur dont le tour
      // sautait l'apprenait au moment où il sautait. Des cartes en main, on ne
      // dit que le nombre — leur nom appartient à leur propriétaire.
      //
      // Pas de pastille de cartes sur sa propre carte : la rangée sous le dé
      // porte déjà les cartes ET leur compte. Une pastille de plus ne dirait
      // rien et rognerait la ligne d'à côté.
      const inHand =
        state.variant.powers === true && !session.controls(seat) ? session.handSize(seat) : 0
      const owed = session.skipsOwed(seat)
      const marks =
        inHand > 0 || owed > 0
          ? h(
              'div',
              { class: 'pcard__marks' },
              inHand > 0
                ? h('span', {
                    class: 'pcard__mark',
                    text: String(inHand),
                    attrs: {
                      title: t('play.cards', { n: inHand }),
                      'aria-label': t('play.cards', { n: inHand }),
                    },
                  })
                : null,
              owed > 0
                ? h('span', {
                    class: 'pcard__mark pcard__mark--skip',
                    // Un tour barré, et son compte seulement s'il y en a plusieurs :
                    // un chiffre nu se lirait comme le compte de cartes d'à côté.
                    text: owed > 1 ? `—${owed}` : '—',
                    attrs: { title: t('play.willSkip', { n: owed }), 'aria-label': t('play.willSkip', { n: owed }) },
                  })
                : null,
            )
          : null

      return h(
        'div',
        {
          class: `pcard${active ? ' active' : ''}${rank >= 0 ? ' out' : ''}`,
          style: this.seatVars(seat),
        },
        this.token(seat),
        h(
          'div',
          { class: 'body' },
          h('span', { class: 'who', text: p.name }),
          h('span', { class: 'meta', text: line.join(' · ') }),
        ),
        marks,
        // Le bot n'a pris le siège que faute de mieux : un appui le rend.
        held && session.mine(seat)
          ? h('button', {
              class: 'pcard__take',
              text: t('play.takeBack'),
              attrs: { 'aria-label': t('play.takeBack.label') },
              on: { click: () => session.takeBack(seat) },
            })
          : null,
        // Le temps de réflexion, sur le contour de la carte : discret tant qu'il
        // en reste, rouge à la fin. Décoratif pour qui écoute — les secondes
        // sont dites au-dessus du dé, là où l'on attend l'information.
        active && session.turnLeft() !== null ? this.turnRingFor() : null,
        // Le texte a son propre nœud : c'est LUI qu'on tronque à trois lignes,
        // et une troncature demande `overflow: hidden` — posée sur la bulle,
        // elle rognait la pointe, qui vit hors de ses bords.
        bubble ? this.chatBubble(seat, bubble.text) : null,
      )
    }

    hosts.forEach((host, i) => {
      const seats = rows[i]!
      const used = seats.some((seat) => state.players.some((p) => p.seat === seat))
      fill(host, ...(used ? seats.map(card) : []))
    })
  }

  /**
   * Le dé — et, quand une carte est armée, le bouton qui la valide.
   *
   * Un seul geste pour jouer une carte et lancer : c'est ce qui rend le choix
   * lisible. On arme, on désigne, on lance. Le moteur reçoit les deux ensemble
   * (voir `Action` dans `types.ts`) : deux intentions envoyées à la suite
   * pourraient s'appliquer dans l'ordre inverse chez l'hôte.
   */
  private throwDie(boost?: 'low' | 'high'): void {
    const session = this.session
    const game = session?.game
    if (!session || !game || !session.myTurn) return

    const armed = this.armed
    if (armed) {
      // Une carte qui demande un cheval et n'en a pas encore : le lancer ne
      // part pas, on rappelle simplement ce qui manque.
      if (needsPawn(armed.power) && armed.pawnId === undefined) {
        return this.notify('hand.aim.needed')
      }
      // Le dé pipé se dépense en demandant son nombre. Le lancer nu le
      // gaspillerait — la carte partirait, et le dé ne pencherait vers rien.
      // Le dé déjà sur la table, en revanche, n'a plus rien à pencher : la
      // carte s'y joue pour ce qu'il lui reste, un jeton de plus dans la
      // réserve de la table.
      if (armed.power === 'des' && boost === undefined && game.phase === 'rolling') {
        return this.notify('hand.boost.needed')
      }
      this.armed = null
      if (this.autoTimer) clearTimeout(this.autoTimer)
      this.autoTimer = null
      return session.dispatch({ type: 'roll', boost, power: armed.power, pawnId: armed.pawnId })
    }

    if (game.phase === 'rolling') return session.dispatch({ type: 'roll', boost })

    // Rien à jouer : le dé passe la main. C'est le pendant du garde-fou
    // ci-dessus — une carte en main suspend le tour automatique, et sans ce
    // geste-là le joueur qui n'a aucun coup resterait bloqué jusqu'à ce que sa
    // pendule s'épuise. Le dé est le bouton « j'agis » : il lance, il valide une
    // carte, et il passe quand il n'y a rien d'autre à faire.
    if (session.moves().length === 0) session.dispatch({ type: 'pass' })
  }

  /**
   * Le tour peut-il se dérouler tout seul ?
   *
   * Un coup sans choix n'est pas un choix : quand il n'y a rien à jouer, ou un
   * seul coup possible, le tour part de lui-même. Une carte **armée** est la
   * seule chose qui l'en empêche — le doigt est alors sur le plateau, pas sur
   * le dé, et jouer le coup dessous ferait disparaître la carte qu'on visait.
   *
   * Une carte simplement *présente* en main, elle, ne suspend plus rien : elle
   * ne fait qu'allonger le délai (voir `autoDelay`). L'ancienne règle rendait la
   * main un piège — un bonus ramassé, et chaque tour à coup unique redemandait
   * une confirmation jusqu'à la fin de la partie.
   */
  private canAutoPlay(state: GameState, moveCount: number): boolean {
    const session = this.session
    if (!session?.myTurn || session.paused || state.phase !== 'moving' || moveCount > 1) return false
    return this.armed === null
  }

  /** Le temps de lecture avant qu'un coup sans choix ne parte tout seul. */
  private autoDelay(): number {
    return (this.session?.hand().playable.length ?? 0) > 0 ? AUTO_HOLD_MS : AUTO_MS
  }

  /**
   * Le dé dit ce qu'il va faire : lancer, valider la carte armée, ou passer.
   *
   * Sans ce signal, la carte choisie attend un geste que rien ne désigne — et le
   * joueur cherche un bouton « jouer » qui n'existe pas.
   */
  private paintValidator(state: GameState, moveCount: number): void {
    const mounts = this.mounts
    if (!mounts) return
    const ready = this.armedReady()
    // Le dé pipé ne se valide pas par le dé mais par ses deux boutons : c'est
    // là que le halo doit aller. Le poser sur le dé désignait le seul geste qui
    // gaspille la carte — elle partait, et le lancer ne penchait vers rien.
    const viaBoost = ready && this.armed!.power === 'des' && state.phase === 'rolling'
    mounts.diceRow.classList.toggle('validating', ready && !viaBoost)
    mounts.diceRow.classList.toggle('validating-boost', viaBoost)
    // Le dé fait trois choses selon l'instant : il valide une carte armée, il
    // lance, ou il passe la main. Ce qu'il fait doit se dire, au moins pour qui
    // écoute l'écran.
    const label =
      ready && !viaBoost
        ? t('hand.validate', { power: t(`power.${this.armed!.power}` as Key) })
        : state.phase === 'moving' && moveCount === 0
          ? t('play.pass')
          : t('play.roll')
    mounts.dieBtn.setAttribute('aria-label', label)
  }

  /**
   * Ses propres cartes — jamais celles des autres.
   *
   * **Un bouton, et non une rangée.** Les cartes tenaient sur une ligne à
   * hauteur fixe, sous la ligne de tour, qu'elles gardaient même vides : le
   * plateau perdait quarante-cinq pixels pendant les trois quarts d'une partie
   * pour un rang qui ne montrait rien. Un plateau qu'on ne voit pas bien est un
   * plateau sur lequel on joue mal — c'est la pièce maîtresse, tout le reste
   * est du décor.
   *
   * Le bouton ne porte que les figures des cartes gardées : à cette taille un
   * dessin se reconnaît, un mot ne se lit pas. Le nom, l'effet et le geste sont
   * dans le tiroir, où il y a la place de les écrire en entier.
   */
  private renderHand(host: HTMLElement): void {
    const session = this.session!
    const { cards, playable } = session.hand()
    const line = this.mounts!.turnLine
    // La partie finie, il n'y a plus de carte à jouer ; la partie figée, la
    // feuille de pause couvre déjà tout — un tiroir resté ouvert derrière elle
    // reviendrait au premier doigt posé sur « Reprendre ».
    const closed = session.game?.phase === 'finished' || session.paused

    // Pas de carte, pas de bouton : la ligne de tour reprend toute sa largeur.
    const show = cards.length > 0 && session.game?.phase !== 'finished'
    line.classList.toggle('has-cards', show)
    host.hidden = !show
    if (closed) this.closeHandTray()
    if (!show) {
      fill(host)
      return
    }

    const armed = this.armed
    host.classList.toggle('on', playable.length > 0)
    host.classList.toggle('aimed', armed !== null)
    host.setAttribute(
      'aria-label',
      armed
        ? t('hand.open.armed', { power: t(`power.${armed.power}` as Key) })
        : t('hand.open', { n: cards.length, max: HAND_LIMIT }),
    )

    fill(
      host,
      ...cards.map((power) =>
        h(
          'span',
          {
            class: `handbtn__glyph${armed?.power === power ? ' on' : ''}`,
            attrs: { 'aria-hidden': 'true' },
          },
          icon(POWER_ICON[power], 15),
        ),
      ),
    )

    // Le tiroir ouvert suit la partie : une carte ramassée pendant qu'on le lit
    // doit y apparaître, et une carte qui n'est plus jouable doit s'y éteindre.
    this.paintHandTray()
  }

  /**
   * Le tiroir de la main.
   *
   * Il dit d'une carte tout ce que le bouton ne peut pas : son nom, son effet,
   * et si elle se joue maintenant. Un appui l'arme et referme le tiroir — le
   * geste suivant est sur le plateau ou sur le dé, et un panneau resté ouvert
   * les cacherait tous les deux.
   */
  private showHand(): void {
    if (this.handTray) return this.closeHandTray()
    if (this.session?.hand().cards.length === 0) return

    const body = h('div', { class: 'tray__cards' })
    const foot = h('span', { class: 'hint center' })
    const grab = h(
      'div',
      { class: 'sheet__grab' },
      h('span', { class: 'sheet__grip', attrs: { 'aria-hidden': 'true' } }),
      h('h2', { class: 'tray__title', text: t('hand.title') }),
    )
    const sheet = h(
      'div',
      { class: 'sheet tray__sheet' },
      this.sheetClose(() => this.closeHandTray()),
      grab,
      body,
      foot,
      // Les malus ne passent jamais par la main : la question « c'était quoi,
      // déjà ? » vient le plus souvent d'eux, et il faut un chemin vers eux.
      h('button', {
        class: 'tray__all',
        text: t('table.powers.see', { n: POWER_LIST.length }),
        on: { click: () => this.showPowers() },
      }),
    )
    const overlay = h(
      'div',
      {
        class: 'overlay tray',
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('hand.title') },
        on: {
          click: (ev) => {
            if (ev.target === overlay) this.closeHandTray()
          },
        },
      },
      sheet,
    )

    // La feuille se pousse par sa poignée. Pas par n'importe où : son corps
    // défile, et un doigt qui descend dedans doit faire défiler — pas emporter
    // la feuille entière au premier geste de lecture.
    swipeAway(grab, {
      moves: sheet,
      way: 'down',
      tapAway: false,
      onDismiss: () => this.closeHandTray(),
    })

    this.handTray = { overlay, body, foot }
    addEventListener('keydown', this.onTrayKey)
    document.body.append(overlay)
    this.paintHandTray()
  }

  private onTrayKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') this.closeHandTray()
  }

  private closeHandTray(): void {
    if (!this.handTray) return
    removeEventListener('keydown', this.onTrayKey)
    this.handTray.overlay.remove()
    this.handTray = null
  }

  /** Le contenu du tiroir, refait à chaque changement d'état. */
  private paintHandTray(): void {
    const tray = this.handTray
    const session = this.session
    if (!tray || !session) return
    const { cards, playable } = session.hand()

    fill(
      tray.body,
      ...cards.map((power) => {
        const spec = POWERS[power]
        const usable = playable.includes(power)
        const chosen = this.armed?.power === power
        const name = t(`power.${power}` as Key)
        return h(
          'div',
          { class: `tray-card tray-card--${spec.kind}${chosen ? ' chosen' : ''}` },
          h(
            'button',
            {
              class: 'tray-card__pick',
              disabled: !usable,
              attrs: { 'aria-pressed': String(chosen) },
              on: {
                click: () => {
                  // Toucher une carte ne la joue pas : elle s'arme, et le
                  // tiroir s'efface pour laisser voir le plateau et le dé.
                  this.armed = chosen ? null : { power }
                  if (this.autoTimer) clearTimeout(this.autoTimer)
                  this.autoTimer = null
                  this.closeHandTray()
                  this.update()
                },
              },
            },
            h('span', { class: `tray-card__glyph tray-card__glyph--${spec.kind}` }, icon(POWER_ICON[power], 22)),
            h(
              'span',
              { class: 'tray-card__text' },
              h('strong', { class: 'tray-card__name', text: name }),
              h('span', { class: 'tray-card__desc', text: t(`power.${power}.desc` as Key) }),
              // Une carte éteinte doit dire pourquoi. « Grisée sans raison » se
              // lit comme une panne, et l'on retape dessus jusqu'à y croire.
              h('span', {
                class: 'tray-card__state',
                text: chosen ? this.armedDetail() : usable ? t('hand.playable') : t('hand.later'),
              }),
            ),
          ),
          h(
            'button',
            {
              class: 'tray-card__info',
              attrs: { 'aria-label': t('hand.info', { power: name }) },
              on: { click: () => this.showPowers(power) },
            },
            icon('info', 15),
          ),
        )
      }),
    )
    tray.foot.textContent = t('hand.count', { n: cards.length, max: HAND_LIMIT })
  }

  /**
   * La croix d'une feuille, en haut à droite et toujours là.
   *
   * Un bouton « Fermer » posé sous le contenu oblige à faire défiler une feuille
   * entière pour en sortir — et sur le catalogue des sept cartes, c'est un écran
   * et demi de défilement pour refermer ce qu'on est venu lire trois secondes.
   * La croix, elle, colle au haut de la zone visible : elle est au même endroit
   * quel que soit l'endroit où l'on a défilé.
   */
  private sheetClose(onClose: () => void): HTMLElement {
    return h(
      'button',
      {
        class: 'sheet__close',
        attrs: { 'aria-label': t('common.close') },
        on: { click: onClose },
      },
      icon('close', 18),
    )
  }

  private renderTurn(host: HTMLElement, state: GameState, moveCount: number): void {
    const session = this.session!
    const mine = session.myTurn
    const current = state.players.find((p) => p.seat === state.turn)
    const finished = state.phase === 'finished'

    let title: string
    let detail = ''

    if (this.tumbling) {
      title = t('play.rolling')
    } else if (finished) {
      title = t('play.over')
    } else if (mine && state.voided) {
      title = t('play.voided')
      detail = t('play.voided.hint', { n: state.variant.maxConsecutiveSixes })
    } else if (mine && state.phase === 'rolling') {
      title = t('play.yourTurn')
      // Un joueur qu'on aide a le droit de le savoir : le dé qui penche vers la
      // sortie se dit, il ne se cache pas.
      const mercy = mercyOf(state, state.turn)
      detail = mercy >= 1 ? t('play.mercy.sure') : mercy > 0 ? t('play.mercy') : t('play.touchDie')
    } else if (mine && moveCount === 0) {
      title = t('play.nothing')
      // Ce qui va se passer, et non ce qui pourrait se passer : le tour part
      // tout seul, il part tout seul mais laisse le temps d'une carte, ou il
      // attend un geste. Trois situations, trois phrases.
      detail = !this.canAutoPlay(state, moveCount)
        ? t('play.nothing.pass')
        : this.autoDelay() > AUTO_MS
          ? t('play.nothing.card')
          : t('play.nothing.hint')
    } else if (mine && moveCount === 1) {
      title = t('play.youRolled', { dice: state.dice ?? '' })
      detail = !this.canAutoPlay(state, moveCount)
        ? t('play.pickOne.tap')
        : this.autoDelay() > AUTO_MS
          ? t('play.pickOne.card')
          : t('play.pickOne')
    } else if (mine) {
      title = t('play.youRolled', { dice: state.dice ?? '' })
      detail = t('play.pickMany')
    } else if (state.phase === 'rolling') {
      // `turnOf` porte déjà la phrase entière — « Tour de Sami », « Sami's turn » :
      // la préposition et l'élision sont des affaires de langue, pas de gabarit.
      title = turnOf(current?.name ?? '…')
    } else {
      title = t('play.rolled', { name: current?.name ?? '…', dice: state.dice ?? '' })
    }

    // Une carte armée passe devant tout le reste. « Touchez le dé » au-dessus
    // d'une main qui réclame un cheval, ce sont deux consignes qui se
    // contredisent — et la rangée de cartes, à trois cartes sur un petit
    // écran, n'a plus la place d'en porter une (voir `.hand__hint`).
    if (mine && !finished && this.armed) detail = this.armedDetail()

    const clock = h('span', { class: 'turnline__clock' })
    this.turnClock = clock

    fill(
      host,
      h(
        'div',
        { class: 'turnline-row' },
        finished ? null : this.token(state.turn),
        h('strong', { text: title }),
        clock,
      ),
      // Toujours présente, même vide : la ligne garde sa hauteur (voir le CSS)
      // pour que le bloc ne change jamais de taille d'un tour à l'autre.
      h('span', { class: 'detail', text: detail ? `· ${detail}` : '' }),
    )

    // Le dé est le bouton « j'agis », et il l'est dans les trois cas : il lance,
    // il valide une carte armée — même quand un dé est déjà sur la table, car
    // c'est là qu'on joue un rejeu ou un galop de rattrapage — et il passe la
    // main quand il n'y a rien à jouer.
    //
    // `!this.tumbling` : tant qu'il roule, il n'accepte rien. Un appui pendant
    // l'animation passerait le tour ou lâcherait une carte avant même qu'on ait
    // lu le chiffre.
    const acting = mine && !finished && !this.tumbling && !session.paused
    const canPass = acting && state.phase === 'moving' && moveCount === 0
    const canRoll = acting && (state.phase === 'rolling' || this.armedReady() || canPass)
    const die = this.mounts!.dieBtn
    die.disabled = !canRoll
    die.classList.toggle('ready', canRoll)
    this.startClock()
  }

  // ─────────────────────────── la pause ───────────────────────────

  /**
   * La partie figée, et la feuille qui le dit.
   *
   * **Tout s'arrête** : le bot qui allait jouer, la pendule du tour, le dé et
   * le plateau (voir `setPaused` côté session). La feuille n'est donc pas un
   * décor posé devant un jeu qui continuerait derrière — elle est la seule
   * chose qui bouge encore, et le seul geste qui la referme est son bouton :
   * un fond qu'on ferme au doigt relancerait la partie en reprenant son
   * téléphone dans sa poche.
   *
   * L'écran a le droit de s'éteindre pendant ce temps-là : c'est même pour ça
   * qu'on met en pause.
   */
  private paintPause(): void {
    const session = this.session
    if (session?.paused !== true) {
      if (this.pauseSheet) {
        this.closePause()
        // Le coup évident du tour en cours a été programmé, puis refusé pendant
        // la pause : sans cet oubli, il ne serait jamais reprogrammé et le tour
        // attendrait un doigt qui ne sait pas qu'on l'attend.
        this.autoAt = -1
        setKeepAwake(this.screen === 'play')
      }
      return
    }
    if (this.pauseSheet) return

    if (this.autoTimer) clearTimeout(this.autoTimer)
    this.autoTimer = null
    setKeepAwake(false)
    const resume = h('button', {
      class: 'btn red',
      text: t('pause.resume'),
      on: { click: () => session.setPaused(false) },
    })
    this.pauseSheet = h(
      'div',
      {
        class: 'overlay paused',
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('pause.title') },
      },
      h(
        'div',
        { class: 'sheet pause__sheet' },
        h('span', { class: 'pause__mark' }, icon('pause', 34)),
        h('h2', { style: { textAlign: 'center' }, text: t('pause.title') }),
        h('p', { class: 'hint center', text: t('pause.body') }),
        resume,
      ),
    )
    addEventListener('keydown', this.onPauseKey)
    document.body.append(this.pauseSheet)
    resume.focus()
  }

  private closePause(): void {
    if (!this.pauseSheet) return
    removeEventListener('keydown', this.onPauseKey)
    this.pauseSheet.remove()
    this.pauseSheet = null
  }

  private onPauseKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') this.session?.setPaused(false)
  }

  /** Une carte est armée et ne lui manque plus rien : le dé peut la lâcher. */
  private armedReady(): boolean {
    return armedReady(this.armed)
  }

  /**
   * Le geste qui manque à la carte armée, en une ligne.
   *
   * Le dé pipé a sa phrase à lui : lui dire « lancez le dé » ne veut rien dire,
   * puisque ce sont ses deux boutons — petit nombre, grand nombre — qui le
   * lancent et le dépensent d'un même geste.
   */
  private armedDetail(): string {
    const armed = this.armed
    if (!armed) return ''
    if (!armedReady(armed)) return t('hand.aim')
    return armed.power === 'des' ? t('hand.roll.boost') : t('hand.roll')
  }

  // ─────────────────────────── le temps de réflexion ───────────────────────────

  /**
   * Le contour qui se vide. Il est peint par une variable CSS remise à jour à
   * chaque image plutôt que par une animation déclarée : le décompte doit
   * repartir de la même valeur chez tout le monde, et une animation lancée à
   * l'affichage aurait décrit le temps de CET écran, pas celui du tour.
   */
  private turnRingFor(): HTMLElement {
    const ring = h('span', { class: 'pcard__timer', attrs: { 'aria-hidden': 'true' } })
    this.turnRing = ring
    this.startClock()
    return ring
  }

  private startClock(): void {
    if (this.clockFrame !== null) return
    this.clockFrame = requestAnimationFrame(this.tickClock)
  }

  private stopClock(): void {
    if (this.clockFrame !== null) cancelAnimationFrame(this.clockFrame)
    this.clockFrame = null
    this.turnRing = null
    this.turnClock = null
  }

  private tickClock = (): void => {
    this.clockFrame = null
    const left = this.session?.turnLeft() ?? null

    if (this.turnRing) {
      this.turnRing.style.setProperty('--left', (left ?? 0).toFixed(3))
      this.turnRing.classList.toggle('urgent', left !== null && left <= URGENT_LEFT)
    }
    if (this.turnClock) {
      // Le chiffre n'apparaît qu'à la fin, et seulement pour qui doit jouer :
      // un compte à rebours permanent au-dessus du dé ferait de chaque tour une
      // épreuve chronométrée, ce que le contour dit déjà bien assez.
      const urgent = left !== null && left <= URGENT_LEFT && this.session?.myTurn === true
      this.turnClock.textContent = urgent ? t('play.seconds', { n: this.session!.turnSeconds() }) : ''
    }

    if (left === null || this.screen !== 'play') return
    this.clockFrame = requestAnimationFrame(this.tickClock)
  }

  /**
   * Un coup sans choix n'est pas un choix : quand il n'y a rien à jouer, ou un
   * seul coup possible, le tour se déroule tout seul après un temps de lecture.
   * Seul l'appareil qui contrôle le siège agit — les autres regardent.
   *
   * Une carte jouable en main ne l'empêche pas ; elle rallonge le délai, le
   * temps qu'un doigt puisse arriver avant lui (voir `autoDelay`). Toucher une
   * carte annule le coup programmé — c'est ce que fait le gestionnaire d'appui.
   */
  private scheduleObvious(state: GameState, moves: Move[]): void {
    if (this.autoAt === state.seq) return
    if (!this.canAutoPlay(state, moves.length)) return

    this.autoAt = state.seq
    if (this.autoTimer) clearTimeout(this.autoTimer)
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null
      // L'état a pu bouger pendant l'attente : on ne joue que s'il est intact.
      const now = this.session?.game
      if (!now || now.seq !== state.seq || !this.session!.myTurn || now.phase !== 'moving') return
      const move = moves[0]
      this.session!.dispatch(move ? { type: 'move', pawnId: move.pawnId } : { type: 'pass' })
    }, this.autoDelay())
  }

  /** Peint une face sur le dé, sans le retirer du DOM : l'animation survit. */
  private paintDie(value: number | null, rolled: boolean): void {
    const mounts = this.mounts
    if (!mounts) return
    mounts.dieBtn.classList.toggle('rolled', rolled)
    mounts.die.classList.toggle('light', rolled)
    mounts.die.classList.toggle('waiting', value === null)
    if (value === null) {
      fill(mounts.die, h('span', { text: '?' }))
      return
    }
    fill(
      mounts.die,
      ...(PIPS[value] ?? []).map((i) =>
        h('b', { style: { gridRow: String(Math.ceil(i / 3)), gridColumn: String(((i - 1) % 3) + 1) } }),
      ),
    )
  }

  /**
   * Le lancer : le dé roule en changeant de face, puis retombe sur le résultat.
   * Les faces intermédiaires sont purement décoratives — le tirage, lui, a déjà
   * eu lieu dans le moteur.
   *
   * « Mouvement réduit » ralentit le lancer, il ne le supprime pas. Le dé est le
   * seul endroit où l'on voit qu'un tour vient d'être joué : sans rien, un
   * chiffre change tout seul dans un coin et personne ne sait de qui il vient.
   * Ce n'est pas théorique — Firefox sur Android relaie ce réglage dès que le
   * système coupe ses animations (économiseur de batterie, échelle d'animation
   * à zéro dans les options de développeur), et le dé y restait inerte alors que
   * le même téléphone l'animait sous Chrome. La sobriété est déléguée à la
   * feuille de style, qui remplace la culbute par un simple battement.
   */
  private tumble(result: number): void {
    const die = this.mounts?.dieBtn
    if (!die) return

    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
    const period = calm ? 150 : 70
    const duration = calm ? 450 : 620

    this.tumbling = true
    die.classList.add('tumbling')
    const spin = setInterval(() => this.paintDie(1 + Math.floor(Math.random() * 6), true), period)

    setTimeout(() => {
      clearInterval(spin)
      this.tumbling = false
      die.classList.remove('tumbling')
      this.paintDie(result, true)
      die.classList.add('landed')
      setTimeout(() => die.classList.remove('landed'), 340)
      // Le résultat est posé : le reste de l'écran peut enfin le refléter.
      this.update()
    }, duration)
  }

  // ─────────────────────────── 08 · victoire ───────────────────────────

  /**
   * La feuille de match.
   *
   * Le podium dit qui a gagné ; il ne dit pas pourquoi, ni ce qu'on a failli
   * faire. « 4,1 de moyenne au dé et perdu quand même » est la phrase qui fait
   * relancer une manche, et elle ne se reconstitue pas depuis l'état final :
   * elle se compte pendant la partie, dans le moteur.
   *
   * Les colonnes qui n'apprennent rien à cette table-là ne s'affichent pas —
   * la colonne des pouvoirs sur une partie sans pouvoirs serait une colonne de
   * zéros, et une colonne de zéros se lit comme une panne.
   */
  private statsCard(state: GameState, order: Seat[]): HTMLElement | null {
    if (!state.stats) return null
    const rows = order.map((seat) => ({ seat, stats: statsOf(state, seat) }))
    if (rows.every((r) => r.stats.rolls === 0)) return null

    const average = (s: SeatStats) => (s.rolls === 0 ? '—' : (s.pips / s.rolls).toFixed(1))
    type Column = { key: Key; value: (s: SeatStats) => string; show: boolean }
    const columns: Column[] = (
      [
        { key: 'stats.distance', value: (s) => String(s.distance), show: true },
        { key: 'stats.average', value: average, show: true },
        { key: 'stats.captures', value: (s) => String(s.captures), show: true },
        { key: 'stats.losses', value: (s) => String(s.losses), show: true },
        { key: 'stats.sixes', value: (s) => String(s.sixes), show: true },
        {
          key: 'stats.powers',
          value: (s) => String(s.powers),
          show: rows.some((r) => r.stats.powers > 0),
        },
      ] satisfies Column[]
    ).filter((c) => c.show)

    // Un bloc par joueur, et non un tableau à colonnes.
    //
    // Six nombres et un nom ne tiennent pas sur la largeur d'un téléphone : le
    // tableau à colonnes écrasait la colonne des noms jusqu'à la faire
    // disparaître, et débordait quand même. Le nom prend donc sa ligne, et les
    // valeurs se rangent dessous en autant de colonnes que la largeur permet.
    return h(
      'div',
      { class: 'card stats' },
      h('span', { class: 'label', text: t('stats.title') }),
      ...rows.map(({ seat, stats }) =>
        h(
          'div',
          { class: 'stats__player', style: this.seatVars(seat) },
          h(
            'span',
            { class: 'stats__who' },
            h('i'),
            h('b', { text: state.players.find((p) => p.seat === seat)?.name ?? '' }),
          ),
          h(
            'div',
            { class: 'stats__pairs' },
            ...columns.map((c) =>
              h(
                'span',
                { class: 'stats__pair' },
                h('b', { text: c.value(stats) }),
                h('span', { text: t(c.key) }),
              ),
            ),
          ),
        ),
      ),
    )
  }

  private renderPodium(state: GameState): void {
    // On ne teste que le podium, et non « un calque quelconque » : le chat ou le
    // catalogue des pouvoirs ouverts au moment de la victoire empêchaient la
    // feuille de match d'apparaître, et plus rien ne la rappelait ensuite.
    if (document.querySelector('.overlay.podium')) return
    const session = this.session!
    const winner = state.players.find((p) => p.seat === state.ranking[0])
    const lastStep = geometryFor(state.variant).lastStep
    const done = (seat: Seat) => pawnsOf(state, seat).filter((p) => p.steps === lastStep).length

    // Les joueurs restants suivent les arrivés, du plus avancé au moins avancé.
    const rest = state.players
      .filter((p) => !state.ranking.includes(p.seat))
      .sort((a, b) => done(b.seat) - done(a.seat))
    const order: Seat[] = [...state.ranking, ...rest.map((p) => p.seat)]

    const overlay = h(
      'div',
      { class: 'overlay podium' },
      h(
        'div',
        { class: 'sheet' },
        h('div', { class: 'confetti' }, ...Array.from({ length: 5 }, () => h('span'))),
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'trophy' }, h('span'), h('span'), h('span')),
          h('h2', {
            style: { textAlign: 'center' },
            text: t('win.title', { name: winner?.name ?? t('win.nobody') }),
          }),
          h('p', {
            class: 'hint center',
            // Le nom de la variante n'est plus dans l'état — il ne pouvait pas y
            // être et rester traduisible : `id` sert de clé, `variantName` la lit.
            text: t('win.detail', {
              n: done(state.ranking[0] ?? 0),
              total: state.variant.pawnsPerPlayer,
              variant: variantName(state.variant.id),
            }),
          }),
        ),
        h(
          'div',
          { class: 'podium' },
          ...order.map((seat, i) =>
            h(
              'div',
              {
                class: `rank${i === 0 ? ' first' : ''}`,
                style: this.seatVars(seat),
              },
              h('span', { class: 'n', text: String(i + 1) }),
              this.token(seat),
              h('span', { class: 'who', text: state.players.find((p) => p.seat === seat)?.name ?? '' }),
              h('span', { class: 'score', text: `${done(seat)}/${state.variant.pawnsPerPlayer}` }),
            ),
          ),
        ),
        this.statsCard(state, order),
        session.isHost
          ? h('button', {
              class: 'btn red',
              text: t('win.rematch'),
              on: {
                click: () => {
                  overlay.remove()
                  this.board?.reset()
                  this.lastDie = null
                  session.restart()
                },
              },
            })
          : h('p', { class: 'hint center', text: t('win.hostRematch') }),
        h('button', {
          class: 'btn',
          text: t('win.home'),
          on: {
            click: () => {
              overlay.remove()
              this.quit()
            },
          },
        }),
      ),
    )
    document.body.append(overlay)
  }

  // ─────────────────────────── chat ───────────────────────────

  /** Le bouton qui ouvre le chat, avec son point rouge de message non lu. */
  private chatButton(): HTMLElement {
    const dot = h('span', { class: 'chat-dot' })
    this.chatDot = dot
    this.updateChatBadge()
    return h(
      'button',
      {
        class: 'icon-btn chat-btn',
        attrs: { 'aria-label': t('chat.title') },
        on: { click: () => this.renderChat() },
      },
      icon('chat'),
      dot,
    )
  }

  private updateChatBadge(): void {
    this.chatDot?.classList.toggle('show', this.chatUnread > 0)
  }

  /** Reçu par la session, que le panneau soit ouvert ou non. */
  private onChat(message: ChatMessage): void {
    if (this.chatOpen) {
      this.appendChatMessage(message)
    } else if (message.clientId !== this.session?.self) {
      this.chatUnread++
      this.updateChatBadge()
    }

    const seat = this.session?.lobby.players.find((p) => p.clientId === message.clientId)?.seat
    if (seat !== undefined) this.showChatBubble(seat, message.text)
  }

  /**
   * La bulle posée sur la carte de son auteur — et chassable au doigt.
   *
   * Elle sort de la carte par le haut et couvre le siège du dessus : quatre
   * secondes, c'est court quand on lit et long quand on a lu. Elle part donc
   * comme les autres flottants, d'un appui ou d'un geste, et sa minuterie part
   * avec elle.
   */
  private chatBubble(seat: Seat, text: string): HTMLElement {
    const el = h(
      'div',
      { class: `pcard__bubble${emojiOnly(text) ? ' solo' : ''}` },
      h('span', { class: 'pcard__bubble-text', text }),
    )
    swipeAway(el, {
      onDismiss: () => {
        const shown = this.chatBubbles.get(seat)
        if (shown) clearTimeout(shown.timer)
        this.chatBubbles.delete(seat)
        this.refreshPlayerCards()
      },
    })
    return el
  }

  /** Fait apparaître le message sur la carte de son auteur, en jeu — pas
   *  besoin d'ouvrir le chat pour le voir passer. Un envoi qui se répète
   *  relance simplement la minuterie plutôt que d'empiler les bulles. */
  private showChatBubble(seat: Seat, text: string): void {
    const previous = this.chatBubbles.get(seat)
    if (previous) clearTimeout(previous.timer)

    const shown = text.length > CHAT_BUBBLE_MAX ? `${text.slice(0, CHAT_BUBBLE_MAX - 1)}…` : text
    const timer = setTimeout(() => {
      this.chatBubbles.delete(seat)
      this.refreshPlayerCards()
    }, CHAT_BUBBLE_MS)
    this.chatBubbles.set(seat, { text: shown, timer })
    this.refreshPlayerCards()
  }

  /** Redessine les cartes joueurs seules, sans passer par tout `refreshPlay` —
   *  une bulle qui expire ne doit pas perturber le dé ou le plateau. */
  private refreshPlayerCards(): void {
    if (this.screen !== 'play' || !this.mounts || !this.session?.game) return
    this.renderPlayers(this.mounts.players, this.session.game)
  }

  private closeChat(): void {
    this.chatOpen = false
    this.chatList = null
    document.querySelector('.overlay.chat')?.remove()
  }

  /**
   * Fermer le chat **d'un geste** — et non parce qu'on quitte la partie.
   *
   * La distinction n'est pas théorique : `teardown()` ferme le chat lui aussi,
   * et rappeler la feuille de match depuis là collait un podium tout neuf par
   * dessus l'écran d'accueil, sur une partie qui n'existait plus.
   */
  private dismissChat(): void {
    this.closeChat()
    this.showPodiumIfOver()
  }

  /**
   * La partie s'est terminée pendant qu'un calque couvrait l'écran : plus aucun
   * état n'arrivera pour rappeler la feuille de match. On la repose en fermant.
   */
  private showPodiumIfOver(): void {
    const state = this.session?.game
    if (state?.phase === 'finished' && this.screen === 'play') this.renderPodium(state)
  }

  /**
   * Le chat s'ouvre en feuille par le bas plutôt qu'en boîte centrée : le
   * pouce est là, le plateau reste visible au-dessus, et le clavier qui monte
   * pousse la feuille au lieu de la couper en deux.
   */
  private renderChat(): void {
    if (document.querySelector('.overlay.chat')) return
    const session = this.session!
    this.chatOpen = true
    this.chatUnread = 0
    this.updateChatBadge()

    const list = h('div', { class: 'chat__list', attrs: { 'aria-live': 'polite' } })
    this.chatList = list
    this.paintChatLog()

    const input = h('input', {
      attrs: { type: 'text', placeholder: t('chat.placeholder'), maxlength: '240', autocomplete: 'off' },
    }) as HTMLInputElement

    const send = () => {
      if (!input.value.trim()) return
      session.sendChat(input.value)
      input.value = ''
      input.focus()
    }

    const overlay = h(
      'div',
      {
        class: 'overlay chat',
        on: {
          click: (ev) => {
            if (ev.target === overlay) this.dismissChat()
          },
        },
      },
      h(
        'div',
        { class: 'sheet chat__sheet' },
        // La poignée dit « ceci est une feuille » avant même qu'on ait lu le
        // titre ; elle ne se touche pas, le fond et la croix ferment.
        h('span', { class: 'chat__grip' }),
        h(
          'div',
          { class: 'topbar chat__head' },
          h('h2', { text: t('chat.title') }),
          h('span', { style: { flex: '1' } }),
          h(
            'button',
            {
              class: 'icon-btn',
              attrs: { 'aria-label': t('common.close') },
              on: { click: () => this.dismissChat() },
            },
            icon('close', 20),
          ),
        ),
        list,
        // Une réaction part d'un seul appui : pas de composition, pas de
        // validation. Toutes tiennent à l'écran — une rangée qui défile
        // horizontalement cachait la moitié du choix derrière un geste que
        // rien n'annonçait.
        h(
          'div',
          { class: 'chat__emoji', attrs: { role: 'group', 'aria-label': t('chat.reactions') } },
          ...EMOJI.map((e) =>
            h('button', {
              class: 'chat__emoji-btn',
              text: e,
              attrs: { type: 'button', 'aria-label': e },
              on: { click: () => session.sendChat(e) },
            }),
          ),
        ),
        h(
          'form',
          {
            class: 'chat__row',
            on: {
              submit: (ev) => {
                ev.preventDefault()
                send()
              },
            },
          },
          input,
          // Bouton icône et non libellé : « Envoyer » mangeait la moitié de la
          // ligne, et le champ à côté n'affichait plus que « Écrire un mes ».
          h(
            'button',
            { class: 'icon-btn chat__send', attrs: { type: 'submit', 'aria-label': t('chat.send') } },
            icon('send', 22),
          ),
        ),
      ),
    )
    document.body.append(overlay)
    // Pas de focus automatique sur le champ : sur mobile ça ouvrirait le
    // clavier tout de suite, rétrécissant l'écran juste après l'affichage —
    // le panneau se retrouverait décalé sous les yeux de qui vient de l'ouvrir.
    list.scrollTop = list.scrollHeight
  }

  /** Redessine la liste entière : le groupage dépend du message précédent, un
   *  ajout isolé ne suffit donc pas à l'ouverture. */
  private paintChatLog(): void {
    const list = this.chatList
    const log = this.session?.chatLog ?? []
    if (!list) return
    if (!log.length) {
      fill(
        list,
        h('div', { class: 'chat__empty' }, icon('chat', 40), h('p', { class: 'hint center', text: t('chat.empty') })),
      )
      return
    }
    fill(list, ...log.map((m, i) => this.chatRow(m, log[i - 1])))
  }

  /**
   * Une ligne de conversation : le nom une seule fois par bloc, la bulle, et
   * l'heure posée dans un coin. Le nom prend la couleur du siège de son auteur —
   * c'est déjà comme ça que le plateau et les cartes désignent les joueurs.
   */
  private chatRow(message: ChatMessage, previous?: ChatMessage): HTMLElement {
    const session = this.session
    const mine = message.clientId === session?.self
    const seat = session?.lobby.players.find((p) => p.clientId === message.clientId)?.seat
    const grouped =
      previous !== undefined && previous.clientId === message.clientId && message.at - previous.at < CHAT_GROUP_MS
    const solo = emojiOnly(message.text)

    return h(
      'div',
      {
        class: `chat__msg${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}${solo ? ' solo' : ''}`,
        style: seat === undefined ? {} : this.seatVars(seat),
      },
      grouped || mine ? null : h('span', { class: 'chat__author', text: message.name }),
      h(
        'div',
        { class: 'chat__bubble' },
        h('span', { class: 'chat__text', text: message.text }),
        h('span', { class: 'chat__time', text: this.formatChatTime(message.at) }),
      ),
    )
  }

  private formatChatTime(at: number): string {
    return new Intl.DateTimeFormat(lang(), { hour: '2-digit', minute: '2-digit' }).format(new Date(at))
  }

  private appendChatMessage(message: ChatMessage): void {
    const list = this.chatList
    if (!list) return
    const log = this.session?.chatLog ?? []
    // L'état vide n'est pas une ligne de conversation : il part au premier mot.
    if (list.querySelector('.chat__empty')) list.replaceChildren()
    // `log` contient déjà `message` : le précédent est l'avant-dernier.
    list.append(this.chatRow(message, log[log.length - 2]))
    list.scrollTop = list.scrollHeight
  }

  // ─────────────────────────── divers ───────────────────────────

  private toastTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Un message flottant écrit dans la langue courante.
   *
   * Le pendant de `toast`, qui reçoit lui du texte déjà fait : ce que rapporte
   * le moteur ou un pair est déjà une phrase, ce que l'interface signale est une
   * clé. Les deux passent par le même bandeau.
   */
  private notify(key: Key, params?: Record<string, string | number>): void {
    this.toast(t(key, params))
  }

  private toast(message: string): void {
    document.querySelector('.toast')?.remove()
    const el = h('div', { class: 'toast', text: message })
    document.body.append(el)
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => el.remove(), 2800)
    // Posé en bas, il sort par le bas : le plus court chemin hors de l'écran.
    // Il couvre le dé et ses deux boutons, et l'on n'a pas toujours trois
    // secondes à donner à un message qu'on a lu en une.
    swipeAway(el, {
      tapWay: 'down',
      onDismiss: () => {
        if (this.toastTimer) clearTimeout(this.toastTimer)
        this.toastTimer = null
        el.remove()
      },
    })
  }
}
