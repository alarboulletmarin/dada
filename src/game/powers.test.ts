import { describe, expect, it } from 'vitest'
import { geometryFor } from './board.ts'
import {
  apply,
  boostsOf,
  createGame,
  handOf,
  legalMoves,
  pawnId,
  playablePowers,
  statsOf,
} from './engine.ts'
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

  // Le dé pipé rejoignait la réserve à la seconde où on le ramassait : un bonus
  // qui se joue tout seul, c'est-à-dire un bonus dont on ne décide rien.
  it('dés — se garde en main, et ne garnit la réserve qu’une fois joué', () => {
    const drawn = play(about('des', { at: landing }))
    expect(handOf(drawn, 0)).toEqual(['des'])
    expect(boostsOf(drawn, 0)).toBe(boostsOf(about('des'), 0))

    const spent = apply(myTurn(drawn), { type: 'power', power: 'des' }, 0).state
    // Le bonus va à qui joue la carte, et à personne d'autre.
    expect(boostsOf(spent, 0)).toBe(boostsOf(drawn, 0) + 1)
    expect(boostsOf(spent, 1)).toBe(boostsOf(drawn, 1))
    expect(handOf(spent, 0)).toEqual([])
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
 * Le lancer du dé comme validateur d'une carte.
 *
 * Choisir une carte ne la joue pas : elle attend son cheval, puis elle attend le
 * dé. Les deux voyagent dans une seule action — deux intentions envoyées à la
 * suite pourraient s'appliquer dans l'ordre inverse chez l'hôte, et la carte
 * jouerait après le dé qu'elle devait pipé.
 */
describe('le lancer valide la carte armée', () => {
  const landing = { [pawnId(0, 0)]: firstPowerStep - 1 }

  it('joue la carte AVANT de lancer, en une seule action', () => {
    const drawn = play(about('bouclier', { at: landing }))
    const before: GameState = { ...myTurn(drawn), phase: 'rolling', dice: null }

    const after = apply(before, { type: 'roll', power: 'bouclier', pawnId: pawnId(0, 0) }, 0).state
    expect(pawnOf(after).shield).toBe(true)
    expect(handOf(after, 0)).toEqual([])
    // Le dé est bien parti : la carte ne remplace pas le tour, elle l'ouvre.
    expect(after.phase).toBe('moving')
    expect(after.dice).not.toBeNull()

    // L'ordre compte : le bouclier est posé, puis le dé lancé.
    const seqs = after.log.map((e) => e.event.kind)
    expect(seqs.indexOf('played')).toBeLessThan(seqs.lastIndexOf('roll'))
  })

  it('refuse tout le geste quand la carte ne peut pas être jouée — le dé ne part pas', () => {
    const drawn = play(about('galop', { at: landing }))
    const before: GameState = { ...myTurn(drawn), phase: 'rolling', dice: null }

    // Le cheval 1 est à l'écurie : le galop n'a rien à pousser.
    const refused = apply(before, { type: 'roll', power: 'galop', pawnId: pawnId(0, 1) }, 0)
    expect(refused.error).toBe('powerNotNow')
    expect(refused.state.dice).toBeNull()
    expect(handOf(refused.state, 0)).toEqual(['galop'])
  })

  it('rejeu — relance une seule fois : le lancer EST la carte', () => {
    const drawn = play(about('rejeu', { at: landing }))
    const before = myTurn(drawn, 2)
    const after = apply(before, { type: 'roll', power: 'rejeu' }, 0).state

    expect(handOf(after, 0)).toEqual([])
    expect(statsOf(after, 0).rolls).toBe(statsOf(before, 0).rolls + 1)
    expect(after.turn).toBe(0)
    expect(after.phase).toBe('moving')
  })

  it('ne rend pas un second dé à une carte jouée après le lancer', () => {
    const drawn = play(about('bouclier', { at: landing }))
    const before = myTurn(drawn, 3)
    const after = apply(before, { type: 'roll', power: 'bouclier', pawnId: pawnId(0, 0) }, 0).state

    expect(pawnOf(after).shield).toBe(true)
    expect(after.dice).toBe(3)
    expect(statsOf(after, 0).rolls).toBe(statsOf(before, 0).rolls)
  })

  it('sans carte armée, reste le lancer d’avant', () => {
    const fresh = createGame({ players: players([0, 1]), variant: withPowers(), seed: 7 })
    const rolled = apply(fresh, { type: 'roll' }, 0).state
    expect(rolled.phase).toBe('moving')
    expect(apply(rolled, { type: 'roll' }, 0).error).toBe('alreadyRolled')
  })
})

/**
 * Les cartes qui durent.
 *
 * Un bouclier tient tant que personne ne vient manger le cheval — une partie
 * entière, s'il le faut. Un galop, lui, peut rentrer le dernier cheval, et cette
 * victoire-là doit compter comme les autres.
 */
describe('les effets qui durent', () => {
  const landing = { [pawnId(0, 0)]: firstPowerStep - 1 }

  it('le bouclier tient d’un tour à l’autre tant que rien ne le frappe', () => {
    const drawn = play(about('bouclier', { at: landing }))
    let state = apply(myTurn(drawn), { type: 'power', power: 'bouclier', pawnId: pawnId(0, 0) }, 0).state
    expect(pawnOf(state).shield).toBe(true)

    // Dix tours passent sans que personne n'attaque : le bouclier est toujours là.
    for (let i = 0; i < 10; i++) {
      state = apply({ ...state, turn: 0, phase: 'rolling', dice: null, voided: false }, { type: 'roll' }, 0).state
      state = { ...state, turn: 1, phase: 'rolling', dice: null, voided: false }
      state = apply(state, { type: 'roll' }, 1).state
      expect(pawnOf(state).shield).toBe(true)
    }
  })

  it('un galop qui rentre le dernier cheval fait gagner la partie', () => {
    const base = about('galop', { at: landing })
    const last = GEO.lastStep - POWERS.galop.steps
    const state: GameState = {
      ...base,
      hands: [['galop'], [], [], []],
      // Un seul cheval encore dehors, à trois cases de l'arrivée ; les autres
      // sont déjà rentrés.
      pawns: base.pawns.map((p) =>
        p.owner !== 0 ? p : p.id === pawnId(0, 0) ? { ...p, steps: last } : { ...p, steps: GEO.lastStep },
      ),
      turn: 0,
      phase: 'rolling',
      dice: null,
    }

    const won = apply(state, { type: 'power', power: 'galop', pawnId: pawnId(0, 0) }, 0).state
    expect(pawnOf(won).steps).toBe(GEO.lastStep)
    expect(won.ranking[0]).toBe(0)
    expect(won.log.some((e) => e.event.kind === 'win')).toBe(true)
    // Deux joueurs seulement : la partie est finie, et le siège 0 ne rejoue pas.
    expect(won.phase).toBe('finished')
  })

  it('un bouclier ne survit pas à l’arrivée : le cheval rentré n’en porte plus', () => {
    const base = about('bouclier', { at: landing })
    const state: GameState = {
      ...base,
      hands: [['galop'], [], [], []],
      pawns: base.pawns.map((p) =>
        p.id === pawnId(0, 0)
          ? { ...p, steps: GEO.lastStep - POWERS.galop.steps, shield: true }
          : p,
      ),
      turn: 0,
      phase: 'rolling',
      dice: null,
    }
    const home = apply(state, { type: 'power', power: 'galop', pawnId: pawnId(0, 0) }, 0).state
    expect(pawnOf(home).steps).toBe(GEO.lastStep)
    expect(pawnOf(home).shield).toBe(false)
  })
})


/**
 * Le galop arrive quelque part, et cette case appartient peut-être à un autre.
 *
 * Il posait autrefois son cheval sur la case visée sans regarder qui s'y
 * trouvait : deux chevaux sur une case en règle française, et un adversaire
 * rattrapé qui survivait à la charge. Un galop se joue donc comme un coup de
 * dé — il mange ce qu'il rattrape, il brise les boucliers, et il refuse la case
 * qu'un coup ordinaire aurait refusée.
 */
describe('le galop arrive comme un coup ordinaire', () => {
  /** Le siège 0 armé d'un galop, chevaux posés où on le demande. */
  const armed = (at: Record<string, number>, id = 'petits-chevaux'): GameState => {
    const base = createGame({ players: players([0, 1]), variant: withPowers(id), seed: 7 })
    return {
      ...base,
      hands: [['galop'], [], [], []],
      pawns: base.pawns.map((p) => ({ ...p, steps: at[p.id] ?? p.steps })),
      turn: 0,
      phase: 'rolling',
      dice: null,
    }
  }

  const gallop = (state: GameState, pawn = pawnId(0, 0)) =>
    apply(state, { type: 'power', power: 'galop', pawnId: pawn }, 0)

  it('mange le cheval adverse qu’il rattrape', () => {
    const victim = pawnId(1, 0)
    const state = armed({ [pawnId(0, 0)]: 10, [victim]: stepsToReach(1, (GEO.startIndex[0] + 13) % GEO.trackLength) })

    const after = gallop(state).state
    expect(pawnOf(after).steps).toBe(13)
    expect(pawnOf(after, victim).steps).toBe(STABLE)
    expect(statsOf(after, 0).captures).toBe(1)
    expect(statsOf(after, 1).losses).toBe(1)
    expect(after.log.some((e) => e.event.kind === 'capture')).toBe(true)
  })

  it('brise le bouclier au lieu de manger, et partage la case', () => {
    const victim = pawnId(1, 0)
    const base = armed({ [pawnId(0, 0)]: 10, [victim]: stepsToReach(1, (GEO.startIndex[0] + 13) % GEO.trackLength) })
    const state: GameState = {
      ...base,
      pawns: base.pawns.map((p) => (p.id === victim ? { ...p, shield: true } : p)),
    }

    const after = gallop(state).state
    expect(pawnOf(after).steps).toBe(13)
    expect(pawnOf(after, victim).shield).toBe(false)
    expect(pawnOf(after, victim).steps).not.toBe(STABLE)
    expect(statsOf(after, 0).captures).toBe(0)
    expect(after.log.some((e) => e.event.kind === 'shielded')).toBe(true)
  })

  // Une carte refusée doit être refusée AVANT de quitter la main : `canPlayPower`
  // et l'effet lisent la même fonction (`galopFor`), et ne peuvent donc pas
  // diverger. Le pire pour un bonus gardé serait d'être dépensé pour rien.
  it('refuse la case tenue par un cheval qu’il ne peut pas manger, sans rien dépenser', () => {
    // Son propre cheval, en règle française : le coup n'existe pas.
    const mine = armed({ [pawnId(0, 0)]: 10, [pawnId(0, 1)]: 13 })
    const refused = gallop(mine)
    expect(refused.error).toBe('powerNotNow')
    expect(handOf(refused.state, 0)).toEqual(['galop'])
    expect(pawnOf(refused.state).steps).toBe(10)
    // L'état d'origine, tel quel : ni carte retirée, ni carte annoncée.
    expect(refused.state).toBe(mine)
    expect(refused.state.log.some((e) => e.event.kind === 'played')).toBe(false)

    // Un adversaire abrité sur sa case de départ : pas davantage.
    const guard = pawnId(1, 0)
    const safe = armed({
      [pawnId(0, 0)]: stepsToReach(0, GEO.startIndex[1]) - POWERS.galop.steps,
      [guard]: 0,
    })
    const spared = gallop(safe)
    expect(spared.error).toBe('powerNotNow')
    expect(spared.state).toBe(safe)
  })

  /**
   * Un galop qui mange ne fait pas rejouer, même au Ludo où la capture vaut un
   * tour de plus.
   *
   * Une carte n'ouvre pas un tour, elle se joue dans celui qu'on tient déjà :
   * elle ne passe donc pas par `endTurn`, et la prime de capture appartient au
   * coup de dé. C'est aussi ce qui empêche un galop de se payer lui-même — deux
   * cartes gardées suffiraient sinon à ne plus rendre la main.
   */
  it('ne fait pas rejouer au Ludo, même en mangeant', () => {
    const ludo = geometryFor(withPowers('ludo'))
    const victim = pawnId(1, 0)
    const base = createGame({ players: players([0, 1]), variant: withPowers('ludo'), seed: 7 })
    const prey = (ludo.startIndex[0] + 10) % ludo.trackLength
    expect(ludo.startIndexSet.has(prey) || ludo.starIndexSet.has(prey)).toBe(false)

    const state: GameState = {
      ...base,
      hands: [['galop'], [], [], []],
      pawns: base.pawns.map((p) =>
        p.id === pawnId(0, 0)
          ? { ...p, steps: 7 }
          : p.id === victim
            ? { ...p, steps: (prey - ludo.startIndex[1] + ludo.trackLength) % ludo.trackLength }
            : p,
      ),
      turn: 0,
      // Un dé de 2 est déjà sur la table : le tour est en cours, et c'est lui
      // qui décidera de la main, pas la carte.
      dice: 2,
      phase: 'moving',
    }

    const eaten = apply(state, { type: 'power', power: 'galop', pawnId: pawnId(0, 0) }, 0).state
    expect(pawnOf(eaten, victim).steps).toBe(STABLE)
    // La carte n'a ni rendu ni repris la main : le tour est là où il était.
    expect(eaten.turn).toBe(0)
    expect(eaten.phase).toBe('moving')
    expect(eaten.dice).toBe(2)

    // Et le coup de dé qui suit, qui ne mange personne, rend la main normalement.
    const moved = play(eaten)
    expect(moved.turn).toBe(1)
  })

  it('partage la case au Ludo, qui ne connaît pas la règle française', () => {
    const state = armed({ [pawnId(0, 0)]: 10, [pawnId(0, 1)]: 13 }, 'ludo')
    const after = gallop(state).state
    expect(pawnOf(after).steps).toBe(13)
    expect(pawnOf(after, pawnId(0, 1)).steps).toBe(13)
  })

  // Un pouvoir qui déplace ne redéclenche pas la case où il pose le cheval :
  // deux cases voisines pourraient sinon se renvoyer la balle sans fin.
  it('ne ramasse pas la case pouvoir sur laquelle il s’arrête', () => {
    const state = armed({ [pawnId(0, 0)]: firstPowerStep - POWERS.galop.steps })
    const after = gallop(state).state
    expect(pawnOf(after).steps).toBe(firstPowerStep)
    expect(after.log.some((e) => e.event.kind === 'power')).toBe(false)
    expect(handOf(after, 0)).toEqual([])
  })
})

/**
 * Le faux pas recule, et un recul ne se change pas en aubaine.
 *
 * Deux règles, et elles tiennent ensemble : **on ne mange jamais en reculant**
 * — un malus qui offrirait une capture serait un bonus — et la case d'arrivée
 * obéit à « une case, un cheval » comme n'importe quelle autre. Une case prise
 * arrête donc le cheval à la première case libre en deçà, et s'il n'y en a
 * aucune il reste où il est. Jamais de retour à l'écurie : c'est le rôle du
 * malus qui porte ce nom.
 */
describe('le faux pas recule sans rien renverser', () => {
  const landing = { [pawnId(0, 0)]: firstPowerStep - 1 }
  const back = firstPowerStep - POWERS.fauxpas.steps

  it('s’arrête sur la première case libre quand la case visée est prise', () => {
    const state = about('fauxpas', { at: { ...landing, [pawnId(0, 1)]: back } })
    const next = play(state)
    expect(pawnOf(next).steps).toBe(back + 1)
    expect(pawnOf(next, pawnId(0, 1)).steps).toBe(back)
  })

  it('reste sur place si tout le chemin du retour est occupé', () => {
    const state = about('fauxpas', {
      at: { ...landing, [pawnId(0, 1)]: back, [pawnId(0, 2)]: back + 1, [pawnId(0, 3)]: back + 2 },
    })
    const next = play(state)
    expect(pawnOf(next).steps).toBe(firstPowerStep)
    // Rien ne s'est passé après le coup de dé : il n'y a pas deux temps à raconter.
    expect(next.hop).toBeUndefined()
  })

  it('ne mange jamais l’adversaire sur lequel il recule', () => {
    const victim = pawnId(1, 0)
    const state = about('fauxpas', {
      at: { ...landing, [victim]: stepsToReach(1, (GEO.startIndex[0] + back) % GEO.trackLength) },
    })
    const next = play(state)
    expect(pawnOf(next, victim).steps).not.toBe(STABLE)
    expect(pawnOf(next).steps).toBe(back + 1)
    expect(statsOf(next, 0).captures).toBe(0)
  })

  it('recule sans se gêner au Ludo, où deux pions partagent une case', () => {
    const ludo = geometryFor(withPowers('ludo'))
    const step = [...ludo.powerIndexSet]
      .map((i) => (i - ludo.startIndex[0] + ludo.trackLength) % ludo.trackLength)
      .sort((a, b) => a - b)[0]!
    const target = Math.max(0, step - POWERS.fauxpas.steps)

    const base = createGame({ players: players([0, 1]), variant: withPowers('ludo'), seed: 7 })
    const state: GameState = {
      ...base,
      deck: ['fauxpas', ...freshDeck()],
      pawns: base.pawns.map((p) =>
        p.id === pawnId(0, 0)
          ? { ...p, steps: step - 1 }
          : p.id === pawnId(0, 1)
            ? { ...p, steps: target }
            : p,
      ),
      dice: 1,
      phase: 'moving',
    }
    const next = play(state)
    expect(pawnOf(next).steps).toBe(target)
    expect(pawnOf(next, pawnId(0, 1)).steps).toBe(target)
  })
})

/**
 * Le bouclier se pose là où une capture peut arriver.
 *
 * À l'écurie et dans l'escalier, rien ne peut manger le cheval : le bouclier y
 * serait une carte dépensée pour rien, et une carte dépensée pour rien est un
 * piège tendu au joueur, pas une décision. Il ne protège pas non plus du
 * « Retour à l'écurie » — ce malus n'est pas une capture, et personne ne le
 * lance sur qui que ce soit.
 */
describe('où le bouclier se pose', () => {
  const armed = (at: number): GameState => {
    const base = createGame({ players: players([0, 1]), variant: withPowers(), seed: 7 })
    return {
      ...base,
      hands: [['bouclier'], [], [], []],
      pawns: base.pawns.map((p) => (p.id === pawnId(0, 0) ? { ...p, steps: at } : p)),
      turn: 0,
      phase: 'rolling',
      dice: null,
    }
  }
  const shield = (state: GameState) =>
    apply(state, { type: 'power', power: 'bouclier', pawnId: pawnId(0, 0) }, 0)

  it('accepte un cheval en piste', () => {
    expect(shield(armed(4)).error).toBeUndefined()
  })

  it('refuse un cheval resté à l’écurie', () => {
    const refused = shield(armed(STABLE))
    expect(refused.error).toBe('powerNotNow')
    expect(handOf(refused.state, 0)).toEqual(['bouclier'])
  })

  it('refuse un cheval déjà dans l’escalier, où plus rien ne l’atteint', () => {
    const refused = shield(armed(GEO.trackLength))
    expect(refused.error).toBe('powerNotNow')
    expect(playablePowers(armed(GEO.trackLength))).toEqual([])
  })

  it('ne protège pas du retour à l’écurie', () => {
    const state = about('ecurie', { at: { [pawnId(0, 0)]: firstPowerStep - 1 } })
    const shielded: GameState = {
      ...state,
      pawns: state.pawns.map((p) => (p.id === pawnId(0, 0) ? { ...p, shield: true } : p)),
    }
    expect(pawnOf(play(shielded)).steps).toBe(STABLE)
  })
})

/**
 * Un bouclier brisé n'est pas une capture.
 *
 * Le cheval reste sur sa case, son propriétaire ne perd rien — et l'attaquant
 * ne gagne donc pas le tour de rejeu que le Ludo accorde à qui mange.
 */
describe('briser un bouclier ne fait pas rejouer', () => {
  it('rend la main au Ludo, où la capture fait rejouer', () => {
    const ludo = geometryFor(withPowers('ludo'))
    const base = createGame({ players: players([0, 1]), variant: withPowers('ludo'), seed: 7 })
    expect(base.variant.extraTurnOnCapture).toBe(true)

    // Le siège 1 charge un cheval protégé posé trois cases devant lui, sur une
    // case ordinaire du circuit — ni départ, ni étoile.
    const victimIndex = (ludo.startIndex[1] + 3) % ludo.trackLength
    expect(ludo.startIndexSet.has(victimIndex) || ludo.starIndexSet.has(victimIndex)).toBe(false)
    const state: GameState = {
      ...base,
      turn: 1,
      dice: 3,
      phase: 'moving',
      pawns: base.pawns.map((p) =>
        p.id === pawnId(1, 0)
          ? { ...p, steps: 0 }
          : p.id === pawnId(0, 0)
            ? { ...p, steps: (victimIndex - ludo.startIndex[0] + ludo.trackLength) % ludo.trackLength, shield: true }
            : p,
      ),
    }

    const after = play(state, pawnId(1, 0))
    expect(after.log.some((e) => e.event.kind === 'shielded')).toBe(true)
    expect(after.log.some((e) => e.event.kind === 'capture')).toBe(false)
    expect(after.turn).toBe(0)
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

/**
 * Le coup se raconte en deux temps, et l'état doit le permettre.
 *
 * Un cheval qui s'arrête sur une case pouvoir peut en repartir aussitôt. L'état
 * ne gardant que sa position finale, l'écran dessinait « six moins trois »
 * comme un tranquille déplacement de trois cases, et un retour à l'écurie ne se
 * dessinait pas du tout — le cheval reparaissait chez lui sans avoir bougé.
 * `hop` note la case où le dé l'avait posé. Du dessin, pas de la règle : le
 * moteur ne le lit jamais.
 */
describe('l’étape intermédiaire d’un coup', () => {
  const landing = firstPowerStep - 6

  it('note la case pouvoir quand un faux pas en repart', () => {
    const next = play(about('fauxpas', { at: { [pawnId(0, 0)]: landing }, dice: 6 }))
    expect(next.hop).toEqual({ pawnId: pawnId(0, 0), at: firstPowerStep })
    expect(pawnOf(next).steps).toBe(firstPowerStep - 3)
  })

  it('la note aussi quand le cheval est renvoyé à l’écurie', () => {
    const next = play(about('ecurie', { at: { [pawnId(0, 0)]: landing }, dice: 6 }))
    expect(next.hop).toEqual({ pawnId: pawnId(0, 0), at: firstPowerStep })
    expect(pawnOf(next).steps).toBe(STABLE)
  })

  // Une carte gardée n'a pas déplacé le cheval : il n'y a pas deux temps à
  // raconter, et une étape posée là ferait rejouer un détour inexistant.
  it('ne note rien quand le pouvoir ne déplace pas', () => {
    const next = play(about('bouclier', { at: { [pawnId(0, 0)]: landing }, dice: 6 }))
    expect(next.hop).toBeUndefined()
    expect(pawnOf(next).steps).toBe(firstPowerStep)
  })

  it('ne note rien sur un coup ordinaire', () => {
    const next = play(about('fauxpas', { at: { [pawnId(0, 0)]: 2 }, dice: 3 }))
    expect(next.hop).toBeUndefined()
  })

  // Elle ne vaut que pour le coup qui vient d'être joué : la laisser traîner
  // ferait rejouer, au coup suivant du même cheval, un détour d'il y a trois tours.
  it('s’efface au coup suivant', () => {
    const detoured = play(about('fauxpas', { at: { [pawnId(0, 0)]: landing }, dice: 6 }))
    expect(detoured.hop).toBeDefined()
    const after = play(myTurn(detoured, 2))
    expect(after.hop).toBeUndefined()
  })
})
