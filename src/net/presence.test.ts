import { describe, expect, it } from 'vitest'
import {
  AWAY_TO_BOT_MS,
  isBotSeat,
  MISSED_TURNS_TO_BOT,
  shouldHandToBot,
  turnLeft,
  TURN_MS,
  type SeatPresence,
} from './presence.ts'

const human = (over: Partial<SeatPresence> = {}): SeatPresence => ({
  kind: 'human',
  connected: true,
  botFill: false,
  ...over,
})

describe('qui tient le siège', () => {
  it('un siège humain présent est joué par son joueur', () => {
    expect(isBotSeat(human())).toBe(false)
  })

  it('un bot à demeure et un bot de remplacement sont tous deux des bots', () => {
    expect(isBotSeat(human({ kind: 'bot' }))).toBe(true)
    expect(isBotSeat(human({ botFill: true, connected: false }))).toBe(true)
  })
})

describe('relève par un bot', () => {
  const present = { missed: 0, awayFor: null }

  it('laisse tranquille un joueur qui joue', () => {
    expect(shouldHandToBot(human(), present)).toBe(false)
  })

  it('laisse tranquille un joueur qui vient de partir', () => {
    expect(shouldHandToBot(human({ connected: false }), { missed: 0, awayFor: 5000 })).toBe(false)
  })

  it('remplace le joueur parti depuis assez longtemps', () => {
    expect(shouldHandToBot(human({ connected: false }), { missed: 0, awayFor: AWAY_TO_BOT_MS })).toBe(true)
  })

  it('ne remplace pas un joueur revenu entre-temps', () => {
    expect(shouldHandToBot(human(), { missed: 0, awayFor: AWAY_TO_BOT_MS * 10 })).toBe(false)
  })

  it('remplace après trois tours sautés d’affilée, pas avant', () => {
    const seat = human()
    expect(shouldHandToBot(seat, { missed: MISSED_TURNS_TO_BOT - 1, awayFor: null })).toBe(false)
    expect(shouldHandToBot(seat, { missed: MISSED_TURNS_TO_BOT, awayFor: null })).toBe(true)
  })

  it('ne relève pas un siège déjà tenu par un bot', () => {
    expect(shouldHandToBot(human({ kind: 'bot' }), { missed: 9, awayFor: 9e5 })).toBe(false)
    expect(shouldHandToBot(human({ botFill: true }), { missed: 9, awayFor: 9e5 })).toBe(false)
  })
})

describe('temps de réflexion', () => {
  it('ne décompte rien quand aucune minuterie ne court', () => {
    expect(turnLeft(null, 1000)).toBeNull()
  })

  it('va de 1 à 0 sur la durée du tour', () => {
    const end = 10_000 + TURN_MS
    expect(turnLeft(end, 10_000)).toBe(1)
    expect(turnLeft(end, 10_000 + TURN_MS / 2)).toBeCloseTo(0.5)
    expect(turnLeft(end, end)).toBe(0)
  })

  it('reste dans ses bornes malgré une horloge qui a sauté', () => {
    expect(turnLeft(0, 10_000)).toBe(0)
    expect(turnLeft(10_000 + 3 * TURN_MS, 10_000)).toBe(1)
  })
})
