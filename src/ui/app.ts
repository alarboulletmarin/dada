/**
 * Écrans et interactions. Toute décision de règle appartient au moteur ;
 * ce fichier ne fait qu'afficher un état et transmettre des intentions.
 *
 * Le parcours suit la maquette : accueil → choix du jeu → salon → partie,
 * avec un détour possible par « rejoindre » et par les règles.
 */

import { BOARD_SHAPES, geometryFor, isBoardShape, type BoardShape } from '../game/board.ts'
import { mercyOf, pawnsOf } from '../game/engine.ts'
import { bonusCount, DECK_SIZE, POWER_LIST } from '../game/powers.ts'
import { STABLE, type GameState, type Move, type Seat, type Variant } from '../game/types.ts'
import { VARIANTS } from '../game/variants.ts'
import { makeCode, type ChatMessage } from '../net/room.ts'
import { clearInvite, clearSave, readInvite, readSave } from '../net/save.ts'
import { Session, type Notice, type NoticeCode } from '../net/session.ts'
import { aboutLabel, renderAbout } from './about.ts'
import { BoardView, SEAT_MARKS } from './board-view.ts'
import { fill, h, setKeepAwake } from './dom.ts'
import { icon } from './icons.ts'
import { lang, LANG_LABEL, nextLang, setLang, since, t, type Key } from './i18n.ts'
import { applyTheme, nextTheme, readTheme, THEME_ICON } from './theme.ts'

const NAME_KEY = 'dada.name'
/** Temps laissé au dé pour retomber avant qu'un coup évident ne se joue seul. */
const AUTO_MS = 600
const CODE_LENGTH = 5
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

/** Pastille de chaque variante : de la présentation, pas des règles. */
const BADGES: Record<string, 'die' | 'pawn' | 'bolt'> = {
  'petits-chevaux': 'die',
  ludo: 'pawn',
  rapide: 'bolt',
}

/** Les réactions du chat : une poignée d'expressions, pas une bibliothèque
 *  entière. Un appui envoie — c'est tout l'intérêt d'une réaction : on ne
 *  compose pas un message avec, on répond du tac au tac pendant son tour. */
const EMOJI = ['😀', '😂', '😍', '😮', '😢', '😡', '👍', '👎', '🙌', '🎉', '🔥', '❤️', '🐴', '🎲', '⭐', '💀']
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

