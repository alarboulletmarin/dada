/**
 * Géométrie du plateau, paramétrée par `S` — la taille du carré d'écurie de
 * chaque siège (`Variant.boardSize`). Toute la géométrie (grille, circuit,
 * escaliers, emplacements d'écurie) se déduit de ce seul paramètre :
 *
 *   grid          = 2*S + 3
 *   L (écart entre deux départs) = 2*S + 2
 *   trackLength   = 4*L = 8*S + 8
 *   homeLength    = S
 *   lastStep      = trackLength + homeLength - 1
 *   décalage étoile après chaque départ = S + 2
 *   center        = (S+1, S+1)
 *
 * Avec S=6 (variantes « petits chevaux » et « ludo »), on retrouve exactement
 * l'ancien plateau fixe : grid=15, trackLength=56, homeLength=6, lastStep=61.
 *
 * Le circuit compte `trackLength` cases, réparties à parts égales sur 4 bras,
 * ce qui donne un tracé **orthogonalement continu** : chaque case du circuit
 * touche la suivante par un côté. C'est ce qui permet d'animer un pion case
 * par case sans saut visuel.
 *
 *        col →  0 1 2 3 4 5 6 7 8 9 ...
 *   row 0       ┌───────┐ · · · ┌───────┐
 *     ↓         │écurie │ │ │ │ │écurie │
 *     …         └───────┘ · · · └───────┘
 *     …         · · · · · · ·╳· · · · · ·
 *     …         ┌───────┐ · · · ┌───────┐
 *     …         └───────┘ · · · └───────┘
 */

import type { Seat, Variant } from './types.ts'

export type Cell = { col: number; row: number }

const cell = (col: number, row: number): Cell => ({ col, row })

/** Génère un segment droit de `count` cases depuis (col,row) dans la direction (dc,dr). */
function segment(col: number, row: number, dc: number, dr: number, count: number): Cell[] {
  return Array.from({ length: count }, (_, i) => cell(col + dc * i, row + dr * i))
}

/**
 * Le circuit, dans le sens horaire, en partant de la case de départ du siège 0.
 * L'ordre des segments est ce qui garantit la continuité — ne pas réordonner
 * sans relancer `board.test.ts`, qui vérifie l'adjacence de bout en bout.
 */
function buildTrack(S: number): Cell[] {
  return [
    ...segment(0, S, 1, 0, S + 1),
    ...segment(S, S - 1, 0, -1, S),
    cell(S + 1, 0),
    ...segment(S + 2, 0, 0, 1, S),
    cell(S + 2, S),
    ...segment(S + 3, S, 1, 0, S),
    cell(2 * S + 2, S + 1),
    ...segment(2 * S + 2, S + 2, -1, 0, S + 1),
    ...segment(S + 2, S + 3, 0, 1, S),
    cell(S + 1, 2 * S + 2),
    ...segment(S, 2 * S + 2, 0, -1, S),
    cell(S, S + 2),
    ...segment(S - 1, S + 2, -1, 0, S),
    cell(0, S + 1),
  ]
}

/**
 * Escalier privé de chaque siège : `S` cases convergeant vers le centre.
 * Le pion y entre après avoir parcouru les cases du circuit.
 */
function buildHomePath(S: number): Record<Seat, Cell[]> {
  return {
    0: segment(1, S + 1, 1, 0, S),
    1: segment(S + 1, 1, 0, 1, S),
    2: segment(2 * S + 1, S + 1, -1, 0, S),
    3: segment(S + 1, 2 * S + 1, 0, -1, S),
  }
}

/** Coin haut-gauche du carré S×S de chaque siège. */
function buildStableOrigin(S: number): Record<Seat, Cell> {
  return {
    0: cell(0, 0),
    1: cell(S + 3, 0),
    2: cell(S + 3, S + 3),
    3: cell(0, S + 3),
  }
}

/**
 * Emplacements des pions au repos, relatifs au carré S×S de leur siège
 * (à additionner à `STABLE_ORIGIN[seat]` pour la position absolue).
 * 4 pions → les quatre coins en retrait de 1 ; 2 pions → deux coins en diagonale.
 */
