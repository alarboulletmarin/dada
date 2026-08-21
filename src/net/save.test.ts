/**
 * Ce qu'une sauvegarde doit survivre.
 *
 * Une partie locale ne vit que là : la jeter, c'est la perdre pour de bon. Le
 * numéro de format ne doit donc monter que quand le **moteur** change — pas
 * quand le salon gagne un champ qui ne sert qu'en ligne, et qu'on sait combler.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { readSave, writeSave } from './save.ts'
import type { Lobby } from './room.ts'
import type { GameState } from '../game/types.ts'

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

const lobby: Lobby = {
  code: 'LOCAL',
  hostClientId: 'moi',
  epoch: 0,
  round: 0,
  variantId: 'petits-chevaux',
  players: [],
  started: true,
}
const game = { seq: 3, phase: 'rolling' } as unknown as GameState

describe('sauvegarde locale', () => {
  beforeEach(() => localStorage.clear())

  it('se relit telle qu’elle a été écrite', () => {
    writeSave(lobby, game)
    expect(readSave()?.game.seq).toBe(3)
  })

  /**
   * `epoch` et `round` ne servent qu'en ligne, où rien n'est sauvegardé. Une
   * partie d'avant leur apparition reste parfaitement jouable : on comble, on
   * ne jette pas.
   */
  it('comble les champs de salon qu’une version d’avant ne portait pas', () => {
    writeSave(lobby, game)
    const raw = JSON.parse(localStorage.getItem('dada.save')!) as {
      lobby: Partial<Lobby>
    }
    delete raw.lobby.epoch
    delete raw.lobby.round
    localStorage.setItem('dada.save', JSON.stringify(raw))

    const back = readSave()
    expect(back).not.toBeNull()
    expect(back!.lobby.epoch).toBe(0)
    expect(back!.lobby.round).toBe(0)
  })
})
