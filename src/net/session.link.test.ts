/**
 * Ce qui se passe quand le réseau tremble.
 *
 * Le symptôme rapporté par une vraie table : deux joueurs sur un réseau
 * médiocre voyaient un bot prendre leur siège alors qu'ils n'étaient
 * déconnectés de personne. Trois causes, trois familles de tests ici :
 *
 *   1. Deux arbitres à la fois (« split brain »). Un invité qui perdait son
 *      lien vers l'hôte s'élisait aussitôt ; l'ancien hôte ignorait ses salons,
 *      et chacun mettait un bot sur le siège de l'autre. D'où l'époque, la
 *      grâce avant élection, et le quorum.
 *   2. Une présence déduite du transport, qui déclare un pair perdu au bout de
 *      cinq secondes et ne dit plus rien ensuite. D'où le battement de cœur.
 *   3. Un coup joué à temps, arrivé tard, compté comme un tour sauté. D'où les
 *      intentions numérotées et acquittées.
 *
 * Le canal est un double : on ne va pas appeler des relais publics pour savoir
 * qui arbitre.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Session, type RoomFactory, type SessionListeners } from './session.ts'
import type { Lobby, LobbyPlayer, Room, StateMessage } from './room.ts'
import { AWAY_TO_BOT_MS, SILENCE_MS, TICK_MS, TURN_GRACE_MS, TURN_MS } from './presence.ts'

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
  let left = 0

  const room: Room = {
    selfId: 'moi-le-pair',
    relaysUp: () => 3,
    peers: () => peers,
    send: (kind, data, to) => sent.push({ kind, data, to }),
    on: (kind, cb) => handlers.set(kind, cb as (data: never, peer: string) => void),
    onPeerJoin: (cb) => {
      onJoin = cb
    },
    onPeerLeave: (cb) => {
      onLeave = cb
    },
    leave: async () => {
      left++
      peers = []
    },
  }

  return {
    room,
    sent,
    factory: (() => room) as RoomFactory,
    get left() {
      return left
    },
    receive: (kind: string, data: unknown, peer: string) => handlers.get(kind)?.(data as never, peer),
    join: (peer: string) => {
      peers = [...peers, peer]
      onJoin?.(peer)
    },
    leave: (peer: string) => {
      peers = peers.filter((p) => p !== peer)
      onLeave?.(peer)
    },
    of: (kind: string) => sent.filter((m) => m.kind === kind),
  }
}

const listeners = (): SessionListeners => ({ onChange: vi.fn(), onError: vi.fn(), onChat: vi.fn() })

const seat = (over: Partial<LobbyPlayer> & Pick<LobbyPlayer, 'seat' | 'clientId'>): LobbyPlayer => ({
  name: `J${over.seat + 1}`,
  peerId: null,
  kind: 'human',
  connected: true,
  botFill: false,
  ...over,
})

const lobbyOf = (over: Partial<Lobby> = {}): Lobby => ({
  code: 'ABCDEFGH',
  hostClientId: 'hote',
  epoch: 0,
  round: 0,
  variantId: 'petits-chevaux',
  players: [],
  started: false,
  ...over,
})

/** Un invité déjà assis, avec l'hôte au bout du fil. */
function seatedGuest(others: LobbyPlayer[] = []) {
  const channel = fakeRoom()
  const guest = Session.online('ABCDEFGH', 'Camille', false, listeners(), channel.factory)
  channel.join('p-hote')
  const lobby = lobbyOf({
    players: [
      seat({ seat: 0, clientId: 'hote', peerId: 'p-hote', name: 'Alan' }),
      seat({ seat: 1, clientId: guest.self, peerId: 'moi-le-pair', name: 'Camille' }),
      ...others,
    ],
  })
  channel.receive('lobby', structuredClone(lobby), 'p-hote')
  return { channel, guest, lobby }
}

