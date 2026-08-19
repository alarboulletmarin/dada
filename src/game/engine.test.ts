import { describe, expect, it } from 'vitest'
import { geometryFor } from './board.ts'
import { apply, createGame, forceSkipTurn, hasWon, legalMoves, mercyOf, pawnId } from './engine.ts'
import { rollDie } from './rng.ts'
import { variantById } from './variants.ts'
import { DICE_BOOSTS_PER_GAME, STABLE, type GameState, type Player, type Seat } from './types.ts'

const players = (seats: Seat[]): Player[] =>
  seats.map((seat) => ({ seat, name: `J${seat + 1}`, kind: 'local' as const, peerId: null, connected: true }))

/** Géométrie de la variante par défaut des tests (petits-chevaux), et de la variante rapide. */
const STANDARD = geometryFor(variantById('petits-chevaux'))
const RAPIDE = geometryFor(variantById('rapide'))

/** Fabrique un état contrôlé : positions imposées, dé imposé. */
function setup(opts: {
  variant?: string
  seats?: Seat[]
  at?: Record<string, number>
  dice?: number
  turn?: Seat
}): GameState {
  const base = createGame({
    players: players(opts.seats ?? [0, 1]),
    variant: variantById(opts.variant ?? 'petits-chevaux'),
    seed: 1,
  })
  return {
    ...base,
    turn: opts.turn ?? base.turn,
    pawns: base.pawns.map((p) => ({ ...p, steps: opts.at?.[p.id] ?? p.steps })),
    dice: opts.dice ?? null,
    phase: opts.dice === undefined ? 'rolling' : 'moving',
  }
}

/** Cherche une graine dont le prochain jet vaut `value` — permet de tester le flux de tour. */
function seedFor(value: number): number {
  for (let s = 1; s < 1_000_000; s++) if (rollDie(s)[1] === value) return s
  throw new Error(`aucune graine ne produit ${value}`)
}

/** Position relative du siège `seat` qui tombe sur la case absolue `index`. */
const stepsToReach = (seat: Seat, index: number): number =>
  (index - STANDARD.startIndex[seat] + STANDARD.trackLength) % STANDARD.trackLength

describe('sortie de l’écurie', () => {
  it('interdit de sortir sans la bonne valeur', () => {
    for (const dice of [1, 2, 3, 4, 5]) {
      expect(legalMoves(setup({ dice }))).toHaveLength(0)
    }
  })

  it('autorise les quatre chevaux sur un 6', () => {
    const moves = legalMoves(setup({ dice: 6 }))
    expect(moves).toHaveLength(4)
    expect(moves.every((m) => m.exits && m.to === 0)).toBe(true)
  })

  it('accepte aussi le 1 en variante rapide', () => {
    // La variante rapide joue avec 2 chevaux par joueur, pas 4.
    expect(legalMoves(setup({ variant: 'rapide', dice: 1 }))).toHaveLength(2)
  })
})

describe('capture', () => {
  it('renvoie le cheval adverse à l’écurie', () => {
    const victim = pawnId(1, 0)
    const state = setup({
      at: { [pawnId(0, 0)]: 2, [victim]: stepsToReach(1, 5) },
      dice: 3,
    })

    const move = legalMoves(state).find((m) => m.pawnId === pawnId(0, 0))!
    expect(move.to).toBe(5)
    expect(move.captures).toEqual([victim])

    const { state: after } = apply(state, { type: 'move', pawnId: pawnId(0, 0) }, 0)
    expect(after.pawns.find((p) => p.id === victim)!.steps).toBe(STABLE)
  })

  it('épargne un cheval sur une case étoilée en Ludo', () => {
    const victim = pawnId(1, 0)
    const at = { [pawnId(0, 0)]: 5, [victim]: stepsToReach(1, 8) }
    expect(legalMoves(setup({ variant: 'ludo', at, dice: 3 }))[0]!.captures).toEqual([])
    // La règle française n'a pas de case étoilée : la capture passe.
    expect(legalMoves(setup({ variant: 'petits-chevaux', at, dice: 3 }))[0]!.captures).toEqual([victim])
  })

  it('épargne un cheval sur une case de départ', () => {
    const victim = pawnId(1, 0)
    const state = setup({
      at: { [pawnId(0, 0)]: 25, [victim]: stepsToReach(1, STANDARD.startIndex[2]) },
      dice: 3,
    })
    expect(legalMoves(state)[0]!.to).toBe(28)
    expect(legalMoves(state)[0]!.captures).toEqual([])
  })

  it('ne mange jamais ses propres chevaux', () => {
    const state = setup({ at: { [pawnId(0, 0)]: 2, [pawnId(0, 1)]: 5 }, dice: 3 })
    const move = legalMoves(state).find((m) => m.pawnId === pawnId(0, 0))!
    expect(move.captures).toEqual([])
  })
})

