/**
 * La variante « équipes » — deux contre deux, sièges opposés.
 *
 * Tout ce qui suit tient dans une phrase : **on ne joue plus seul**. Le
 * partenaire n'est ni une proie ni un obstacle, on lui prête ses tours quand on
 * n'a plus rien à jouer, et le classement se lit par équipe. Chacun de ces
 * points a son test, parce que chacun d'eux est un endroit où le moteur, écrit
 * pour quatre solitaires, pouvait continuer à compter comme avant.
 */

import { describe, expect, it } from 'vitest'
import { geometryFor } from './board.ts'
import { chooseMove, choosePower } from './bot.ts'
import {
  activeSeatFor,
  apply,
  canPlayPower,
  createGame,
  legalMoves,
  partnerOf,
  pawnId,
  sameTeam,
  seatsOfTeam,
  teamHasWon,
  teamOf,
} from './engine.ts'
import type { PowerId } from './powers.ts'
import { STABLE, type Action, type GameState, type Player, type Seat } from './types.ts'
import { variantById } from './variants.ts'

const EQUIPES = geometryFor(variantById('equipes'))

const players = (seats: Seat[]): Player[] =>
  seats.map((seat) => ({ seat, name: `J${seat + 1}`, kind: 'local' as const, peerId: null, connected: true }))

/** Fabrique une partie en équipes : positions imposées, dé imposé. */
function setup(opts: {
  seats?: Seat[]
  at?: Record<string, number>
  dice?: number
  turn?: Seat
  hands?: Record<number, PowerId[]>
}): GameState {
  const base = createGame({
    players: players(opts.seats ?? [0, 1, 2, 3]),
    variant: variantById('equipes'),
    seed: 1,
  })
  return {
    ...base,
    turn: opts.turn ?? base.turn,
    pawns: base.pawns.map((p) => ({ ...p, steps: opts.at?.[p.id] ?? p.steps })),
    dice: opts.dice ?? null,
    phase: opts.dice === undefined ? 'rolling' : 'moving',
    hands: [0, 1, 2, 3].map((s) => opts.hands?.[s] ?? []),
  }
}

/** Position relative du siège `seat` qui tombe sur la case absolue `index`. */
const stepsToReach = (seat: Seat, index: number): number =>
  (index - EQUIPES.startIndex[seat] + EQUIPES.trackLength) % EQUIPES.trackLength

/**
 * Une case ordinaire du circuit — ni départ, ni étoile, ni case pouvoir : la
 * seule où une capture peut avoir lieu, et donc la seule où l'on peut vérifier
 * qu'elle n'a pas lieu entre coéquipiers.
 */
const MEETING = EQUIPES.startIndex[0] + 5

/** Tous les chevaux d'un siège rentrés. */
const allHome = (seat: Seat): Record<string, number> =>
  Object.fromEntries([0, 1, 2, 3].map((i) => [pawnId(seat, i), EQUIPES.lastStep]))

describe('les deux camps', () => {
  it('oppose les sièges 0 et 2 aux sièges 1 et 3', () => {
    expect(teamOf(0)).toBe(teamOf(2))
    expect(teamOf(1)).toBe(teamOf(3))
    expect(teamOf(0)).not.toBe(teamOf(1))
  })

  it('donne à chacun le siège d’en face pour partenaire', () => {
    expect(partnerOf(0)).toBe(2)
    expect(partnerOf(2)).toBe(0)
    expect(partnerOf(1)).toBe(3)
    expect(partnerOf(3)).toBe(1)
    expect(sameTeam(0, 2)).toBe(true)
    expect(sameTeam(0, 1)).toBe(false)
  })

  it('range les sièges par équipe', () => {
    const state = setup({})
    expect(seatsOfTeam(state, teamOf(0))).toEqual([0, 2])
    expect(seatsOfTeam(state, teamOf(1))).toEqual([1, 3])
  })
})

