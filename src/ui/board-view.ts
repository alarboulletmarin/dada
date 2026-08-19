/**
 * Rendu du plateau.
 *
 * La grille des cases est construite une seule fois ; seuls les pions bougent,
 * sur une couche séparée positionnée en `transform`. Un déplacement est joué
 * case par case plutôt qu'en ligne droite : c'est ce qui permet de « compter »
 * le dé des yeux et de comprendre ce qui vient de se passer.
 *
 * **Tout est posé en pourcentage, pas en grille CSS.** L'ancien plateau était
 * une `grid` de 15×15 et chaque case une cellule ; c'était plus court à écrire,
 * mais cela interdisait tout ce qui ne tombe pas sur un entier — donc le rond
 * et le serpent. Une case connaît maintenant son coin haut-gauche en unités de
 * case, éventuellement flottant, et se pose en `left`/`top`/`width`/`height`.
 *
 * Le dessin suit la maquette « plateau illustré » : circuit ivoire cerné
 * d'encre, écuries pleines couleur, cœur en moulin à quatre pointes.
 */

import { cellOf, geometryFor, type BoardGeometry, type Cell } from '../game/board.ts'
import { pawnSlot } from '../game/engine.ts'
import { STABLE, type GameState, type Move, type Seat, type Variant } from '../game/types.ts'
import { t } from './i18n.ts'

const SEATS: Seat[] = [0, 1, 2, 3]
/** Une forme par siège : le plateau reste lisible sans distinguer les couleurs. */
export const SEAT_MARKS = ['●', '▲', '■', '◆'] as const
const STEP_MS = 115
/**
 * Le temps que dure l'impact, avant que le cheval mangé ne rentre.
 *
 * Il ne rentre qu'ici, et c'est tout l'objet de ce délai : l'écran plaçait les
 * chevaux à leur position finale **avant** de faire marcher celui qui avance,
 * si bien que la victime rentrait à l'écurie pendant que son bourreau était
 * encore à quatre cases de là. On savait qu'on allait se faire manger une
 * seconde avant de l'être — la seule chose que le jeu n'avait pas à dire.
 */
const STRUCK_MS = 200
const key = (c: Cell) => `${c.col.toFixed(3)},${c.row.toFixed(3)}`

/** Angle, en degrés depuis le haut et dans le sens horaire, de `from` vers `to`. */
const headingBetween = (from: Cell, to: Cell): number =>
  (Math.atan2(to.col - from.col, from.row - to.row) * 180) / Math.PI

export class BoardView {
  private board: HTMLElement
  private layer: HTMLElement
  private pawns = new Map<string, HTMLElement>()
  /** Dernière position connue de chaque pion, pour savoir quoi animer. */
  private previous = new Map<string, number>()
  private animating = false
  private pending: (() => void) | null = null
  /** Ce qui attend que le plateau ait fini de bouger. Voir `settled`. */
  private settlers: (() => void)[] = []
  private geometry: BoardGeometry

  private root: HTMLElement

  constructor(root: HTMLElement, private variant: Variant) {
    this.root = root
    this.geometry = geometryFor(this.variant)
    root.classList.add('board-wrap')
    root.style.setProperty('--grid', String(this.geometry.grid))
    this.board = this.buildGrid()
    root.append(this.board)
    this.layer = document.createElement('div')
    this.layer.className = 'pawns'
    root.append(this.layer)
  }

  /**
   * Pose un élément sur le plateau. `col`/`row` sont le coin haut-gauche en
   * unités de case, `w`/`h` la taille dans la même unité — tous flottants.
   */
  private at(
    className: string,
    col: number,
    row: number,
    w = 1,
    h = 1,
    seat: Seat | null = null,
    rot = 0,
  ): HTMLElement {
    const grid = this.geometry.grid
    const el = document.createElement('div')
    el.className = className
    const pc = (n: number) => `${(n / grid) * 100}%`
    el.style.left = pc(col)
    el.style.top = pc(row)
    el.style.width = pc(w)
    el.style.height = pc(h)
    if (rot) el.style.setProperty('--tilt', `${rot}deg`)
    if (seat !== null) {
      el.style.setProperty('--seat', `var(--seat-${seat})`)
      el.style.setProperty('--on', `var(--on-${seat})`)
      el.dataset.seat = String(seat)
    }
    this.board.append(el)
    return el
  }

