/**
 * Écrans et interactions. Toute décision de règle appartient au moteur ;
 * ce fichier ne fait qu'afficher un état et transmettre des intentions.
 *
 * Le parcours suit la maquette : accueil → choix du jeu → salon → partie,
 * avec un détour possible par « rejoindre » et par les règles.
 */

import { pawnsOf } from '../game/engine.ts'
import { LAST_STEP, STABLE, type GameState, type Move, type Seat, type Variant } from '../game/types.ts'
import { VARIANTS } from '../game/variants.ts'
import { makeCode } from '../net/room.ts'
import { clearSave, readSave, since } from '../net/save.ts'
import { Session } from '../net/session.ts'
import { BoardView, SEAT_MARKS } from './board-view.ts'
import { fill, h, setKeepAwake } from './dom.ts'
import { applyTheme, nextTheme, readTheme, THEME_ICON, THEME_LABEL } from './theme.ts'

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

/** Habillage des variantes : de la présentation, pas des règles. */
const LOOKS: Record<string, { tag: string; badge: string; meta: string }> = {
  'petits-chevaux': { tag: 'FR', badge: 'die', meta: '4 chevaux · 20–30 min' },
  ludo: { tag: 'INT', badge: 'pawn', meta: '4 pions · 15–25 min' },
  rapide: { tag: 'EXPRESS', badge: 'bolt', meta: 'sortie facile · 10 min' },
}

/** « de Sami », mais « d'Ines » : l'élision, sinon la phrase accroche. */
const nameOf = (name: string): string =>
  /^[aeiouyàâäéèêëîïôöûüh]/i.test(name) ? `d'${name}` : `de ${name}`

const HOW_TO = [
  ['Sortir de l’écurie', 'Il faut un 6 pour poser un cheval sur sa case de départ.'],
  ['Tourner', 'On avance du nombre de points, dans le sens des aiguilles.'],
  ['Manger', 'Tomber pile sur un cheval adverse le renvoie chez lui. Les cases ✦ protègent.'],
  ['Rentrer', 'Après le tour complet, le cheval prend son escalier. Compte exact pour arriver.'],
  ['Gagner', 'Le premier à rentrer ses 4 chevaux remporte la partie.'],
]

type Screen = 'home' | 'pick' | 'join' | 'lobby' | 'play' | 'rules'

