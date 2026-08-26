/**
 * Ce que les trois niveaux du bot doivent tenir, et ce qu'ils ont le droit de
 * rater.
 *
 * Le fichier `fuzz.test.ts` fait déjà jouer des parties entières, mais toujours
 * au niveau par défaut : rien n'y protégeait `tranquille` ni `redoutable`. Or
 * c'est précisément là qu'un bot se casse sans qu'on le voie. Un niveau affaibli
 * qui refuserait tous ses coups, tournerait en rond ou proposerait un coup que
 * le moteur rejette **fige la table** — le tour ne finit jamais, et personne ne
 * peut jouer. C'est le premier trou bouché ici : les trois niveaux mènent une
 * partie jusqu'à `finished`, sans qu'aucune action ne soit refusée.
 *
 * Les autres trous sont ceux qu'ouvre l'idée même de niveaux :
 *
 * - le hasard de `tranquille` se tire de l'état (voir `wobble`) et non de
 *   `Math.random` : une partie doit se rejouer à l'identique à graine égale, et
 *   le test de déterminisme tombe le jour où quelqu'un remet un vrai tirage ;
 * - un réglage qui ne changerait rien serait un mensonge du salon : le
 *   redoutable doit l'emporter nettement en tête-à-tête contre le tranquille ;
 * - `tranquille` doit se tromper **comme un humain** — oublier une capture,
 *   jamais jouer un coup illégal ;
 * - `redoutable` doit voir ce que `normal` ne voit pas : la case abritée, le
 *   cheval adverse le plus avancé, le bonus de dé qu'on garde sinon jusqu'à la
 *   fin de la partie ;
 * - et les deux appels d'avant les niveaux, `chooseMove(state)` et
 *   `choosePower(state)`, doivent continuer à dire exactement ce qu'ils
 *   disaient, c'est-à-dire jouer comme `normal`.
 *
 * Il doit rester **court** : quelques secondes en tout, sinon on cesse de le
 * lancer et il ne protège plus rien.
 */

import { describe, expect, it } from 'vitest'
import { geometryFor, trackIndexOf } from './board.ts'
import {
  BOT_DELAY,
  BOT_LEVELS,
  botTurn,
  chooseMove,
  choosePower,
  DEFAULT_LEVEL,
  isBotLevel,
  type BotLevel,
} from './bot.ts'
import { apply, createGame, isSafeIndex, legalMoves, pawnId } from './engine.ts'
import type { GameState, Player, Seat } from './types.ts'
import { VARIANTS, variantById } from './variants.ts'

/** Assez pour finir une partie à quatre sur le grand plateau, jamais infini. */
const MAX_ACTIONS = 4000

/**
 * Toutes les variantes du dépôt, et non une liste recopiée.
 *
 * Les règles sont des données : ajouter la variante de sa famille tient en un
 * objet de vingt lignes, et personne n'ira penser à la rajouter ici. Une liste
 * écrite à la main aurait laissé le prochain jeu de règles sans aucun bot pour
 * le mener au bout — c'est-à-dire sans le seul test qui dise qu'il ne fige pas
 * la table.
 */
const VARIANT_IDS = VARIANTS.map((v) => v.id)

const players = (seats: Seat[]): Player[] =>
  seats.map((seat) => ({ seat, name: `J${seat + 1}`, kind: 'bot' as const, peerId: null, connected: true }))

/** La variante demandée, recopiée : le gel ne doit pas mordre sur `variants.ts`. */
const variantFor = (id: string, powers: boolean) => {
  const v = variantById(id)
  return { ...v, exitRolls: [...v.exitRolls], powers }
}

/**
 * Gèle l'état de fond en comble avant de le donner au bot : une écriture en
 * place lèverait au lieu de passer inaperçue. Le bot trie ses coups et range ses
 * cartes, et il le fait sur un état qui ne lui appartient pas — celui-là même
 * qui circule d'un téléphone à l'autre.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const inner of Object.values(value)) deepFreeze(inner)
  return Object.freeze(value)
}

/**
 * Une partie entière menée par des bots, un niveau par siège.
 *
 * Le refus est collecté dans une phrase plutôt qu'asserté sur place : elle dit
 * l'action, la graine et le rang du coup, ce dont on a besoin pour rejouer la
 * partie qui a mal tourné.
 */
