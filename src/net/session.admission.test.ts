/**
 * L'admission, vue de bout en bout.
 *
 * `admission.test.ts` vérifie la décision ; celui-ci vérifie le va-et-vient —
 * un `hello` arrive, une demande apparaît, l'hôte tranche, un siège existe ou
 * non. C'est là que vivent les vraies fautes : une décision juste câblée à
 * l'envers laisse entrer tout le monde, et aucune fonction pure ne le dirait.
 *
 * Le canal est un double : la vraie mise en relation passe par des relais
 * publics, qu'on ne va pas appeler pour savoir si un inconnu peut s'asseoir.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Session, type RoomFactory, type SessionListeners } from './session.ts'
import type { Room } from './room.ts'

/**
 * `localStorage` de rechange : les tests tournent hors navigateur, et
 * l'identité d'appareil s'y range. Un stockage en mémoire suffit — c'est
 * exactement le contrat dont `clientId()` a besoin, et cela évite de tirer un
 * DOM entier pour trois chaînes.
 */
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

/** Un canal qui n'envoie rien nulle part, mais retient tout et se laisse piloter. */
function fakeRoom() {
  const sent: Sent[] = []
  const handlers = new Map<string, (data: never, peer: string) => void>()
  let onJoin: ((peer: string) => void) | null = null
  let onLeave: ((peer: string) => void) | null = null

  const room: Room = {
    selfId: 'moi-le-pair',
    relaysUp: () => 3,
    peers: () => [],
    send: (kind, data, to) => sent.push({ kind, data, to }),
    on: (kind, cb) => handlers.set(kind, cb as (data: never, peer: string) => void),
    onPeerJoin: (cb) => {
      onJoin = cb
    },
    onPeerLeave: (cb) => {
      onLeave = cb
    },
    leave: () => {},
  }

  return {
    room,
    sent,
    factory: (() => room) as RoomFactory,
    /** Simule l'arrivée d'un message envoyé par un pair. */
    receive: (kind: string, data: unknown, peer: string) =>
      handlers.get(kind)?.(data as never, peer),
    join: (peer: string) => onJoin?.(peer),
    leave: (peer: string) => onLeave?.(peer),
    of: (kind: string) => sent.filter((m) => m.kind === kind),
  }
}

const listeners = (): SessionListeners => ({ onChange: vi.fn(), onError: vi.fn(), onChat: vi.fn() })

describe("l'hôte tient la porte", () => {
  let channel: ReturnType<typeof fakeRoom>
  let host: Session

  beforeEach(() => {
    localStorage.clear()
    channel = fakeRoom()
    host = Session.online('ABCDEFGH', 'Alan', true, listeners(), channel.factory)
  })

  it("n'assoit personne tant que l'hôte n'a pas tranché", () => {
    channel.receive('hello', { clientId: 'inconnu', name: 'Camille' }, 'peer-1')

    expect(host.lobby.players).toHaveLength(1)
    expect(host.pendingJoins()).toEqual([{ clientId: 'inconnu', name: 'Camille', peer: 'peer-1' }])
    // Le demandeur doit savoir que sa demande est posée, sinon il attend devant
    // un écran muet sans savoir s'il a mal tapé le code.
    expect(channel.of('join')).toEqual([
      { kind: 'join', data: { clientId: 'inconnu', status: 'pending' }, to: 'peer-1' },
    ])
  })

  it('assoit le demandeur quand l’hôte accepte', () => {
    channel.receive('hello', { clientId: 'inconnu', name: 'Camille' }, 'peer-1')
    host.admit('inconnu')

    expect(host.pendingJoins()).toHaveLength(0)
    expect(host.lobby.players.map((p) => p.name)).toEqual(['Alan', 'Camille'])
    expect(host.lobby.players[1]!.peerId).toBe('peer-1')
    // Le salon mis à jour part vers tout le monde.
    expect(channel.of('lobby').length).toBeGreaterThan(0)
  })

  it('éconduit le demandeur quand l’hôte refuse', () => {
    channel.receive('hello', { clientId: 'importun', name: 'Inconnu' }, 'peer-9')
    host.refuse('importun')

    expect(host.pendingJoins()).toHaveLength(0)
    expect(host.lobby.players).toHaveLength(1)
    expect(channel.of('join').at(-1)).toEqual({
      kind: 'join',
      data: { clientId: 'importun', status: 'denied' },
      to: 'peer-9',
    })
  })

  // Sans cela, un refusé qui se represente à chaque publication du salon ferait
  // passer la soirée de l'hôte à refuser le même.
  it('ne redemande plus rien à l’hôte pour un refusé', () => {
    channel.receive('hello', { clientId: 'importun', name: 'Inconnu' }, 'peer-9')
    host.refuse('importun')
    channel.receive('hello', { clientId: 'importun', name: 'Inconnu' }, 'peer-9')

    expect(host.pendingJoins()).toHaveLength(0)
    expect(host.lobby.players).toHaveLength(1)
  })

  it('ne pose pas deux fois la demande du même appareil', () => {
    channel.receive('hello', { clientId: 'ami', name: 'Camille' }, 'peer-1')
    channel.receive('hello', { clientId: 'ami', name: 'Camille' }, 'peer-1')

    expect(host.pendingJoins()).toHaveLength(1)
  })

  it('oublie la demande de qui est reparti avant la réponse', () => {
    channel.receive('hello', { clientId: 'pressé', name: 'Camille' }, 'peer-1')
    channel.leave('peer-1')

    expect(host.pendingJoins()).toHaveLength(0)
    host.admit('pressé')
    expect(host.lobby.players).toHaveLength(1)
  })

  it("n'ouvre plus la porte une fois la partie lancée", () => {
    channel.receive('hello', { clientId: 'ami', name: 'Camille' }, 'peer-1')
    host.admit('ami')
    host.start()
    expect(host.lobby.started).toBe(true)

    channel.receive('hello', { clientId: 'retardataire', name: 'Sami' }, 'peer-2')
    expect(host.pendingJoins()).toHaveLength(0)
    expect(host.lobby.players).toHaveLength(2)
  })

  /**
   * La règle qui compte le plus : un rechargement de page ne doit pas demander
   * l'accord de l'hôte. Le siège est déjà attribué, il revient chez lui.
   */
  it('rend son siège sans rien demander à qui revient', () => {
    channel.receive('hello', { clientId: 'ami', name: 'Camille' }, 'peer-1')
    host.admit('ami')
    channel.leave('peer-1')
    expect(host.lobby.players[1]!.connected).toBe(false)

    channel.receive('hello', { clientId: 'ami', name: 'Camille' }, 'peer-7')

    expect(host.pendingJoins()).toHaveLength(0)
    expect(host.lobby.players).toHaveLength(2)
    expect(host.lobby.players[1]!.connected).toBe(true)
    expect(host.lobby.players[1]!.peerId).toBe('peer-7')
  })
})

