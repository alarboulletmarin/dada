/**
 * Géométrie du plateau, sur une grille 15×15.
 *
 * Le circuit compte 56 cases (14 par bras, comme les petits chevaux français),
 * ce qui donne un tracé **orthogonalement continu** : chaque case du circuit
 * touche la suivante par un côté. C'est ce qui permet d'animer un pion case par
 * case sans saut visuel.
 *
 *        col →  0 1 2 3 4 5 6 7 8 9 ...14
 *   row 0       ┌───────┐ · · · ┌───────┐
 *     ↓         │écurie │ │ │ │ │écurie │
 *     6         └───────┘ · · · └───────┘
 *     7         · · · · · · ·╳· · · · · ·
 *     8         ┌───────┐ · · · ┌───────┐
 *    14         └───────┘ · · · └───────┘
 */

import { HOME_LENGTH, LAST_STEP, TRACK_LENGTH, type Seat } from './types.ts'

export const GRID = 15

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
export const TRACK: readonly Cell[] = [
  ...segment(0, 6, 1, 0, 7), //  0..6   bras gauche, ligne haute → coin (6,6)
  ...segment(6, 5, 0, -1, 6), //  7..12  montée le long de la colonne 6
  cell(7, 0), //                 13     sommet
  ...segment(8, 0, 0, 1, 6), //  14..19 descente le long de la colonne 8
  cell(8, 6), //                 20     coin
  ...segment(9, 6, 1, 0, 6), //  21..26 bras droit, ligne haute
  cell(14, 7), //                27     extrémité droite
  ...segment(14, 8, -1, 0, 7), // 28..34 bras droit, ligne basse → coin (8,8)
  ...segment(8, 9, 0, 1, 6), //  35..40 descente le long de la colonne 8
  cell(7, 14), //                41     base
  ...segment(6, 14, 0, -1, 6), // 42..47 montée le long de la colonne 6
  cell(6, 8), //                 48     coin
  ...segment(5, 8, -1, 0, 6), // 49..54 bras gauche, ligne basse
  cell(0, 7), //                 55     extrémité gauche
]

/** Case de départ de chaque siège, en index de circuit. Répartis tous les 14. */
export const START_INDEX: Record<Seat, number> = { 0: 0, 1: 14, 2: 28, 3: 42 }

/**
 * Escalier privé de chaque siège : 6 cases convergeant vers le centre.
 * Le pion y entre après avoir parcouru les 55 cases du circuit.
 */
export const HOME_PATH: Record<Seat, readonly Cell[]> = {
  0: segment(1, 7, 1, 0, HOME_LENGTH), // depuis la gauche  → (1,7)..(6,7)
  1: segment(7, 1, 0, 1, HOME_LENGTH), // depuis le haut    → (7,1)..(7,6)
  2: segment(13, 7, -1, 0, HOME_LENGTH), // depuis la droite  → (13,7)..(8,7)
  3: segment(7, 13, 0, -1, HOME_LENGTH), // depuis le bas     → (7,13)..(7,8)
}

/** Emplacements des pions au repos, dans le carré 6×6 de chaque siège. */
export const STABLE_SLOTS: Record<Seat, readonly Cell[]> = {
  0: [cell(1, 1), cell(4, 1), cell(1, 4), cell(4, 4)],
  1: [cell(10, 1), cell(13, 1), cell(10, 4), cell(13, 4)],
  2: [cell(10, 10), cell(13, 10), cell(10, 13), cell(13, 13)],
  3: [cell(1, 10), cell(4, 10), cell(1, 13), cell(4, 13)],
}

/** Coin haut-gauche du carré 6×6 de chaque siège. */
export const STABLE_ORIGIN: Record<Seat, Cell> = {
  0: cell(0, 0),
  1: cell(9, 0),
  2: cell(9, 9),
  3: cell(0, 9),
}

/** Cases étoilées : 8 cases après chaque départ. */
export const STAR_INDICES: readonly number[] = [8, 22, 36, 50]

export const CENTER: Cell = cell(7, 7)

/** Convertit une position relative en index absolu du circuit, ou null si hors circuit. */
export function trackIndexOf(seat: Seat, steps: number): number | null {
  if (steps < 0 || steps >= TRACK_LENGTH) return null
  return (START_INDEX[seat] + steps) % TRACK_LENGTH
}

/** Case du plateau occupée par un pion à la position `steps`, ou null s'il est à l'écurie. */
export function cellOf(seat: Seat, steps: number, stableSlot: number): Cell {
  if (steps < 0) return STABLE_SLOTS[seat][stableSlot % 4]!
  if (steps < TRACK_LENGTH) return TRACK[trackIndexOf(seat, steps)!]!
  return HOME_PATH[seat][steps - TRACK_LENGTH]!
}

export const isOnTrack = (steps: number): boolean => steps >= 0 && steps < TRACK_LENGTH
export const isInHomePath = (steps: number): boolean => steps >= TRACK_LENGTH
export const hasFinished = (steps: number): boolean => steps === LAST_STEP