function buildStableSlots(S: number, pawnsPerPlayer: number): Cell[] {
  const corners = [cell(1, 1), cell(S - 2, 1), cell(1, S - 2), cell(S - 2, S - 2)]
  if (pawnsPerPlayer === 4) return corners
  if (pawnsPerPlayer === 2) return [corners[0]!, corners[3]!]
  throw new Error(`pawnsPerPlayer=${pawnsPerPlayer} non supporté (2 ou 4 attendu)`)
}

export type BoardGeometry = {
  grid: number
  stableSize: number
  pawnsPerPlayer: number
  trackLength: number
  homeLength: number
  lastStep: number
  track: readonly Cell[]
  startIndex: Record<Seat, number>
  homePath: Record<Seat, readonly Cell[]>
  stableSlots: Record<Seat, readonly Cell[]>
  stableOrigin: Record<Seat, Cell>
  starIndices: readonly number[]
  startIndexSet: ReadonlySet<number>
  starIndexSet: ReadonlySet<number>
  center: Cell
}

function buildGeometry(S: number, pawnsPerPlayer: number): BoardGeometry {
  const grid = 2 * S + 3
  const armLength = 2 * S + 2
  const trackLength = 4 * armLength
  const homeLength = S
  const lastStep = trackLength + homeLength - 1
  const track = buildTrack(S)
  const startIndex: Record<Seat, number> = { 0: 0, 1: armLength, 2: 2 * armLength, 3: 3 * armLength }
  const homePath = buildHomePath(S)
  const stableOrigin = buildStableOrigin(S)
  const slots = buildStableSlots(S, pawnsPerPlayer)
  const origins: Seat[] = [0, 1, 2, 3]
  const forSeat = <T>(fn: (seat: Seat) => T): Record<Seat, T> => {
    const result = {} as Record<Seat, T>
    for (const seat of origins) result[seat] = fn(seat)
    return result
  }
  const stableSlots = forSeat<readonly Cell[]>((seat) =>
    slots.map((s) => cell(s.col + stableOrigin[seat].col, s.row + stableOrigin[seat].row)),
  )
  const starIndices = origins.map((seat) => (startIndex[seat] + S + 2) % trackLength)

  return {
    grid,
    stableSize: S,
    pawnsPerPlayer,
    trackLength,
    homeLength,
    lastStep,
    track,
    startIndex,
    homePath,
    stableSlots,
    stableOrigin,
    starIndices,
    startIndexSet: new Set(Object.values(startIndex)),
    starIndexSet: new Set(starIndices),
    center: cell(S + 1, S + 1),
  }
}

const cache = new Map<string, BoardGeometry>()

/** Mémoïsée : évite de reconstruire les tableaux à chaque frame de rendu. */
export function geometryFor(v: Pick<Variant, 'boardSize' | 'pawnsPerPlayer'>): BoardGeometry {
  const key = `${v.boardSize}:${v.pawnsPerPlayer}`
  const cached = cache.get(key)
  if (cached) return cached
  const geometry = buildGeometry(v.boardSize, v.pawnsPerPlayer)
  cache.set(key, geometry)
  return geometry
}

/** Convertit une position relative en index absolu du circuit, ou null si hors circuit. */
export function trackIndexOf(geometry: BoardGeometry, seat: Seat, steps: number): number | null {
  if (steps < 0 || steps >= geometry.trackLength) return null
  return (geometry.startIndex[seat] + steps) % geometry.trackLength
}

/** Case du plateau occupée par un pion à la position `steps`, ou null s'il est à l'écurie. */
export function cellOf(geometry: BoardGeometry, seat: Seat, steps: number, stableSlot: number): Cell {
  if (steps < 0) return geometry.stableSlots[seat][stableSlot % geometry.pawnsPerPlayer]!
  if (steps < geometry.trackLength) return geometry.track[trackIndexOf(geometry, seat, steps)!]!
  return geometry.homePath[seat][steps - geometry.trackLength]!
}

export const isOnTrack = (geometry: BoardGeometry, steps: number): boolean =>
  steps >= 0 && steps < geometry.trackLength
export const isInHomePath = (geometry: BoardGeometry, steps: number): boolean =>
  steps >= geometry.trackLength
export const hasFinished = (geometry: BoardGeometry, steps: number): boolean => steps === geometry.lastStep
