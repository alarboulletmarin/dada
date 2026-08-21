/**
 * Adversaire artificiel — utile quand on n'est que deux ou trois.
 *
 * Heuristique volontairement simple et lisible : elle joue correctement sans
 * être imbattable, ce qui est exactement ce qu'on veut pour compléter une table.
 */

import { geometryFor, hasFinished, isOnTrack, trackIndexOf } from './board.ts'
import { activeSeatFor, areAllies, canPlayPower, legalMoves, pawnsOf, playablePowers } from './engine.ts'
import { HAND_LIMIT, POWERS, type PowerId } from './powers.ts'
import type { Action, GameState, Move } from './types.ts'

function score(move: Move, state: GameState): number {
  const trackLength = geometryFor(state.variant).trackLength
  let s = 0

  // Manger reste le coup le plus rentable : l'adversaire repart de zéro.
  if (move.captures.length > 0) s += 1000 + move.captures.length * 100

  // Rentrer un cheval est définitif.
  if (move.finishes) s += 800

  // Sortir de l'écurie met un cheval en jeu ; d'autant plus utile qu'on en a peu dehors.
  if (move.exits) {
    const seat = activeSeatFor(state)
    const outside = state.pawns.filter((p) => p.owner === seat && p.steps >= 0).length
    s += 400 - outside * 80
  }

  // Se mettre à l'abri dans l'escalier.
  if (move.to >= trackLength && move.from < trackLength) s += 300

  // À défaut, faire progresser le cheval le plus avancé.
  s += move.to * 2

  // Éviter de finir juste devant un adversaire qui pourrait nous manger au tour suivant.
  if (move.to < trackLength) s -= threatOn(state, move.to) * 60

  return s
}

/**
 * Nombre de chevaux adverses situés 1 à 6 cases derrière cette position.
 *
 * Le calcul se fait en cases absolues du circuit : chaque joueur compte ses pas
 * depuis son propre départ, comparer des `steps` bruts n'aurait aucun sens.
 *
 * `steps` se compte depuis le départ du siège dont on joue les chevaux — le
 * partenaire, le cas échéant — et un coéquipier n'est jamais une menace : il ne
 * peut pas manger, donc il ne fait pas fuir.
 */
function threatOn(state: GameState, steps: number): number {
  const geometry = geometryFor(state.variant)
  if (!isOnTrack(geometry, steps)) return 0
  const seat = activeSeatFor(state)
  const target = trackIndexOf(geometry, seat, steps)
  if (target === null) return 0

  let threats = 0
  for (const p of state.pawns) {
    if (areAllies(state, p.owner, seat) || !isOnTrack(geometry, p.steps)) continue
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

/**
 * La carte que le bot jouerait maintenant, s'il en a une qui vaut le coup.
 *
 * Volontairement frugale : un bot qui viderait sa main dès qu'il le peut
 * gaspillerait ses cartes, et un bot qui ne les jouerait jamais donnerait à la
 * table l'impression que les pouvoirs ne marchent pas. Trois règles suffisent —
 * relancer un dé qui ne sert à rien, protéger le cheval le plus exposé, et
 * pousser un cheval qui rentre.
 */
export function choosePower(state: GameState): Action | null {
  const hand = playablePowers(state)
  if (hand.length === 0) return null

  const geometry = geometryFor(state.variant)
  // Les chevaux qu'on joue, qui ne sont pas toujours les siens : en équipes, un
  // joueur qui a fini pose ses cartes sur les chevaux de son partenaire.
  const mine = pawnsOf(state, activeSeatFor(state)).filter((p) => !hasFinished(geometry, p.steps))
  const best = (power: PowerId): string | undefined =>
    mine
      .filter((p) => canPlayPower(state, power, p.id))
      .sort((a, b) => b.steps - a.steps)[0]?.id

  // Un galop qui fait rentrer un cheval est toujours bon à prendre.
  if (hand.includes('galop')) {
    const finisher = mine.find(
      (p) => canPlayPower(state, 'galop', p.id) && p.steps + POWERS.galop.steps === geometry.lastStep,
    )
    if (finisher) return { type: 'power', power: 'galop', pawnId: finisher.id }
  }

  // Relancer un dé qui ne donne aucun coup : il n'y a rien à perdre.
  if (hand.includes('rejeu') && legalMoves(state).length === 0) return { type: 'power', power: 'rejeu' }

  // Protéger le cheval le plus avancé, quand il est vraiment menacé.
  if (hand.includes('bouclier')) {
    const target = mine
      .filter((p) => canPlayPower(state, 'bouclier', p.id))
      .sort((a, b) => b.steps - a.steps)
      .find((p) => threatOn(state, p.steps) > 0)
    if (target) return { type: 'power', power: 'bouclier', pawnId: target.id }
  }

  // Main pleine : mieux vaut dépenser que refuser la prochaine carte.
  if ((state.hands?.[state.turn]?.length ?? 0) >= HAND_LIMIT) {
    for (const power of hand) {
      if (POWERS[power].target === 'aucune') return { type: 'power', power }
      const pawnId = best(power)
      if (pawnId) return { type: 'power', power, pawnId }
    }
  }

  return null
}
