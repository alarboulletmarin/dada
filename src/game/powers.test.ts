import { describe, expect, it } from 'vitest'
import { geometryFor } from './board.ts'
import { apply, createGame, handOf, legalMoves, pawnId, playablePowers, statsOf } from './engine.ts'
import { bonusCount, DECK_SIZE, freshDeck, HAND_LIMIT, POWERS, POWER_IDS, type PowerId } from './powers.ts'
import { shuffle } from './rng.ts'
import { STABLE, type GameState, type Player, type Seat, type Variant } from './types.ts'
import { variantById } from './variants.ts'

const players = (seats: Seat[]): Player[] =>
  seats.map((seat) => ({ seat, name: `J${seat + 1}`, kind: 'local' as const, peerId: null, connected: true }))

const withPowers = (id = 'petits-chevaux'): Variant => ({ ...variantById(id), powers: true })

const GEO = geometryFor(withPowers())

/**
 * Fabrique un état où le cheval 0 du siège 0 est à `dice` cases d'une case
 * pouvoir, la pioche truquée pour rendre `power` en premier. Le moteur reste
 * pur : il suffit de poser la pioche qu'on veut.
 */
function about(power: PowerId, opts: { at?: Record<string, number>; dice?: number } = {}): GameState {
  const base = createGame({ players: players([0, 1]), variant: withPowers(), seed: 7 })
  return {
    ...base,
    deck: [power, ...freshDeck()],
    pawns: base.pawns.map((p) => ({ ...p, steps: opts.at?.[p.id] ?? p.steps })),
    dice: opts.dice ?? 1,
    phase: 'moving',
  }
}

/** Le premier décalage de case pouvoir, compté depuis le départ du siège 0. */
const firstPowerStep = [...GEO.powerIndexSet]
  .map((i) => (i - GEO.startIndex[0] + GEO.trackLength) % GEO.trackLength)
  .sort((a, b) => a - b)[0]!

/** Position relative du siège `seat` qui tombe sur la case absolue `index`. */
const stepsToReach = (seat: Seat, index: number): number =>
  (index - GEO.startIndex[seat] + GEO.trackLength) % GEO.trackLength

const play = (state: GameState, pawn = pawnId(0, 0)): GameState => apply(state, { type: 'move', pawnId: pawn }, state.turn).state
const pawnOf = (state: GameState, id = pawnId(0, 0)) => state.pawns.find((p) => p.id === id)!

/**
 * Rend la main au siège 0, dé lancé.
 *
 * Une carte se ramasse à la fin d'un coup, et le tour passe aussitôt : elle ne
 * se joue donc jamais dans la foulée, mais au tour suivant. C'est le propre
 * d'une carte qu'on garde, et les tests doivent avancer jusque-là.
 */
const myTurn = (state: GameState, dice = 3): GameState => ({
  ...state,
  turn: 0,
  phase: 'moving',
  dice,
  voided: false,
})

describe('le paquet', () => {
  it('mélange les mêmes cartes, dans un ordre qui dépend de la graine', () => {
    const [, a] = shuffle(1, freshDeck())
    const [, b] = shuffle(2, freshDeck())
    expect(a).not.toEqual(b)
    expect([...a].sort()).toEqual([...b].sort())
  })

  // C'est toute la promesse d'équité : au bout d'un paquet, la table a vu
  // exactement cette composition, quelles que soient les cases ramassées.
  it('tient la proportion annoncée : dix bonus pour six malus', () => {
    expect(DECK_SIZE).toBe(16)
    expect(bonusCount).toBe(10)
    const deck = freshDeck()
    for (const id of POWER_IDS) {
      expect(deck.filter((p) => p === id)).toHaveLength(POWERS[id].copies)
    }
  })

  it('se remélange quand il est vide plutôt que de rendre rien', () => {
    const state = { ...about('bouclier', { at: { [pawnId(0, 0)]: firstPowerStep - 1 } }), deck: [] }
    const next = play(state)
    expect(next.deck!.length).toBe(DECK_SIZE - 1)
    expect(next.log.some((e) => e.event.kind === 'power')).toBe(true)
  })

  it('ne pioche pas du tout si la table n’a pas activé les pouvoirs', () => {
    const base = createGame({ players: players([0, 1]), variant: variantById('petits-chevaux'), seed: 7 })
    expect(base.deck).toBeUndefined()
    const state: GameState = {
      ...base,
      pawns: base.pawns.map((p) => (p.id === pawnId(0, 0) ? { ...p, steps: firstPowerStep - 1 } : p)),
      dice: 1,
      phase: 'moving',
    }
    expect(play(state).log.some((e) => e.event.kind === 'power')).toBe(false)
  })
})