describe('arrivée', () => {
  it('exige le compte exact', () => {
    const at = { [pawnId(0, 0)]: STANDARD.lastStep - 1 }
    expect(legalMoves(setup({ at, dice: 1 }))[0]!.finishes).toBe(true)
    expect(legalMoves(setup({ at, dice: 2 }))).toHaveLength(0)
  })

  it('tolère le dépassement en variante rapide', () => {
    const move = legalMoves(setup({ variant: 'rapide', at: { [pawnId(0, 0)]: RAPIDE.lastStep - 1 }, dice: 5 }))[0]!
    expect(move.to).toBe(RAPIDE.lastStep)
    expect(move.finishes).toBe(true)
  })

  it('ignore un cheval déjà arrivé', () => {
    const state = setup({ at: { [pawnId(0, 0)]: STANDARD.lastStep }, dice: 6 })
    expect(legalMoves(state).some((m) => m.pawnId === pawnId(0, 0))).toBe(false)
  })

  it('traverse l’escalier sans quitter le circuit', () => {
    // 55 = dernière case du circuit ; +2 doit mener à la 2ᵉ case de l'escalier.
    const move = legalMoves(setup({ at: { [pawnId(0, 0)]: STANDARD.trackLength - 1 }, dice: 2 }))[0]!
    expect(move.to).toBe(STANDARD.trackLength + 1)
  })
})

describe('barrages (Ludo)', () => {
  const blocker = stepsToReach(1, 5)

  it('bloquent le passage', () => {
    const state = setup({
      variant: 'ludo',
      at: { [pawnId(0, 0)]: 2, [pawnId(1, 0)]: blocker, [pawnId(1, 1)]: blocker },
      dice: 5,
    })
    expect(legalMoves(state).some((m) => m.pawnId === pawnId(0, 0))).toBe(false)
  })

  it('laissent passer un cheval isolé', () => {
    const state = setup({
      variant: 'ludo',
      at: { [pawnId(0, 0)]: 2, [pawnId(1, 0)]: blocker },
      dice: 5,
    })
    expect(legalMoves(state).some((m) => m.pawnId === pawnId(0, 0))).toBe(true)
  })

  it('sont ignorés en règle française', () => {
    const state = setup({
      variant: 'petits-chevaux',
      at: { [pawnId(0, 0)]: 2, [pawnId(1, 0)]: blocker, [pawnId(1, 1)]: blocker },
      dice: 5,
    })
    expect(legalMoves(state).some((m) => m.pawnId === pawnId(0, 0))).toBe(true)
  })
})

describe('enchaînement des tours', () => {
  it('rend la main quand aucun coup n’est possible', () => {
    const rolled = apply({ ...setup({}), rng: seedFor(3) }, { type: 'roll' }, 0).state
    expect(rolled.dice).toBe(3)
    expect(legalMoves(rolled)).toHaveLength(0)

    const passed = apply(rolled, { type: 'pass' }, 0).state
    expect(passed.turn).toBe(1)
    expect(passed.phase).toBe('rolling')
  })

  it('fait rejouer après un 6', () => {
    const rolled = apply({ ...setup({}), rng: seedFor(6) }, { type: 'roll' }, 0).state
    const moved = apply(rolled, { type: 'move', pawnId: pawnId(0, 0) }, 0).state
    expect(moved.turn).toBe(0)
    expect(moved.phase).toBe('rolling')
  })

  it('annule le tour au troisième 6 consécutif', () => {
    const state = { ...setup({}), rng: seedFor(6), consecutiveSixes: 2 }
    const rolled = apply(state, { type: 'roll' }, 0).state
    expect(rolled.voided).toBe(true)
    expect(legalMoves(rolled)).toHaveLength(0)
    expect(apply(rolled, { type: 'pass' }, 0).state.turn).toBe(1)
  })

  it('refuse une action venant du mauvais siège', () => {
    expect(apply(setup({}), { type: 'roll' }, 1).error).toBeTruthy()
  })

  it('refuse un coup illégal', () => {
    const state = setup({ dice: 3 })
    expect(apply(state, { type: 'move', pawnId: pawnId(0, 0) }, 0).error).toBeTruthy()
  })

  it('refuse de passer si un coup existe', () => {
    expect(apply(setup({ dice: 6 }), { type: 'pass' }, 0).error).toBeTruthy()
  })

  it('saute les joueurs déjà arrivés', () => {
    const done = Object.fromEntries([0, 1, 2, 3].map((i) => [pawnId(1, i), STANDARD.lastStep]))
    const state: GameState = {
      ...setup({ seats: [0, 1, 2], at: done, dice: 3 }),
      ranking: [1],
      phase: 'moving',
    }
    expect(apply(state, { type: 'pass' }, 0).state.turn).toBe(2)
  })
})

