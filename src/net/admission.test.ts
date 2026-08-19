import { describe, expect, it } from 'vitest'
import { canAdmit, welcomeFor, type Admission } from './admission.ts'
import type { Lobby, LobbyPlayer } from './room.ts'
import type { Seat } from '../game/types.ts'

const seat = (n: Seat, clientId: string): LobbyPlayer => ({
  seat: n,
  name: `J${n + 1}`,
  clientId,
  peerId: `peer-${clientId}`,
  kind: 'human',
  connected: true,
  botFill: false,
})

const lobbyOf = (players: LobbyPlayer[], started = false): Lobby => ({
  code: 'ABCDEFGH',
  hostClientId: 'hote',
  variantId: 'petits-chevaux',
  players,
  started,
})

const state = (over: Partial<Admission> = {}): Admission => ({
  lobby: lobbyOf([seat(0, 'hote')]),
  refused: new Set<string>(),
  pending: new Set<string>(),
  maxSeats: 4,
  ...over,
})

describe('qui entre dans le salon', () => {
  it("demande l'accord de l'hôte pour un appareil inconnu", () => {
    expect(welcomeFor(state(), 'inconnu')).toEqual({ kind: 'ask' })
  })

  // C'est la règle qui compte le plus : un rechargement de page, un tunnel, une
  // batterie à plat. Redemander l'accord au milieu d'une partie serait une porte
  // qui claque dans le dos.
  it('rend son siège sans rien demander à qui en a déjà un', () => {
    const lobby = lobbyOf([seat(0, 'hote'), seat(1, 'ami')])
    expect(welcomeFor(state({ lobby }), 'ami')).toEqual({ kind: 'reclaim' })
  })

  it('rend son siège même à un appareil autrefois refusé', () => {
    // L'hôte a pu changer d'avis et l'inviter depuis : le siège attribué
    // l'emporte sur le souvenir d'un refus.
    const lobby = lobbyOf([seat(0, 'hote'), seat(1, 'repenti')])
    const refused = new Set(['repenti'])
    expect(welcomeFor(state({ lobby, refused }), 'repenti')).toEqual({ kind: 'reclaim' })
  })

  it('ne redemande pas à l’hôte pour un appareil déjà refusé', () => {
    const refused = new Set(['importun'])
    expect(welcomeFor(state({ refused }), 'importun')).toEqual({ kind: 'refused' })
  })

  it('laisse regarder quand la partie est lancée', () => {
    const lobby = lobbyOf([seat(0, 'hote')], true)
    expect(welcomeFor(state({ lobby }), 'retardataire')).toEqual({ kind: 'watch' })
  })

  it('laisse regarder quand la table est pleine', () => {
    const lobby = lobbyOf([seat(0, 'a'), seat(1, 'b'), seat(2, 'c'), seat(3, 'd')])
    expect(welcomeFor(state({ lobby }), 'cinquieme')).toEqual({ kind: 'watch' })
  })

  it('ne pose pas deux fois la même demande', () => {
    const pending = new Set(['insistant'])
    expect(welcomeFor(state({ pending }), 'insistant')).toEqual({ kind: 'ask' })
  })
})

/**
 * Entre le moment où l'hôte voit « X veut rejoindre » et celui où il appuie sur
 * « Accepter », la table a pu changer. Accepter dans le vide donnerait un siège
 * fantôme, occupé par personne et impossible à libérer.
 */
describe('accorder une place', () => {
  it('accepte une demande en attente sur une table ouverte', () => {
    expect(canAdmit(state({ pending: new Set(['ami']) }), 'ami')).toBe(true)
  })

  it("refuse d'accorder une place jamais demandée", () => {
    expect(canAdmit(state(), 'fantome')).toBe(false)
  })

  it('refuse si la partie a été lancée entre-temps', () => {
    const lobby = lobbyOf([seat(0, 'hote')], true)
    expect(canAdmit(state({ lobby, pending: new Set(['ami']) }), 'ami')).toBe(false)
  })

  it('refuse si la table s’est remplie entre-temps', () => {
    const lobby = lobbyOf([seat(0, 'a'), seat(1, 'b'), seat(2, 'c'), seat(3, 'd')])
    expect(canAdmit(state({ lobby, pending: new Set(['ami']) }), 'ami')).toBe(false)
  })

  it('refuse si le demandeur a déjà été assis entre-temps', () => {
    const lobby = lobbyOf([seat(0, 'hote'), seat(1, 'ami')])
    expect(canAdmit(state({ lobby, pending: new Set(['ami']) }), 'ami')).toBe(false)
  })
})
