/**
 * La main est privée.
 *
 * L'état de la partie circule d'un téléphone à l'autre, cartes comprises : un
 * jeu pair-à-pair sans serveur n'a pas d'endroit où les cacher. Mais l'écran ne
 * doit montrer que la sienne — la barre affichait celle du joueur dont c'était
 * le tour, si bien qu'on lisait le jeu de l'adversaire au moment précis où il
 * s'en servait. Un bouclier qu'on sait posé n'en est plus un.
 *
 * Le mode « on se passe le téléphone » est l'exception qui confirme la règle :
 * les quatre sièges sont tenus par le même appareil, et la main montrée est
 * celle du joueur assis devant l'écran.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Session, type RoomFactory, type SessionListeners } from './session.ts'
import type { Room } from './room.ts'
import type { Seat } from '../game/types.ts'

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
    leave: async () => {},
  }
  return {
    factory: (() => room) as RoomFactory,
    receive: (kind: string, data: unknown, peer: string) => handlers.get(kind)?.(data as never, peer),
  }
}

const listeners = (): SessionListeners => ({ onChange: vi.fn(), onError: vi.fn(), onChat: vi.fn() })

/**
 * Pose une main connue sur chaque siège, sans passer par le hasard du paquet, et
 * sort un cheval par camp : un bouclier ne se pose pas sur un cheval à l'écurie,
 * et une carte injouable ne dirait rien de ce qu'on veut vérifier ici.
 */
const deal = (session: Session): void => {
  session.game = {
    ...session.game!,
    pawns: session.game!.pawns.map((p) => (p.id.endsWith('-0') ? { ...p, steps: 4 } : p)),
    hands: [['bouclier'], ['galop', 'galop'], [], []],
    skips: [0, 2, 0, 0],
  }
}

describe('la main ne se montre qu’à son propriétaire', () => {
  let channel: ReturnType<typeof fakeRoom>
  let host: Session

  beforeEach(() => {
    localStorage.clear()
    channel = fakeRoom()
    host = Session.online('ABCDEFGH', 'Alan', true, listeners(), channel.factory)
    channel.receive('hello', { clientId: 'ami', name: 'Camille' }, 'peer-1')
    host.admit('ami')
    host.setPowers(true)
    host.setVariant('petits-chevaux')
    host.start()
    deal(host)
  })

  it('montre les siennes pendant son propre tour', () => {
    expect(host.game!.turn).toBe(0)
    expect(host.hand()).toEqual({ seat: 0, cards: ['bouclier'], playable: ['bouclier'] })
  })

  it('montre encore les siennes pendant le tour de l’autre — jamais les siennes à lui', () => {
    host.game = { ...host.game!, turn: 1 as Seat }
    const shown = host.hand()
    expect(shown.seat).toBe(0)
    expect(shown.cards).toEqual(['bouclier'])
    // Rien de jouable : ce n'est pas notre tour, la barre est en lecture seule.
    expect(shown.playable).toEqual([])
    expect(shown.cards).not.toContain('galop')
  })

  it('du jeu des autres, ne dit que le nombre', () => {
    expect(host.handSize(0)).toBe(1)
    expect(host.handSize(1)).toBe(2)
    expect(host.handSize(2)).toBe(0)
  })

  it('dit les tours qu’un siège doit encore sauter — un malus qui dure', () => {
    expect(host.skipsOwed(0)).toBe(0)
    expect(host.skipsOwed(1)).toBe(2)
  })
})

describe('un seul téléphone : la main suit celui qui joue', () => {
  let session: Session

  beforeEach(() => {
    localStorage.clear()
    session = Session.local('Alan', listeners())
    session.addSeat('human')
    session.setPowers(true)
    session.setVariant('petits-chevaux')
    session.start()
    deal(session)
  })

  it('tous les sièges sont à cet appareil, la main est celle du tour', () => {
    expect(session.mySeats).toEqual([0, 1])
    expect(session.hand().cards).toEqual(['bouclier'])

    session.game = { ...session.game!, turn: 1 as Seat }
    expect(session.hand()).toMatchObject({ seat: 1, cards: ['galop', 'galop'] })
  })
})
