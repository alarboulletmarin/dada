/**
 * Moteur de jeu : `(état, action) → état`.
 *
 * Aucune dépendance au DOM, au réseau ou à l'horloge. Le même code sert au
 * mode « on se passe le téléphone », à l'hôte d'une partie en ligne et aux
 * tests. Toute la logique de règles vit ici et nulle part ailleurs.
 */

import { geometryFor, hasFinished, isOnTrack, trackIndexOf } from './board.ts'
import { freshDeck, HAND_LIMIT, POWERS, type PowerId } from './powers.ts'
import { rollDie, shuffle } from './rng.ts'
import {
  DICE_BOOSTS_PER_GAME,
  STABLE,
  type Action,
  type GameError,
  type GameState,
  type LogEvent,
  type Move,
  type Pawn,
  type Player,
  type Seat,
  type SeatStats,
  type Variant,
} from './types.ts'

const LOG_LIMIT = 60

export const pawnId = (seat: Seat, index: number): string => `p${seat}-${index}`
export const pawnSlot = (id: string): number => Number(id.split('-')[1] ?? 0)

const emptyStats = (): SeatStats => ({
  rolls: 0,
  pips: 0,
  sixes: 0,
  captures: 0,
  losses: 0,
  distance: 0,
  powers: 0,
})

/**
 * Compteurs d'un siège, dans un état qui n'en aurait pas.
 *
 * Le `?? ` n'est pas de la timidité : un pair resté sur une version d'avant les
 * statistiques envoie un état qui n'en porte pas, et la partie doit continuer
 * plutôt que de tomber sur un `undefined`.
 */
export const statsOf = (state: GameState, seat: Seat): SeatStats =>
  state.stats?.[seat] ?? emptyStats()

/** Applique un delta aux compteurs d'un siège. Sans effet de bord. */
function countUp(state: GameState, seat: Seat, delta: Partial<SeatStats>): GameState {
  const stats = [0, 1, 2, 3].map((s) => statsOf(state, s as Seat))
  const current = stats[seat]!
  stats[seat] = { ...current }
  for (const [key, value] of Object.entries(delta) as [keyof SeatStats, number][]) {
    stats[seat]![key] = current[key] + value
  }
  return { ...state, stats }
}

/** Les cartes gardées par un siège. */
export const handOf = (state: GameState, seat: Seat): PowerId[] => state.hands?.[seat] ?? []

function setHand(state: GameState, seat: Seat, cards: PowerId[]): GameState {
  const hands = [0, 1, 2, 3].map((s) => (s === seat ? cards : handOf(state, s as Seat)))
  return { ...state, hands }
}

export function createGame(opts: {
  players: Player[]
  variant: Variant
  seed: number
}): GameState {
  const players = [...opts.players].sort((a, b) => a.seat - b.seat)
  const pawns: Pawn[] = players.flatMap((p) =>
    Array.from({ length: opts.variant.pawnsPerPlayer }, (_, i) => ({
      id: pawnId(p.seat, i),
      owner: p.seat,
      steps: STABLE,
    })),
  )

  // Le paquet de pouvoirs est mélangé une fois, ici, avec la graine de la
  // partie : tous les appareils obtiennent le même — un pouvoir qui divergerait
  // d'un téléphone à l'autre ferait diverger la partie entière.
  const [rng, deck] = opts.variant.powers ? shuffle(opts.seed, freshDeck()) : [opts.seed, undefined]

  return {
    variant: opts.variant,
    players,
    pawns,
    turn: players[0]!.seat,
    dice: null,
    consecutiveSixes: 0,
    voided: false,
    phase: 'rolling',
    ranking: [],
    rng,
    diceBoosts: DICE_BOOSTS_PER_GAME,
    stuck: [0, 0, 0, 0],
    deck,
    skips: [0, 0, 0, 0],
    hands: [[], [], [], []],
    stats: [emptyStats(), emptyStats(), emptyStats(), emptyStats()],
    log: [
      { seq: 0, seat: players[0]!.seat, actor: '', event: { kind: 'start', variant: opts.variant.id } },
    ],
    seq: 0,
  }
}

// ─────────────────────────────── lectures ───────────────────────────────

export const playerAt = (state: GameState, seat: Seat): Player | undefined =>
  state.players.find((p) => p.seat === seat)

