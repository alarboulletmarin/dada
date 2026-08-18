/**
 * Adversaire artificiel — utile quand on n'est que deux ou trois.
 *
 * Heuristique volontairement simple et lisible : elle joue correctement sans
 * être imbattable, ce qui est exactement ce qu'on veut pour compléter une table.
 */

import { geometryFor, isOnTrack, trackIndexOf } from './board.ts'
import { legalMoves } from './engine.ts'
import type { GameState, Move } from './types.ts'

function score(move: Move, state: GameState): number {
  const trackLength = geometryFor(state.variant).trackLength
  let s = 0

  // Manger reste le coup le plus rentable : l'adversaire repart de zéro.
  if (move.captures.length > 0) s += 1000 + move.captures.length * 100

  // Rentrer un cheval est définitif.
  if (move.finishes) s += 800

  // Sortir de l'écurie met un cheval en jeu ; d'autant plus utile qu'on en a peu dehors.
  if (move.exits) {
    const outside = state.pawns.filter((p) => p.owner === state.turn && p.steps >= 0).length
    s += 400 - outside * 80
  }

  // Se mettre à l'abri dans l'escalier.
  if (move.to >= trackLength && move.from < trackLength) s += 300

  // À défaut, faire progresser le cheval le plus avancé.
  s += move.to * 2

  // Éviter de finir juste devant un adversaire qui pourrait nous manger au tour suivant.
  if (move.to < trackLength) s -= threatAt(state, move) * 60

  return s
}

/**
 * Nombre de chevaux adverses situés 1 à 6 cases derrière la destination.
 * Le calcul se fait en cases absolues du circuit : chaque joueur compte ses pas
 * depuis son propre départ, comparer des `steps` bruts n'aurait aucun sens.
 */
function threatAt(state: GameState, move: Move): number {
  const geometry = geometryFor(state.variant)
  const target = trackIndexOf(geometry, state.turn, move.to)
  if (target === null) return 0

  let threats = 0
  for (const p of state.pawns) {
    if (p.owner === state.turn || !isOnTrack(geometry, p.steps)) continue
    const from = trackIndexOf(geometry, p.owner, p.steps)!
    const gap = (target - from + geometry.trackLength) % geometry.trackLength
    if (gap >= 1 && gap <= 6) threats++
  }
  return threats
}

/** Le meilleur coup selon l'heuristique, ou null s'il n'y en a aucun. */
export function chooseMove(state: GameState): Move | null {
  const moves = legalMoves(state)
  if (moves.length === 0) return null
  return moves.reduce((best, m) => (score(m, state) > score(best, state) ? m : best))
}