describe("un seul arbitre à la fois", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })
  afterEach(() => vi.useRealTimers())

  it("un hôte qui voit passer une époque plus récente abdique et garde son siège", () => {
    const channel = fakeRoom()
    const host = Session.online('ABCDEFGH', 'Alan', true, listeners(), channel.factory)
    channel.receive('hello', { clientId: 'ami', name: 'Camille' }, 'p1')
    host.admit('ami')
    expect(host.isHost).toBe(true)

    const before = channel.of('hello').length
    channel.receive(
      'lobby',
      structuredClone({ ...host.lobby, hostClientId: 'ami', epoch: host.lobby.epoch + 1 }),
      'p1',
    )

    expect(host.isHost).toBe(false)
    expect(host.lobby.hostClientId).toBe('ami')
    expect(host.lobby.players.some((p) => p.clientId === host.self)).toBe(true)
    // Il redevient un invité comme un autre : il doit se represénter.
    expect(channel.of('hello').length).toBeGreaterThan(before)
    host.destroy(true)
  })

  it("à époque égale, le plus petit identifiant garde la main", () => {
    const channel = fakeRoom()
    const host = Session.online('ABCDEFGH', 'Alan', true, listeners(), channel.factory)
    const epoch = host.lobby.epoch

    // Un prétendant dont l'identifiant vient après le nôtre : il perd.
    channel.receive('lobby', lobbyOf({ hostClientId: '~grand', epoch }), 'p1')
    expect(host.isHost).toBe(true)

    // Un prétendant dont l'identifiant vient avant : il gagne.
    channel.receive('lobby', lobbyOf({ hostClientId: '!petit', epoch }), 'p1')
    expect(host.isHost).toBe(false)
    host.destroy(true)
  })

  it("un invité qui perd le lien de l'hôte n'élit personne avant la grâce", () => {
    const { channel, guest } = seatedGuest()

    channel.leave('p-hote')
    vi.advanceTimersByTime(AWAY_TO_BOT_MS - 1000)

    expect(guest.isHost).toBe(false)
    expect(guest.link).toBe('lost')
    guest.destroy(true)
  })

  it("après la grâce, l'élection est déterministe et ouvre une nouvelle époque", () => {
    const { channel, guest } = seatedGuest()
    const epoch = guest.lobby.epoch

    channel.leave('p-hote')
    vi.advanceTimersByTime(AWAY_TO_BOT_MS + TICK_MS)

    expect(guest.isHost).toBe(true)
    expect(guest.lobby.epoch).toBe(epoch + 1)
    guest.destroy(true)
  })

  /**
   * Le cœur du symptôme : celui qui ne voit plus personne n'est pas
   * l'arbitre — c'est lui qui est isolé. S'élire seul, c'est fabriquer le
   * second hôte qui mettra un bot sur le siège des autres.
   */
  it("ne s'élit pas quand on ne voit plus la moitié de la table", () => {
    const { channel, guest } = seatedGuest([
      seat({ seat: 2, clientId: 'sami', peerId: 'p-sami' }),
      seat({ seat: 3, clientId: 'ines', peerId: 'p-ines' }),
    ])

    channel.leave('p-sami')
    channel.leave('p-ines')
    channel.leave('p-hote')
    vi.advanceTimersByTime(AWAY_TO_BOT_MS * 2)

    expect(guest.isHost).toBe(false)
    guest.destroy(true)
  })
})

describe('le battement de cœur', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })
  afterEach(() => vi.useRealTimers())

  it("l'hôte bat la mesure", () => {
    const channel = fakeRoom()
    const host = Session.online('ABCDEFGH', 'Alan', true, listeners(), channel.factory)
    vi.advanceTimersByTime(TICK_MS * 3)
    expect(channel.of('tick').length).toBeGreaterThanOrEqual(2)
    host.destroy(true)
  })

  it("l'invité répond au battement", () => {
    const { channel, guest } = seatedGuest()
    channel.receive('tick', { from: 'hote', epoch: 0, seq: 0, at: 1000 }, 'p-hote')
    expect(channel.of('pong')).toHaveLength(1)
    guest.destroy(true)
  })

  it("l'invité qui n'entend plus rien se sait coupé, sans que personne ne soit parti", () => {
    const { channel, guest } = seatedGuest()
    expect(guest.link).toBe('linked')

    // Le pair est toujours là pour le transport, mais plus un mot n'arrive.
    vi.advanceTimersByTime(SILENCE_MS + TICK_MS)
    expect(guest.link).toBe('lost')
    channel.receive('tick', { from: 'hote', epoch: 0, seq: 0, at: 1000 }, 'p-hote')
    expect(guest.link).toBe('linked')
    guest.destroy(true)
  })

  it("l'hôte déclare absent qui ne répond plus, sans attendre le transport", () => {
    const channel = fakeRoom()
    const host = Session.online('ABCDEFGH', 'Alan', true, listeners(), channel.factory)
    channel.join('p1')
    channel.receive('hello', { clientId: 'ami', name: 'Camille' }, 'p1')
    host.admit('ami')
    expect(host.lobby.players[1]!.connected).toBe(true)

    vi.advanceTimersByTime(SILENCE_MS + TICK_MS)
    expect(host.lobby.players[1]!.connected).toBe(false)
    host.destroy(true)
  })

  it('rend le siège dès le premier message du revenant, sans attendre un hello', () => {
    const channel = fakeRoom()
    const host = Session.online('ABCDEFGH', 'Alan', true, listeners(), channel.factory)
    channel.join('p1')
    channel.receive('hello', { clientId: 'ami', name: 'Camille' }, 'p1')
    host.admit('ami')
    host.lobby.players[1]!.botFill = true
    host.lobby.players[1]!.connected = false

    channel.receive('pong', { clientId: 'ami', at: 1000 }, 'p1')

    expect(host.lobby.players[1]!.botFill).toBe(false)
    expect(host.lobby.players[1]!.connected).toBe(true)
    host.destroy(true)
  })
})

