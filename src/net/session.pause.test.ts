/**
 * La pause : tout s'arrête, ou rien ne s'arrête.
 *
 * Une pause qui laisserait le bot jouer, ou la pendule tourner, serait pire que
 * pas de pause du tout : on repose son téléphone en croyant la partie figée, et
 * on la retrouve trois tours plus loin, avec un tour sauté au passage. Ce
 * fichier vérifie donc les trois choses qui doivent s'arrêter — le bot, la
 * pendule, les coups — et le fait qu'elles repartent toutes à la reprise.
 *
 * Elle n'existe que sur un seul téléphone : voir `canPause`. En ligne, figer
 * les bots et la pendule chez soi ne figerait rien chez les autres.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { Session, type RoomFactory, type SessionListeners } from './session.ts'
import type { Room } from './room.ts'
import type { Seat } from '../game/types.ts'
import { TURN_GRACE_MS, TURN_MS } from './presence.ts'

const memoryStorage = () => {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}
globalThis.localStorage ??= memoryStorage() as Storage

const listeners = (): SessionListeners => ({ onChange: vi.fn(), onError: vi.fn(), onChat: vi.fn() })

function fakeRoom() {
  const handlers = new Map<string, (data: never, peer: string) => void>()
  const room: Room = {
    selfId: 'moi-le-pair',
    relaysUp: () => 3,
    peers: () => [],
    send: () => {},
    on: (kind, cb) => handlers.set(kind, cb as (data: never, peer: string) => void),
    onPeerJoin: () => {},
    onPeerLeave: () => {},
    leave: () => {},
  }
  return {
    factory: (() => room) as RoomFactory,
    receive: (kind: string, data: unknown, peer: string) => handlers.get(kind)?.(data as never, peer),
  }
}

/** Une partie locale, un humain et un bot, lancée. */
const started = (): Session => {
  const session = Session.local('Alan', listeners())
  session.addSeat('bot')
  session.start()
  return session
}

describe('la pause fige la partie', () => {
  let session: Session

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    session = started()
  })

  afterEach(() => {
    session.destroy(true)
    vi.useRealTimers()
  })

  it('ne se propose qu’une fois la partie lancée', () => {
    const salon = Session.local('Alan', listeners())
    salon.addSeat('bot')
    expect(salon.canPause).toBe(false)
    expect(session.canPause).toBe(true)
  })

  it('le bot ne joue pas pendant la pause, et joue dès la reprise', () => {
    // Le tour passe au bot sans jouer de vrai coup : ce qu'on vérifie ici est
    // la minuterie du bot, pas la partie.
    session.game = { ...session.game!, turn: 1 as Seat }
    const seq = session.game.seq

    session.setPaused(true)
    vi.advanceTimersByTime(5_000)
    expect(session.game!.seq).toBe(seq)

    session.setPaused(false)
    vi.advanceTimersByTime(5_000)
    expect(session.game!.seq).toBeGreaterThan(seq)
  })

  it('la pendule du tour s’arrête, et repart entière', () => {
    expect(session.turnLeft()).toBeCloseTo(1, 1)

    vi.advanceTimersByTime(TURN_MS / 2)
    expect(session.turnLeft()).toBeCloseTo(0.5, 1)

    // Rien à décompter : le contour disparaît de la carte du joueur.
    session.setPaused(true)
    expect(session.turnLeft()).toBe(null)
    vi.advanceTimersByTime(TURN_MS * 3)
    expect(session.turnLeft()).toBe(null)

    // Reprendre avec trois secondes au compteur ferait de la pause une
    // punition : le tour repart entier.
    session.setPaused(false)
    expect(session.turnLeft()).toBeCloseTo(1, 1)
  })

  it('le tour ne saute pas pendant la pause', () => {
    const turn = session.game!.turn
    session.setPaused(true)
    vi.advanceTimersByTime((TURN_MS + TURN_GRACE_MS) * 2)
    expect(session.game!.turn).toBe(turn)
  })

  it('aucun coup ne part tant que c’est en pause', () => {
    const seq = session.game!.seq
    session.setPaused(true)
    session.dispatch({ type: 'roll' })
    expect(session.game!.seq).toBe(seq)

    session.setPaused(false)
    session.dispatch({ type: 'roll' })
    expect(session.game!.seq).toBeGreaterThan(seq)
  })

  it('une nouvelle manche repart sans la pause de la précédente', () => {
    session.setPaused(true)
    session.restart()
    expect(session.paused).toBe(false)
  })
})

describe('en ligne, la pause n’existe pas', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('la table n’appartient pas à un seul téléphone', () => {
    const channel = fakeRoom()
    const host = Session.online('ABCDEFGH', 'Alan', true, listeners(), channel.factory)
    channel.receive('hello', { clientId: 'ami', name: 'Camille' }, 'peer-1')
    host.admit('ami')
    host.start()

    expect(host.canPause).toBe(false)
    host.setPaused(true)
    expect(host.paused).toBe(false)
    host.destroy(true)
  })
})