function playOut(opts: {
  variantId: string
  seed: number
  levelOf: (seat: Seat) => BotLevel
  powers?: boolean
  seats?: Seat[]
  /** Appelé avant chaque action, sur l'état que le bot va voir. */
  watch?: (state: GameState) => void
}): GameState {
  const variant = variantFor(opts.variantId, opts.powers === true)
  const seats: Seat[] = opts.seats ?? [0, 1, 2, 3]
  const label = `${opts.variantId}${opts.powers ? '+pouvoirs' : ''} · graine ${opts.seed}`
  let state = deepFreeze(createGame({ players: players(seats), variant, seed: opts.seed }))
  let refused: string | null = null
  let actions = 0

  while (refused === null && state.phase !== 'finished' && actions < MAX_ACTIONS) {
    opts.watch?.(state)
    const action = botTurn(state, opts.levelOf(state.turn))
    const played = apply(state, action, state.turn)
    // Le bot ne doit jamais proposer un coup que le moteur refuse : un bot qui
    // se fait refuser son action reste bloqué sur son tour, et la table avec lui.
    if (played.error) {
      refused = `${label} · action ${actions} refusée (${played.error}) : ${JSON.stringify(action)}`
      break
    }
    state = deepFreeze(played.state)
    actions++
  }

  expect(refused).toBeNull()
  // Une partie qui n'arrive pas au bout est un blocage, pas une partie difficile.
  expect(state.phase, `${label} · ${actions} actions`).toBe('finished')
  return state
}

/**
 * Une position imposée : chevaux placés, dé posé, au siège 0 de jouer.
 *
 * `logSeq` est le seul levier sur les hésitations du niveau tranquille (voir
 * `wobble`) : le faire varier, c'est rejouer la même situation avec un autre
 * tirage, sans jamais toucher au générateur de la partie.
 */
function position(opts: {
  variantId: string
  at: Record<string, number>
  dice: number
  logSeq?: number
}): GameState {
  const base = createGame({
    players: players([0, 1, 2, 3]),
    variant: variantFor(opts.variantId, false),
    seed: 1,
  })
  return deepFreeze({
    ...base,
    pawns: base.pawns.map((p) => ({ ...p, steps: opts.at[p.id] ?? p.steps })),
    dice: opts.dice,
    phase: 'moving',
    logSeq: opts.logSeq ?? 1,
  })
}

/** Position relative du siège `seat` qui tombe sur la case absolue `index`. */
function stepsToReach(variantId: string, seat: Seat, index: number): number {
  const geometry = geometryFor(variantById(variantId))
  return (index - geometry.startIndex[seat] + geometry.trackLength) % geometry.trackLength
}

/** La case d'arrivée de ce coup est-elle une case où l'on ne peut pas être mangé ? */
function landsSafe(state: GameState, to: number): boolean {
  const geometry = geometryFor(state.variant)
  const index = trackIndexOf(geometry, 0, to)
  return index !== null && isSafeIndex(state.variant, index)
}

describe('les trois niveaux mènent une partie jusqu’au bout', () => {
  for (const level of BOT_LEVELS) {
    it(`ne se fait jamais refuser un coup en ${level}`, () => {
      for (const variantId of VARIANT_IDS) {
        for (const powers of [false, true]) {
          for (const seed of [1, 2]) {
            const state = playOut({ variantId, powers, seed, levelOf: () => level })
            // Le classement complet est la preuve que la partie s'est terminée
            // par une victoire et non par un plafond d'actions atteint.
            expect(state.ranking.length, `${variantId} · ${level} · graine ${seed}`).toBe(4)
          }
        }
      }
    })
  }
})