describe("un bot n'entre que quand la table l'attend", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })
  afterEach(() => vi.useRealTimers())

  /**
   * Tant qu'un autre joue, un joueur parti ne gêne personne. Lui retirer son
   * siège pendant le tour du voisin, c'est le remplacer pour rien — et c'est ce
   * qu'on voyait : le bot apparaissait alors que le joueur était en train de
   * revenir.
   */
  it("ne confie le siège d'un absent qu'au moment de son tour", () => {
    const { host, channel } = onlineTable()
    host.start()
    host.game = { ...host.game!, turn: 0 }
    channel.leave('p1')

    vi.advanceTimersByTime(AWAY_TO_BOT_MS - 1_000)
    expect(host.lobby.players[1]!.botFill).toBe(false)

    vi.advanceTimersByTime(20_000)
    expect(host.lobby.players[1]!.botFill).toBe(true)
    host.destroy(true)
  })

  it('confie dès le lancement un siège que personne ne tient', () => {
    const { host, channel } = onlineTable()
    channel.leave('p1')
    expect(host.lobby.players[1]!.connected).toBe(false)

    host.start()
    expect(host.lobby.players[1]!.botFill).toBe(true)
    host.destroy(true)
  })
})

describe('les intentions sont acquittées', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })
  afterEach(() => vi.useRealTimers())

  it("l'invité réémet tant que l'hôte n'a pas accusé réception", () => {
    const { channel, guest } = seatedGuest()
    channel.receive(
      'state',
      {
        from: 'hote',
        epoch: 0,
        round: 0,
        game: startedGame(guest, channel),
      } satisfies StateMessage,
      'p-hote',
    )

    guest.dispatch({ type: 'roll' })
    const first = channel.of('intent')
    expect(first).toHaveLength(1)
    const sent = first[0]!.data as { nonce: string }

    vi.advanceTimersByTime(2500)
    expect(channel.of('intent').length).toBeGreaterThan(1)
    // Toujours la même intention : l'hôte doit pouvoir la reconnaître.
    expect((channel.of('intent').at(-1)!.data as { nonce: string }).nonce).toBe(sent.nonce)

    channel.receive('ack', { nonce: sent.nonce, ok: true }, 'p-hote')
    const after = channel.of('intent').length
    vi.advanceTimersByTime(5000)
    expect(channel.of('intent')).toHaveLength(after)
    guest.destroy(true)
  })

  it("l'hôte n'applique qu'une fois une intention réémise, et acquitte à chaque fois", () => {
    const { host, channel } = onlineTable()
    host.start()
    host.game = { ...host.game!, turn: 1 }
    const seq = host.game.seq

    const intent = {
      clientId: 'ami',
      epoch: host.lobby.epoch,
      action: { type: 'roll' as const },
      seq,
      nonce: 'n-1',
    }
    channel.receive('intent', intent, 'p1')
    const afterFirst = host.game!.seq
    expect(afterFirst).toBeGreaterThan(seq)

    channel.receive('intent', intent, 'p1')
    expect(host.game!.seq).toBe(afterFirst)
    expect(channel.of('ack').filter((m) => (m.data as { nonce: string }).nonce === 'n-1')).toHaveLength(2)
    host.destroy(true)
  })

})

describe('la revanche parvient aux invités', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })
  afterEach(() => vi.useRealTimers())

  it("accepte le premier état d'une nouvelle manche malgré son numéro plus petit", () => {
    const { channel, guest, lobby } = seatedGuest()
    const game = startedGame(guest, channel)
    channel.receive('state', { from: 'hote', epoch: 0, round: 0, game: { ...game, seq: 50 } }, 'p-hote')
    expect(guest.game!.seq).toBe(50)

    // Revanche : le salon repasse en attente, la manche suivante est annoncée.
    channel.receive('lobby', { ...structuredClone(lobby), started: false, round: 1 }, 'p-hote')
    expect(guest.game).toBeNull()

    channel.receive('state', { from: 'hote', epoch: 0, round: 1, game: { ...game, seq: 0 } }, 'p-hote')
    expect(guest.game).not.toBeNull()
    expect(guest.game!.seq).toBe(0)
    guest.destroy(true)
  })
})

