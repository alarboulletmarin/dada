/**
 * Rendu du plateau.
 *
 * La grille des cases est construite une seule fois ; seuls les pions bougent,
 * sur une couche séparée positionnée en `transform`. Un déplacement est joué
 * case par case plutôt qu'en ligne droite : c'est ce qui permet de « compter »
 * le dé des yeux et de comprendre ce qui vient de se passer.
 *
 * Le dessin suit la maquette « plateau illustré » : circuit ivoire cerné
 * d'encre, écuries pleines couleur, cœur en moulin à quatre pointes.
 */

import {
  GRID,
  HOME_PATH,
  STABLE_ORIGIN,
  STABLE_SLOTS,
  START_INDEX,
  STAR_INDICES,
  TRACK,
  cellOf,
  type Cell,
} from '../game/board.ts'
import { pawnSlot } from '../game/engine.ts'
import type { GameState, Move, Seat, Variant } from '../game/types.ts'

const SEATS: Seat[] = [0, 1, 2, 3]
/** Une forme par siège : le plateau reste lisible sans distinguer les couleurs. */
export const SEAT_MARKS = ['●', '▲', '■', '◆'] as const
const STEP_MS = 115
const key = (c: Cell) => `${c.col},${c.row}`

export class BoardView {
  private board: HTMLElement
  private layer: HTMLElement
  private pawns = new Map<string, HTMLElement>()
  /** Dernière position connue de chaque pion, pour savoir quoi animer. */
  private previous = new Map<string, number>()
  private animating = false
  private pending: (() => void) | null = null

  constructor(root: HTMLElement, private variant: Variant) {
    root.classList.add('board-wrap')
    this.board = this.buildGrid()
    root.append(this.board)
    this.layer = document.createElement('div')
    this.layer.className = 'pawns'
    root.append(this.layer)
  }

  private buildGrid(): HTMLElement {
    const board = document.createElement('div')
    board.className = 'board'

    /** Place un élément sur la grille 15×15, en cases (1-indexées côté CSS). */
    const at = (
      className: string,
      col: number,
      row: number,
      width = 1,
      height = 1,
      seat: Seat | null = null,
    ): HTMLElement => {
      const el = document.createElement('div')
      el.className = className
      el.style.gridArea = `${row + 1} / ${col + 1} / span ${height} / span ${width}`
      if (seat !== null) {
        el.style.setProperty('--seat', `var(--seat-${seat})`)
        el.style.setProperty('--on', `var(--on-${seat})`)
        el.dataset.seat = String(seat)
      }
      board.append(el)
      return el
    }

    // Le plateau ne doit annoncer que les règles réellement appliquées : une
    // étoile dessinée là où rien ne protège est un mensonge.
    const safeStars = this.variant.starSquaresAreSafe
    const starts = new Map(SEATS.map((s) => [START_INDEX[s], s]))
    // Chaque case étoile est le relais d'un camp : elle en prend la couleur.
    const starOwner = new Map<number, Seat>(
      STAR_INDICES.flatMap((i) => {
        const seat = SEATS.find((s) => (i - START_INDEX[s] + TRACK.length) % TRACK.length === 8)
        return seat === undefined ? [] : [[i, seat] as [number, Seat]]
      }),
    )

    // 1. Le circuit commun : trait fin entre deux cases, trait d'encre sur les
    //    cases qui comptent (départ, étoile).
    TRACK.forEach((c, i) => {
      const startSeat = starts.get(i)
      if (startSeat !== undefined) {
        const cell = at('cell start', c.col, c.row, 1, 1, startSeat)
        // Une flèche dans le sens de la marche : le plateau explique lui-même
        // par où l'on part et dans quel sens on tourne.
        const next = TRACK[(i + 1) % TRACK.length]!
        const angle = next.col > c.col ? 0 : next.row > c.row ? 90 : next.col < c.col ? 180 : 270
        const arrow = document.createElement('i')
        arrow.style.setProperty('--rot', `${angle}deg`)
        cell.append(arrow)
      } else if (safeStars && starOwner.has(i)) {
        at('cell safe', c.col, c.row, 1, 1, starOwner.get(i)!)
      } else at('cell', c.col, c.row)
    })

    // 2. Les écuries : bloc plein, enclos ivoire, quatre emplacements pointillés.
    for (const seat of SEATS) {
      const o = STABLE_ORIGIN[seat]
      at('deco stable', o.col, o.row, 6, 6, seat)
      at('deco pen', o.col + 1, o.row + 1, 4, 4, seat)
      for (const slot of STABLE_SLOTS[seat]) at('deco slot', slot.col, slot.row, 1, 1, seat)
    }

    // 3. Les escaliers : une barre pleine par siège plutôt que six cases isolées,
    //    pour qu'on voie d'un coup où mène chaque couloir.
    for (const seat of SEATS) {
      const path = HOME_PATH[seat]
      const first = path[0]!
      const last = path[path.length - 1]!
      const horizontal = first.row === last.row
      const side = this.sideOf(seat)
      const col = Math.min(first.col, last.col)
      const row = Math.min(first.row, last.row)
      at(
        `deco lane ${horizontal ? 'lane-h' : 'lane-v'} end-${side}`,
        col,
        row,
        horizontal ? path.length : 1,
        horizontal ? 1 : path.length,
        seat,
      )
    }

    // 4. Le cœur : une seule case, et pas trois sur trois. Les quatre angles du
    //    carré central appartiennent au circuit — c'est même ce qui rend le
    //    tracé continu — donc un bloc 3×3 les recouvrirait, et un cheval qui
    //    passe par là semblerait déjà arrivé.
    const center = at('deco center', 7, 7)
    for (const seat of SEATS) {
      const tri = document.createElement('i')
      tri.className = `side-${this.sideOf(seat)}`
      tri.style.setProperty('--seat', `var(--seat-${seat})`)
      tri.dataset.seat = String(seat)
      center.append(tri)
    }

    return board
  }

