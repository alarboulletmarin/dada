/**
 * Le palmarès qui circule.
 *
 * Le registre des parties vit sur chaque appareil (voir `ledger.ts`) ; ce
 * fichier vérifie les trois gestes qui le font converger sans arbitre :
 *
 *   1. Une partie terminée entre au registre **chez chacun**, qu'il ait tenu la
 *      couronne ou non — sans quoi un palmarès dépendrait de qui a créé le
 *      salon ce soir-là.
 *   2. Le registre entier est offert à qui s'assoit, une fois, et à personne
 *      d'autre : le code de partie amène jusqu'à la porte, il ne l'ouvre pas.
 *   3. Ce qui arrive d'un voisin se réunit au sien, sans doublon.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Session, type RoomFactory, type SessionListeners } from './session.ts'
import { addMatches, clearLedger, matchIdOf, readLedger, type Match } from './ledger.ts'
import type { Lobby, LobbyPlayer, Room } from './room.ts'
import type { GameState, SeatStats } from '../game/types.ts'

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

type Sent = { kind: string; data: unknown; to?: string }

function fakeRoom() {
  const sent: Sent[] = []
  const handlers = new Map<string, (data: never, peer: string) => void>()
  let onJoin: ((peer: string) => void) | null = null
  let onLeave: ((peer: string) => void) | null = null
  let peers: string[] = []

  const room: Room = {
    selfId: 'moi-le-pair',
    relaysUp: () => 3,
    peers: () => peers,
    send: (kind, data, to) => void sent.push({ kind, data, to }),
    on: (kind, cb) => void handlers.set(kind, cb as (data: never, peer: string) => void),
    onPeerJoin: (cb) => {
      onJoin = cb
    },
    onPeerLeave: (cb) => {
      onLeave = cb
    },
    leave: async () => {
      peers = []
    },
  }

  return {
    room,
    factory: (() => room) as RoomFactory,
    receive: (kind: string, data: unknown, peer: string) => handlers.get(kind)?.(data as never, peer),
    join: (peer: string) => {
      peers = [...peers, peer]
      onJoin?.(peer)
    },
    part: (peer: string) => {
      peers = peers.filter((p) => p !== peer)
      onLeave?.(peer)
    },
    of: (kind: string) => sent.filter((m) => m.kind === kind),
  }
}

const listeners = (): SessionListeners => ({ onChange: vi.fn(), onError: vi.fn(), onChat: vi.fn() })

const stats = (): SeatStats => ({
  rolls: 12,
  pips: 40,
  sixes: 2,
  captures: 1,
  losses: 0,
  distance: 120,
  powers: 0,
})

const seat = (n: number, name: string, clientId: string, peerId: string | null): LobbyPlayer => ({
  seat: n as LobbyPlayer['seat'],
  name,
  clientId,
  peerId,
  kind: 'human',
  connected: true,
  botFill: false,
})

/** L'état d'une partie qui vient de s'achever, tel qu'il arrive de l'arbitre. */
const finishedGame = (rng = 4242): GameState =>
  ({
    variant: { id: 'petits-chevaux', pawnsPerPlayer: 4 },
    players: [
      { seat: 0, name: 'Alan', kind: 'remote', peerId: 'hote', connected: true },
      { seat: 1, name: 'Camille', kind: 'local', peerId: null, connected: true },
    ],
    pawns: [],
    turn: 0,
    dice: null,
    consecutiveSixes: 0,
    voided: false,
    phase: 'finished',
    ranking: [1, 0],
    rng,
    diceBoosts: [3, 3, 3, 3],
    stuck: [0, 0, 0, 0],
    stats: [stats(), stats()],
    log: [],
    seq: 12,
  }) as unknown as GameState

const someMatch = (id: string, at = 1000): Match => ({
  id,
  at,
  variantId: 'petits-chevaux',
  teams: false,
  players: [{ seat: 0, name: 'Léa', place: 1, bot: false, won: true, stats: stats() }],
})