describe("l'invité devant la porte", () => {
  let channel: ReturnType<typeof fakeRoom>
  let guest: Session

  beforeEach(() => {
    localStorage.clear()
    channel = fakeRoom()
    guest = Session.online('ABCDEFGH', 'Camille', false, listeners(), channel.factory)
  })

  it('sait que sa demande est en attente', () => {
    expect(guest.joinStatus).toBe('unknown')
    channel.receive('join', { clientId: guest.self, status: 'pending' }, 'hote')
    expect(guest.joinStatus).toBe('pending')
  })

  it('sait qu’il a été refusé', () => {
    channel.receive('join', { clientId: guest.self, status: 'denied' }, 'hote')
    expect(guest.joinStatus).toBe('denied')
  })

  it('ignore le verdict adressé à quelqu’un d’autre', () => {
    channel.receive('join', { clientId: 'un-autre', status: 'denied' }, 'hote')
    expect(guest.joinStatus).toBe('unknown')
  })

  it('oublie son attente dès qu’un siège lui est attribué', () => {
    channel.receive('join', { clientId: guest.self, status: 'pending' }, 'hote')
    channel.receive(
      'lobby',
      {
        code: 'ABCDEFGH',
        hostClientId: 'hote',
        variantId: 'petits-chevaux',
        started: false,
        players: [
          { seat: 0, name: 'Alan', clientId: 'hote', peerId: 'p0', kind: 'human', connected: true, botFill: false },
          { seat: 1, name: 'Camille', clientId: guest.self, peerId: 'p1', kind: 'human', connected: true, botFill: false },
        ],
      },
      'hote',
    )
    expect(guest.joinStatus).toBe('unknown')
  })

  /**
   * L'hôte a pu changer entre-temps — le précédent est parti avec la liste
   * d'attente, qui ne voyage pas dans le salon. Sans cette relance, le
   * demandeur resterait devant une porte que plus personne ne garde.
   */
  it('se represente quand le salon publié ne lui donne pas de siège', () => {
    channel.receive(
      'lobby',
      {
        code: 'ABCDEFGH',
        hostClientId: 'nouvel-hote',
        variantId: 'petits-chevaux',
        started: false,
        players: [
          { seat: 0, name: 'Alan', clientId: 'nouvel-hote', peerId: 'p0', kind: 'human', connected: true, botFill: false },
        ],
      },
      'hote',
    )
    expect(channel.of('hello').length).toBeGreaterThan(0)
  })

  it('ne se represente plus une fois refusé', () => {
    channel.receive('join', { clientId: guest.self, status: 'denied' }, 'hote')
    const before = channel.of('hello').length
    channel.receive(
      'lobby',
      {
        code: 'ABCDEFGH',
        hostClientId: 'hote',
        variantId: 'petits-chevaux',
        started: false,
        players: [
          { seat: 0, name: 'Alan', clientId: 'hote', peerId: 'p0', kind: 'human', connected: true, botFill: false },
        ],
      },
      'hote',
    )
    expect(channel.of('hello').length).toBe(before)
  })
})