describe('la table doit être complète', () => {
  it('refuse une partie en équipes à deux', () => {
    expect(() =>
      createGame({ players: players([0, 1]), variant: variantById('equipes'), seed: 1 }),
    ).toThrow()
  })

  it('refuse une partie en équipes à trois', () => {
    expect(() =>
      createGame({ players: players([0, 1, 2]), variant: variantById('equipes'), seed: 1 }),
    ).toThrow()
  })

  it('accepte les quatre sièges', () => {
    const state = createGame({ players: players([0, 1, 2, 3]), variant: variantById('equipes'), seed: 1 })
    expect(state.pawns).toHaveLength(16)
    expect(state.variant.teams).toBe(true)
  })

  it('laisse les autres variantes se jouer à deux', () => {
    expect(() =>
      createGame({ players: players([0, 1]), variant: variantById('ludo'), seed: 1 }),
    ).not.toThrow()
  })
})

describe('un coéquipier n’est jamais une proie', () => {
  it('partage sa case au lieu de le manger', () => {
    const partner = pawnId(2, 0)
    const state = setup({
      at: { [pawnId(0, 0)]: 2, [partner]: stepsToReach(2, MEETING) },
      dice: 3,
    })

    const move = legalMoves(state).find((m) => m.pawnId === pawnId(0, 0))!
    expect(move.to).toBe(5)
    expect(move.captures).toEqual([])

    const { state: after } = apply(state, { type: 'move', pawnId: pawnId(0, 0) }, 0)
    expect(after.pawns.find((p) => p.id === partner)!.steps).toBe(stepsToReach(2, MEETING))
  })

  it('mange en revanche l’adversaire posé sur la même case', () => {
    const victim = pawnId(1, 0)
    const state = setup({
      at: { [pawnId(0, 0)]: 2, [victim]: stepsToReach(1, MEETING) },
      dice: 3,
    })

    const move = legalMoves(state).find((m) => m.pawnId === pawnId(0, 0))!
    expect(move.captures).toEqual([victim])

    const { state: after } = apply(state, { type: 'move', pawnId: pawnId(0, 0) }, 0)
    expect(after.pawns.find((p) => p.id === victim)!.steps).toBe(STABLE)
  })

  it('ne le mange pas davantage au galop', () => {
    const partner = pawnId(2, 0)
    const state = setup({
      at: { [pawnId(0, 0)]: 2, [partner]: stepsToReach(2, MEETING) },
      hands: { 0: ['galop'] },
    })

    expect(canPlayPower(state, 'galop', pawnId(0, 0))).toBe(true)
    const { state: after, error } = apply(state, { type: 'power', power: 'galop', pawnId: pawnId(0, 0) }, 0)
    expect(error).toBeUndefined()
    expect(after.pawns.find((p) => p.id === pawnId(0, 0))!.steps).toBe(5)
    expect(after.pawns.find((p) => p.id === partner)!.steps).toBe(stepsToReach(2, MEETING))
  })

  it('laisse intact le bouclier du partenaire', () => {
    const partner = pawnId(2, 0)
    const base = setup({
      at: { [pawnId(0, 0)]: 2, [partner]: stepsToReach(2, MEETING) },
      dice: 3,
    })
    const state = {
      ...base,
      pawns: base.pawns.map((p) => (p.id === partner ? { ...p, shield: true } : p)),
    }

    const move = legalMoves(state).find((m) => m.pawnId === pawnId(0, 0))!
    expect(move.shielded).toEqual([])

    const { state: after } = apply(state, { type: 'move', pawnId: pawnId(0, 0) }, 0)
    expect(after.pawns.find((p) => p.id === partner)!.shield).toBe(true)
  })

  it('brise en revanche le bouclier de l’adversaire', () => {
    const victim = pawnId(1, 0)
    const base = setup({
      at: { [pawnId(0, 0)]: 2, [victim]: stepsToReach(1, MEETING) },
      dice: 3,
    })
    const state = {
      ...base,
      pawns: base.pawns.map((p) => (p.id === victim ? { ...p, shield: true } : p)),
    }

    const move = legalMoves(state).find((m) => m.pawnId === pawnId(0, 0))!
    expect(move.shielded).toEqual([victim])
    expect(move.captures).toEqual([])

    const { state: after } = apply(state, { type: 'move', pawnId: pawnId(0, 0) }, 0)
    const survivor = after.pawns.find((p) => p.id === victim)!
    expect(survivor.steps).toBe(stepsToReach(1, MEETING))
    expect(survivor.shield).toBe(false)
  })
})