describe('la même graine rejoue la même partie', () => {
  const partie = (level: BotLevel): GameState =>
    playOut({ variantId: 'petits-chevaux', powers: true, seed: 42, levelOf: () => level })

  it('rend deux parties identiques à niveau et graine égaux', () => {
    for (const level of BOT_LEVELS) {
      const once = partie(level)
      const twice = partie(level)
      // Le niveau tranquille hésite et oublie, mais il tire ses hésitations de
      // `logSeq` : le jour où quelqu'un remet `Math.random`, ces deux parties
      // divergent et deux appareils ne montrent plus le même plateau.
      expect(JSON.stringify(twice), level).toBe(JSON.stringify(once))
    }
  })
})

describe('le niveau change vraiment la partie', () => {
  /** Assez de graines pour que l'écart se voie, assez peu pour rester court. */
  const DUELS = 60

  it('fait gagner le redoutable contre le tranquille en tête-à-tête', () => {
    let gagnes = 0
    for (let seed = 1; seed <= DUELS; seed++) {
      // Le siège du redoutable change d'une graine à l'autre : sans cela, on
      // mesurerait surtout l'avantage de jouer en premier.
      const redoutable: Seat = (seed % 2) as Seat
      const state = playOut({
        variantId: 'petits-chevaux',
        seed,
        seats: [0, 1],
        levelOf: (seat) => (seat === redoutable ? 'redoutable' : 'tranquille'),
      })
      if (state.ranking[0] === redoutable) gagnes++
    }
    // Deux niveaux qui gagneraient une fois sur deux seraient un réglage qui ne
    // règle rien — le salon promettrait une difficulté que la partie ne tient pas.
    expect(gagnes, `${gagnes}/${DUELS}`).toBeGreaterThan(DUELS * 0.66)
  })
})

describe('le niveau tranquille se trompe, mais jamais n’importe comment', () => {
  /** Combien d'états on parcourt en ne changeant que `logSeq`. */
  const TIRAGES = 24

  /**
   * Une capture à portée, et un coup de repli plus avancé sur le circuit.
   *
   * Le cheval mangeable vaut 1100 points d'heuristique, le repli en vaut 46 :
   * seul un bot qui oublie de regarder — ou qui hésite — peut préférer le second.
   */
  const capture = (logSeq: number): GameState =>
    position({
      variantId: 'petits-chevaux',
      at: {
        [pawnId(0, 0)]: 2,
        [pawnId(0, 1)]: 20,
        [pawnId(1, 0)]: stepsToReach('petits-chevaux', 1, 5),
      },
      dice: 3,
      logSeq,
    })

  it('rate parfois la capture que le niveau normal prend toujours', () => {
    let manques = 0
    let prises = 0
    for (let logSeq = 0; logSeq < TIRAGES; logSeq++) {
      const state = capture(logSeq)
      // Le niveau normal ne tire rien : il voit la capture à tous les coups, et
      // un bot qui la manquerait ne serait pas « normal » mais cassé.
      expect(chooseMove(state, 'normal')!.captures, `logSeq ${logSeq}`).toEqual([pawnId(1, 0)])
      if (chooseMove(state, 'tranquille')!.captures.length === 0) manques++
      else prises++
    }
    // Il en rate — c'est le réglage — mais il n'en rate pas toutes : un bot qui
    // refuserait systématiquement de manger ne serait plus un adversaire.
    expect(manques).toBeGreaterThan(0)
    expect(prises).toBeGreaterThan(0)
  })

  it('ne propose jamais un coup que le moteur refuserait', () => {
    for (let logSeq = 0; logSeq < TIRAGES; logSeq++) {
      const state = capture(logSeq)
      const move = chooseMove(state, 'tranquille')!
      // Le coup hésitant est pris dans la liste triée : le jour où l'index
      // déborde, `chooseMove` rendrait un cheval que `legalMoves` n'a pas proposé.
      expect(legalMoves(state).map((m) => m.pawnId), `logSeq ${logSeq}`).toContain(move.pawnId)
      const { error } = apply(state, { type: 'move', pawnId: move.pawnId }, 0)
      expect(error, `logSeq ${logSeq}`).toBeUndefined()
    }
  })
})