export class App {
  private session: Session | null = null
  private board: BoardView | null = null
  private screen: Screen | null = null
  private mounts: {
    players: HTMLElement[]
    turn: HTMLElement
    dieBtn: HTMLButtonElement
    die: HTMLElement
  } | null = null
  private name = localStorage.getItem(NAME_KEY) ?? ''
  /** Ce qu'on fera de la variante choisie sur l'écran « on joue à quoi ? ». */
  private picking: 'online' | 'local' | 'change' = 'online'
  private variantId = VARIANTS[0]!.id
  /** Dernier résultat de dé connu : le dé du bas garde toujours une face visible. */
  private lastDie: number | null = null
  /** Valeur déjà affichée, pour repérer le lancer qui vient d'arriver. */
  private shownDice: number | null = null
  private tumbling = false
  /** Coup évident déjà programmé, repéré par le numéro d'état du moteur. */
  private autoAt = -1
  private autoTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private root: HTMLElement) {}

  start(): void {
    // Ouvrir le lien d'un ami alors que le jeu tourne déjà ne recharge pas la
    // page : sans cela, on resterait sur l'écran précédent sans rien comprendre.
    // `replaceState` (utilisé à la création et en quittant) ne déclenche pas
    // l'événement, donc seul un vrai clic sur un lien passe ici.
    addEventListener('hashchange', () => {
      const code = location.hash.replace('#', '').toUpperCase()
      if (!code || code === this.session?.lobby.code) return
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
      onError: (message: string) => this.toast(message),
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
          'aria-label': `Code de partie ${code.split('').join(' ')} — copier le lien`,
          title: 'Copier le lien de la partie',
        },
        on: { click: () => void this.share(code) },
      },
      h('small', { text: 'code' }),
      code,
      h('span', { text: '⧉', attrs: { 'aria-hidden': 'true' } }),
    )
  }

  private backButton(onClick: () => void, label = 'Retour'): HTMLElement {
    return h('button', {
      class: 'icon-btn',
      text: '←',
      attrs: { 'aria-label': label },
      on: { click: onClick },
    })
  }

  // ─────────────────────────── 01 · accueil ───────────────────────────

  private renderHome(): void {
    this.screen = 'home'
    const nameInput = h('input', {
      value: this.name,
      attrs: { placeholder: 'Votre prénom', maxlength: '16', 'aria-label': 'Votre prénom' },
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
        h('p', { class: 'tagline', text: 'le jeu des petits chevaux, entre amis' }),
        h('div', { class: 'dice-pair' }, this.face(5), this.face(6)),
        h('div', { class: 'field' }, h('span', { class: 'label', text: 'Vous êtes' }), nameInput),
        h(
          'div',
          { class: 'stack push' },
          ...this.resumeCard(),
          h('button', { class: 'btn red', text: 'Créer une partie', on: { click: () => go('online') } }),
          h('button', {
            class: 'btn blue',
            text: 'Rejoindre avec un code',
            on: {
              click: () => {
                this.saveName(nameInput.value)
                this.renderJoin('')
              },
            },
          }),
          h('button', { class: 'btn', text: 'Un seul téléphone', on: { click: () => go('local') } }),
        ),
        h('button', {
          class: 'btn small',
          text: 'Comment on joue',
          on: { click: () => this.renderRules(() => this.renderHome()) },
        }),
        h(
          'div',
          { class: 'settings' },
          h('button', {
            text: `${THEME_ICON[readTheme()]} ${THEME_LABEL[readTheme()]}`,
            attrs: { 'aria-label': `Thème : ${THEME_LABEL[readTheme()]}. Changer.` },
            on: {
              click: () => {
                applyTheme(nextTheme())
                this.renderHome()
              },
            },
          }),
        ),
        h('p', {
          class: 'hint center',
          html: 'Sans compte · sans pub · sans serveur.<br>Trois secondes et le dé roule.',
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

    const variant = VARIANTS.find((v) => v.id === save.lobby.variantId)
    const players = save.lobby.players.length

    return [
      h(
        'div',
        { class: 'resume' },
        h('button', {
          class: 'btn green',
          text: 'Reprendre la partie',
          on: { click: () => this.resumeSaved() },
        }),
        h(
          'div',
          { class: 'resume-foot' },
          h('span', {
            class: 'hint',
            text: `${variant?.name ?? 'Partie'} · ${players} joueurs · ${since(save.at)}`,
          }),
          h('button', {
            class: 'link',
            text: 'oublier',
            attrs: { 'aria-label': 'Oublier la partie sauvegardée' },
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

  // ─────────────────────────── 02 · choisir le jeu ───────────────────────────

  private renderPick(): void {
    this.screen = 'pick'
    const back = () => (this.picking === 'change' ? this.renderLobby() : this.renderHome())

    const cards = h(
      'div',
      { class: 'stack' },
      ...VARIANTS.map((v) => {
        const look = LOOKS[v.id] ?? { tag: '', badge: 'die', meta: '' }
        const badge = h('span', { class: `badge b${VARIANTS.indexOf(v) + 1}` })
        if (look.badge === 'die') badge.append(this.face(5))
        else if (look.badge === 'pawn') badge.append(this.token(null))
        else badge.textContent = '⚡'

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
              h('strong', { text: v.name }),
              look.tag ? h('span', { class: 'tag', text: look.tag }) : null,
            ),
            h('p', { class: 'desc', text: v.description }),
            h('span', { class: 'desc', text: look.meta }),
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
        h('div', { class: 'topbar' }, this.backButton(back), h('h2', { text: 'On joue à quoi ?' })),
        cards,
        h('p', {
          class: 'hint center',
          text: 'Les règles maison se règlent juste après, dans le salon.',
        }),
        h('button', { class: 'btn red push', text: 'Continuer', on: { click: confirm } }),
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
        'aria-label': 'Code de partie',
        inputmode: 'text',
      },
    })
    const submit = h('button', { class: 'btn blue', text: 'Rejoindre' })

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
      if (value.length < 4) return this.toast('Entrez le code que vos amis vous ont donné.')
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
          h('h2', { text: 'Rejoindre une partie' }),
        ),
        h('p', {
          class: 'hint',
          text: `Tapez les ${CODE_LENGTH} caractères que votre ami vous a envoyés.`,
        }),
        h('div', { class: 'code-input', on: { click: () => input.focus() } }, boxes, input),
        submit,
        h('p', {
          class: 'hint center push',
          text: "Le code ouvre un lien direct entre vos téléphones. Rien n'est stocké nulle part.",
        }),
      ),
    )
    paint()
    if (!prefill) setTimeout(() => input.focus(), 60)
  }

  // ─────────────────────────── 03 + 05 · salon ───────────────────────────

  private renderLobby(): void {
    const session = this.session!
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
          attrs: { maxlength: '16', 'aria-label': `Nom du joueur ${p.seat + 1}` },
          on: { change: () => session.rename(p.seat, nameField.value.trim() || `Joueur ${p.seat + 1}`) },
        })
        if (!editable) nameField.disabled = true

        const tag = p.kind === 'bot' ? 'bot' : !p.connected ? 'hors ligne' : ''
        const isHostSeat = p.seat === session.hostSeat

        return h(
          'div',
          { class: `seat${p.connected ? '' : ' offline'}` },
          this.token(p.seat),
          nameField,
          h('span', {
            class: 'tag',
            text: tag || (isHostSeat ? 'hôte' : p.clientId === session.self ? 'vous' : ''),
          }),
          session.isHost && !isHostSeat
            ? h('button', {
                class: 'icon-btn danger',
                text: '✕',
                attrs: { 'aria-label': `Retirer ${p.name}` },
                on: { click: () => session.removeSeat(p.seat) },
              })
            : null,
        )
      }),
      ...Array.from({ length: Math.max(0, 4 - lobby.players.length) }, () =>
        h(
          'div',
          { class: 'seat empty' },
          this.token(null, 'ghost'),
          h('span', { class: 'who', text: 'place libre' }),
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
          this.backButton(() => this.quit(), 'Quitter la partie'),
          h('h2', { text: 'Salon' }),
          online && !session.isHost ? this.codePill(lobby.code) : null,
        ),

        online && session.isHost ? this.codeCard(lobby.code) : null,

        waiting
          ? this.linkCard(session)
          : h(
              'div',
              { class: 'stack' },
              h('span', { class: 'label', text: `Joueurs · ${lobby.players.length}/4` }),
              seats,
              canAdd
                ? h(
                    'div',
                    { class: 'row' },
                    h('button', {
                      class: 'btn small',
                      text: '+ Joueur',
                      on: { click: () => session.addSeat('human') },
                    }),
                    h('button', {
                      class: 'btn small',
                      text: '+ Bot',
                      on: { click: () => session.addSeat('bot') },
                    }),
                  )
                : null,
            ),

        h(
          'div',
          { class: 'stack' },
          h('span', { class: 'label', text: `Règles maison · ${variant.name}` }),
          this.ruleChips(variant),
          session.isHost
            ? h('button', {
                class: 'btn small',
                text: 'Changer de jeu',
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

        h(
          'div',
          { class: 'stack push' },
          session.isHost
            ? h('button', {
                class: 'btn red',
                text: lobby.players.length < 2 ? 'Il faut au moins 2 joueurs' : 'Lancer la partie',
                disabled: lobby.players.length < 2,
                on: { click: () => session.start() },
              })
            : !waiting
              ? h('p', { class: 'hint center', text: "En attente du lancement par l'hôte…" })
              : null,
          h('p', { class: 'hint center', text: 'Ordre tiré au sort · 4 chevaux chacun' }),
        ),
      ),
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
        h('h3', { text: 'Connexion à la partie…' }),
        h('p', {
          class: 'hint',
          text: "Votre ami doit avoir la partie ouverte de son côté. Cela prend deux à trois secondes.",
        }),
        h('div', { class: 'link-dots' }, h('i'), h('i'), h('i')),
      )
    }

    const relays = session.relaysUp()
    return h(
      'div',
      { class: 'card' },
      h('h3', { text: 'Personne ne répond' }),
      h('p', {
        class: 'hint',
        text:
          relays === 0
            ? "Aucun relais de mise en relation n'est joignable : vérifiez votre connexion internet."
            : `Trois causes possibles : le code n'est pas le bon, votre ami n'a pas encore ouvert la partie, ou vos deux réseaux bloquent la connexion directe (fréquent en 4G).`,
      }),
      h(
        'div',
        { class: 'row' },
        h('button', {
          class: 'btn small green',
          text: 'Réessayer',
          on: {
            click: () => {
              session.retry()
              this.renderLobby()
            },
          },
        }),
        h('button', {
          class: 'btn small',
          text: 'Autre code',
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
      h('span', { class: 'label', text: 'Code à partager' }),
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
          text: 'Partager',
          on: { click: () => void this.share(code) },
        }),
        h('button', {
          class: 'btn small',
          text: 'Copier',
          on: { click: () => void this.copy(code) },
        }),
      ),
      h('p', { class: 'hint', text: 'Vos amis tapent ce code, ou ouvrent le lien. Rien à installer.' }),
    )
  }

  /** Les réglages de la variante, lisibles d'un coup d'œil. */
  private ruleChips(v: Variant): HTMLElement {
    const chips: [string, boolean][] = [
      [`${v.exitRolls.join(' ou ')} pour sortir`, true],
      ['6 rejoue', v.extraTurnOnSix],
      ['manger renvoie', true],
      ['cases étoile', v.starSquaresAreSafe],
      ['compte exact', v.exactFinish],
      ['barrages', v.blockades],
      ['prime de capture', v.extraTurnOnCapture],
    ]
    return h(
      'div',
      { class: 'chips' },
      ...chips.map(([text, on]) =>
        h('span', { class: `chip${on ? ' on' : ''}`, text: on ? `${text} ✓` : text }),
      ),
    )
  }

  private linkFor(code: string): string {
    return `${location.origin}${location.pathname}#${code}`
  }

  private async share(code: string): Promise<void> {
    const url = this.linkFor(code)
    const text = `Rejoins ma partie de petits chevaux — code ${code}`
    try {
      if (navigator.share) await navigator.share({ title: 'Jeu du Dada', text, url })
      else await this.copy(code)
    } catch {
      // Partage annulé : rien à signaler.
    }
  }

  private async copy(code: string): Promise<void> {
    const url = this.linkFor(code)
    try {
      await navigator.clipboard.writeText(url)
      this.toast('Lien copié.')
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
        h('div', { class: 'topbar' }, this.backButton(back), h('h2', { text: 'Comment on joue' })),
        h(
          'div',
          { class: 'steps' },
          ...HOW_TO.map(([title, body], i) =>
            h(
              'div',
              {
                class: 'step',
                style: this.seatVars((i % 4) as Seat),
              },
              h('span', { class: 'num', text: String(i + 1) }),
              h('div', { class: 'body' }, h('strong', { text: title! }), h('span', { text: body! })),
            ),
          ),
        ),
        h('p', { class: 'hint center push', text: 'Trois 6 de suite · tour perdu' }),
      ),
    )
  }

  // ─────────────────────────── 06 + 07 · partie ───────────────────────────

  private renderPlay(): void {
    this.screen = 'play'
    setKeepAwake(true)

    const boardHost = h('div')
    const top = h('div', { class: 'players' })
    const bottom = h('div', { class: 'players' })
    const turn = h('div', { class: 'turnline', attrs: { 'aria-live': 'polite' } })
    const die = h('div', { class: 'face' })
    const dieBtn = h(
      'button',
      {
        class: 'dice',
        attrs: { 'aria-label': 'Lancer le dé' },
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

    fill(
      this.root,
      h(
        'div',
        { class: 'play' },
        h(
          'div',
          { class: 'topbar' },
          this.backButton(() => this.quit(), 'Quitter la partie'),
          h('span', { style: { flex: '1' } }),
          this.session!.mode === 'online' ? this.codePill(this.session!.lobby.code) : null,
          h('button', {
            class: 'icon-btn',
            text: '?',
            attrs: { 'aria-label': 'Comment on joue' },
            on: { click: () => this.renderRules(() => this.update()) },
          }),
        ),
        top,
        boardHost,
        bottom,
        turn,
        dieBtn,
      ),
    )

    this.board = new BoardView(boardHost, this.session!.game!.variant)
    this.mounts = { players: [top, bottom], turn, dieBtn, die }
    this.shownDice = null
    this.tumbling = false
    this.autoAt = -1
    this.paintDie(this.lastDie, false)
  }

  private refreshPlay(state: GameState): void {
    const session = this.session!
    const mounts = this.mounts!
    const moves = session.moves()
    if (state.dice !== null) this.lastDie = state.dice

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

    if (state.phase === 'finished') this.renderPodium(state)
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

    const card = (seat: Seat) => {
      const p = state.players.find((x) => x.seat === seat)
      // Siège inoccupé : une carte fantôme, pour que la carte voisine reste du
      // côté de son quadrant.
      if (!p) return h('div', { class: 'pcard ghost' })

      const pawns = pawnsOf(state, seat)
      const done = pawns.filter((x) => x.steps === LAST_STEP).length
      const running = pawns.filter((x) => x.steps > STABLE && x.steps < LAST_STEP).length
      const rank = state.ranking.indexOf(seat)
      const active = state.turn === seat && state.phase !== 'finished'

      const meta =
        rank >= 0
          ? `${rank === 0 ? '1re' : `${rank + 1}e`} place`
          : done > 0
            ? `${done} rentré${done > 1 ? 's' : ''}`
            : running > 0
              ? `${running} en piste`
              : 'à l’écurie'

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
          h('span', { class: 'meta', text: session.controls(seat) ? `vous · ${meta}` : meta }),
        ),
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
      title = 'Le dé roule…'
    } else if (finished) {
      title = 'Partie terminée'
    } else if (mine && state.voided) {
      title = 'Tour perdu'
      detail = `${state.variant.maxConsecutiveSixes} six d'affilée`
    } else if (mine && state.phase === 'rolling') {
      title = 'À vous'
      detail = 'touchez le dé'
    } else if (mine && moveCount === 0) {
      title = 'Rien à jouer'
      detail = 'on passe la main'
    } else if (mine && moveCount === 1) {
      title = `Vous avez fait ${state.dice}`
      detail = 'un seul coup : il se joue'
    } else if (mine) {
      title = `Vous avez fait ${state.dice}`
      detail = 'choisissez un cheval cerclé'
    } else if (state.phase === 'rolling') {
      title = current ? `Tour ${nameOf(current.name)}` : 'Tour suivant'
    } else {
      title = `${current?.name ?? '…'} a fait ${state.dice}`
    }

    fill(
      host,
      finished ? null : this.token(state.turn),
      h('strong', { text: title }),
      detail ? h('span', { class: 'detail', text: `· ${detail}` }) : null,
    )

    const canRoll = mine && state.phase === 'rolling' && !finished
    const die = this.mounts!.dieBtn
    die.disabled = !canRoll
    die.classList.toggle('ready', canRoll)
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
   */
  private tumble(result: number): void {
    const die = this.mounts?.dieBtn
    if (!die) return

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.paintDie(result, true)
      return
    }

    this.tumbling = true
    die.classList.add('tumbling')
    const spin = setInterval(() => this.paintDie(1 + Math.floor(Math.random() * 6), true), 70)

    setTimeout(() => {
      clearInterval(spin)
      this.tumbling = false
      die.classList.remove('tumbling')
      this.paintDie(result, true)
      die.classList.add('landed')
      setTimeout(() => die.classList.remove('landed'), 340)
      // Le résultat est posé : le reste de l'écran peut enfin le refléter.
      this.update()
    }, 620)
  }

  // ─────────────────────────── 08 · victoire ───────────────────────────

  private renderPodium(state: GameState): void {
    if (document.querySelector('.overlay')) return
    const session = this.session!
    const winner = state.players.find((p) => p.seat === state.ranking[0])
    const done = (seat: Seat) => pawnsOf(state, seat).filter((p) => p.steps === LAST_STEP).length

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
          h('h2', { style: { textAlign: 'center' }, text: `${winner?.name ?? 'Personne'} gagne\u202f!` }),
          h('p', {
            class: 'hint center',
            text: `${done(state.ranking[0] ?? 0)}/4 chevaux rentrés · règles « ${state.variant.name} »`,
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
              h('span', { class: 'score', text: `${done(seat)}/4` }),
            ),
          ),
        ),
        session.isHost
          ? h('button', {
              class: 'btn red',
              text: 'Revanche',
              on: {
                click: () => {
                  overlay.remove()
                  this.board?.reset()
                  this.lastDie = null
                  session.restart()
                },
              },
            })
          : h('p', { class: 'hint center', text: "L'hôte peut relancer une manche." }),
        h('button', {
          class: 'btn',
          text: 'Accueil',
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

  // ─────────────────────────── divers ───────────────────────────

  private toastTimer: ReturnType<typeof setTimeout> | null = null

  private toast(message: string): void {
    document.querySelector('.toast')?.remove()
    const el = h('div', { class: 'toast', text: message })
    document.body.append(el)
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => el.remove(), 2800)
  }
}
