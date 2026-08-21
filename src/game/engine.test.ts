import { describe, expect, it } from 'vitest'
import { geometryFor } from './board.ts'
import { apply, createGame, forceSkipTurn, hasWon, legalMoves, mercyOf, pawnId } from './engine.ts'
import { rollDie } from './rng.ts'
import { variantById } from './variants.ts'
import { DICE_BOOSTS_PER_GAME, STABLE, type GameState, type Player, type Seat } from './types.ts'

const players = (seats: Seat[]): Player[] =>
  seats.map((seat) => ({ seat, name: `J${seat + 1}`, kind: 'local' as const, peerId: null, connected: true }))

/** Géométries des trois variantes. Elles n'ont pas le même plateau : le
 *  français fait 56 cases, l'international 52, le rapide 40. Un test qui vise
 *  une case absolue doit donc dire sur quel plateau il compte. */
const STANDARD = geometryFor(variantById('petits-chevaux'))
const LUDO = geometryFor(variantById('ludo'))
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
const stepsToReach = (seat: Seat, index: number, geometry = STANDARD): number =>
  (index - geometry.startIndex[seat] + geometry.trackLength) % geometry.trackLength

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
    // La case étoilée du siège 0 tombe huit crans après son départ, sur les deux
    // plateaux — mais le siège 1 n'y est pas au même nombre de pas, le circuit
    // n'ayant pas la même longueur.
    const ludo = { [pawnId(0, 0)]: 5, [victim]: stepsToReach(1, 8, LUDO) }
    const move = legalMoves(setup({ variant: 'ludo', at: ludo, dice: 3 })).find(
      (m) => m.pawnId === pawnId(0, 0),
    )!
    expect(move.to).toBe(8)
    expect(move.captures).toEqual([])

    // La règle française n'a pas de case étoilée : la capture passe.
    const french = { [pawnId(0, 0)]: 5, [victim]: stepsToReach(1, 8) }
    expect(legalMoves(setup({ variant: 'petits-chevaux', at: french, dice: 3 }))[0]!.captures).toEqual([
      victim,
    ])
  })

  // Deux camps peuvent partager une case abritée au Ludo. En règle française,
  // c'est le coup entier qui devient injouable — voir « une case, un cheval ».
  it('épargne un cheval sur une case de départ, et le laisse partager la case', () => {
    const victim = pawnId(1, 0)
    const state = setup({
      variant: 'ludo',
      at: { [pawnId(0, 0)]: 23, [victim]: stepsToReach(1, LUDO.startIndex[2], LUDO) },
      dice: 3,
    })
    const move = legalMoves(state).find((m) => m.pawnId === pawnId(0, 0))!
    expect(move.to).toBe(26)
    expect(move.captures).toEqual([])
  })

  it('ne mange jamais ses propres chevaux', () => {
    // Au Ludo, deux pions d'une même couleur cohabitent sur une case.
    const state = setup({ variant: 'ludo', at: { [pawnId(0, 0)]: 2, [pawnId(0, 1)]: 5 }, dice: 3 })
    const move = legalMoves(state).find((m) => m.pawnId === pawnId(0, 0))!
    expect(move.captures).toEqual([])
  })
})

/**
 * « Deux chevaux ne peuvent pas occuper la même case ; s'il s'agit de vos
 * propres chevaux, l'un reste derrière l'autre. » C'est la règle française ;
 * le Ludo, lui, laisse deux pions d'une même couleur partager une case.
 */
