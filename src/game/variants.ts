/**
 * Les règles varient d'une famille à l'autre — c'est la principale source de
 * disputes autour d'un plateau. Elles sont donc des données, pas du code.
 *
 * `trackLength` n'est pas un réglage de confort : c'est le plateau lui-même.
 *
 * - **56 cases, 14 par quart** — le plateau français des petits chevaux. Le
 *   circuit passe par les quatre angles du carré central.
 * - **52 cases, 13 par quart** — le plateau international du Ludo. Il coupe ces
 *   angles ; le cheval y tourne en diagonale, et les cases étoile tombent huit
 *   crans après chaque départ, comme sur un plateau imprimé.
 * - **40 cases** — un plateau réduit, pour les parties courtes.
 */

import type { Variant } from './types.ts'

export const VARIANTS: Variant[] = [
  {
    id: 'petits-chevaux',
    trackLength: 56,
    pawnsPerPlayer: 4,
    exitRolls: [6],
    mercyExit: 5,
    extraTurnOnSix: true,
    maxConsecutiveSixes: 3,
    extraTurnOnCapture: false,
    extraTurnOnFinish: false,
    starSquaresAreSafe: false,
    startSquaresAreSafe: true,
    blockades: false,
    // « Deux chevaux ne peuvent pas occuper la même case. »
    onePerSquare: true,
    exactFinish: true,
    // Les six marches de l'escalier français portent leur numéro.
    numberedHome: true,
  },
  {
    id: 'ludo',
    trackLength: 52,
    pawnsPerPlayer: 4,
    exitRolls: [6],
    mercyExit: 5,
    extraTurnOnSix: true,
    maxConsecutiveSixes: 3,
    extraTurnOnCapture: true,
    extraTurnOnFinish: true,
    starSquaresAreSafe: true,
    startSquaresAreSafe: true,
    blockades: true,
    // Impossible ici : deux pions sur une case, c'est justement un barrage.
    onePerSquare: false,
    exactFinish: true,
    // Le couloir d'arrivée du Ludo est une bande de couleur, sans numéros.
    numberedHome: false,
  },
  {
    id: 'rapide',
    trackLength: 40,
    pawnsPerPlayer: 2,
    exitRolls: [1, 6],
    // Une sortie sur deux faces tombe déjà d'elle-même : le dé reste franc.
    mercyExit: 0,
    extraTurnOnSix: true,
    maxConsecutiveSixes: 0,
    extraTurnOnCapture: true,
    extraTurnOnFinish: true,
    starSquaresAreSafe: true,
    startSquaresAreSafe: true,
    blockades: false,
    onePerSquare: false,
    exactFinish: false,
    numberedHome: false,
  },
]

export const DEFAULT_VARIANT = VARIANTS[0]!

export function variantById(id: string): Variant {
  return VARIANTS.find((v) => v.id === id) ?? DEFAULT_VARIANT
}
