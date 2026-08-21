/**
 * Le transport, en carton — et rien d'autre dans ce fichier.
 *
 * Il est séparé de `test-dom.ts` pour une raison mécanique : c'est
 * `vi.mock('../net/room.ts')` qui va chercher `fakeJoinGameRoom`, et la
 * fabrique d'un mock s'exécute **pendant** la résolution du module qu'elle
 * remplace. Si elle importait `test-dom.ts` — qui tire `app.ts`, donc
 * `session.ts`, donc `room.ts` — elle attendrait le module qu'elle est en train
 * de fabriquer. Le fichier de test se figeait sans un mot.
 *
 * D'où la règle tenue ici : **aucun import de valeur venu de `src/`.** Le seul
 * lien avec `room.ts` est un import de type, effacé à la compilation.
 */

import { expect } from 'vitest'
import type { Room } from '../net/room.ts'

export type Sent = { kind: string; data: unknown; to?: string }

export type FakeChannel = ReturnType<typeof makeChannel>

/** Tous les salons ouverts depuis le début du test, dans l'ordre. */
export const rooms: FakeChannel[] = []

/**
 * Le même canal double que `session.link.test.ts` : il n'envoie rien nulle
 * part, retient tout, et se laisse piloter depuis le test.
 */
function makeChannel(code: string) {
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
    code,
    room,
    sent,
    /** Ce qui est parti d'ici, par nature de message. */
    of: (kind: string) => sent.filter((m) => m.kind === kind),
    /** Un message arrive d'un pair, comme s'il venait du réseau. */
    receive: (kind: string, data: unknown, peer: string) => handlers.get(kind)?.(data as never, peer),
    join: (peer: string) => {
      peers = [...peers, peer]
      onJoin?.(peer)
    },
    part: (peer: string) => {
      peers = peers.filter((p) => p !== peer)
      onLeave?.(peer)
    },
  }
}

/**
 * Ce que le banc d'essai passe à `new App(root, join)` à la place de
 * `joinGameRoom`.
 *
 * Un écran n'a toujours pas à savoir comment on entre dans une salle : il reçoit
 * la fabrique et la transmet à `Session.online`, qui l'acceptait déjà. C'est le
 * seul fil que les tests tirent — le reste (session, moteur, battements) est le
 * vrai.
 */
export function fakeJoinGameRoom(code: string): Room {
  const channel = makeChannel(code)
  rooms.push(channel)
  return channel.room
}

/** Le dernier salon ouvert — celui de la session que l'écran vient de créer. */
export function lastRoom(): FakeChannel {
  const channel = rooms[rooms.length - 1]
  expect(channel, "aucune session en ligne n'a été ouverte").toBeTruthy()
  return channel!
}