describe('fin de partie', () => {
  it('classe le joueur qui rentre son dernier cheval', () => {
    const at = Object.fromEntries([0, 1, 2, 3].map((i) => [pawnId(0, i), STANDARD.lastStep]))
    at[pawnId(0, 3)] = STANDARD.lastStep - 1

    const state = setup({ at, dice: 1 })
    const { state: after } = apply(state, { type: 'move', pawnId: pawnId(0, 3) }, 0)

    expect(hasWon(after, 0)).toBe(true)
    expect(after.ranking[0]).toBe(0)
    // À deux joueurs, la partie s'arrête dès le premier arrivé.
    expect(after.phase).toBe('finished')
    expect(after.ranking).toEqual([0, 1])
  })

  it('continue à trois tant qu’il reste deux joueurs en lice', () => {
    const at = Object.fromEntries([0, 1, 2, 3].map((i) => [pawnId(0, i), STANDARD.lastStep]))
    at[pawnId(0, 3)] = STANDARD.lastStep - 1

    const state = setup({ seats: [0, 1, 2], at, dice: 1 })
    const { state: after } = apply(state, { type: 'move', pawnId: pawnId(0, 3) }, 0)

    expect(after.ranking).toEqual([0])
    expect(after.phase).toBe('rolling')
    expect(after.turn).toBe(1)
  })

  it('refuse toute action une fois terminée', () => {
    const finished: GameState = { ...setup({}), phase: 'finished' }
    expect(apply(finished, { type: 'roll' }, 0).error).toBeTruthy()
  })
})

describe('journal', () => {
  // L'affichage compose « <acteur> <texte> » : si le texte répétait le nom,
  // le journal afficherait « Alice Alice gagne la partie ! ».
  it("ne met jamais le nom de l'acteur dans l'événement", () => {
    const at = Object.fromEntries([0, 1, 2, 3].map((i) => [pawnId(0, i), STANDARD.lastStep]))
    at[pawnId(0, 3)] = STANDARD.lastStep - 1
    const { state } = apply(setup({ at, dice: 1 }), { type: 'move', pawnId: pawnId(0, 3) }, 0)

    // Le nom du joueur est porté une fois, par `actor`. Si l'événement le
    // portait aussi, l'écran afficherait « Alice Alice gagne la partie ! ».
    for (const entry of state.log) {
      if (!entry.actor) continue
      const payload = JSON.stringify(entry.event)
      expect(payload.includes(entry.actor), `« ${entry.actor} | ${payload} »`).toBe(false)
    }
  })

  it('laisse les messages système sans acteur', () => {
    expect(createGame({ players: players([0, 1]), variant: variantById('ludo'), seed: 1 }).log[0]!.actor).toBe('')
  })
})

describe('déterminisme', () => {
  it('rejoue la même partie à partir de la même graine', () => {
    const play = () => {
      let s = createGame({ players: players([0, 1]), variant: variantById('ludo'), seed: 42 })
      for (let i = 0; i < 200 && s.phase !== 'finished'; i++) {
        if (s.phase === 'rolling') s = apply(s, { type: 'roll' }, s.turn).state
        else {
          const moves = legalMoves(s)
          s = moves[0]
            ? apply(s, { type: 'move', pawnId: moves[0].pawnId }, s.turn).state
            : apply(s, { type: 'pass' }, s.turn).state
        }
      }
      return s
    }
    expect(JSON.stringify(play().pawns)).toBe(JSON.stringify(play().pawns))
  })
})

describe('bonus de dé', () => {
  it('consomme un bonus quand le lancer est boosté', () => {
    const state = setup({})
    expect(state.diceBoosts).toBe(DICE_BOOSTS_PER_GAME)

    const rolled = apply(state, { type: 'roll', boost: 'low' }, 0).state
    expect(rolled.diceBoosts).toBe(DICE_BOOSTS_PER_GAME - 1)
  })

  it('laisse les bonus intacts sans boost', () => {
    const rolled = apply(setup({}), { type: 'roll' }, 0).state
    expect(rolled.diceBoosts).toBe(DICE_BOOSTS_PER_GAME)
  })

  it('ignore un boost demandé sans bonus restant, sans planter', () => {
    const state: GameState = { ...setup({}), diceBoosts: 0 }
    const rolled = apply(state, { type: 'roll', boost: 'high' }, 0).state
    expect(rolled.diceBoosts).toBe(0)
    expect(rolled.dice).not.toBeNull()
  })
})

