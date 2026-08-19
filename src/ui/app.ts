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
 */
const AUTO_HOLD_MS = 2600
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
    dieBtn: HTMLButtonElement
    die: HTMLElement
    diceRow: HTMLElement
    boostLowBtn: HTMLButtonElement
    boostHighBtn: HTMLButtonElement
    boostCounts: HTMLElement[]
    hand: HTMLElement
    pauseBtn: HTMLButtonElement | null
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

  constructor(private root: HTMLElement) {}

  start(): void {
    // Ouvrir le lien d'un ami alors que le jeu tourne déjà ne recharge pas la
    // page : sans cela, on resterait sur l'écran précédent sans rien comprendre.
    // `replaceState` (utilisé à la création et en quittant) ne déclenche pas
    // l'événement, donc seul un vrai clic sur un lien passe ici.
    addEventListener('hashchange', () => {
      const code = location.hash.replace('#', '').toUpperCase()
      if (!code || code === this.session?.lobby.code) return
      this.closeChat()
      this.session?.destroy()
      this.session = null
      this.renderJoin(code)
    })

    const code = location.hash.replace('#', '').toUpperCase()
    if (code) this.renderJoin(code)
    else this.renderHome()
  }

  // ─────────────────────────── session ───────────────────────────

  private listeners() {
    return {
      onChange: () => this.update(),
      onError: (notice: Notice) => this.notify(NOTICE_KEY[notice.code], { name: notice.name ?? '' }),
      onChat: (message: ChatMessage) => this.onChat(message),
    }
  }

  private saveName(value: string): void {
    this.name = value.trim() || 'Joueur'
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
    this.session.addSeat('bot')
    this.update()
  }

  private openOnline(code: string, asHost: boolean): void {
    if (asHost) history.replaceState(null, '', `#${code}`)
    this.session = Session.online(code, this.name || 'Joueur', asHost, this.listeners())
    if (asHost) this.session.setVariant(this.variantId)
    this.update()
  }

  private quit(): void {
    if (this.autoTimer) clearTimeout(this.autoTimer)
    this.autoTimer = null
    this.autoAt = -1
    document.querySelector('.cardnotes')?.remove()
    this.closePause()
    this.armed = null
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
    setKeepAwake(false)
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

    if (session.game && session.lobby.started) {
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
        h('div', { class: 'dice-pair' }, this.face(5), this.face(6)),
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
    this.screen = 'lobby'
    const { lobby } = session
    const online = session.mode === 'online'
    const waiting = online && lobby.players.length === 0
    const variant = VARIANTS.find((v) => v.id === lobby.variantId) ?? VARIANTS[0]!

    const seats = h(
      'div',
      { class: 'seats' },
      ...lobby.players.map((p) => {
        const editable = session.isHost || p.clientId === session.self
        const nameField = h('input', {
          value: p.name,
          attrs: { maxlength: '16', 'aria-label': t('lobby.rename', { n: p.seat + 1 }) },
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
                      on: { click: () => session.addSeat('human') },
                    }),
                    h('button', {
                      class: 'btn small',
                      text: t('lobby.addBot'),
                      on: { click: () => session.addSeat('bot') },
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

    if (session.joinStatus === 'denied') {
      return h(
        'div',
        { class: 'card' },
        h('h3', { text: t('join.denied') }),
        h('p', { class: 'hint', text: t('join.denied.hint') }),
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
      h(
        'div',
        { class: 'sheet powers__sheet' },
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
        group('bonus'),
        group('malus'),
        h('button', { class: 'btn', text: t('common.close'), on: { click: () => close() } }),
      ),
    )
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

    const boardHost = h('div')
    // Les deux rangées se distinguent par une classe et non par leur rang : la
    // disposition paysage les place dans des lignes différentes, et compter les
    // enfants en CSS se serait cassé au premier bloc inséré.
    const top = h('div', { class: 'players players--top' })
    const bottom = h('div', { class: 'players players--bottom' })
    const turn = h('div', { class: 'turnline', attrs: { 'aria-live': 'polite' } })
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
    // La main vit au-dessus du dé et non dessous : une carte se joue *avant* de
    // lancer aussi bien qu'après, et la ranger sous le dé la ferait lire comme
    // une conséquence du lancer.
    const hand = h('div', { class: 'hand', attrs: { 'aria-label': t('hand.title') } })

    // La pause n'existe que sur un seul téléphone : voir `canPause` côté
    // session. En ligne, un bouton qui ne figerait que son propre écran
    // mentirait sur ce qu'il fait.
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
        top,
        // Le plateau ne se dimensionne pas sur la largeur mais sur la place qui
        // reste : c'est ce créneau qui la mesure (voir `.board-slot`). Sans lui,
        // un écran court poussait le dé hors de l'écran.
        h('div', { class: 'board-slot' }, boardHost),
        bottom,
        turn,
        hand,
        diceRow,
      ),
    )

    this.board = new BoardView(boardHost, this.session!.game!.variant)
    this.mounts = {
      players: [top, bottom],
      turn,
      dieBtn,
      die,
      diceRow,
      boostLowBtn: low.btn,
      boostHighBtn: high.btn,
      boostCounts: [low.count, high.count],
      hand,
      pauseBtn,
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
    if (this.armed !== null && needsPawn(this.armed.power)) {
      const aimed = this.armed.pawnId
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

    if (state.phase === 'finished') this.renderPodium(state)
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
    setTimeout(() => el.remove(), NOTE_MS[kind])
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
        bubble
          ? h(
              'div',
              { class: `pcard__bubble${emojiOnly(bubble.text) ? ' solo' : ''}` },
              h('span', { class: 'pcard__bubble-text', text: bubble.text }),
            )
          : null,
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
    mounts.diceRow.classList.toggle('validating', ready)
    // Le dé fait trois choses selon l'instant : il valide une carte armée, il
    // lance, ou il passe la main. Ce qu'il fait doit se dire, au moins pour qui
    // écoute l'écran.
    const label = ready
      ? t('hand.validate', { power: t(`power.${this.armed!.power}` as Key) })
      : state.phase === 'moving' && moveCount === 0
        ? t('play.pass')
        : t('play.roll')
    mounts.dieBtn.setAttribute('aria-label', label)
  }

  /**
   * Ses propres cartes — jamais celles des autres.
   *
   * Une carte qui ne mène à rien maintenant reste visible mais éteinte : la
   * retirer ferait croire qu'on l'a perdue. Toucher une carte ne la joue pas :
   * elle s'arme, on désigne son cheval sur le plateau s'il en faut un, et c'est
   * le dé qui la lâche. Un second appui la range.
   *
   * **Chaque carte porte son ⓘ.** L'annonce du ramassage passe et ne revient
   * pas ; trois tours plus tard, il ne reste qu'un mot sur une pastille, et
   * « Faux pas » ne dit pas de combien on recule. Le petit rond ouvre le
   * catalogue sur la carte touchée — sans rien jouer, sans rendre la main, et
   * la partie continue derrière. Il ouvre le catalogue **entier** et non une
   * fiche isolée : la question « c'est quoi déjà ? » vient souvent d'un malus
   * qu'on vient de subir et qui, lui, n'est jamais passé par la main.
   */
  private renderHand(host: HTMLElement): void {
    const session = this.session!
    const { cards, playable } = session.hand()

    host.classList.toggle('empty', cards.length === 0)
    host.classList.toggle('aiming', this.armed !== null)
    if (cards.length === 0) {
      fill(host)
      return
    }

    const armed = this.armed
    // Ce qu'il reste à faire, dans l'ordre où il faut le faire. Le dé pipé a sa
    // phrase à lui : lui « lancer le dé » ne veut rien dire, puisque ce sont ses
    // deux boutons — petit nombre, grand nombre — qui le lancent et le dépensent.
    const hint = !armed
      ? t('hand.count', { n: cards.length, max: HAND_LIMIT })
      : needsPawn(armed.power) && armed.pawnId === undefined
        ? t('hand.aim')
        : armed.power === 'des'
          ? t('hand.roll.boost')
          : t('hand.roll')

    fill(
      host,
      ...cards.map((power) => {
        const usable = playable.includes(power)
        const chosen = armed?.power === power
        const name = t(`power.${power}` as Key)
        const desc = t(`power.${power}.desc` as Key)
        return h(
          'span',
          { class: 'hand__slot' },
          h(
            'button',
            {
              class: `hand__card${usable ? ' on' : ''}${chosen ? ' aimed' : ''}`,
              disabled: !usable,
              attrs: { 'aria-pressed': String(chosen), 'aria-label': `${name} — ${desc}` },
              on: {
                click: () => {
                  // Ranger la carte armée, ou en armer une autre. Dans les deux
                  // cas rien n'est joué : c'est le dé qui joue.
                  this.armed = chosen ? null : { power }
                  // Un coup évident déjà programmé ne doit pas passer devant la
                  // carte qu'on vient de choisir.
                  if (this.autoTimer) clearTimeout(this.autoTimer)
                  this.autoTimer = null
                  this.update()
                },
              },
            },
            // La figure d'abord : dans un paquet, une carte se reconnaît à son
            // dessin bien avant qu'on ait lu son nom.
            h('span', { class: 'hand__glyph', attrs: { 'aria-hidden': 'true' } }, icon(POWER_ICON[power], 15)),
            // Pas de numéro : deux cartes du même nom sont deux boutons du même
            // nom, et c'est déjà lisible. Le compte est sous la rangée.
            h('span', { class: 'hand__name', text: name }),
          ),
          // Le ⓘ est posé sur le coin de la pastille, comme le compteur des
          // bonus de dé : en position absolue, il ne coûte pas un pixel de la
          // rangée — et la rangée n'a pas un pixel à donner (voir le CSS).
          h(
            'button',
            {
              class: 'hand__info',
              attrs: { 'aria-label': t('hand.info', { power: name }) },
              on: { click: () => this.showPowers(power) },
            },
            icon('info', 13),
          ),
        )
      }),
      h('span', { class: 'hand__hint', text: hint }),
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
        ? this.armed
          ? t('play.armed')
          : t('play.nothing.pass')
        : this.autoDelay() > AUTO_MS
          ? t('play.nothing.card')
          : t('play.nothing.hint')
    } else if (mine && moveCount === 1) {
      title = t('play.youRolled', { dice: state.dice ?? '' })
      detail = !this.canAutoPlay(state, moveCount)
        ? this.armed
          ? t('play.armed')
          : t('play.pickOne.tap')
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
    if (mine && !finished && this.armed) {
      detail = this.armedReady() ? t('play.armed') : t('hand.aim')
    }

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
    if (document.querySelector('.overlay')) return
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
      { class: 'overlay' },
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
            if (ev.target === overlay) this.closeChat()
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
            { class: 'icon-btn', attrs: { 'aria-label': t('common.close') }, on: { click: () => this.closeChat() } },
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
  }
}
