/**
 * Des parties entières, jouées par des bots, sur lesquelles on vérifie ce qui
 * doit rester vrai à chaque instant.
 *
 * Les tests des autres fichiers posent une situation et vérifient une règle ;
 * celui-ci ne pose rien. Il laisse le moteur dérouler soixante parties et
 * regarde, après chaque action, si l'état tient encore debout — deux chevaux sur
 * une case, un cheval hors du plateau, un tour donné à un joueur déjà rentré :
 * ces fautes-là n'arrivent jamais dans un cas de test choisi à la main, elles
 * arrivent au trois-centième coup d'une partie ordinaire.
 *
 * Il doit rester **court** : soixante graines, quelques secondes. Un test de
 * robustesse qu'on n'a plus envie de lancer ne protège plus rien.
 */

import { describe, expect, it } from 'vitest'
import { geometryFor, isOnTrack, trackIndexOf } from './board.ts'
import { chooseMove, choosePower } from './bot.ts'
import { apply, createGame, handOf } from './engine.ts'
import { HAND_LIMIT } from './powers.ts'
import { STABLE, type Action, type GameState, type Pawn, type Player, type Seat } from './types.ts'
import { variantById } from './variants.ts'

/** Assez pour finir une partie à quatre sur le grand plateau, jamais infini. */
const MAX_ACTIONS = 4000

const SEEDS = 10
const VARIANTS = ['petits-chevaux', 'ludo', 'rapide']

const players = (seats: Seat[]): Player[] =>
  seats.map((seat) => ({ seat, name: `J${seat + 1}`, kind: 'bot' as const, peerId: null, connected: true }))

/**
 * Gèle l'état de fond en comble avant de le donner au moteur : une écriture en
 * place lèverait au lieu de passer inaperçue. L'immutabilité n'est pas un
 * principe décoratif ici — l'état circule d'un téléphone à l'autre, et un objet
 * modifié en place ne s'annonce nulle part.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const inner of Object.values(value)) deepFreeze(inner)
  return Object.freeze(value)
}

/** La variante demandée, recopiée : le gel ne doit pas mordre sur `variants.ts`. */
const variantFor = (id: string, powers: boolean) => {
  const v = variantById(id)
  return { ...v, exitRolls: [...v.exitRolls], powers }
}

/** Où un cheval se tient, en cases absolues sur le circuit et en marches privées ailleurs. */
function squareOf(state: GameState, pawn: Pawn): string | null {
  const geometry = geometryFor(state.variant)
  if (pawn.steps === STABLE || pawn.steps === geometry.lastStep) return null
  if (isOnTrack(geometry, pawn.steps)) return `case ${trackIndexOf(geometry, pawn.owner, pawn.steps)}`
  return `escalier ${pawn.owner}·${pawn.steps}`
}

/**
 * Les cases qu'un bouclier brisé autorise à partager, et les chevaux qui y ont
 * droit. Une case, des noms : la tolérance ne suit pas les chevaux ailleurs, et
 * elle ne s'ouvre pas à un troisième venu.
 */
type SharedSquares = Map<string, Set<string>>

/**
 * Retire les tolérances périmées : dès que les chevaux qui partageaient une case
 * s'en séparent, elle redevient une case comme les autres. Sans ce ménage, un
 * cheval gracié au dixième tour resterait excusé jusqu'à la fin de la partie, et
 * l'invariant ne vérifierait plus grand-chose.
 */
function expire(state: GameState, shared: SharedSquares): void {
  for (const [square, ids] of shared) {
    let together = 0
    for (const pawn of state.pawns) {
      if (ids.has(pawn.id) && squareOf(state, pawn) === square) together++
    }
    if (together < 2) shared.delete(square)
  }
}

/**
 * Ce qui doit rester vrai après n'importe quelle action. Rend la première faute
 * trouvée, ou `null` si l'état tient debout.
 *
 * Une phrase plutôt qu'une assertion : les vérifications tournent des dizaines
 * de milliers de fois, et une assertion coûte mille fois une comparaison. Le
 * test n'en garde qu'une, à l'arrivée, avec la phrase pour tout dire.
 *
 * `shared` porte l'unique exception à « une case, un cheval » : un cheval au
 * bouclier encaisse la charge sans bouger, et partage donc sa case avec son
 * attaquant le temps d'un tour (voir `landing` dans `engine.ts`). Elle est
 * nominative — cette case-là, ces chevaux-là — et elle expire dès qu'ils se
 * séparent. Hors de ce cas, deux chevaux sur une case en règle française sont
 * un bug.
 */
