/**
 * Qui est assis où — et donc, en équipes, qui joue avec qui.
 *
 * L'équipe n'est pas un champ du joueur : c'est la parité de son siège
 * (`teamOf`, dans le moteur), parce que sur le plateau les coéquipiers sont les
 * deux coins opposés. Changer d'équipe, c'est donc changer de place à table —
 * et non recoller une étiquette sur un joueur qui n'a pas bougé.
 *
 * `swapSeats` est l'unique geste qui le permet : deux joueurs échangent leur
 * siège, avec ce qui va avec (leur couleur, leur coin, leur camp). Tout le
 * reste — le nom, le portrait, l'appareil qui tient le siège — suit la
 * personne, pas la place.
 */

import { describe, expect, it, vi } from 'vitest'
import { teamOf } from '../game/engine.ts'
import type { Seat } from '../game/types.ts'
import { Session, type Notice, type SessionListeners } from './session.ts'

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

const said: Notice[] = []

const listeners = (): SessionListeners => ({
  onChange: vi.fn(),
  onError: (notice) => void said.push(notice),
  onChat: vi.fn(),
})

/** Une table locale de `seats` sièges, réglée sur la variante donnée. */
const table = (variantId: string, seats: number): Session => {
  said.length = 0
  const session = Session.local('Léa', listeners())
  session.setVariant(variantId)
  for (let i = 1; i < seats; i++) session.addSeat('bot', `Bot ${i + 1}`)
  return session
}

/** Le nom assis à cette place, pour lire une table d'un coup d'œil. */
const nameAt = (session: Session, seat: Seat): string | undefined =>
  session.lobby.players.find((p) => p.seat === seat)?.name

describe('Session.swapSeats', () => {
  it('échange les deux places, et rien d’autre', () => {
    const session = table('equipes', 4)
    const before = session.lobby.players.find((p) => p.seat === 1)!
    const face = before.face

    session.swapSeats(1, 2)

    expect(nameAt(session, 1)).toBe('Bot 3')
    expect(nameAt(session, 2)).toBe('Bot 2')
    // Le portrait suit la personne : c'est le sien, pas celui de la place.
    expect(session.lobby.players.find((p) => p.name === 'Bot 2')!.face).toBe(face)
  })

  it('change de camp celui qui change de place', () => {
    const session = table('equipes', 4)

    expect(teamOf(1)).not.toBe(teamOf(2))
    session.swapSeats(1, 2)

    // Léa tient toujours le siège 0 ; son partenaire, le siège 2, a changé de tête.
    expect(nameAt(session, 0)).toBe('Léa')
    expect(nameAt(session, 2)).toBe('Bot 2')
  })

  it('suit l’hôte quand c’est lui qui bouge', () => {
    const session = table('equipes', 4)

    session.swapSeats(0, 1)

    expect(nameAt(session, 1)).toBe('Léa')
    expect(session.hostSeat).toBe(1)
  })

  it('ne fait rien sur une place vide', () => {
    const session = table('petits-chevaux', 2)

    session.swapSeats(0, 3)

    expect(nameAt(session, 0)).toBe('Léa')
    expect(session.lobby.players).toHaveLength(2)
  })

  it('ne fait rien quand on échange un siège avec lui-même', () => {
    const session = table('equipes', 4)
    const onChange = session.lobby.players.length

    session.swapSeats(2, 2)

    expect(nameAt(session, 2)).toBe('Bot 3')
    expect(session.lobby.players).toHaveLength(onChange)
  })

  it('ne bouge plus personne une fois la partie lancée', () => {
    const session = table('equipes', 4)
    session.start()

    session.swapSeats(1, 2)

    expect(nameAt(session, 1)).toBe('Bot 2')
    expect(nameAt(session, 2)).toBe('Bot 3')
  })
})