  private buildGrid(): HTMLElement {
    const board = document.createElement('div')
    board.className = `board shape-${this.geometry.shape}`
    this.board = board

    // Le plateau ne doit annoncer que les règles réellement appliquées : une
    // étoile dessinée là où rien ne protège est un mensonge.
    const geo = this.geometry
    const safeStars = this.variant.starSquaresAreSafe
    const starts = new Map(SEATS.map((s) => [geo.startIndex[s], s]))
    // Chaque case étoile est le relais d'un camp : elle en prend la couleur.
    // `starIndices` est construit siège par siège, dans l'ordre des sièges.
    const starOwner = new Map(geo.starIndices.map((index, seat) => [index, seat as Seat]))

    // 1. Le circuit commun : trait fin entre deux cases, trait d'encre sur les
    //    cases qui comptent (départ, étoile, pouvoir).
    geo.track.forEach((c, i) => {
      const next = geo.track[(i + 1) % geo.track.length]!
      const heading = headingBetween(c, next)
      const startSeat = starts.get(i)

      if (startSeat !== undefined) {
        // Une flèche dans le sens de la marche : le plateau explique lui-même
        // par où l'on part et dans quel sens on tourne.
        const cell = this.at('cell start', c.col, c.row, 1, 1, startSeat, c.rot ?? 0)
        const arrow = document.createElement('i')
        // La flèche est dessinée pointe à droite ; `heading` compte depuis le
        // haut. Sur un plateau courbe, la case est déjà inclinée : on retire
        // son inclinaison pour ne pas la compter deux fois.
        arrow.style.setProperty('--rot', `${heading - 90 - (c.rot ?? 0)}deg`)
        cell.append(arrow)
      } else if (safeStars && starOwner.has(i)) {
        this.at('cell safe', c.col, c.row, 1, 1, starOwner.get(i)!, c.rot ?? 0)
      } else if (geo.powerIndexSet.has(i)) {
        this.at('cell power', c.col, c.row, 1, 1, null, c.rot ?? 0).append(
          document.createElement('i'),
        )
      } else this.at('cell', c.col, c.row, 1, 1, null, c.rot ?? 0)
    })

    // 2. Les écuries : bloc plein, enclos ivoire, emplacements pointillés.
    //    Le retrait de l'enclos est une fraction du bloc et non une case
    //    pleine : les écuries d'un plateau rond tiennent dans un coin de trois
    //    cases et demie, où un retrait fixe ne laisserait plus d'enclos du tout.
    for (const seat of SEATS) {
      const box = geo.stableBox[seat]
      const inset = box.size * 0.16
      this.at('deco stable', box.col, box.row, box.size, box.size, seat)
      this.at('deco pen', box.col + inset, box.row + inset, box.size - 2 * inset, box.size - 2 * inset, seat)
      for (const slot of geo.stableSlots[seat]) this.at('deco slot', slot.col, slot.row, 1, 1, seat)
    }

    // 3. Le cœur, posé AVANT les escaliers : sur les plateaux où les angles du
    //    carré central sont libres, il occupe trois cases sur trois, et les
    //    dernières marches des escaliers viennent alors se poser dessus. Une
    //    pointe par camp, tournée vers le couloir d'où il arrive.
    const size = geo.centerSize
    const center = this.at(
      'deco center',
      geo.center.col - (size - 1) / 2,
      geo.center.row - (size - 1) / 2,
      size,
      size,
    )
    for (const seat of SEATS) {
      const path = geo.homePath[seat]
      const tri = document.createElement('i')
      tri.style.setProperty('--rot', `${headingBetween(geo.center, path[path.length - 1]!)}deg`)
      tri.style.setProperty('--seat', `var(--seat-${seat})`)
      tri.dataset.seat = String(seat)
      center.append(tri)
    }

    // 4. Les escaliers, marche par marche.
    //
    //    L'ancien dessin en posait un seul bloc plein par siège. C'était plus
    //    net, mais cela supposait un escalier droit — impossible sur un plateau
    //    rond.
    //
    //    Les numéros, eux, ne sont pas décoratifs : ils sont imprimés sur le
    //    plateau français, dont la règle stricte demande le chiffre exact de la
    //    marche visée. Le couloir d'arrivée du Ludo est une bande de couleur, et
    //    le numéroter reviendrait à dessiner un plateau qui n'existe pas.
    const numbered = this.variant.numberedHome
    for (const seat of SEATS) {
      geo.homePath[seat].forEach((c, i) => {
        const step = this.at('cell home', c.col, c.row, 1, 1, seat, c.rot ?? 0)
        if (!numbered) return
        const label = document.createElement('b')
        label.textContent = String(i + 1)
        label.style.setProperty('--rot', `${-(c.rot ?? 0)}deg`)
        step.append(label)
      })
    }

    return board
  }

