/**
 * Une table en équipes se lance à quatre, ou ne se lance pas.
 *
 * `createGame` LÈVE si `variant.teams` et que la table n'a pas exactement
 * quatre sièges — c'est le bon choix côté moteur : une équipe de un contre une
 * équipe de deux n'est pas une variante, c'est un handicap. Mais une exception
 * qui remonte jusqu'à l'écran, c'est une partie qui disparaît sans un mot.
 *
 * Le bouton du salon reste donc éteint, ET la session refuse : les deux, parce
 * qu'un bouton n'est qu'un bouton. Un salon rouvert d'un lien, une variante
 * changée alors que des sièges sont déjà là, un appel programmatique — il y a
 * plus de chemins vers `start()` que d'endroits où l'on peut griser un bouton.
 */

import { describe, expect, it, vi } from 'vitest'
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

/** Ce que la session a eu à dire, pour pouvoir vérifier qu'elle a dit quelque chose. */
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

describe('Session.start en équipes', () => {
  it('ne fabrique rien à trois sièges, et le dit', () => {
    const session = table('equipes', 3)

    expect(() => session.start()).not.toThrow()
    expect(session.game).toBeNull()
    expect(session.lobby.started).toBe(false)
    // Un refus muet se lit comme un bouton cassé : celui-ci se nomme, et
    // l'écran le rend avec le texte du salon (`lobby.needFour`).
    expect(said).toEqual([{ code: 'teamsNeedFour' }])
  })

  it('lance à quatre', () => {
    const session = table('equipes', 4)

    session.start()
    expect(session.game).not.toBeNull()
    expect(session.game!.variant.teams).toBe(true)
    expect(session.lobby.started).toBe(true)
    expect(said).toEqual([])
  })

  // Le garde ne vaut que pour les équipes : partout ailleurs, deux suffisent.
  it('laisse les autres variantes se lancer à deux', () => {
    const session = table('ludo', 2)

    session.start()
    expect(session.game).not.toBeNull()
    expect(session.lobby.started).toBe(true)
  })
})