describe('ramasser une case pouvoir', () => {
  const landing = { [pawnId(0, 0)]: firstPowerStep - 1 }

  it('ne se déclenche que sur une case pouvoir', () => {
    const elsewhere = play(about('bouclier', { at: { [pawnId(0, 0)]: 0 }, dice: 1 }))
    expect(elsewhere.log.some((e) => e.event.kind === 'power')).toBe(false)
  })

  it('bouclier — se garde en main, puis protège le cheval une fois', () => {
    // Ramassé, il rejoint la main : c'est le joueur qui choisit son moment.
    const drawn = play(about('bouclier', { at: landing }))
    expect(handOf(drawn, 0)).toEqual(['bouclier'])
    expect(pawnOf(drawn).shield).toBeUndefined()

    const armed = apply(myTurn(drawn), { type: 'power', power: 'bouclier', pawnId: pawnId(0, 0) }, 0).state
    expect(pawnOf(armed).shield).toBe(true)
    expect(handOf(armed, 0)).toEqual([])

    // Le siège 1 tombe pile dessus : le coup reste légal, mais ne mange pas.
    const victimIndex = (GEO.startIndex[0] + firstPowerStep) % GEO.trackLength
    const chaser = (victimIndex - GEO.startIndex[1] - 1 + GEO.trackLength) % GEO.trackLength
    const attack: GameState = {
      ...armed,
      turn: 1,
      phase: 'moving',
      dice: 1,
      pawns: armed.pawns.map((p) => (p.id === pawnId(1, 0) ? { ...p, steps: chaser } : p)),
    }
    const move = legalMoves(attack).find((m) => m.pawnId === pawnId(1, 0))!
    expect(move.captures).toEqual([])
    expect(move.shielded).toEqual([pawnId(0, 0)])

    const after = play(attack, pawnId(1, 0))
    expect(pawnOf(after).steps).toBe(firstPowerStep)
    expect(pawnOf(after).shield).toBe(false)
  })

  it('galop — se garde, puis pousse le cheval désigné de trois cases', () => {
    const drawn = play(about('galop', { at: landing }))
    expect(handOf(drawn, 0)).toEqual(['galop'])
    expect(pawnOf(drawn).steps).toBe(firstPowerStep)

    const run = apply(myTurn(drawn), { type: 'power', power: 'galop', pawnId: pawnId(0, 0) }, 0).state
    expect(pawnOf(run).steps).toBe(firstPowerStep + POWERS.galop.steps)
  })

  it('galop — refuse un cheval resté à l’écurie', () => {
    const drawn = play(about('galop', { at: landing }))
    const refused = apply(myTurn(drawn), { type: 'power', power: 'galop', pawnId: pawnId(0, 1) }, 0)
    expect(refused.error).toBe('powerNotNow')
    expect(handOf(refused.state, 0)).toEqual(['galop'])
  })

  // Un galop ne doit jamais faire rentrer un cheval par accident, ni le pousser
  // au-delà de l'arrivée. La propriété se vérifie sur toutes les cases pouvoir
  // de toutes les variantes plutôt que sur un cas choisi à la main.
  it('galop — ne pousse jamais un cheval au-delà de l’arrivée', () => {
    for (const id of ['petits-chevaux', 'ludo', 'rapide']) {
      const geometry = geometryFor(withPowers(id))
      for (const index of geometry.powerIndexSet) {
        const steps = (index - geometry.startIndex[0] + geometry.trackLength) % geometry.trackLength
        expect(steps + POWERS.galop.steps, `${id} · case ${index}`).toBeLessThanOrEqual(
          geometry.lastStep,
        )
      }
    }
  })

  it('faux pas — recule de trois cases sans repasser par l’écurie', () => {
    const next = play(about('fauxpas', { at: landing }))
    expect(pawnOf(next).steps).toBe(Math.max(0, firstPowerStep - POWERS.fauxpas.steps))
    expect(pawnOf(next).steps).toBeGreaterThanOrEqual(0)
  })

  it('écurie — renvoie le cheval chez lui, bouclier compris', () => {
    const armed = about('ecurie', { at: landing })
    const state: GameState = {
      ...armed,
      pawns: armed.pawns.map((p) => (p.id === pawnId(0, 0) ? { ...p, shield: true } : p)),
    }
    const next = play(state)
    expect(pawnOf(next).steps).toBe(STABLE)
    expect(pawnOf(next).shield).toBe(false)
  })

  it('dés — ajoute un bonus de dé au budget commun', () => {
    const before = about('des', { at: landing })
    expect(play(before).diceBoosts).toBe(before.diceBoosts + 1)
  })

  it('rejeu — se garde, puis relance le dé sans rendre la main', () => {
    const drawn = play(about('rejeu', { at: landing }))
    expect(handOf(drawn, 0)).toEqual(['rejeu'])

    // Un dé sur la table, un tour à soi : la carte s'y joue.
    const before = myTurn(drawn, 2)
    const after = apply(before, { type: 'power', power: 'rejeu' }, 0).state
    expect(after.turn).toBe(0)
    expect(after.phase).toBe('moving')
    expect(after.dice).not.toBeNull()
    expect(statsOf(after, 0).rolls).toBe(statsOf(before, 0).rolls + 1)
  })

  it('rejeu — n’est pas jouable tant que le dé n’est pas lancé', () => {
    const drawn = play(about('rejeu', { at: landing }))
    const early: GameState = { ...myTurn(drawn), phase: 'rolling', dice: null }
    expect(apply(early, { type: 'power', power: 'rejeu' }, 0).error).toBe('powerNotNow')
    expect(playablePowers(early)).toEqual([])
  })

  it('refuse une carte qu’on n’a pas', () => {
    const state = about('rejeu', { at: landing })
    expect(apply(state, { type: 'power', power: 'galop', pawnId: pawnId(0, 0) }, 0).error).toBe(
      'noSuchPower',
    )
  })

  it('laisse filer un bonus quand la main est pleine', () => {
    const full = about('bouclier', { at: landing })
    const state: GameState = { ...full, hands: [['galop', 'galop', 'galop'], [], [], []] }
    const next = play(state)
    expect(handOf(next, 0)).toHaveLength(HAND_LIMIT)
    expect(next.log.some((e) => e.event.kind === 'handFull')).toBe(true)
  })

  it('tour sauté — brûle le prochain tour du joueur, une seule fois', () => {
    const next = play(about('saute', { at: landing }))
    expect(next.skips![0]).toBe(1)
    expect(next.turn).toBe(1)

    // Le siège 1 n'a rien à jouer et passe : la main devrait revenir au siège 0,
    // qui la perd, et repartir aussitôt au siège 1.
    const passed = apply({ ...next, dice: 3, phase: 'moving' }, { type: 'pass' }, 1).state
    expect(passed.turn).toBe(1)
    expect(passed.skips![0]).toBe(0)
    expect(passed.log.some((e) => e.event.kind === 'skipped')).toBe(true)

    // …et une seule fois : le tour suivant du siège 0 se joue normalement.
    const again = apply({ ...passed, dice: 3, phase: 'moving' }, { type: 'pass' }, 1).state
    expect(again.turn).toBe(0)
  })

  it('journalise ce qui a été ramassé, sans texte traduit', () => {
    const next = play(about('galop', { at: landing }))
    const entry = next.log.find((e) => e.event.kind === 'power')!
    expect(entry.event).toEqual({ kind: 'power', power: 'galop', pawn: 1 })
  })
})