export const pawnsOf = (state: GameState, seat: Seat): Pawn[] =>
  state.pawns.filter((p) => p.owner === seat)

export const hasWon = (state: GameState, seat: Seat): boolean => {
  const geometry = geometryFor(state.variant)
  return pawnsOf(state, seat).every((p) => hasFinished(geometry, p.steps))
}

/**
 * Ce joueur est-il bloqué à l'écurie — c'est-à-dire : seule une face de sortie
 * peut lui donner quelque chose à jouer ?
 */
export function isPenned(state: GameState, seat: Seat): boolean {
  const geometry = geometryFor(state.variant)
  const running = pawnsOf(state, seat).filter((p) => !hasFinished(geometry, p.steps))
  return running.length > 0 && running.every((p) => p.steps === STABLE)
}

/**
 * De 0 à 1 : à quel point le dé penche vers la sortie pour ce siège.
 *
 * Zéro tant que le joueur a un cheval dehors, ou si la variante ne connaît pas
 * la pitié. Sinon un cran par tour passé à l'écurie, jusqu'à 1 — la sortie
 * certaine. Le premier essai, lui, se joue toujours au dé franc : la pitié
 * répare une attente, elle ne l'anticipe pas.
 */
export function mercyOf(state: GameState, seat: Seat): number {
  const { mercyExit } = state.variant
  if (mercyExit <= 0 || !isPenned(state, seat)) return 0
  return Math.min(1, (state.stuck?.[seat] ?? 0) / mercyExit)
}

/** Une case du circuit est-elle protégée de la capture ? */
export function isSafeIndex(variant: Variant, index: number): boolean {
  const g = geometryFor(variant)
  if (variant.startSquaresAreSafe && g.startIndexSet.has(index)) return true
  if (variant.starSquaresAreSafe && g.starIndexSet.has(index)) return true
  return false
}

/** Pions présents sur une case absolue du circuit. */
function pawnsOnTrackIndex(state: GameState, index: number, exceptId?: string): Pawn[] {
  const geometry = geometryFor(state.variant)
  return state.pawns.filter(
    (p) =>
      p.id !== exceptId &&
      isOnTrack(geometry, p.steps) &&
      trackIndexOf(geometry, p.owner, p.steps) === index,
  )
}

/**
 * Un barrage adverse (2+ pions d'un même joueur) occupe-t-il cette case ?
 *
 * « Adverse » n'est pas un détail : un barrage est un mur dressé contre les
 * autres, pas une case qu'on se condamne à soi-même. Ses propres pions le
 * franchissent librement — sans quoi poser un barrage reviendrait à s'enfermer
 * derrière, et personne n'en poserait jamais.
 */
function isBlockaded(state: GameState, index: number, mover: Pawn): boolean {
  const perOwner = new Map<Seat, number>()
  for (const p of pawnsOnTrackIndex(state, index, mover.id)) {
    if (p.owner === mover.owner) continue
    perOwner.set(p.owner, (perOwner.get(p.owner) ?? 0) + 1)
  }
  return [...perOwner.values()].some((n) => n >= 2)
}

/** Le trajet `from → to` traverse-t-il un barrage ? La case d'arrivée compte. */
function pathIsBlocked(state: GameState, pawn: Pawn, from: number, to: number): boolean {
  const geometry = geometryFor(state.variant)
  for (let s = from + 1; s <= to; s++) {
    if (!isOnTrack(geometry, s)) continue
    const index = trackIndexOf(geometry, pawn.owner, s)
    if (index !== null && isBlockaded(state, index, pawn)) return true
  }
  return false
}

/**
 * Les chevaux déjà posés sur la case où ce coup mènerait — les siens comme
 * ceux des autres. Le circuit est commun et se compte en cases absolues ;
 * l'escalier est privé, et seuls les chevaux du même siège peuvent s'y trouver.
 */
function occupantsAt(state: GameState, pawn: Pawn, to: number): Pawn[] {
  const geometry = geometryFor(state.variant)
  if (isOnTrack(geometry, to)) {
    return pawnsOnTrackIndex(state, trackIndexOf(geometry, pawn.owner, to)!, pawn.id)
  }
  return state.pawns.filter((p) => p.id !== pawn.id && p.owner === pawn.owner && p.steps === to)
}