describe('la partie terminée entre au registre', () => {
  let channel: ReturnType<typeof fakeRoom>
  let guest: Session

  /** Un invité assis, l'arbitre en face, la partie lancée. */
  const seated = (): Lobby => ({
    code: 'ABCDEFGH',
    hostClientId: 'alan',
    epoch: 0,
    round: 3,
    variantId: 'petits-chevaux',
    players: [seat(0, 'Alan', 'alan', 'hote'), seat(1, 'Camille', guest.self, 'moi-le-pair')],
    started: true,
  })

  beforeEach(() => {
    localStorage.clear()
    clearLedger()
    channel = fakeRoom()
    guest = Session.online('ABCDEFGH', 'Camille', false, listeners(), channel.factory)
    channel.join('hote')
    channel.receive('lobby', seated(), 'hote')
  })

  /**
   * Le cœur de l'affaire : l'invité n'arbitre rien, ne calcule rien, et compte
   * pourtant sa soirée. Un palmarès qui n'existerait que chez l'hôte
   * disparaîtrait le soir où quelqu'un d'autre crée le salon.
   */
  it('chez qui n’arbitre pas, comme chez l’arbitre', () => {
    channel.receive('state', { from: 'alan', epoch: 0, round: 3, game: finishedGame() }, 'hote')

    const ledger = readLedger()
    expect(ledger).toHaveLength(1)
    expect(ledger[0]!.players.find((p) => p.won)!.name).toBe('Camille')
  })

  it('avec l’identifiant que l’arbitre lui donnera aussi', () => {
    const game = finishedGame()
    channel.receive('state', { from: 'alan', epoch: 0, round: 3, game }, 'hote')

    expect(readLedger()[0]!.id).toBe(matchIdOf('ABCDEFGH', 3, game))
  })

  /**
   * L'état final repasse à chaque battement de l'arbitre. Le registre saurait
   * l'écarter, mais il ne doit pas non plus rediffuser la même partie à toute
   * la table dix fois de suite.
   */
  it('une seule fois, quel que soit le nombre d’états reçus', () => {
    const game = finishedGame()
    channel.receive('state', { from: 'alan', epoch: 0, round: 3, game }, 'hote')
    channel.receive('state', { from: 'alan', epoch: 0, round: 3, game }, 'hote')

    expect(readLedger()).toHaveLength(1)
    expect(channel.of('ledger')).toHaveLength(1)
  })

  /**
   * Celui dont le lien a lâché au dernier coup n'a pas vu la fin : ce message
   * est ce qui la lui rend.
   */
  it('et s’annonce à la table', () => {
    channel.receive('state', { from: 'alan', epoch: 0, round: 3, game: finishedGame() }, 'hote')

    const sent = channel.of('ledger').at(-1)!
    expect(sent.to).toBe('hote')
    expect((sent.data as { matches: Match[] }).matches).toHaveLength(1)
  })

  it('rien à ranger d’une partie qui n’est pas finie', () => {
    const running = { ...finishedGame(), phase: 'rolling' } as GameState
    channel.receive('state', { from: 'alan', epoch: 0, round: 3, game: running }, 'hote')

    expect(readLedger()).toHaveLength(0)
  })
})

/**
 * Sur un seul téléphone il n'y a ni salon, ni voisin, ni arbitre — et pourtant
 * c'est le mode où l'on joue le plus souvent, celui des dimanches soir autour
 * d'une table. Le registre doit y marcher pareil, sans réseau du tout.
 */