describe('le niveau redoutable voit ce que le niveau normal ne voit pas', () => {
  it('préfère la case abritée à la case la plus avancée', () => {
    // En ludo, les cases étoile protègent : celle du siège 0 tombe huit crans
    // après son départ. Deux coups possibles, et un seul met le cheval à l'abri.
    const state = position({
      variantId: 'ludo',
      at: { [pawnId(0, 0)]: 5, [pawnId(0, 1)]: 20 },
      dice: 3,
    })
    expect(legalMoves(state)).toHaveLength(2)

    const normal = chooseMove(state, 'normal')!
    const redoutable = chooseMove(state, 'redoutable')!
    // Le niveau normal ne compte que la distance parcourue : il pousse le cheval
    // le plus avancé et laisse l'autre sur une case où tout le monde peut le manger.
    expect(normal.pawnId).toBe(pawnId(0, 1))
    expect(landsSafe(state, normal.to)).toBe(false)
    // Le redoutable, lui, sait qu'une étoile est un rocher où l'on attend son tour.
    expect(redoutable.pawnId).toBe(pawnId(0, 0))
    expect(landsSafe(state, redoutable.to)).toBe(true)
  })

  it('mange le cheval le plus avancé quand deux captures s’offrent', () => {
    const avance = stepsToReach('ludo', 1, 5)
    const debutant = stepsToReach('ludo', 2, 33)
    const state = position({
      variantId: 'ludo',
      at: {
        [pawnId(0, 0)]: 2,
        [pawnId(0, 1)]: 30,
        [pawnId(1, 0)]: avance,
        [pawnId(2, 0)]: debutant,
      },
      dice: 3,
    })
    // Les deux coups mangent : ce n'est donc pas « manger ou non » qui les sépare.
    expect(legalMoves(state).map((m) => m.captures.length)).toEqual([1, 1])
    expect(avance).toBeGreaterThan(debutant)

    // Le niveau normal joue les deux captures à l'identique et départage sur sa
    // propre avance : il renvoie à l'écurie un cheval qui venait d'en sortir.
    expect(chooseMove(state, 'normal')!.captures).toEqual([pawnId(2, 0)])
    // Le redoutable compte ce que la capture fait perdre à l'autre, et non le
    // simple fait de manger : il choisit le cheval qui avait presque fini son tour.
    expect(chooseMove(state, 'redoutable')!.captures).toEqual([pawnId(1, 0)])
  })
})