/** Tous les coups jouables avec le dé courant. Vide = le joueur doit passer. */
export function legalMoves(state: GameState): Move[] {
  const { dice, variant } = state
  if (dice === null || state.phase !== 'moving' || state.voided) return []

  const geometry = geometryFor(variant)
  const moves: Move[] = []

  for (const pawn of pawnsOf(state, state.turn)) {
    if (hasFinished(geometry, pawn.steps)) continue

    let to: number
    const exits = pawn.steps === STABLE

    if (exits) {
      if (!variant.exitRolls.includes(dice)) continue
      to = 0
    } else {
      to = pawn.steps + dice
      if (to > geometry.lastStep) {
        if (variant.exactFinish) continue
        to = geometry.lastStep
      }
    }

    const from = exits ? STABLE : pawn.steps
    if (variant.blockades && pathIsBlocked(state, pawn, exits ? -1 : from, to)) continue

    // Capture : uniquement sur le circuit, et jamais sur une case protégée.
    // Un cheval au bouclier reste sur la case : le coup est légal, il n'est
    // simplement pas mangé, et son bouclier se brise à l'impact.
    const occupants = occupantsAt(state, pawn, to)
    const captures: string[] = []
    const shielded: string[] = []
    if (isOnTrack(geometry, to) && !isSafeIndex(variant, trackIndexOf(geometry, pawn.owner, to)!)) {
      for (const victim of occupants) {
        if (victim.owner === pawn.owner) continue
        ;(victim.shield ? shielded : captures).push(victim.id)
      }
    }

    // Une case, un cheval (règle française) : si quelque chose reste sur la
    // case d'arrivée après le coup, le coup n'existe pas.
    //
    // Deux exceptions. L'arrivée, évidemment : c'est là que les quatre chevaux
    // se rejoignent. Et le bouclier — un pouvoir, pas un cheval : s'il rendait
    // sa case interdite, il cesserait d'être « une capture encaissée » pour
    // devenir un mur, et un mur que rien ne pourrait plus briser, puisque la
    // charge qui le brise n'aurait jamais lieu. Le cheval protégé encaisse
    // donc le choc et partage sa case le temps d'un tour.
    const survivors = occupants.length - captures.length - shielded.length
    if (variant.onePerSquare && to !== geometry.lastStep && survivors > 0) continue

    moves.push({
      pawnId: pawn.id,
      from,
      to,
      captures,
      shielded,
      finishes: to === geometry.lastStep,
      exits,
    })
  }

  return moves
}

// ─────────────────────────────── écritures ───────────────────────────────

export type ApplyResult = { state: GameState; error?: GameError }

/**
 * Applique une action au nom de `actor`. Le siège est vérifié ici : c'est le
 * seul rempart contre un pair qui jouerait à la place d'un autre.
 */
export function apply(state: GameState, action: Action, actor: Seat): ApplyResult {
  if (state.phase === 'finished') return { state, error: 'finished' }
  if (actor !== state.turn) return { state, error: 'notYourTurn' }

  switch (action.type) {
    case 'roll':
      return applyRoll(state, action.boost)
    case 'move':
      return applyMove(state, action.pawnId)
    case 'pass':
      return applyPass(state)
    case 'power':
      return applyHeldPower(state, action.power, action.pawnId)
  }
}

function applyRoll(state: GameState, boost?: 'low' | 'high'): ApplyResult {
  if (state.phase !== 'rolling') return { state, error: 'alreadyRolled' }

  // Un boost sans bonus restant (UI périmée par la latence réseau) n'est pas
  // une faute du joueur : le lancer se fait simplement sans biais.
  const useBoost = boost !== undefined && state.diceBoosts > 0
  const [rng, dice] = rollDie(state.rng, {
    bias: useBoost ? boost : undefined,
    exitFaces: state.variant.exitRolls,
    exitChance: mercyOf(state, state.turn),
  })
  const consecutiveSixes = dice === 6 ? state.consecutiveSixes + 1 : 0
  const max = state.variant.maxConsecutiveSixes
  const voided = max > 0 && dice === 6 && consecutiveSixes >= max

  let next: GameState = {
    ...state,
    rng,
    dice,
    consecutiveSixes,
    voided,
    phase: 'moving',
    diceBoosts: useBoost ? state.diceBoosts - 1 : state.diceBoosts,
    seq: state.seq + 1,
  }
  next = countUp(next, state.turn, { rolls: 1, pips: dice, sixes: dice === 6 ? 1 : 0 })
  next = addLog(next, state.turn, { kind: 'roll', dice })
  if (voided) next = addLog(next, state.turn, { kind: 'voided', sixes: max })

  return { state: next }
}