describe('pitié de sortie', () => {
  /** Enchaîne des tours entiers pour un joueur seul face à l'écurie. */
  const turnsToLeave = (seed: number, variantId = 'petits-chevaux'): number => {
    let s = createGame({ players: players([0, 1]), variant: variantById(variantId), seed })
    for (let turn = 1; turn <= 60; turn++) {
      s = apply(s, { type: 'roll' }, 0).state
      const moves = legalMoves(s)
      if (moves[0]) return turn
      s = apply(s, { type: 'pass' }, 0).state
      // Le siège 1 joue et rend la main, sinon on ne compterait qu'un seul tour.
      while (s.turn !== 0) {
        s = s.phase === 'rolling' ? apply(s, { type: 'roll' }, s.turn).state : s
        const other = legalMoves(s)
        s = other[0]
          ? apply(s, { type: 'move', pawnId: other[0].pawnId }, s.turn).state
          : apply(s, { type: 'pass' }, s.turn).state
      }
    }
    return Infinity
  }

  it('laisse le premier essai au dé franc', () => {
    const state = createGame({ players: players([0, 1]), variant: variantById('ludo'), seed: 7 })
    expect(mercyOf(state, 0)).toBe(0)
  })

  it('monte d’un cran par tour passé à l’écurie', () => {
    const state = createGame({ players: players([0, 1]), variant: variantById('ludo'), seed: 7 })
    const after = (n: number): GameState => ({ ...state, stuck: [n, 0, 0, 0] })
    expect(mercyOf(after(1), 0)).toBeCloseTo(0.2)
    expect(mercyOf(after(3), 0)).toBeCloseTo(0.6)
    expect(mercyOf(after(5), 0)).toBe(1)
    // Au-delà du seuil, la certitude ne se dépasse pas.
    expect(mercyOf(after(9), 0)).toBe(1)
  })

  it('retombe à zéro dès qu’un cheval est dehors', () => {
    const state: GameState = {
      ...setup({ at: { [pawnId(0, 0)]: 4 }, dice: 3 }),
      stuck: [4, 0, 0, 0],
    }
    expect(mercyOf(state, 0)).toBe(0)
  })

  it('ne s’applique pas à une variante qui ne la connaît pas', () => {
    const rapide = createGame({ players: players([0, 1]), variant: variantById('rapide'), seed: 7 })
    expect(mercyOf({ ...rapide, stuck: [9, 0, 0, 0] }, 0)).toBe(0)
  })

  it('compte les tours passés enfermé, et les oublie à la sortie', () => {
    let s = createGame({ players: players([0, 1]), variant: variantById('ludo'), seed: 3 })
    s = apply(s, { type: 'roll' }, 0).state
    expect(legalMoves(s)).toHaveLength(0)
    s = apply(s, { type: 'pass' }, 0).state
    expect(s.stuck[0]).toBe(1)
  })

  /**
   * Le point de départ de toute l'affaire : la règle stricte laisse une partie
   * sur quinze attendre plus de quinze lancers, pendant que la table fait le
   * tour du plateau. Avec la pitié, la sortie est bornée.
   */
  it('borne l’attente à l’écurie, quelle que soit la graine', () => {
    let worst = 0
    let total = 0
    const runs = 400
    for (let seed = 1; seed <= runs; seed++) {
      const turns = turnsToLeave(seed)
      worst = Math.max(worst, turns)
      total += turns
    }
    expect(worst).toBeLessThanOrEqual(6)
    expect(total / runs).toBeLessThan(3.5)
  })
})

describe('forceSkipTurn', () => {
  it('passe la main au siège suivant même si des coups légaux existaient', () => {
    const state = setup({ at: { [pawnId(0, 0)]: 2 }, dice: 3 })
    expect(legalMoves(state).length).toBeGreaterThan(0)

    const after = forceSkipTurn(state, 0)
    expect(after.turn).toBe(1)
    expect(after.phase).toBe('rolling')
  })

  it('fonctionne aussi en phase de lancer, avant même d’avoir joué le dé', () => {
    const state = setup({})
    expect(state.phase).toBe('rolling')

    const after = forceSkipTurn(state, 0)
    expect(after.turn).toBe(1)
  })

  it('passe vraiment la main après un 6 resté sur la table', () => {
    // Un 6 vaut rejeu : sans précaution, le tour « sauté » revenait au même
    // joueur, qui l'aurait sauté à nouveau, et ainsi de suite.
    const state = setup({ at: { [pawnId(0, 0)]: 2 }, dice: 6 })
    const after = forceSkipTurn(state, 0)
    expect(after.turn).toBe(1)
    expect(after.dice).toBeNull()
  })

  it('ne fait rien si le siège appelé n’a pas la main', () => {
    const state = setup({ dice: 3 })
    expect(forceSkipTurn(state, 1)).toBe(state)
  })

  it('ne fait rien si la partie est déjà terminée', () => {
    const state: GameState = { ...setup({}), phase: 'finished' }
    expect(forceSkipTurn(state, 0)).toBe(state)
  })
})
