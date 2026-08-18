/**
 * Les règles varient d'une famille à l'autre — c'est la principale source de
 * disputes autour d'un plateau. Elles sont donc des données, pas du code.
 */

import type { Variant } from './types.ts'

export const VARIANTS: Variant[] = [
  {
    id: 'petits-chevaux',
    name: 'Petits chevaux',
    description: 'La règle française classique. Un 6 pour sortir, on rejoue sur un 6.',
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
    name: 'Ludo',
    description: 'La règle internationale. Cases étoilées protégées, barrages, primes de capture.',
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
    name: 'Rapide',
    description: 'Sortie sur 1 ou 6, arrivée sans compte exact. Pour une partie courte.',
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