  /** De quel côté du plateau l'escalier d'un siège rejoint le cœur. */
  private sideOf(seat: Seat): 'left' | 'right' | 'top' | 'bottom' {
    const path = HOME_PATH[seat]
    const first = path[0]!
    const last = path[path.length - 1]!
    if (first.row === last.row) return first.col < last.col ? 'left' : 'right'
    return first.row < last.row ? 'top' : 'bottom'
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
      const k = key(cellOf(p.owner, p.steps, pawnSlot(p.id)))
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

  render(state: GameState, moves: Move[], onPick: (pawnId: string) => void): void {
    // Un état qui arrive pendant une animation attend son tour, sinon le pion
    // « saute » à sa position finale au milieu du mouvement.
    if (this.animating) {
      this.pending = () => this.render(state, moves, onPick)
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

    for (const p of state.pawns) {
      const el = this.pawnEl(p.id, p.owner)
      const move = playable.get(p.id)

      el.classList.toggle('playable', move !== undefined)
      el.onclick = move ? () => onPick(p.id) : null

      // Un cheval jouable devient un vrai bouton : atteignable au clavier et
      // annoncé par un lecteur d'écran. Les autres sortent de l'ordre de tabulation.
      if (move) {
        const what = move.exits ? 'Sortir' : move.finishes ? 'Rentrer' : 'Avancer'
        el.setAttribute('role', 'button')
        el.setAttribute('tabindex', '0')
        el.setAttribute('aria-label', `${what} le cheval ${pawnSlot(p.id) + 1}`)
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

      if (animated?.id !== p.id) {
        this.place(el, cellOf(p.owner, p.steps, pawnSlot(p.id)), offsets.get(p.id)!)
      }
    }

    this.previous = new Map(state.pawns.map((p) => [p.id, p.steps]))

    if (animated) void this.walk(animated, offsets)
  }

  private async walk(
    step: { id: string; seat: Seat; from: number; to: number },
    offsets: Map<string, { x: number; y: number }>,
  ): Promise<void> {
    const el = this.pawns.get(step.id)
    if (!el) return

    this.animating = true
    el.classList.add('moving')
    const slot = pawnSlot(step.id)

    for (let s = step.from + 1; s <= step.to; s++) {
      const last = s === step.to
      this.place(el, cellOf(step.seat, s, slot), last ? offsets.get(step.id)! : { x: 0, y: 0 })
      await new Promise((r) => setTimeout(r, STEP_MS))
    }

    el.classList.remove('moving')
    this.animating = false

    const next = this.pending
    this.pending = null
    next?.()
  }

  /** Repart d'une page blanche entre deux manches. */
  reset(): void {
    this.pawns.forEach((el) => el.remove())
    this.pawns.clear()
    this.previous.clear()
    this.animating = false
    this.pending = null
  }
}

// `GRID` reste la source de vérité de la taille du plateau : une divergence
// entre la grille CSS et la géométrie du moteur serait invisible à l'œil.
if (GRID !== 15) throw new Error(`Plateau ${GRID}×${GRID} : la grille CSS attend 15×15.`)