type Screen = 'home' | 'pick' | 'join' | 'lobby' | 'play' | 'rules' | 'about'

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
  } | null = null
  private name = localStorage.getItem(NAME_KEY) ?? ''
  /** Ce qu'on fera de la variante choisie sur l'écran « on joue à quoi ? ». */
  private picking: 'online' | 'local' | 'change' = 'online'
  private variantId = VARIANTS[0]!.id
  /** Dernier événement du journal déjà annoncé — voir `announce`. */
  private announced = -1
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
      ...VARIANTS.map((v) => {
        const badge = h('span', { class: `badge b${VARIANTS.indexOf(v) + 1}` })
        const kind = BADGES[v.id] ?? 'die'
        if (kind === 'die') badge.append(this.face(5))
        else if (kind === 'pawn') badge.append(this.token(null))
        else badge.append(icon('bolt', 30))

        return h(
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
          badge,
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
        )
      }),
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
      submit.disabled = value.length < 4
    }
    input.addEventListener('input', paint)

    const join = () => {
      if (value.length < 4) return this.notify('join.tooShort')
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

        h(
          'div',
          { class: 'stack' },
          h('span', { class: 'label', text: t('lobby.rules', { variant: variantName(variant.id) }) }),
          this.ruleChips(variant),
          session.isHost
            ? h('button', {
                class: 'btn small',
                text: t('lobby.change'),
                on: {
                  click: () => {
                    this.picking = 'change'
                    this.variantId = variant.id
                    this.renderPick()
                  },
                },
              })
            : null,
        ),

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

  /** Les réglages de la variante, lisibles d'un coup d'œil. */
  private ruleChips(v: Variant): HTMLElement {
    const chips: [string, boolean][] = [
      [t('chip.exit', { rolls: v.exitRolls.join(t('chip.or')) }), true],
      [t('chip.six'), v.extraTurnOnSix],
      [t('chip.capture'), true],
      [t('chip.star'), v.starSquaresAreSafe],
      [t('chip.exact'), v.exactFinish],
      [t('chip.single'), v.onePerSquare],
      [t('chip.blockade'), v.blockades],
      [t('chip.bonus'), v.extraTurnOnCapture],
    ]
    return h(
      'div',
      { class: 'chips' },
      ...chips.map(([text, on]) =>
        h('span', { class: `chip${on ? ' on' : ''}` }, text, on ? icon('check', 15) : null),
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
        h(
          'div',
          { class: 'row row--split' },
          h('strong', { text: t('table.powers') }),
          h('button', {
            class: `toggle${powers ? ' on' : ''}`,
            disabled: !host,
            attrs: { role: 'switch', 'aria-checked': String(powers), 'aria-label': t('table.powers') },
            text: t(powers ? 'table.powers.on' : 'table.powers.off'),
            on: { click: () => session.setPowers(!powers) },
          }),
        ),
        h('p', { class: 'hint', text: t('table.powers.hint') }),
        h('button', {
          class: 'btn small',
          text: t('table.powers.see', { n: POWER_LIST.length }),
          on: { click: () => this.showPowers() },
        }),
      ),
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
  private showPowers(): void {
    if (document.querySelector('.overlay.powers')) return

    const close = (): void => {
      removeEventListener('keydown', onKey)
      overlay.remove()
    }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') close()
    }

    const group = (kind: 'bonus' | 'malus') =>
      h(
        'div',
        { class: `powers-group powers-group--${kind}` },
        h('span', { class: 'label', text: t(kind === 'bonus' ? 'powers.bonus' : 'powers.malus') }),
        ...POWER_LIST.filter((p) => p.kind === kind).map((p) =>
          h(
            'div',
            { class: 'power-row' },
            h('span', { class: `power-mark power-mark--${p.kind}` }),
            h(
              'div',
              { class: 'power-text' },
              h('strong', { text: t(`power.${p.id}` as Key) }),
              h('span', { class: 'desc', text: t(`power.${p.id}.desc` as Key) }),
            ),
            h('span', { class: 'power-copies', text: t('powers.copies', { n: p.copies }) }),
          ),
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
        h(
          'div',
          { class: 'card' },
          h('h2', { style: { textAlign: 'center' }, text: t('powers.title') }),
          h('p', {
            class: 'hint center',
            text: t('table.powers.fair', {
              n: DECK_SIZE,
              bonus: bonusCount,
              malus: DECK_SIZE - bonusCount,
            }),
          }),
          group('bonus'),
          group('malus'),
        ),
        h('button', { class: 'btn', text: t('common.close'), on: { click: () => close() } }),
      ),
    )
    addEventListener('keydown', onKey)
    document.body.append(overlay)
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
        h('p', { class: 'hint center push', text: t('rules.footer') }),
      ),
    )
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
        on: {
          click: () => {
            const game = this.session?.game
            if (!game || !this.session!.myTurn || game.phase !== 'rolling') return
            this.session!.dispatch({ type: 'roll' })
          },
        },
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
          on: { click: () => this.session!.dispatch({ type: 'roll', boost: side }) },
        },
        h('span', { class: 'boost__label', text: t(side === 'low' ? 'play.boost.low' : 'play.boost.high') }),
        count,
      )
      return { btn, count }
    }
    const low = boost('low')
    const high = boost('high')
    const diceRow = h('div', { class: 'dice-row' }, low.btn, dieBtn, high.btn)

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
          h(
            'button',
            {
              class: 'icon-btn',
              attrs: { 'aria-label': t('rules.title') },
              on: { click: () => this.renderRules(() => this.update()) },
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
    }
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
    const moves = session.moves()
    if (state.dice !== null) this.lastDie = state.dice

    const canBoost = session.myTurn && state.phase === 'rolling' && state.diceBoosts > 0
    mounts.boostLowBtn.disabled = !canBoost
    mounts.boostHighBtn.disabled = !canBoost
    // Réserve épuisée : les boutons s'effacent au lieu de rester grisés à vie.
    // Le dé garde sa place, la ligne garde sa hauteur — rien ne bouge sous le
    // plateau, et l'écran ne se réorganise pas au dernier bonus dépensé.
    mounts.diceRow.classList.toggle('spent', state.diceBoosts === 0)
    const remaining = t(state.diceBoosts === 1 ? 'play.boost.remaining.one' : 'play.boost.remaining', {
      n: state.diceBoosts,
    })
    for (const el of mounts.boostCounts) el.textContent = String(state.diceBoosts)
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

    this.board!.render(state, moves, (pawnId) => session.dispatch({ type: 'move', pawnId }))
    this.renderPlayers(mounts.players, state)
    this.renderTurn(mounts.turn, state, moves.length)
    this.scheduleObvious(state, moves)

    this.announce(state)

    if (state.phase === 'finished') this.renderPodium(state)
  }

  /**
   * Ce qui vient d'arriver et ne se lit nulle part ailleurs.
   *
   * Le plateau montre où sont les chevaux, pas pourquoi ils y sont : un cheval
   * qui recule de trois cases sans explication ressemble à un bug. Les
   * événements de pouvoir sont donc annoncés au passage, une fois, à tout le
   * monde — c'est la seule chose que le joueur ne peut pas déduire de l'écran.
   */
  private announce(state: GameState): void {
    const fresh = state.log.filter((entry) => entry.seq > this.announced)
    if (state.log.length > 0) this.announced = state.log[state.log.length - 1]!.seq

    // Un seul bandeau : deux toasts qui se chassent ne se lisent ni l'un ni
    // l'autre. Le dernier événement est celui qui explique l'écran actuel.
    for (const entry of [...fresh].reverse()) {
      const { event } = entry
      if (event.kind === 'power') {
        return this.notify('toast.power', {
          name: entry.actor,
          power: t(`power.${event.power}` as Key),
          desc: t(`power.${event.power}.desc` as Key),
        })
      }
      if (event.kind === 'shielded') {
        return this.notify('toast.shielded', { pawn: event.pawn, owner: event.owner })
      }
      if (event.kind === 'skipped') return this.notify('toast.skipped', { name: entry.actor })
    }
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
      detail = t('play.nothing.hint')
    } else if (mine && moveCount === 1) {
      title = t('play.youRolled', { dice: state.dice ?? '' })
      detail = t('play.pickOne')
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

    const canRoll = mine && state.phase === 'rolling' && !finished
    const die = this.mounts!.dieBtn
    die.disabled = !canRoll
    die.classList.toggle('ready', canRoll)
    this.startClock()
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
   */
  private scheduleObvious(state: GameState, moves: Move[]): void {
    const session = this.session!
    if (this.autoAt === state.seq) return
    if (!session.myTurn || state.phase !== 'moving' || moves.length > 1) return

    this.autoAt = state.seq
    if (this.autoTimer) clearTimeout(this.autoTimer)
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null
      // L'état a pu bouger pendant l'attente : on ne joue que s'il est intact.
      const now = this.session?.game
      if (!now || now.seq !== state.seq || !this.session!.myTurn || now.phase !== 'moving') return
      const move = moves[0]
      this.session!.dispatch(move ? { type: 'move', pawnId: move.pawnId } : { type: 'pass' })
    }, AUTO_MS)
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