describe('une case, un cheval (règle française)', () => {
  it('interdit de se poser sur son propre cheval', () => {
    const state = setup({ at: { [pawnId(0, 0)]: 2, [pawnId(0, 1)]: 7 }, dice: 5 })
    expect(legalMoves(state).some((m) => m.pawnId === pawnId(0, 0))).toBe(false)
  })

  it('interdit de se poser sur un adversaire protégé, faute de pouvoir le manger', () => {
    const at = { [pawnId(0, 0)]: stepsToReach(0, STANDARD.startIndex[1]) - 3, [pawnId(1, 0)]: 0 }
    expect(legalMoves(setup({ at, dice: 3 })).some((m) => m.pawnId === pawnId(0, 0))).toBe(false)
  })

  it('autorise le coup dès lors que la case se libère par la capture', () => {
    const at = { [pawnId(0, 0)]: 2, [pawnId(1, 0)]: stepsToReach(1, STANDARD.startIndex[0] + 7) }
    const move = legalMoves(setup({ at, dice: 5 })).find((m) => m.pawnId === pawnId(0, 0))
    expect(move?.captures).toEqual([pawnId(1, 0)])
  })

  it('interdit aussi de doubler une marche de son escalier', () => {
    const at = {
      [pawnId(0, 0)]: STANDARD.trackLength,
      [pawnId(0, 1)]: STANDARD.trackLength + 2,
    }
    expect(legalMoves(setup({ at, dice: 2 })).some((m) => m.pawnId === pawnId(0, 0))).toBe(false)
  })

  // Sans cette exception, le deuxième cheval ne pourrait jamais rentrer.
  it("laisse les quatre chevaux se rejoindre à l'arrivée", () => {
    const at = { [pawnId(0, 0)]: STANDARD.lastStep - 1, [pawnId(0, 1)]: STANDARD.lastStep }
    const move = legalMoves(setup({ at, dice: 1 })).find((m) => m.pawnId === pawnId(0, 0))
    expect(move?.finishes).toBe(true)
  })

  it('ne vaut pas pour le Ludo, qui laisse deux pions partager une case', () => {
    const mine = stepsToReach(0, 7, LUDO)
    const state = setup({ variant: 'ludo', at: { [pawnId(0, 0)]: mine - 5, [pawnId(0, 1)]: mine }, dice: 5 })
    expect(legalMoves(state).some((m) => m.pawnId === pawnId(0, 0))).toBe(true)
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

/**
 * Empiler deux pions d'une même couleur ne dresse aucun mur.
 *
 * La règle des barrages a été retirée : elle enfermait la table derrière deux
 * pions qu'on ne pouvait ni manger ni contourner, et la partie s'arrêtait de
 * jouer. Ces tests-ci sont ce qui l'empêche de revenir par la porte de service.
 */
describe('deux pions sur une case ne bloquent personne', () => {
  const blocker = stepsToReach(1, 5, LUDO)

  it('laisse passer un cheval adverse au Ludo', () => {
    const state = setup({
      variant: 'ludo',
      at: { [pawnId(0, 0)]: 2, [pawnId(1, 0)]: blocker, [pawnId(1, 1)]: blocker },
      dice: 5,
    })
    expect(legalMoves(state).some((m) => m.pawnId === pawnId(0, 0))).toBe(true)
  })

  // Franchir, c'est une chose ; s'y arrêter en est une autre, et les deux
  // doivent passer. Un coup qui tombe pile sur la pile mange ce qu'il y trouve.
  it("laisse s'arrêter dessus, et mange les deux", () => {
    const state = setup({
      variant: 'ludo',
      at: {
        [pawnId(0, 0)]: stepsToReach(0, 5, LUDO) - 3,
        [pawnId(1, 0)]: blocker,
        [pawnId(1, 1)]: blocker,
      },
      dice: 3,
    })
    const move = legalMoves(state).find((m) => m.pawnId === pawnId(0, 0))!
    expect(move.captures).toEqual([pawnId(1, 0), pawnId(1, 1)])
  })

  it("n'arrête pas davantage son propre camp", () => {
    const mine = stepsToReach(0, 5, LUDO)
    const state = setup({
      variant: 'ludo',
      at: { [pawnId(0, 0)]: mine - 5, [pawnId(0, 1)]: mine, [pawnId(0, 2)]: mine },
      dice: 6,
    })
    expect(legalMoves(state).some((m) => m.pawnId === pawnId(0, 0))).toBe(true)
  })

  it('ne bloque rien non plus en règle française', () => {
    const state = setup({
      variant: 'petits-chevaux',
      at: {
        [pawnId(0, 0)]: 2,
        [pawnId(1, 0)]: stepsToReach(1, 5),
        [pawnId(1, 1)]: stepsToReach(1, 5),
      },
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

  /**
   * Trois 6 d'affilée, et le tour est perdu — le troisième compris.
   *
   * Sans plafond, un 6 rend la main, et la main rendue peut refaire 6 : la
   * table regarde un joueur jouer seul aussi longtemps que le dé le veut. Le
   * troisième 6 ne se joue donc pas : il annule le coup **et** le tour. La
   * chaîne s'accumule bien d'un lancer à l'autre, y compris au travers du
   * rejeu qui rend la main — c'est ce que ce test vérifie de bout en bout,
   * plutôt qu'en posant le compteur à la main.
   */
  for (const variant of ['petits-chevaux', 'ludo', 'rapide']) {
    it(`perd le tour au troisième 6, en ${variant}`, () => {
      let state = setup({ variant })
      expect(state.variant.maxConsecutiveSixes).toBe(3)

      // Deux 6 joués : chacun rend la main au même joueur.
      for (let n = 1; n < 3; n++) {
        state = apply({ ...state, rng: seedFor(6) }, { type: 'roll' }, 0).state
        expect(state.dice).toBe(6)
        expect(state.voided).toBe(false)
        const moves = legalMoves(state)
        expect(moves.length).toBeGreaterThan(0)
        state = apply(state, { type: 'move', pawnId: moves[0]!.pawnId }, 0).state
        expect(state.turn).toBe(0)
        expect(state.phase).toBe('rolling')
      }

      // Le troisième : rien n'est jouable, et la main passe.
      state = apply({ ...state, rng: seedFor(6) }, { type: 'roll' }, 0).state
      expect(state.voided).toBe(true)
      expect(legalMoves(state)).toHaveLength(0)
      expect(apply(state, { type: 'pass' }, 0).state.turn).toBe(1)
    })
  }

  // Le rejeu relance le dé sans rendre la main : s'il remettait la chaîne à
  // zéro, il serait le moyen d'effacer deux 6 déjà posés et d'échapper à la règle.
  it('compte aussi les 6 obtenus par la carte rejeu', () => {
    const state = { ...setup({}), rng: seedFor(6), consecutiveSixes: 2, dice: 3, phase: 'moving' as const }
    const withCard = { ...state, hands: [['rejeu' as const], [], [], []] }
    const played = apply(withCard, { type: 'power', power: 'rejeu' }, 0).state
    expect(played.dice).toBe(6)
    expect(played.voided).toBe(true)
    expect(legalMoves(played)).toHaveLength(0)
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

/**
 * `apply` est totale : elle rend un état pour n'importe quelle entrée.
 *
 * L'action vient du réseau. Un pair d'une version plus récente, un message
 * abîmé, un `null` : rien de tout cela ne doit faire tomber l'hôte, qui tient la
 * partie de toute la table. Ce qu'on ne comprend pas est refusé, pas subi.
 */
describe('une action incomprise est refusée, jamais subie', () => {
  it('refuse une action qui n’en est pas une', () => {
    const state = setup({ dice: 3 })
    for (const junk of [null, undefined, 'roll', 42, {}, { type: 7 }]) {
      const result = apply(state, junk as never, 0)
      expect(result.error).toBe('illegal')
      expect(result.state).toBe(state)
    }
  })

  it('refuse un type d’action inconnu', () => {
    const state = setup({ dice: 3 })
    const result = apply(state, { type: 'télépathie' } as never, 0)
    expect(result.error).toBe('illegal')
    expect(result.state).toBe(state)
  })

  it('lance un dé franc quand le bonus demandé n’existe pas', () => {
    const state = setup({})
    const rolled = apply(state, { type: 'roll', boost: 'moyen' as never }, 0)
    expect(rolled.error).toBeUndefined()
    expect(rolled.state.dice).not.toBeNull()
    // Un bonus qu'on ne sait pas lire ne se dépense pas.
    expect(rolled.state.diceBoosts).toBe(DICE_BOOSTS_PER_GAME)
  })

  // Le refus rendait l'état débarrassé de l'étape intermédiaire du coup
  // précédent : l'écran, qui s'en sert pour raconter un détour en deux temps,
  // la perdait à cause d'un coup qui n'a jamais eu lieu.
  it('rend l’état d’origine, intact', () => {
    const state: GameState = { ...setup({ dice: 3 }), hop: { pawnId: pawnId(0, 0), at: 4 } }
    const refused = apply(state, { type: 'move', pawnId: pawnId(0, 0) }, 0)
    expect(refused.error).toBe('illegal')
    expect(refused.state).toBe(state)
    expect(refused.state.hop).toEqual({ pawnId: pawnId(0, 0), at: 4 })
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

  /**
   * Le numéro d'une entrée ne revient jamais en arrière.
   *
   * Le journal est tronqué à ses soixante dernières entrées, et le numéro se
   * lisait dans sa longueur : passé la soixantième, toutes les entrées portaient
   * le même. L'écran n'annonce que ce qui dépasse le dernier numéro vu — il ne
   * voyait donc plus rien passer, exactement au moment où la partie devient
   * intéressante.
   */
  it('numérote les entrées sans jamais se répéter, même une fois tronqué', () => {
    let state = createGame({ players: players([0, 1]), variant: variantById('ludo'), seed: 12 })
    for (let i = 0; i < 400 && state.phase !== 'finished'; i++) {
      if (state.phase === 'rolling') state = apply(state, { type: 'roll' }, state.turn).state
      else {
        const moves = legalMoves(state)
        state = moves[0]
          ? apply(state, { type: 'move', pawnId: moves[0].pawnId }, state.turn).state
          : apply(state, { type: 'pass' }, state.turn).state
      }
    }

    // Le journal a bien débordé : c'est là que le bug commençait.
    expect(state.log).toHaveLength(60)
    const seqs = state.log.map((e) => e.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(seqs[0]!).toBeGreaterThan(0)
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