function invariants(state: GameState, shared: SharedSquares, ctx: string): string | null {
  const geometry = geometryFor(state.variant)

  const ids = state.pawns.map((p) => p.id)
  if (new Set(ids).size !== ids.length) return `${ctx} · deux chevaux du même nom`
  if (ids.length !== state.players.length * state.variant.pawnsPerPlayer) {
    return `${ctx} · ${ids.length} chevaux sur le plateau`
  }

  for (const pawn of state.pawns) {
    if (pawn.steps < STABLE || pawn.steps > geometry.lastStep) {
      return `${ctx} · ${pawn.id} hors du plateau (${pawn.steps})`
    }
  }

  // Un joueur déjà classé n'a plus rien à jouer : lui rendre la main arrêterait
  // la partie sur un tour que personne ne peut terminer.
  if (state.phase !== 'finished' && state.ranking.includes(state.turn)) {
    return `${ctx} · le tour revient au siège ${state.turn}, déjà classé`
  }

  for (const player of state.players) {
    const hand = handOf(state, player.seat)
    if (hand.length > HAND_LIMIT) return `${ctx} · main de ${hand.length} cartes au siège ${player.seat}`
  }

  if (!state.variant.onePerSquare) return null
  const crowd = new Map<string, string[]>()
  for (const pawn of state.pawns) {
    const square = squareOf(state, pawn)
    if (square === null) continue
    crowd.set(square, [...(crowd.get(square) ?? []), pawn.id])
  }
  for (const [square, tenants] of crowd) {
    if (tenants.length === 1) continue
    const excused = shared.get(square)
    if (!excused || tenants.some((id) => !excused.has(id))) {
      return `${ctx} · ${square} tenue par ${tenants.join(', ')}`
    }
  }
  return null
}

/** Ce que le bot ferait maintenant : une carte s'il en a une qui vaut le coup, sinon le tour. */
function nextAction(state: GameState): Action {
  const power = choosePower(state)
  if (power) return power
  if (state.phase === 'rolling') return { type: 'roll' }
  const move = chooseMove(state)
  return move ? { type: 'move', pawnId: move.pawnId } : { type: 'pass' }
}

/** Le cheval que cette action déplace, s'il y en a un. */
const actingPawn = (action: Action): string | undefined =>
  action.type === 'move' ? action.pawnId : action.type === 'power' ? action.pawnId : undefined

/** Joue une partie entière de bots en vérifiant les invariants à chaque coup. */
function playOut(variantId: string, powers: boolean, seed: number): GameState {
  const seats: Seat[] = seed % 2 === 0 ? [0, 1, 2, 3] : [0, 1, 2]
  const label = `${variantId}${powers ? '+pouvoirs' : ''} · graine ${seed}`
  let state = createGame({ players: players(seats), variant: variantFor(variantId, powers), seed })
  const shared: SharedSquares = new Map()

  let fault = invariants(state, shared, `${label} · départ`)

  let actions = 0
  while (fault === null && state.phase !== 'finished' && actions < MAX_ACTIONS) {
    const action = nextAction(state)
    const before = deepFreeze(state)
    const seen = before.logSeq ?? 0

    const played = apply(before, action, before.turn)
    // Le bot ne doit jamais proposer un coup que le moteur refuse : c'est la
    // seule façon de savoir que `canPlayPower` et `choosePower` disent la même
    // chose, et un bot qui se fait refuser un coup reste bloqué sur son tour.
    if (played.error) {
      fault = `${label} · action ${actions} refusée (${played.error}) : ${JSON.stringify(action)}`
      break
    }
    state = played.state

    // Les tolérances d'hier ne valent que tant que les chevaux graciés sont
    // encore ensemble : on les périme avant d'en accorder de nouvelles.
    expire(state, shared)

    // Un bouclier vient de se briser : l'attaquant et sa victime partagent la
    // case le temps d'un tour, et c'est la seule exception tolérée ensuite.
    const broke = state.log.some((e) => e.seq >= seen && e.event.kind === 'shielded')
    const acting = actingPawn(action)
    if (broke && acting !== undefined) {
      const mover = state.pawns.find((p) => p.id === acting)!
      const square = squareOf(state, mover)
      if (square !== null) {
        const together = state.pawns.filter((p) => squareOf(state, p) === square).map((p) => p.id)
        shared.set(square, new Set(together))
      }
    }

    actions++
    fault = invariants(state, shared, `${label} · action ${actions}`)
  }

  expect(fault).toBeNull()
  // Une partie qui ne finit pas est un blocage : c'est exactement ce que la
  // règle des barrages produisait, et ce qu'on ne veut plus jamais voir.
  expect(state.phase, `${label} · ${actions} actions`).toBe('finished')
  expect(state.ranking.length, label).toBe(seats.length)
  return state
}

describe('parties de bots, jouées jusqu’au bout', () => {
  for (const variantId of VARIANTS) {
    for (const powers of [false, true]) {
      it(`tient ses invariants en ${variantId}${powers ? ' avec pouvoirs' : ''}`, () => {
        for (let seed = 1; seed <= SEEDS; seed++) playOut(variantId, powers, seed)
      })
    }
  }

  // Deux appareils rejouent la même partie à partir de la même graine : c'est
  // ce qui rend une divergence détectable, et le débogage possible.
  it('rejoue coup pour coup à graine égale', () => {
    for (const variantId of VARIANTS) {
      const once = playOut(variantId, true, 99)
      const twice = playOut(variantId, true, 99)
      expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
    }
  })
})