describe('le spectateur ne déclenche pas de tempête', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })
  afterEach(() => vi.useRealTimers())

  it("l'hôte dit qu'on regarde, au lieu de laisser la demande sans réponse", () => {
    const { host, channel } = onlineTable()
    host.start()
    channel.receive('hello', { clientId: 'curieux', name: 'Sami' }, 'p9')
    expect(channel.of('join').at(-1)!.data).toEqual({ clientId: 'curieux', status: 'watching' })
    host.destroy(true)
  })

  it('vingt salons reçus ne produisent pas vingt hello', () => {
    const channel = fakeRoom()
    const guest = Session.online('ABCDEFGH', 'Sami', false, listeners(), channel.factory)
    channel.receive('join', { clientId: guest.self, status: 'watching' }, 'p-hote')

    // Le premier salon lui apprend qui arbitre : il se represente une fois.
    channel.receive('lobby', lobbyOf({ started: true }), 'p-hote')
    const announced = channel.of('hello').length

    for (let i = 0; i < 20; i++) {
      channel.receive('lobby', lobbyOf({ started: true }), 'p-hote')
    }

    expect(guest.joinStatus).toBe('watching')
    // Et plus un seul ensuite : c'est la tempête d'avant qui est morte.
    expect(channel.of('hello')).toHaveLength(announced)
    guest.destroy(true)
  })
})

describe('réessayer ferme vraiment le salon précédent', () => {
  beforeEach(() => localStorage.clear())

  it("attend la fermeture avant de rejoindre", async () => {
    const channel = fakeRoom()
    const guest = Session.online('ABCDEFGH', 'Camille', false, listeners(), channel.factory)
    const before = channel.of('hello').length

    guest.retry()
    expect(channel.of('hello')).toHaveLength(before)
    await vi.waitFor(() => expect(channel.of('hello').length).toBeGreaterThan(before))
    expect(channel.left).toBe(1)
    guest.destroy(true)
  })
})

/** Une table en ligne d'un hôte et d'un invité admis, prête à lancer. */
function onlineTable() {
  const channel = fakeRoom()
  const host = Session.online('ABCDEFGH', 'Alan', true, listeners(), channel.factory)
  channel.join('p1')
  channel.receive('hello', { clientId: 'ami', name: 'Camille' }, 'p1')
  host.admit('ami')
  return { host, channel }
}

/** Un état de partie plausible, fabriqué par un hôte de service. */
function startedGame(guest: Session, channel: ReturnType<typeof fakeRoom>) {
  void channel
  const maker = Session.local('Alan', listeners())
  maker.addSeat('human')
  maker.start()
  const game = structuredClone(maker.game!)
  maker.destroy(true)
  // Le siège de l'invité joue : c'est ce qu'on veut pouvoir dispatcher.
  const mine = guest.lobby.players.find((p) => p.clientId === guest.self)!.seat
  return { ...game, turn: mine }
}

/**
 * Les sondes d'une revue adversariale : chacune reproduisait un chemin où la
 * table finissait par se contredire elle-même. Elles vivent ici parce qu'elles
 * décrivent toutes la même chose — qui fait autorité, et jusqu'à quand.
 */