function applyMove(state: GameState, id: string): ApplyResult {
  if (state.phase !== 'moving') return { state, error: 'rollFirst' }

  const move = legalMoves(state).find((m) => m.pawnId === id)
  if (!move) return { state, error: 'illegal' }

  const pawns = state.pawns.map((p) => {
    if (p.id === move.pawnId) return { ...p, steps: move.to }
    // Un cheval renvoyé à l'écurie y laisse son bouclier : il ne le rapporte
    // pas au tour suivant comme s'il ne s'était rien passé.
    if (move.captures.includes(p.id)) return { ...p, steps: STABLE, shield: false }
    if (move.shielded.includes(p.id)) return { ...p, shield: false }
    return p
  })

  let next: GameState = { ...state, pawns, seq: state.seq + 1 }

  const pawn = pawnSlot(move.pawnId) + 1
  if (move.exits) next = addLog(next, state.turn, { kind: 'exit', pawn })
  else if (move.finishes) next = addLog(next, state.turn, { kind: 'finish', pawn })
  else next = addLog(next, state.turn, { kind: 'advance', pawn, dice: state.dice ?? 0 })

  for (const captured of move.captures) {
    const owner = state.pawns.find((p) => p.id === captured)!.owner
    next = addLog(next, state.turn, {
      kind: 'capture',
      pawn: pawnSlot(captured) + 1,
      victim: playerAt(state, owner)?.name ?? '',
    })
  }

  for (const saved of move.shielded) {
    const owner = state.pawns.find((p) => p.id === saved)!.owner
    next = addLog(next, state.turn, {
      kind: 'shielded',
      pawn: pawnSlot(saved) + 1,
      owner: playerAt(state, owner)?.name ?? '',
    })
  }

  // Le déplacement compte pour la distance parcourue ; la sortie d'écurie ne
  // vaut aucune case (on passe de « nulle part » à la case de départ).
  next = countUp(next, state.turn, {
    distance: move.exits ? 0 : Math.max(0, move.to - move.from),
    captures: move.captures.length,
  })
  for (const captured of move.captures) {
    next = countUp(next, state.pawns.find((p) => p.id === captured)!.owner, { losses: 1 })
  }

  const power = resolvePower(next, move.pawnId)
  next = power.state

  // Le pouvoir a pu déplacer le cheval après coup : c'est sa position finale,
  // et non celle du coup joué, qui dit s'il vient de rentrer.
  const geometry = geometryFor(next.variant)
  const landed = next.pawns.find((p) => p.id === move.pawnId)!
  const settled: Move = { ...move, to: landed.steps, finishes: hasFinished(geometry, landed.steps) }

  return { state: endTurn(next, settled, power.replay) }
}

// ─────────────────────────────── pouvoirs ───────────────────────────────

/**
 * Le cheval vient-il de s'arrêter sur une case pouvoir ? Alors il pioche.
 *
 * Un pouvoir qui déplace ne redéclenche pas la case d'arrivée : sans cette
 * règle, deux cases voisines pourraient se renvoyer la balle sans fin, et le
 * journal deviendrait illisible.
 */
function resolvePower(state: GameState, pawnId: string): { state: GameState; replay: boolean } {
  if (!state.variant.powers) return { state, replay: false }

  const geometry = geometryFor(state.variant)
  const pawn = state.pawns.find((p) => p.id === pawnId)!
  if (!isOnTrack(geometry, pawn.steps)) return { state, replay: false }
  const index = trackIndexOf(geometry, pawn.owner, pawn.steps)
  if (index === null || !geometry.powerIndexSet.has(index)) return { state, replay: false }

  const drawn = draw(state)
  let next = countUp(drawn.state, state.turn, { powers: 1 })
  next = addLog(next, state.turn, {
    kind: 'power',
    power: drawn.power,
    pawn: pawnSlot(pawnId) + 1,
  })

  // Les bonus se gardent, les malus se subissent. Une main pleine refuse la
  // carte plutôt que d'en pousser une dehors : perdre une carte qu'on avait
  // choisi de garder serait la pire des surprises.
  if (POWERS[drawn.power].held) {
    const hand = handOf(next, next.turn)
    if (hand.length >= HAND_LIMIT) {
      return { state: addLog(next, next.turn, { kind: 'handFull', power: drawn.power }), replay: false }
    }
    return { state: setHand(next, next.turn, [...hand, drawn.power]), replay: false }
  }

  return { state: applyPower(next, pawnId, drawn.power), replay: false }
}