describe('jouer pour son partenaire', () => {
  it('garde ses propres chevaux tant qu’il lui en reste', () => {
    const state = setup({ turn: 0, dice: 6 })
    expect(activeSeatFor(state)).toBe(0)
    expect(legalMoves(state).every((m) => m.pawnId.startsWith('p0-'))).toBe(true)
  })

  it('passe aux chevaux du partenaire une fois les siens rentrés', () => {
    const state = setup({ at: allHome(0), turn: 0, dice: 6 })
    expect(activeSeatFor(state)).toBe(2)

    const moves = legalMoves(state)
    expect(moves).toHaveLength(4)
    expect(moves.every((m) => m.pawnId.startsWith('p2-'))).toBe(true)
  })

  it('accepte alors un cheval du partenaire', () => {
    const state = setup({ at: allHome(0), turn: 0, dice: 6 })
    const { state: after, error } = apply(state, { type: 'move', pawnId: pawnId(2, 0) }, 0)
    expect(error).toBeUndefined()
    expect(after.pawns.find((p) => p.id === pawnId(2, 0))!.steps).toBe(0)
  })

  it('le refuse tant qu’on a encore ses propres chevaux', () => {
    const state = setup({ turn: 0, dice: 6 })
    const { error } = apply(state, { type: 'move', pawnId: pawnId(2, 0) }, 0)
    expect(error).toBe('illegal')
  })

  it('laisse une carte désigner un cheval du partenaire, mais seulement alors', () => {
    const busy = setup({ at: { [pawnId(2, 0)]: 4 }, turn: 0, hands: { 0: ['bouclier'] } })
    expect(canPlayPower(busy, 'bouclier', pawnId(2, 0))).toBe(false)

    const free = setup({ at: { ...allHome(0), [pawnId(2, 0)]: 4 }, turn: 0, hands: { 0: ['bouclier'] } })
    expect(canPlayPower(free, 'bouclier', pawnId(2, 0))).toBe(true)
    const { state: after, error } = apply(free, { type: 'power', power: 'bouclier', pawnId: pawnId(2, 0) }, 0)
    expect(error).toBeUndefined()
    expect(after.pawns.find((p) => p.id === pawnId(2, 0))!.shield).toBe(true)
    // La main reste celle du joueur, pas celle du partenaire.
    expect(after.hands?.[0]).toEqual([])
    expect(after.hands?.[2]).toEqual([])
  })

  it('ne classe pas — ni ne met de côté — un siège qui a rentré ses quatre chevaux', () => {
    // Le dernier cheval du siège 0 rentre ; le siège 2 est encore à l'écurie.
    const state = setup({
      at: { ...allHome(0), [pawnId(0, 3)]: EQUIPES.lastStep - 1 },
      turn: 0,
      dice: 1,
    })
    const { state: after } = apply(state, { type: 'move', pawnId: pawnId(0, 3) }, 0)

    expect(after.phase).not.toBe('finished')
    expect(after.ranking).toEqual([])
    expect(after.finishers).toEqual([0])
    // Rentrer un cheval fait rejouer : la main lui reste, pour son partenaire.
    expect(after.turn).toBe(0)
    expect(activeSeatFor(after)).toBe(2)
  })
})