describe("l'arbitrage ne se laisse pas contourner", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })
  afterEach(() => vi.useRealTimers())

  /**
   * Abdiquer en gardant l'état d'avant, c'est ne pas abdiquer : le nouvel
   * arbitre repart d'un numéro plus petit, et l'ex-hôte rejette tout ce qu'il
   * envoie — puis joue des coups datés d'une partie qui n'existe plus.
   */
  it("part de l'état du nouvel arbitre, pas du sien", () => {
    const { host, channel } = onlineTable()
    host.start()
    host.game = { ...host.game!, seq: 50 }

    const taken: Lobby = {
      ...structuredClone(host.lobby),
      hostClientId: 'ami',
      epoch: host.lobby.epoch + 1,
      started: true,
    }
    channel.receive('lobby', taken, 'p1')
    expect(host.isHost).toBe(false)

    const game = startedTwoSeats()
    channel.receive(
      'state',
      { from: 'ami', epoch: taken.epoch, round: taken.round, game: { ...game, seq: 12 } },
      'p1',
    )
    expect(host.game!.seq).toBe(12)
    host.destroy(true)
  })

  it("n'accepte un état que de l'arbitre en titre", () => {
    const { channel, guest } = seatedGuest([seat({ seat: 2, clientId: 'sami', peerId: 'p-sami' })])
    const game = startedTwoSeats()
    channel.receive('state', { from: 'hote', epoch: 0, round: 0, game: { ...game, seq: 4 } }, 'p-hote')
    expect(guest.game!.seq).toBe(4)

    // Un second arbitre au même règne ne s'impose pas : à égalité, c'est
    // l'identité qui départage, et elle a déjà départagé.
    channel.receive('state', { from: 'sami', epoch: 0, round: 0, game: { ...game, seq: 9 } }, 'p-sami')
    expect(guest.game!.seq).toBe(4)
    guest.destroy(true)
  })

  it("ne se croit pas relié parce qu'un autre pair bat la mesure", () => {
    const { channel, guest } = seatedGuest([seat({ seat: 2, clientId: 'sami', peerId: 'p-sami' })])

    // Sami bat la mesure toutes les deux secondes ; l'hôte, lui, s'est tu.
    for (let i = 0; i < 8; i++) {
      vi.advanceTimersByTime(TICK_MS)
      channel.receive('tick', { from: 'sami', epoch: 0, seq: 0, at: Date.now() }, 'p-sami')
    }

    expect(guest.link).toBe('lost')
    guest.destroy(true)
  })

  /**
   * Un hôte resté sur un règne périmé ne le sait pas : il n'a pas reçu le
   * salon du nouveau. N'importe quel invité qui voit les deux peut le lui
   * apprendre — et lui donner du même coup la table à jour.
   */
  it("renvoie le salon à jour à qui bat la mesure d'un règne périmé", () => {
    const { channel, guest } = seatedGuest()
    channel.receive('lobby', { ...structuredClone(guest.lobby), epoch: 3 }, 'p-hote')

    const before = channel.of('lobby').length
    channel.receive('tick', { from: 'hote', epoch: 1, seq: 0, at: Date.now() }, 'p-vieux')

    expect(channel.of('lobby').length).toBe(before + 1)
    expect(channel.of('lobby').at(-1)!.to).toBe('p-vieux')
    expect(channel.of('pong')).toHaveLength(0)
    guest.destroy(true)
  })

  it("redemande la table quand un règne plus récent bat la mesure", () => {
    const { host, channel } = onlineTable()
    const before = channel.of('hello').length

    channel.receive('tick', { from: 'ami', epoch: host.lobby.epoch + 1, seq: 0, at: 1000 }, 'p1')

    expect(channel.of('hello').length).toBe(before + 1)
    expect(channel.of('hello').at(-1)!.to).toBe('p1')
    host.destroy(true)
  })

  /**
   * Deux réveils coup sur coup — `visibilitychange` puis `online` — ouvraient
   * deux salons de plus, dont un seul était refermé. L'orphelin restait
   * branché, et ses battements rassuraient une session qui ne l'écoutait plus.
   */
  it('ne rouvre pas deux salons quand on réessaie deux fois', async () => {
    vi.useRealTimers()
    const channel = fakeRoom()
    const guest = Session.online('ABCDEFGH', 'Camille', false, listeners(), channel.factory)
    const before = channel.of('hello').length

    guest.retry()
    guest.retry()
    await vi.waitFor(() => expect(channel.of('hello').length).toBeGreaterThan(before))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(channel.of('hello').length).toBe(before + 1)
    guest.destroy(true)
  })

  /**
   * Le nouvel arbitre n'a jamais reçu un mot des autres invités : ils ne
   * parlaient qu'à l'ancien. Sans mémoire d'entrée, son premier tour de table
   * les déclarait tous absents — et un « Lancer » dans cette fenêtre mettait
   * un bot sur chaque siège.
   */
  it("ne déclare pas absente la table dont il vient de prendre la main", () => {
    const { channel, guest } = seatedGuest([
      seat({ seat: 2, clientId: 'sami', peerId: 'p-sami' }),
      seat({ seat: 3, clientId: 'ines', peerId: 'p-ines' }),
    ])

    channel.leave('p-hote')
    vi.advanceTimersByTime(AWAY_TO_BOT_MS + TICK_MS)
    expect(guest.isHost).toBe(true)

    vi.advanceTimersByTime(TICK_MS * 2)
    const present = guest.lobby.players.filter((p) => p.connected).map((p) => p.clientId)
    expect(present).toContain('sami')
    expect(present).toContain('ines')
    guest.destroy(true)
  })

  /**
   * Le pardon couvre un coup parti à temps, pas un coup joué longtemps après
   * le couperet : sans limite, un joueur systématiquement en retard ne laissait
   * jamais sa place, et la table payait onze secondes par tour pour toujours.
   */
  it("ne pardonne un coup en retard que le temps d'un aller-retour", () => {
    const { host, channel } = onlineTable()
    host.start()
    host.game = { ...host.game!, turn: 1 }
    const seq = host.game.seq
    // Le départ du pair réarme la pendule sur le siège qu'on vient de lui
    // donner : sans cela le couperet resterait programmé pour l'ancien tour.
    channel.leave('p1')

    vi.advanceTimersByTime(TURN_MS + TURN_GRACE_MS + 100)
    expect(host.game!.turn).not.toBe(1)

    const late = (nonce: string) =>
      channel.receive(
        'intent',
        { clientId: 'ami', epoch: host.lobby.epoch, action: { type: 'roll' }, seq, nonce },
        'p1',
      )

    late('n-vol')
    expect((channel.of('ack').at(-1)!.data as { error?: string }).error).toBe('tooLate')

    vi.advanceTimersByTime(6_000)
    late('n-tard')
    expect((channel.of('ack').at(-1)!.data as { error?: string }).error).toBe('notYourTurn')
    host.destroy(true)
  })

  /** Regarder n'est pas être refusé : quand une place se libère, on redemande. */
  it('redemande une place quand la table se rouvre', () => {
    const channel = fakeRoom()
    const guest = Session.online('ABCDEFGH', 'Sami', false, listeners(), channel.factory)
    channel.receive('join', { clientId: guest.self, status: 'watching' }, 'p-hote')
    channel.receive('lobby', lobbyOf({ started: true, players: [seat({ seat: 0, clientId: 'hote' })] }), 'p-hote')
    const before = channel.of('hello').length

    channel.receive(
      'lobby',
      lobbyOf({ started: false, players: [seat({ seat: 0, clientId: 'hote' })] }),
      'p-hote',
    )
    expect(channel.of('hello').length).toBe(before + 1)

    // Et une seule fois : la table reste ouverte, on ne harcèle pas l'hôte.
    channel.receive(
      'lobby',
      lobbyOf({ started: false, players: [seat({ seat: 0, clientId: 'hote' })] }),
      'p-hote',
    )
    expect(channel.of('hello').length).toBe(before + 1)
    guest.destroy(true)
  })

  it("l'hôte ne refait pas son salon à chaque retour au premier plan", () => {
    const { host, channel } = onlineTable()
    channel.leave('p1')
    const before = channel.of('hello').length

    host.wakeUp()

    expect(channel.of('hello').length).toBe(before + 1)
    expect(channel.left).toBe(0)
    host.destroy(true)
  })

  it("adresse ses intentions à l'arbitre, et non à toute la table", () => {
    const { channel, guest } = seatedGuest([seat({ seat: 2, clientId: 'sami', peerId: 'p-sami' })])
    channel.receive('state', { from: 'hote', epoch: 0, round: 0, game: startedForGuest(guest) }, 'p-hote')

    guest.dispatch({ type: 'roll' })
    expect(channel.of('intent').at(-1)!.to).toBe('p-hote')
    guest.destroy(true)
  })

  /**
   * L'hôte qui recharge sa page revient sans rien savoir de sa table. Un
   * invité, lui, sait encore tout : il lui renvoie le salon, où l'ex-hôte se
   * retrouve nommé arbitre avec les sièges de tout le monde intacts.
   */
  it('rend le salon à un membre qui revient, même quand on n’est pas l’hôte', () => {
    const { channel, guest } = seatedGuest([seat({ seat: 2, clientId: 'sami', peerId: 'p-sami' })])
    const before = channel.of('lobby').length

    channel.receive('hello', { clientId: 'hote', name: 'Alan' }, 'p-hote-2')
    expect(channel.of('lobby').length).toBe(before + 1)
    expect(channel.of('lobby').at(-1)!.to).toBe('p-hote-2')

    // Un inconnu, en revanche, n'apprend rien de la table par un invité.
    const after = channel.of('lobby').length
    channel.receive('hello', { clientId: 'inconnu', name: 'X' }, 'p-x')
    expect(channel.of('lobby').length).toBe(after)
    guest.destroy(true)
  })

  it("oublie les coups en attente quand on refait le lien", async () => {
    vi.useRealTimers()
    const channel = fakeRoom()
    const guest = Session.online('ABCDEFGH', 'Camille', false, listeners(), channel.factory)
    channel.receive(
      'lobby',
      lobbyOf({
        players: [
          seat({ seat: 0, clientId: 'hote', peerId: 'p-hote' }),
          seat({ seat: 1, clientId: guest.self, peerId: 'moi-le-pair' }),
        ],
      }),
      'p-hote',
    )
    channel.receive('state', { from: 'hote', epoch: 0, round: 0, game: startedForGuest(guest) }, 'p-hote')

    guest.dispatch({ type: 'roll' })
    guest.retry()
    const sent = channel.of('intent').length

    await new Promise((resolve) => setTimeout(resolve, 1_600))
    expect(channel.of('intent').length).toBe(sent)
    guest.destroy(true)
  })
})