/**
 * Joue une carte gardée en main.
 *
 * Jouer une carte ne consomme pas le tour : on peut poser un bouclier *puis*
 * lancer le dé, ou relancer un dé décevant *puis* jouer son coup. C'est tout
 * l'intérêt d'une carte qu'on garde — elle sert à choisir l'instant, pas à
 * remplacer un tour.
 */
function applyHeldPower(state: GameState, power: PowerId, target?: string): ApplyResult {
  const hand = handOf(state, state.turn)
  if (!hand.includes(power)) return { state, error: 'noSuchPower' }
  if (!canPlayPower(state, power, target)) return { state, error: 'powerNotNow' }

  // Un seul exemplaire retiré, et non tous ceux du même nom.
  const at = hand.indexOf(power)
  let next = setHand(state, state.turn, [...hand.slice(0, at), ...hand.slice(at + 1)])
  next = { ...next, seq: next.seq + 1 }
  next = addLog(next, next.turn, {
    kind: 'played',
    power,
    pawn: target ? pawnSlot(target) + 1 : 0,
  })

  if (power === 'rejeu') return { state: rerollFor(next) }
  return { state: applyPower(next, target!, power) }
}

/**
 * La carte peut-elle être jouée dans l'état où l'on est ?
 *
 * Exportée : l'écran des cartes en main s'en sert pour griser celles qui ne
 * mènent à rien, plutôt que de laisser le joueur les taper pour rien.
 */
export function canPlayPower(state: GameState, power: PowerId, target?: string): boolean {
  if (state.phase === 'finished') return false
  const spec = POWERS[power]
  if (!spec.held) return false

  // Relancer suppose un dé sur la table, et un tour qui n'est pas déjà perdu.
  if (power === 'rejeu') return state.phase === 'moving' && !state.voided

  if (spec.target === 'cheval') {
    const geometry = geometryFor(state.variant)
    const pawn = state.pawns.find((p) => p.id === target && p.owner === state.turn)
    if (!pawn) return false
    if (hasFinished(geometry, pawn.steps)) return false
    // Un bouclier se pose sur un cheval en piste, pas sur un cheval à l'écurie :
    // à l'écurie, rien ne peut le manger.
    if (power === 'bouclier') return pawn.steps >= 0 && !pawn.shield
    // Un galop pousse un cheval déjà sorti, et jamais au-delà de l'arrivée.
    if (power === 'galop') return pawn.steps >= 0 && pawn.steps + spec.steps <= geometry.lastStep
  }
  return true
}

/** Les cartes de la main jouables tout de suite, cheval visé compris. */
export function playablePowers(state: GameState): PowerId[] {
  return [...new Set(handOf(state, state.turn))].filter((power) => {
    const spec = POWERS[power]
    if (spec.target === 'aucune') return canPlayPower(state, power)
    return pawnsOf(state, state.turn).some((p) => canPlayPower(state, power, p.id))
  })
}

/** Les chevaux sur lesquels cette carte peut se poser. */
export function powerTargets(state: GameState, power: PowerId): string[] {
  if (POWERS[power].target !== 'cheval') return []
  return pawnsOf(state, state.turn)
    .filter((p) => canPlayPower(state, power, p.id))
    .map((p) => p.id)
}

/**
 * Relance le dé sans changer de main.
 *
 * La chaîne de 6 ne repart pas de zéro : sans cela, relancer serait aussi le
 * moyen d'effacer deux 6 déjà posés et d'échapper à la règle des trois.
 */
function rerollFor(state: GameState): GameState {
  const [rng, dice] = rollDie(state.rng, {
    exitFaces: state.variant.exitRolls,
    exitChance: mercyOf(state, state.turn),
  })
  const consecutiveSixes = dice === 6 ? state.consecutiveSixes + 1 : 0
  const max = state.variant.maxConsecutiveSixes
  const voided = max > 0 && dice === 6 && consecutiveSixes >= max

  let next: GameState = { ...state, rng, dice, consecutiveSixes, voided, phase: 'moving' }
  next = countUp(next, state.turn, { rolls: 1, pips: dice, sixes: dice === 6 ? 1 : 0 })
  next = addLog(next, state.turn, { kind: 'roll', dice })
  if (voided) next = addLog(next, state.turn, { kind: 'voided', sixes: max })
  return next
}