  // ─────────────────────────── pions ───────────────────────────

  private pawnEl(id: string, seat: Seat): HTMLElement {
    let el = this.pawns.get(id)
    if (!el) {
      el = document.createElement('div')
      el.className = 'pawn'
      el.style.setProperty('--seat', `var(--seat-${seat})`)
      el.style.setProperty('--on', `var(--on-${seat})`)
      const body = document.createElement('i')
      body.textContent = SEAT_MARKS[seat]
      el.append(body)
      this.layer.append(el)
      this.pawns.set(id, el)
    }
    return el
  }

  private place(el: HTMLElement, cell: Cell, offset: { x: number; y: number }): void {
    el.style.transform = `translate(${cell.col * 100 + offset.x}%, ${cell.row * 100 + offset.y}%)`
  }

  /**
   * Décale légèrement les pions qui partagent une case, pour qu'aucun ne
   * disparaisse sous un autre.
   */
  private offsets(state: GameState): Map<string, { x: number; y: number }> {
    const byCell = new Map<string, string[]>()
    for (const p of state.pawns) {
      const k = key(cellOf(this.geometry, p.owner, p.steps, pawnSlot(p.id)))
      byCell.set(k, [...(byCell.get(k) ?? []), p.id])
    }

    const result = new Map<string, { x: number; y: number }>()
    for (const ids of byCell.values()) {
      ids.forEach((id, i) => {
        if (ids.length === 1) result.set(id, { x: 0, y: 0 })
        else {
          const spread = 13
          result.set(id, {
            x: (i % 2 === 0 ? -spread : spread) * 0.8,
            y: (i < 2 ? -spread : spread) * 0.6,
          })
        }
      })
    }
    return result
  }

  /**
   * `chosen` : le cheval déjà désigné par une carte armée.
   *
   * Une carte se joue en deux temps — on désigne un cheval, puis on lance le dé
   * — et entre les deux il faut voir lequel on a désigné. Sans cette marque, le
   * joueur relit une rangée de chevaux tous cerclés pareil et ne sait plus sur
   * lequel il a appuyé.
   */
  render(
    state: GameState,
    moves: Move[],
    onPick: (pawnId: string) => void,
    chosen?: string,
  ): void {
    // Un état qui arrive pendant une animation attend son tour, sinon le pion
    // « saute » à sa position finale au milieu du mouvement.
    //
    // Mais il ne suffit pas d'attendre : le rendu différé laissait derrière lui
    // les gestes du rendu PRÉCÉDENT. Un cheval encore cerclé gardait le « joue
    // ce coup » d'avant, si bien qu'armer une carte puis toucher un cheval
    // pendant les quelques centaines de millisecondes du déplacement jouait le
    // coup au lieu de désigner la cible. Les gestes partent donc tout de suite ;
    // le dessin, lui, attend la fin du mouvement.
    if (this.animating) {
      for (const el of this.pawns.values()) {
        el.onclick = null
        el.onkeydown = null
      }
      this.pending = () => this.render(state, moves, onPick, chosen)
      return
    }

    const playable = new Map(moves.map((m) => [m.pawnId, m]))
    const offsets = this.offsets(state)

    for (const seat of SEATS) {
      this.board.classList.toggle(`has-${seat}`, state.players.some((p) => p.seat === seat))
    }

    // Repérer le pion qui a avancé, pour le déplacer case par case.
    let animated: { id: string; seat: Seat; from: number; to: number } | null = null
    for (const p of state.pawns) {
      const before = this.previous.get(p.id)
      if (before !== undefined && before !== p.steps && p.steps > before) {
        animated = { id: p.id, seat: p.owner, from: before, to: p.steps }
        break
      }
    }

    // Les chevaux que ce déplacement renvoie à l'écurie. Ils restent où ils
    // sont tant que le cheval qui les mange n'est pas arrivé : une capture se
    // découvre à l'impact, pas quatre cases avant.
    const struck = animated
      ? state.pawns
          .filter((p) => p.steps === STABLE && (this.previous.get(p.id) ?? STABLE) >= 0)
          .map((p) => ({ id: p.id, seat: p.owner }))
      : []
    const held = new Set(struck.map((p) => p.id))

    for (const p of state.pawns) {
      const el = this.pawnEl(p.id, p.owner)
      const move = playable.get(p.id)

      el.classList.toggle('playable', move !== undefined)
      el.classList.toggle('chosen', chosen === p.id)
      el.classList.toggle('shielded', p.shield === true)
      el.onclick = move ? () => onPick(p.id) : null

      // Un cheval jouable devient un vrai bouton : atteignable au clavier et
      // annoncé par un lecteur d'écran. Les autres sortent de l'ordre de tabulation.
      if (move) {
        const labelKey = move.exits ? 'play.pawn.exit' : move.finishes ? 'play.pawn.finish' : 'play.pawn.move'
        el.setAttribute('role', 'button')
        el.setAttribute('tabindex', '0')
        el.setAttribute('aria-label', t(labelKey, { n: pawnSlot(p.id) + 1 }))
        el.onkeydown = (ev) => {
          if (ev.key !== 'Enter' && ev.key !== ' ') return
          ev.preventDefault()
          onPick(p.id)
        }
      } else {
        el.removeAttribute('role')
        el.removeAttribute('tabindex')
        el.removeAttribute('aria-label')
        el.onkeydown = null
      }

      if (animated?.id !== p.id && !held.has(p.id)) {
        this.place(el, cellOf(this.geometry, p.owner, p.steps, pawnSlot(p.id)), offsets.get(p.id)!)
      }
    }

    this.previous = new Map(state.pawns.map((p) => [p.id, p.steps]))

    if (animated) void this.walk(animated, offsets, struck)
  }