describe('une table où chaque siège a son niveau', () => {
  it('va au bout, en mélangeant les trois niveaux et les tailles de table', () => {
    // C'est le cas ORDINAIRE d'un salon — un adversaire sérieux, deux qui
    // laissent respirer — et c'est celui qu'aucun test ne jouait : les parties
    // menées jusqu'au bout plus haut donnent le même niveau à tout le monde.
    // Une table de trois, en prime, parce que c'est là que vivent les tours
    // sautés et les sièges absents.
    const mixed = (seat: Seat): BotLevel => BOT_LEVELS[seat % BOT_LEVELS.length]!
    for (const seats of [[0, 1, 2] as Seat[], [0, 1, 2, 3] as Seat[]]) {
      for (const variantId of ['petits-chevaux', 'ludo']) {
        const end = playOut({ variantId, seed: 7, seats, powers: true, levelOf: mixed })
        expect(end.ranking?.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('les bonus de dé', () => {
  it('penche vers les gros chiffres quand seul un 6 fait sortir de l’écurie', () => {
    // L'état de départ : quatre chevaux à l'écurie, trois bonus en réserve, et
    // une variante qui ne libère que sur un 6.
    const state = createGame({
      players: players([0, 1, 2, 3]),
      variant: variantFor('petits-chevaux', false),
      seed: 3,
    })
    expect(state.variant.exitRolls).toEqual([6])
    // Personne ne dépensait ses bonus : chaque siège finissait la partie avec sa
    // réserve intacte, c'est-à-dire avec un pouvoir qui n'existait que sur l'écran.
    expect(botTurn(state, 'redoutable')).toEqual({ type: 'roll', boost: 'high' })
  })

  it('laisse les niveaux tranquille et normal lancer le dé tout sec', () => {
    const state = createGame({
      players: players([0, 1, 2, 3]),
      variant: variantFor('petits-chevaux', false),
      seed: 3,
    })
    // Le bonus fait partie de ce que `redoutable` voit en plus : le donner aux
    // deux autres niveaux effacerait l'écart qu'on vient de mesurer.
    expect(botTurn(state, 'tranquille')).toEqual({ type: 'roll' })
    expect(botTurn(state, 'normal')).toEqual({ type: 'roll' })
  })

  it('ne penche rien quand les faces de sortie tirent des deux côtés', () => {
    const state = createGame({
      players: players([0, 1, 2, 3]),
      variant: variantFor('rapide', false),
      seed: 3,
    })
    expect(state.variant.exitRolls).toEqual([1, 6])
    // Un 1 et un 6 ouvrent l'écurie : pencher d'un côté fermerait l'autre, et le
    // bonus dépensé vaudrait moins que le dé franc.
    expect(botTurn(state, 'redoutable')).toEqual({ type: 'roll' })
  })

  /**
   * Le compte exact : le bonus va du côté que réclame la TROUPE.
   *
   * Un bonus n'incline pas le dé, il en écrase un côté — les trois faces
   * favorisées passent à 26,7 % et les trois autres tombent à 6,7 %. Choisi du
   * mauvais côté, il rend donc le lancer plus mauvais que le dé franc, et il
   * coûte l'un des trois exemplaires de la partie.
   */
  const rolling = (variantId: string, at: Record<string, number>): GameState => {
    const base = createGame({
      players: players([0, 1, 2, 3]),
      variant: variantFor(variantId, false),
      seed: 5,
    })
    return deepFreeze({
      ...base,
      pawns: base.pawns.map((p) => ({ ...p, steps: at[p.id] ?? p.steps })),
      phase: 'rolling',
      dice: null,
    })
  }

  it('demande le côté que réclame le plus de chevaux, et non le plus proche', () => {
    const last = geometryFor(variantById('petits-chevaux')).lastStep
    // Trois chevaux dans l'escalier à qui il faut 1, 5 et 6 : un seul veut un
    // petit chiffre, deux en veulent un grand.
    const state = rolling('petits-chevaux', {
      [pawnId(0, 0)]: last - 1,
      [pawnId(0, 1)]: last - 5,
      [pawnId(0, 2)]: last - 6,
    })
    // Regarder le cheval le PLUS PROCHE de l'arrivée — celui à qui il faut 1 —
    // faisait demander un petit nombre, et tombait les chances de rentrer
    // quelqu'un de 50 % à 40 %. Le dé franc valait mieux que le bonus dépensé.
    expect(botTurn(state, 'redoutable')).toEqual({ type: 'roll', boost: 'high' })
  })

  it('garde son bonus quand les deux côtés se valent', () => {
    const last = geometryFor(variantById('petits-chevaux')).lastStep
    const state = rolling('petits-chevaux', {
      [pawnId(0, 0)]: last - 3,
      [pawnId(0, 1)]: last - 4,
    })
    // Un cheval de chaque côté : ce que l'un gagne, l'autre le perd. Un bonus
    // dépensé pour rien est un bonus perdu — il n'y en a que trois.
    expect(botTurn(state, 'redoutable')).toEqual({ type: 'roll' })
  })

  it('dépense aussi ses bonus là où l’arrivée ne réclame pas le compte exact', () => {
    const last = geometryFor(variantById('rapide')).lastStep
    const state = rolling('rapide', { [pawnId(0, 0)]: last - 5 })
    expect(state.variant.exactFinish).toBe(false)
    // La variante rapide passait à travers les deux règles — sortie sur 1 ou 6,
    // arrivée sans compte exact — et le niveau redoutable n'y dépensait pas un
    // seul bonus de toute la partie, alors que c'est ce qu'il promet. Sans
    // compte exact il suffit d'atteindre : c'est le grand chiffre qui sert.
    expect(botTurn(state, 'redoutable')).toEqual({ type: 'roll', boost: 'high' })
  })

  it('ne dépense rien quand un petit chiffre suffirait déjà', () => {
    const last = geometryFor(variantById('rapide')).lastStep
    const state = rolling('rapide', { [pawnId(0, 0)]: last - 2 })
    // Deux cases de l'arrivée, et pas de compte exact : cinq faces sur six
    // rentrent le cheval. Un bonus n'y ajouterait presque rien.
    expect(botTurn(state, 'redoutable')).toEqual({ type: 'roll' })
  })
})

describe('le sélecteur de niveaux du salon', () => {
  it('reconnaît les trois identifiants et rien d’autre', () => {
    for (const level of BOT_LEVELS) expect(isBotLevel(level)).toBe(true)
    // Le niveau arrive d'un stockage local ou du réseau : ce qu'on ne comprend
    // pas doit retomber sur le défaut, jamais sur un profil introuvable.
    for (const wrong of ['', 'facile', 'Normal', 'REDOUTABLE', null, undefined, 2, {}, ['normal']]) {
      expect(isBotLevel(wrong), JSON.stringify(wrong) ?? 'undefined').toBe(false)
    }
  })

  it('joue en normal par défaut', () => {
    // Un bot qui reprend le siège d'un joueur parti tient des chevaux qui ne
    // sont pas les siens : il joue comme le jeu, pas comme un réglage choisi.
    //
    // Le défaut est le niveau du MILIEU, et c'est ce qui compte : un défaut
    // posé à un bout du sélecteur ferait de la moitié des tables une difficulté
    // que personne n'a demandée.
    expect(DEFAULT_LEVEL).toBe('normal')
    expect(BOT_LEVELS.indexOf(DEFAULT_LEVEL)).toBe(1)
  })

  it('raccourcit le temps de réflexion du plus tranquille au plus redoutable', () => {
    for (let i = 1; i < BOT_LEVELS.length; i++) {
      // L'attente fait partie du personnage : un adversaire redoutable qui
      // traînerait plus qu'un tranquille jouerait le rôle de l'autre.
      expect(BOT_DELAY[BOT_LEVELS[i]!], BOT_LEVELS[i]).toBeLessThan(BOT_DELAY[BOT_LEVELS[i - 1]!])
    }
  })
})

describe('les appels sans niveau', () => {
  it('décident exactement comme le niveau normal, tout au long d’une partie', () => {
    let cartes = 0
    let coups = 0
    const gestes = new Set<string>()
    const watch = (state: GameState): void => {
      // `chooseMove(state)` et `choosePower(state)` sont les deux appels d'avant
      // les niveaux : la session et les tests des autres fichiers les emploient
      // encore, et un défaut qui glisserait vers un autre profil changerait leur
      // jeu sans que personne ne l'ait demandé.
      const move = chooseMove(state)
      expect(JSON.stringify(move)).toBe(JSON.stringify(chooseMove(state, 'normal')))
      if (move) coups++
      const power = choosePower(state)
      expect(JSON.stringify(power)).toBe(JSON.stringify(choosePower(state, 'normal')))
      if (power) cartes++
      const action = botTurn(state)
      expect(action).toEqual(botTurn(state, 'normal'))
      gestes.add(action.type)
    }

    playOut({ variantId: 'petits-chevaux', powers: true, seed: 5, levelOf: () => 'normal', watch })

    /*
     * Ce que ces trois comptes protègent : les deux côtés de chaque comparaison
     * sortent de la même fonction, et deux `null` comparés à deux `null`
     * passeraient tout aussi bien. Un `chooseMove` qui ne rendrait plus jamais
     * de coup, un `choosePower` qui ne verrait plus jamais une carte jouable,
     * un `botTurn` qui répondrait toujours « je passe » — les trois pannes qui
     * figent une table — laisseraient le test vert sans ces trois lignes.
     */
    expect(coups).toBeGreaterThan(0)
    expect(cartes).toBeGreaterThan(0)
    expect(gestes).toContain('roll')
    expect(gestes).toContain('move')
  })
})