/** Retire la carte du dessus, en remélangeant un paquet neuf s'il est vide. */
function draw(state: GameState): { state: GameState; power: PowerId } {
  let rng = state.rng
  let deck = state.deck ?? []
  if (deck.length === 0) {
    const [seeded, fresh] = shuffle(rng, freshDeck())
    rng = seeded
    deck = fresh
  }
  const [power, ...rest] = deck as [PowerId, ...PowerId[]]
  return { state: { ...state, rng, deck: rest }, power }
}

function applyPower(state: GameState, pawnId: string, power: PowerId): GameState {
  const geometry = geometryFor(state.variant)
  const pawn = state.pawns.find((p) => p.id === pawnId)!
  const setPawn = (patch: Partial<Pawn>): GameState => ({
    ...state,
    pawns: state.pawns.map((p) => (p.id === pawnId ? { ...p, ...patch } : p)),
  })

  switch (power) {
    case 'bouclier':
      return setPawn({ shield: true })

    case 'des':
      return { ...state, diceBoosts: state.diceBoosts + 1 }

    case 'rejeu':
      // Le rejeu se joue dans `endTurn` : il n'y a rien à changer dans l'état.
      return state

    case 'saute': {
      const skips = [...(state.skips ?? [0, 0, 0, 0])]
      skips[state.turn] = (skips[state.turn] ?? 0) + 1
      return { ...state, skips }
    }

    case 'ecurie':
      return setPawn({ steps: STABLE, shield: false })

    case 'galop': {
      // Le galop ne force jamais l'arrivée : sur une variante au compte exact,
      // un cheval qui dépasserait reste où il est. Gagner par accident serait
      // plus frustrant qu'un pouvoir perdu.
      const target = pawn.steps + POWERS.galop.steps
      if (target > geometry.lastStep) return state
      return setPawn({ steps: target })
    }

    case 'fauxpas': {
      // Le recul s'arrête à la case de départ : un cheval ne retourne pas à
      // l'écurie par un faux pas, c'est le rôle du malus qui porte ce nom.
      const target = Math.max(0, pawn.steps - POWERS.fauxpas.steps)
      return setPawn({ steps: target })
    }
  }
}

function applyPass(state: GameState): ApplyResult {
  if (state.phase !== 'moving') return { state, error: 'nothingToPass' }
  if (legalMoves(state).length > 0) return { state, error: 'moveExists' }

  const next = addLog({ ...state, seq: state.seq + 1 }, state.turn, { kind: 'pass' })
  return { state: endTurn(next, null) }
}

/**
 * Force la fin du tour d'un siège sans exiger l'absence de coup légal —
 * réservé à l'hôte pour l'abandon de tour d'un pair déconnecté. Un joueur ne
 * peut jamais déclencher ceci via `apply()`/`dispatch()` : ce n'est pas une
 * action du protocole réseau, seulement un utilitaire appelé côté hôte.
 */
export function forceSkipTurn(state: GameState, seat: Seat): GameState {
  if (state.phase === 'finished' || state.turn !== seat) return state
  // Le dé est effacé AVANT de clore le tour : un 6 resté sur la table vaut
  // rejeu (voir `endTurn`), et le tour qu'on voulait sauter reviendrait au même
  // joueur — indéfiniment, s'il est parti.
  const cleared = { ...state, seq: state.seq + 1, dice: null, consecutiveSixes: 0, voided: false }
  return endTurn(addLog(cleared, seat, { kind: 'timeout' }), null)
}

/**
 * Tours passés à l'écurie sans en sortir. C'est ici que le compteur se tient à
 * jour, à la fin de chaque tour : il monte tant que le joueur reste enfermé,
 * et retombe à zéro à la seconde où un cheval est dehors.
 */