describe('victoire et classement par équipe', () => {
  it('s’arrête dès que les huit chevaux d’une équipe sont rentrés', () => {
    const state = setup({
      at: { ...allHome(0), ...allHome(2), [pawnId(2, 3)]: EQUIPES.lastStep - 1 },
      turn: 0,
      dice: 1,
    })
    expect(teamHasWon(state, teamOf(0))).toBe(false)

    const { state: after } = apply(state, { type: 'move', pawnId: pawnId(2, 3) }, 0)
    expect(teamHasWon(after, teamOf(0))).toBe(true)
    expect(after.phase).toBe('finished')
  })

  it('range l’équipe gagnante d’abord, dans son ordre d’arrivée', () => {
    const base = setup({
      at: { ...allHome(0), ...allHome(2), [pawnId(2, 3)]: EQUIPES.lastStep - 1 },
      turn: 0,
      dice: 1,
    })
    // Le siège 2 avait rentré ses chevaux avant son partenaire.
    const state = { ...base, finishers: [2 as Seat] }

    const { state: after } = apply(state, { type: 'move', pawnId: pawnId(2, 3) }, 0)
    expect(after.ranking).toEqual([2, 0, 1, 3])
  })

  it('n’arrête pas la partie parce qu’un seul siège a fini', () => {
    const state = setup({
      at: { ...allHome(1), [pawnId(1, 3)]: EQUIPES.lastStep - 1 },
      turn: 1,
      dice: 1,
    })
    const { state: after } = apply(state, { type: 'move', pawnId: pawnId(1, 3) }, 1)
    expect(after.phase).toBe('rolling')
    expect(after.ranking).toEqual([])
  })

  it('classe l’adversaire qui avait fini avant l’autre de son camp', () => {
    const base = setup({
      at: { ...allHome(0), ...allHome(2), [pawnId(2, 3)]: EQUIPES.lastStep - 1, ...allHome(3) },
      turn: 0,
      dice: 1,
    })
    const { state: after } = apply({ ...base, finishers: [3 as Seat] }, { type: 'move', pawnId: pawnId(2, 3) }, 0)
    expect(after.ranking).toEqual([0, 2, 3, 1])
  })
})

describe('le reste du règlement ne change pas', () => {
  it('saute le joueur puni, pas son équipe', () => {
    const base = setup({ turn: 0, dice: 1 })
    const state = { ...base, skips: [0, 1, 0, 0] }

    const { state: after } = apply(state, { type: 'pass' }, 0)
    expect(after.turn).toBe(2)
    expect(after.skips).toEqual([0, 0, 0, 0])
  })

  it('rejoue la même partie à partir de la même graine', () => {
    const play = (): GameState => {
      let state = createGame({
        players: players([0, 1, 2, 3]).map((p) => ({ ...p, kind: 'bot' as const })),
        variant: { ...variantById('equipes'), powers: true },
        seed: 7,
      })
      for (let i = 0; i < 400 && state.phase !== 'finished'; i++) {
        const power = choosePower(state)
        const action: Action = power
          ? power
          : state.phase === 'rolling'
            ? { type: 'roll' }
            : ((m) => (m ? { type: 'move', pawnId: m.pawnId } : { type: 'pass' }))(chooseMove(state))
        const played = apply(state, action, state.turn)
        expect(played.error).toBeUndefined()
        state = played.state
      }
      return state
    }
    expect(JSON.stringify(play())).toBe(JSON.stringify(play()))
  })

  it('ne fait pas du partenaire une menace aux yeux du bot', () => {
    // Deux coups possibles : avancer jusqu'à la case 10, ou jusqu'à la 12 — la
    // meilleure des deux, sauf si le cheval du partenaire posé deux cases
    // derrière passait pour un prédateur. Le bot doit choisir la 12.
    const state = setup({
      at: {
        [pawnId(0, 0)]: 7,
        [pawnId(0, 1)]: 9,
        [pawnId(2, 0)]: stepsToReach(2, EQUIPES.startIndex[0] + 10),
      },
      dice: 3,
    })
    expect(legalMoves(state)).toHaveLength(2)
    expect(chooseMove(state)!.to).toBe(12)
  })
})
