import { describe, expect, it } from 'vitest'
import { turnServers } from './turn.ts'

describe('réglages TURN', () => {
  it('assemble les trois variables en un serveur ICE', () => {
    expect(turnServers('turn:relais.example:3478', 'moi', 'secret')).toEqual([
      { urls: ['turn:relais.example:3478'], username: 'moi', credential: 'secret' },
    ])
  })

  it('sépare les URLs sur la virgule', () => {
    expect(
      turnServers('turn:relais.example:80,turn:relais.example:443?transport=tcp', 'moi', 'secret'),
    ).toEqual([
      {
        urls: ['turn:relais.example:80', 'turn:relais.example:443?transport=tcp'],
        username: 'moi',
        credential: 'secret',
      },
    ])
  })

  it("rogne l'espace laissée par un copier-coller, jusque dans les identifiants", () => {
    expect(turnServers(' turn:relais.example:3478 , turn:relais.example:80 ', ' moi\n', 'secret ')).toEqual(
      [
        {
          urls: ['turn:relais.example:3478', 'turn:relais.example:80'],
          username: 'moi',
          credential: 'secret',
        },
      ],
    )
  })

  it("jette l'entrée vide qu'une virgule finale laisse derrière elle", () => {
    // Une chaîne vide dans `urls` fait lever `RTCPeerConnection` à la
    // construction : ce n'est pas le TURN qui tomberait, c'est toute la partie.
    expect(turnServers('turn:relais.example:3478,', 'moi', 'secret')).toEqual([
      { urls: ['turn:relais.example:3478'], username: 'moi', credential: 'secret' },
    ])
  })

  it('se tait quand une des trois variables manque', () => {
    expect(turnServers(undefined, 'moi', 'secret')).toBeUndefined()
    expect(turnServers('turn:relais.example:3478', undefined, 'secret')).toBeUndefined()
    expect(turnServers('turn:relais.example:3478', 'moi', undefined)).toBeUndefined()
  })

  it('se tait quand une variable est renseignée mais vide', () => {
    expect(turnServers('  ', 'moi', 'secret')).toBeUndefined()
    expect(turnServers(',', 'moi', 'secret')).toBeUndefined()
    expect(turnServers('turn:relais.example:3478', ' ', 'secret')).toBeUndefined()
  })
})