function countPenned(state: GameState, seat: Seat): GameState {
  // `?? []` : un état reçu d'un pair resté sur une version d'avant le compteur
  // n'en a pas. Il repart de zéro plutôt que de faire tomber la partie.
  const stuck = [...(state.stuck ?? [])]
  stuck[seat] = isPenned(state, seat) ? (stuck[seat] ?? 0) + 1 : 0
  return { ...state, stuck }
}

/** Décide qui joue ensuite, en tenant compte des primes de rejeu. */
function endTurn(state: GameState, move: Move | null, powerReplay = false): GameState {
  let next = countPenned(state, state.turn)

  // Un joueur qui vient de rentrer son dernier cheval prend place au classement.
  if (move?.finishes && hasWon(next, next.turn) && !next.ranking.includes(next.turn)) {
    next = { ...next, ranking: [...next.ranking, next.turn] }
    // Le nom du joueur est déjà porté par `actor` : l'événement ne le répète pas.
    const place = next.ranking.length
    next = addLog(next, next.turn, place === 1 ? { kind: 'win' } : { kind: 'rank', place })
  }

  const stillPlaying = next.players.filter((p) => !next.ranking.includes(p.seat))
  if (stillPlaying.length <= 1) {
    const last = stillPlaying[0]
    const ranking = last ? [...next.ranking, last.seat] : next.ranking
    return { ...next, ranking, phase: 'finished', dice: null, voided: false }
  }

  const v = next.variant
  const replays =
    !next.voided &&
    move !== null &&
    ((next.dice === 6 && v.extraTurnOnSix) ||
      (move.captures.length > 0 && v.extraTurnOnCapture) ||
      (move.finishes && v.extraTurnOnFinish))

  // Rejouer sur un 6 sans avoir bougé (aucun coup possible) reste un rejeu.
  const replaysOnBlockedSix = !next.voided && move === null && next.dice === 6 && v.extraTurnOnSix

  if ((replays || replaysOnBlockedSix || powerReplay) && !hasWon(next, next.turn)) {
    return {
      ...next,
      phase: 'rolling',
      dice: null,
      voided: false,
      // Seule une chaîne de 6 doit continuer à s'accumuler.
      consecutiveSixes: next.dice === 6 ? next.consecutiveSixes : 0,
    }
  }

  return passTurn({
    ...next,
    phase: 'rolling',
    dice: null,
    consecutiveSixes: 0,
    voided: false,
  })
}

/**
 * Passe la main au siège suivant, en brûlant les tours dus au malus « tour
 * sauté ».
 *
 * Un tour sauté compte comme un tour passé à l'écurie : sans cela, un joueur
 * enfermé que le malus retarde verrait sa pitié de sortie gelée, et paierait le
 * malus deux fois.
 */
function passTurn(state: GameState): GameState {
  let next = state
  // Borne de sécurité : quatre sièges, et chacun ne peut cumuler qu'un nombre
  // fini de tours sautés. La boucle sort d'elle-même, la borne est un filet.
  for (let guard = 0; guard < 32; guard++) {
    const seat = nextActiveSeat(next, next.turn)
    next = { ...next, turn: seat }
    const owed = next.skips?.[seat] ?? 0
    if (owed <= 0) return next
    const skips = [...(next.skips ?? [0, 0, 0, 0])]
    skips[seat] = owed - 1
    next = countPenned(addLog({ ...next, skips }, seat, { kind: 'skipped' }), seat)
  }
  return next
}

function nextActiveSeat(state: GameState, from: Seat): Seat {
  const order = state.players.map((p) => p.seat)
  const start = order.indexOf(from)
  for (let i = 1; i <= order.length; i++) {
    const seat = order[(start + i) % order.length]!
    if (!state.ranking.includes(seat)) return seat
  }
  return from
}

function addLog(state: GameState, seat: Seat, event: LogEvent): GameState {
  const actor = playerAt(state, seat)?.name ?? ''
  const entry = { seq: state.log.length, seat, actor, event }
  return { ...state, log: [...state.log, entry].slice(-LOG_LIMIT) }
}

// ─────────────────────────────── divers ───────────────────────────────

/** Progression 0..1 d'un pion, pour la barre de chaque joueur. */
export const progressOf = (state: GameState, seat: Seat): number => {
  const geometry = geometryFor(state.variant)
  return (
    pawnsOf(state, seat).reduce((sum, p) => sum + Math.max(0, p.steps + 1), 0) /
    (state.variant.pawnsPerPlayer * (geometry.lastStep + 1))
  )
}