/**
 * Les compteurs de fin de partie.
 *
 * Ils n'entrent dans aucune décision de règle — mais ils circulent sur le
 * réseau avec le reste de l'état, et un compteur faux se voit sur l'écran de
 * fin, là où on le lit le plus attentivement.
 */
describe('feuille de match', () => {
  const fresh = () => createGame({ players: players([0, 1]), variant: withPowers(), seed: 7 })

  it('part de zéro', () => {
    const stats = statsOf(fresh(), 0)
    expect(stats).toEqual({
      rolls: 0,
      pips: 0,
      sixes: 0,
      captures: 0,
      losses: 0,
      distance: 0,
      powers: 0,
    })
  })

  it('compte les lancers, la somme des faces et les 6', () => {
    let state = fresh()
    for (let i = 0; i < 5; i++) {
      const before = state.turn
      state = apply(state, { type: 'roll' }, state.turn).state
      const stats = statsOf(state, before)
      expect(stats.rolls).toBeGreaterThan(0)
      expect(stats.pips).toBeGreaterThanOrEqual(stats.rolls)
      expect(stats.pips).toBeLessThanOrEqual(stats.rolls * 6)
      expect(stats.sixes).toBeLessThanOrEqual(stats.rolls)
      // On repart d'un état propre pour ne compter qu'un lancer à la fois.
      state = { ...state, phase: 'rolling', dice: null, voided: false, turn: before }
    }
  })

  it('compte les cases parcourues, sans compter la sortie d’écurie', () => {
    const out = apply({ ...fresh(), dice: 6, phase: 'moving' }, { type: 'move', pawnId: pawnId(0, 0) }, 0).state
    expect(statsOf(out, 0).distance).toBe(0)

    const moved = apply({ ...out, turn: 0, dice: 4, phase: 'moving' }, { type: 'move', pawnId: pawnId(0, 0) }, 0).state
    expect(statsOf(moved, 0).distance).toBe(4)
  })

  it('compte une capture d’un côté et une perte de l’autre', () => {
    const base = fresh()
    const victim = pawnId(1, 0)
    const state: GameState = {
      ...base,
      pawns: base.pawns.map((p) =>
        p.id === pawnId(0, 0) ? { ...p, steps: 2 } : p.id === victim ? { ...p, steps: stepsToReach(1, 5) } : p,
      ),
      dice: 3,
      phase: 'moving',
    }
    const after = play(state)
    expect(statsOf(after, 0).captures).toBe(1)
    expect(statsOf(after, 1).losses).toBe(1)
  })

  it('compte les cartes ramassées', () => {
    const next = play(about('galop', { at: { [pawnId(0, 0)]: firstPowerStep - 1 } }))
    expect(statsOf(next, 0).powers).toBe(1)
  })

  it('survit à un état venu d’une version qui ne les connaissait pas', () => {
    const legacy: GameState = { ...fresh(), stats: undefined }
    expect(statsOf(legacy, 0).rolls).toBe(0)
    const rolled = apply(legacy, { type: 'roll' }, legacy.turn).state
    expect(statsOf(rolled, legacy.turn).rolls).toBe(1)
  })
})