/** Une partie à deux sièges, fabriquée par un hôte de service. */
function startedTwoSeats() {
  const maker = Session.local('Alan', listeners())
  maker.addSeat('human')
  maker.start()
  const game = structuredClone(maker.game!)
  maker.destroy(true)
  return game
}

/** La même, avec la main donnée au siège de cet invité. */
function startedForGuest(guest: Session) {
  const game = startedTwoSeats()
  return { ...game, turn: guest.lobby.players.find((p) => p.clientId === guest.self)!.seat }
}

/**
 * Seconde revue : ce que les réparations de la passe précédente avaient
 * elles-mêmes ouvert. Toutes tournent autour de la même question — à quel
 * moment un message a le droit de changer ce que cet appareil tient pour vrai.
 */
describe("l'arbitre revenu de nulle part", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })
  afterEach(() => vi.useRealTimers())

  /** La table telle qu'un invité la connaît encore, l'hôte ayant fait F5. */
  const relayedTable = (self: string): Lobby =>
    lobbyOf({
      hostClientId: self,
      started: true,
      players: [
        seat({ seat: 0, clientId: self, name: 'Alan' }),
        seat({ seat: 1, clientId: 'ami', peerId: 'p1', name: 'Camille' }),
      ],
    })

  /**
   * Le scénario complet, de bout en bout : l'hôte recharge sa page, un invité
   * lui relaie la table, il reprend la couronne — et il faut qu'il reprenne
   * aussi la partie, sinon il acquitte les coups sans rien appliquer et la
   * table se fige sans un message d'erreur.
   */
  it("reprend la main ET l'état après un rechargement de page", () => {
    const channel = fakeRoom()
    // Ce que fait l'app au rechargement : une session invitée, salon vide.
    const host = Session.online('ABCDEFGH', 'Alan', false, listeners(), channel.factory)
    expect(host.isHost).toBe(false)
    expect(host.game).toBeNull()

    channel.receive('lobby', relayedTable(host.self), 'p1')
    expect(host.isHost).toBe(true)

    const game = { ...startedTwoSeats(), seq: 7, turn: 1 as const }
    channel.receive('state', { from: 'ami', epoch: 0, round: 0, game }, 'p1')
    expect(host.game?.seq).toBe(7)

    channel.receive(
      'intent',
      { clientId: 'ami', epoch: 0, action: { type: 'roll' }, seq: 7, nonce: 'n-1' },
      'p1',
    )
    const ack = channel.of('ack').at(-1)!.data as { ok: boolean }
    expect(ack.ok).toBe(true)
    expect(host.game!.seq).toBeGreaterThan(7)
    host.destroy(true)
  })

  it("n'acquitte pas un coup qu'il n'a pas pu appliquer", () => {
    const channel = fakeRoom()
    const host = Session.online('ABCDEFGH', 'Alan', false, listeners(), channel.factory)
    channel.receive('lobby', relayedTable(host.self), 'p1')

    channel.receive(
      'intent',
      { clientId: 'ami', epoch: 0, action: { type: 'roll' }, seq: 3, nonce: 'n-vide' },
      'p1',
    )
    const ack = channel.of('ack').at(-1)!.data as { ok: boolean; error?: string }
    expect(ack.ok).toBe(false)
    expect(ack.error).toBe('noGame')
    host.destroy(true)
  })

  it("renvoie son état à l'arbitre dont le battement a tout oublié", () => {
    const { channel, guest, lobby } = seatedGuest()
    channel.receive('lobby', { ...structuredClone(lobby), started: true }, 'p-hote')
    channel.receive(
      'state',
      { from: 'hote', epoch: 0, round: 0, game: { ...startedTwoSeats(), seq: 9 } },
      'p-hote',
    )
    expect(guest.game!.seq).toBe(9)

    const before = channel.of('state').length
    channel.receive('tick', { from: 'hote', epoch: 0, seq: -1, at: Date.now() }, 'p-hote')
    expect(channel.of('state').length).toBe(before + 1)
    expect(channel.of('state').at(-1)!.to).toBe('p-hote')

    // Un battement à jour, lui, ne déclenche rien : la table ne se rediffuse
    // pas à l'arbitre toutes les deux secondes.
    const after = channel.of('state').length
    channel.receive('tick', { from: 'hote', epoch: 0, seq: 9, at: Date.now() }, 'p-hote')
    expect(channel.of('state').length).toBe(after)
    guest.destroy(true)
  })

  /** Une époque inventée ne fait pas un arbitre. */
  it("n'adopte pas l'état d'un pair qui s'invente un règne", () => {
    const { channel, guest, lobby } = seatedGuest()
    channel.receive('lobby', { ...structuredClone(lobby), started: true }, 'p-hote')
    channel.receive(
      'state',
      { from: 'hote', epoch: 0, round: 0, game: { ...startedTwoSeats(), seq: 4 } },
      'p-hote',
    )

    channel.receive(
      'state',
      { from: 'inconnu', epoch: 100, round: 0, game: { ...startedTwoSeats(), seq: 9999 } },
      'p-inconnu',
    )
    expect(guest.game!.seq).toBe(4)
    guest.destroy(true)
  })

  /**
   * Le salon qu'on relaie est une photo, et elle peut dater : celle où l'hôte
   * était parti et où un bot tenait son siège. La lui renvoyer telle quelle, à
   * la seconde où il revient, c'est lui annoncer qu'il a été remplacé.
   */
  it('ne relaie pas un salon qui enterre celui qui revient', () => {
    const { channel, guest } = seatedGuest()
    channel.receive(
      'lobby',
      lobbyOf({
        players: [
          seat({ seat: 0, clientId: 'hote', peerId: null, connected: false, botFill: true }),
          seat({ seat: 1, clientId: guest.self, peerId: 'moi-le-pair' }),
        ],
      }),
      'p-hote',
    )

    channel.receive('hello', { clientId: 'hote', name: 'Alan' }, 'p-hote-2')
    const sent = channel.of('lobby').at(-1)!.data as Lobby
    const him = sent.players.find((p) => p.clientId === 'hote')!
    expect(him.connected).toBe(true)
    expect(him.botFill).toBe(false)
    expect(him.peerId).toBe('p-hote-2')
    guest.destroy(true)
  })

  /**
   * Un téléphone qui dort soixante secondes renvoie le pong du battement
   * d'avant : sans borne, l'hôte en déduisait deux minutes d'aller-retour et
   * n'osait plus faire sauter aucun tour.
   */
  it("ne laisse pas un pong en retard dilater la marge de l'arbitre", () => {
    const { host, channel } = onlineTable()
    host.start()
    host.game = { ...host.game!, turn: 1 }
    channel.receive('pong', { clientId: 'ami', at: Date.now() - 60_000 }, 'p1')

    channel.leave('p1')
    vi.advanceTimersByTime(TURN_MS + 3 * TURN_GRACE_MS + 200)
    expect(host.game!.turn).not.toBe(1)
    host.destroy(true)
  })

  it('renvoie la table à un arbitre concurrent du même règne', () => {
    const { channel, guest } = seatedGuest()
    const before = channel.of('lobby').length

    channel.receive('tick', { from: 'usurpateur', epoch: 0, seq: 0, at: 1 }, 'p-u')

    expect(channel.of('lobby').length).toBe(before + 1)
    expect(channel.of('lobby').at(-1)!.to).toBe('p-u')
    expect(channel.of('pong')).toHaveLength(0)
    guest.destroy(true)
  })

  /** Un salon sans `peerId` d'hôte ne doit pas transformer un coup en annonce. */
  it("n'envoie jamais une intention à la cantonade", () => {
    const channel = fakeRoom()
    const guest = Session.online('ABCDEFGH', 'Camille', false, listeners(), channel.factory)
    channel.receive(
      'lobby',
      lobbyOf({
        started: true,
        players: [
          seat({ seat: 0, clientId: 'hote', peerId: null }),
          seat({ seat: 1, clientId: guest.self, peerId: 'moi-le-pair' }),
        ],
      }),
      'p-hote',
    )
    channel.receive('state', { from: 'hote', epoch: 0, round: 0, game: startedForGuest(guest) }, 'p-hote')

    guest.dispatch({ type: 'roll' })
    expect(channel.of('intent').at(-1)!.to).toBe('p-hote')
    guest.destroy(true)
  })

  it("ignore une intention venue d'un autre règne", () => {
    const { host, channel } = onlineTable()
    host.start()
    host.game = { ...host.game!, turn: 1 }
    const seq = host.game.seq

    channel.receive(
      'intent',
      { clientId: 'ami', epoch: host.lobby.epoch + 1, action: { type: 'roll' }, seq, nonce: 'n-x' },
      'p1',
    )
    expect(host.game!.seq).toBe(seq)
    host.destroy(true)
  })

  it("n'écoute plus les messages de l'ancien salon", async () => {
    vi.useRealTimers()
    const first = fakeRoom()
    const second = fakeRoom()
    let opened = 0
    const factory = (() => (opened++ === 0 ? first.room : second.room)) as RoomFactory
    const guest = Session.online('ABCDEFGH', 'Camille', false, listeners(), factory)

    guest.retry()
    await vi.waitFor(() => expect(second.of('hello').length).toBeGreaterThan(0))

    first.receive('lobby', lobbyOf({ hostClientId: 'fantome' }), 'p-vieux')
    expect(guest.lobby.hostClientId).not.toBe('fantome')
    guest.destroy(true)
  })
})