describe('la partie jouée sur un seul téléphone', () => {
  beforeEach(() => {
    localStorage.clear()
    clearLedger()
  })

  it('entre au registre sans qu’aucun canal ne s’ouvre', () => {
    const lobby: Lobby = {
      code: 'LOCAL',
      hostClientId: 'moi',
      epoch: 0,
      round: 0,
      variantId: 'petits-chevaux',
      players: [seat(0, 'Alan', 'moi', null), seat(1, 'Camille', 'moi', null)],
      started: true,
    }
    const game = { ...finishedGame(), players: [
      { seat: 0, name: 'Alan', kind: 'local', peerId: null, connected: true },
      { seat: 1, name: 'Camille', kind: 'local', peerId: null, connected: true },
    ] } as GameState

    Session.resume({ v: 3, lobby, game, at: Date.now() }, listeners())

    expect(readLedger()).toHaveLength(1)
    expect(readLedger()[0]!.players.find((p) => p.won)!.name).toBe('Camille')
  })
})

describe('le palmarès offert à qui s’assoit', () => {
  let channel: ReturnType<typeof fakeRoom>
  let host: Session

  beforeEach(() => {
    localStorage.clear()
    clearLedger()
    addMatches([someMatch('vieille-partie')])
    channel = fakeRoom()
    host = Session.online('ABCDEFGH', 'Alan', true, listeners(), channel.factory)
  })

  it('part vers le joueur que l’hôte vient d’accepter', () => {
    channel.join('peer-1')
    channel.receive('hello', { clientId: 'camille', name: 'Camille' }, 'peer-1')
    host.admit('camille')

    const offers = channel.of('ledger')
    expect(offers).toHaveLength(1)
    expect(offers[0]!.to).toBe('peer-1')
    expect((offers[0]!.data as { matches: Match[] }).matches.map((m) => m.id)).toEqual([
      'vieille-partie',
    ])
  })

  /**
   * Le salon repart à chaque siège pris, chaque renommage, chaque départ. Deux
   * cents parties par publication rempliraient le canal pour ne rien apprendre
   * à personne.
   */
  it('une seule fois par voisin, quoi qu’il arrive au salon ensuite', () => {
    channel.join('peer-1')
    channel.receive('hello', { clientId: 'camille', name: 'Camille' }, 'peer-1')
    host.admit('camille')
    host.rename(1, 'Cam')
    host.addSeat('bot', 'Bot 3')

    expect(channel.of('ledger')).toHaveLength(1)
  })

  /**
   * Le code de partie amène jusqu'à la porte ; c'est l'hôte qui l'ouvre. Le
   * palmarès de la bande n'a pas à s'afficher chez qui n'a pas été accepté.
   */
  it('reste chez soi tant que l’hôte n’a pas accepté', () => {
    channel.join('peer-9')
    channel.receive('hello', { clientId: 'importun', name: 'Inconnu' }, 'peer-9')

    expect(channel.of('ledger')).toHaveLength(0)
  })
})

describe('le palmarès reçu', () => {
  let channel: ReturnType<typeof fakeRoom>
  let host: Session

  beforeEach(() => {
    localStorage.clear()
    clearLedger()
    channel = fakeRoom()
    host = Session.online('ABCDEFGH', 'Alan', true, listeners(), channel.factory)
    channel.join('peer-1')
    channel.receive('hello', { clientId: 'camille', name: 'Camille' }, 'peer-1')
    host.admit('camille')
  })

  it('se réunit au sien, sans doublon', () => {
    addMatches([someMatch('a', 1000)])
    channel.receive('ledger', { matches: [someMatch('a', 1000), someMatch('b', 2000)] }, 'peer-1')

    expect(readLedger().map((m) => m.id)).toEqual(['b', 'a'])
  })

  it("n'écoute pas qui n'est pas à table", () => {
    channel.receive('ledger', { matches: [someMatch('venu-d-ailleurs')] }, 'peer-inconnu')

    expect(readLedger()).toHaveLength(0)
  })

  it('écarte ce qui n’a pas la forme d’une partie', () => {
    channel.receive('ledger', { matches: ['n’importe quoi'] as unknown as Match[] }, 'peer-1')

    expect(readLedger()).toHaveLength(0)
  })
})
