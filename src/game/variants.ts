/**
 * Les règles varient d'une famille à l'autre — c'est la principale source de
 * disputes autour d'un plateau. Elles sont donc des données, pas du code.
 */

import type { Variant } from './types.ts'

export const VARIANTS: Variant[] = [
  {
    id: 'petits-chevaux',
    exitRolls: [6],
    extraTurnOnSix: true,
    maxConsecutiveSixes: 3,
    extraTurnOnCapture: false,
    extraTurnOnFinish: false,
    starSquaresAreSafe: false,
    startSquaresAreSafe: true,
    blockades: false,
    exactFinish: true,
  },
  {
    id: 'ludo',
    exitRolls: [6],
    extraTurnOnSix: true,
    maxConsecutiveSixes: 3,
    extraTurnOnCapture: true,
    extraTurnOnFinish: true,
    starSquaresAreSafe: true,
    startSquaresAreSafe: true,
    blockades: true,
    exactFinish: true,
  },
  {
    id: 'rapide',
    exitRolls: [1, 6],
    extraTurnOnSix: true,
    maxConsecutiveSixes: 0,
    extraTurnOnCapture: true,
    extraTurnOnFinish: true,
    starSquaresAreSafe: true,
    startSquaresAreSafe: true,
    blockades: false,
    exactFinish: false,
  },
]

export const DEFAULT_VARIANT = VARIANTS[0]!

export function variantById(id: string): Variant {
  return VARIANTS.find((v) => v.id === id) ?? DEFAULT_VARIANT
}