  private async walk(
    step: { id: string; seat: Seat; from: number; to: number },
    offsets: Map<string, { x: number; y: number }>,
    struck: { id: string; seat: Seat }[] = [],
  ): Promise<void> {
    const el = this.pawns.get(step.id)
    if (!el) return

    this.animating = true
    el.classList.add('moving')
    const slot = pawnSlot(step.id)

    for (let s = step.from + 1; s <= step.to; s++) {
      const last = s === step.to
      this.place(el, cellOf(this.geometry, step.seat, s, slot), last ? offsets.get(step.id)! : { x: 0, y: 0 })
      await new Promise((r) => setTimeout(r, STEP_MS))
    }

    await this.sendHome(struck, offsets)

    el.classList.remove('moving')
    this.animating = false
    this.release()

    const next = this.pending
    this.pending = null
    next?.()
  }

  /**
   * Le plateau désigne une cible de carte, et non des coups à jouer.
   *
   * Les deux se disaient du même anneau d'encre : une rangée de chevaux tous
   * cerclés pareil, et rien pour dire si les toucher joue un coup ou vise une
   * carte. Le vert est celui de la carte armée et du cheval déjà désigné —
   * une couleur, un geste.
   */
  setAiming(on: boolean): void {
    this.root.classList.toggle('aiming', on)
  }

  /**
   * Se résout quand plus rien ne bouge sur le plateau — tout de suite si rien
   * ne bougeait.
   *
   * Sert aux nouvelles du haut de l'écran : annoncer une capture pendant que le
   * cheval qui mange marche encore, c'est la dire une seconde avant qu'elle
   * n'arrive. Une nouvelle qui devance ce qu'elle raconte gâche les deux.
   */
  settled(): Promise<void> {
    if (!this.animating) return Promise.resolve()
    return new Promise((resolve) => this.settlers.push(resolve))
  }

  private release(): void {
    const waiting = this.settlers
    this.settlers = []
    for (const done of waiting) done()
  }

  /**
   * L'impact, puis le retour à l'écurie.
   *
   * Tenu à l'intérieur de `walk`, donc pendant que `animating` est encore vrai :
   * un état reçu entre-temps attend son tour au lieu de reposer les chevaux à
   * leur place finale au milieu du choc.
   */
  private async sendHome(
    struck: { id: string; seat: Seat }[],
    offsets: Map<string, { x: number; y: number }>,
  ): Promise<void> {
    if (struck.length === 0) return

    for (const p of struck) this.pawns.get(p.id)?.classList.add('struck')
    await new Promise((r) => setTimeout(r, STRUCK_MS))

    for (const p of struck) {
      const el = this.pawns.get(p.id)
      if (!el) continue
      el.classList.remove('struck')
      const slot = pawnSlot(p.id)
      this.place(el, cellOf(this.geometry, p.seat, STABLE, slot), offsets.get(p.id) ?? { x: 0, y: 0 })
    }
  }

  /** Repart d'une page blanche entre deux manches. */
  reset(): void {
    this.pawns.forEach((el) => el.remove())
    this.pawns.clear()
    this.previous.clear()
    this.animating = false
    this.pending = null
    // Rien ne bouge plus : ce qui attendait la fin d'un mouvement l'a, sinon il
    // attendrait la fin d'une manche qui n'existe plus.
    this.release()
  }
}
