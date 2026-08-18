/**
 * Moteur de jeu : `(état, action) → état`.
 *
 * Aucune dépendance au DOM, au réseau ou à l'horloge. Le même code sert au
 * mode « on se passe le téléphone », à l'hôte d'une partie en ligne et aux
 * tests. Toute la logique de règles vit ici et nulle part ailleurs.
 */

import { geometryFor, hasFinished, isOnTrack, trackIndexOf } from './board.ts'
import { rollDie } from './rng.ts'
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
  type Variant,
} from './types.ts'

const LOG_LIMIT = 60

export const pawnId = (seat: Seat, index: number): string => `p${seat}-${index}`
export const pawnSlot = (id: string): number => Number(id.split('-')[1] ?? 0)

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
    rng: opts.seed,
    diceBoosts: DICE_BOOSTS_PER_GAME,
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

/** Un barrage (2+ pions d'un même joueur) occupe-t-il cette case ? */
function isBlockaded(state: GameState, index: number, exceptId: string): boolean {
  const occupants = pawnsOnTrackIndex(state, index, exceptId)
  const perOwner = new Map<Seat, number>()
  for (const p of occupants) perOwner.set(p.owner, (perOwner.get(p.owner) ?? 0) + 1)
  return [...perOwner.values()].some((n) => n >= 2)
}

/** Le trajet `from → to` traverse-t-il un barrage ? La case d'arrivée compte. */
function pathIsBlocked(state: GameState, pawn: Pawn, from: number, to: number): boolean {
  const geometry = geometryFor(state.variant)
  for (let s = from + 1; s <= to; s++) {
    if (!isOnTrack(geometry, s)) continue
    const index = trackIndexOf(geometry, pawn.owner, s)
    if (index !== null && isBlockaded(state, index, pawn.id)) return true
  }
  return false
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
    let captures: string[] = []
    if (isOnTrack(geometry, to)) {
      const index = trackIndexOf(geometry, pawn.owner, to)!
      if (!isSafeIndex(variant, index)) {
        captures = pawnsOnTrackIndex(state, index, pawn.id)
          .filter((p) => p.owner !== pawn.owner)
          .map((p) => p.id)
      }
    }

    moves.push({ pawnId: pawn.id, from, to, captures, finishes: to === geometry.lastStep, exits })
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
  }
}

function applyRoll(state: GameState, boost?: 'low' | 'high'): ApplyResult {
  if (state.phase !== 'rolling') return { state, error: 'alreadyRolled' }

  // Un boost sans bonus restant (UI périmée par la latence réseau) n'est pas
  // une faute du joueur : le lancer se fait simplement sans biais.
  const useBoost = boost !== undefined && state.diceBoosts > 0
  const [rng, dice] = rollDie(state.rng, useBoost ? boost : undefined)
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
    if (move.captures.includes(p.id)) return { ...p, steps: STABLE }
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

  return { state: endTurn(next, move) }
}

function applyPass(state: GameState): ApplyResult {
  if (state.phase !== 'moving') return { state, error: 'nothingToPass' }
  if (legalMoves(state).length > 0) return { state, error: 'moveExists' }

  const next = addLog({ ...state, seq: state.seq + 1 }, state.turn, { kind: 'pass' })
  return { state: endTurn(next, null) }
}

/** Décide qui joue ensuite, en tenant compte des primes de rejeu. */
function endTurn(state: GameState, move: Move | null): GameState {
  let next = state

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

  if ((replays || replaysOnBlockedSix) && !hasWon(next, next.turn)) {
    return {
      ...next,
      phase: 'rolling',
      dice: null,
      voided: false,
      // Seule une chaîne de 6 doit continuer à s'accumuler.
      consecutiveSixes: next.dice === 6 ? next.consecutiveSixes : 0,
    }
  }

  return {
    ...next,
    turn: nextActiveSeat(next, next.turn),
    phase: 'rolling',
    dice: null,
    consecutiveSixes: 0,
    voided: false,
  }
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
