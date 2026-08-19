import { describe, expect, it } from 'vitest'
import { armedReady, keepArmed, needsPawn } from './aim.ts'

const HAND = ['bouclier', 'galop', 'rejeu', 'des'] as const

describe('la carte armée survit à la passe d’affichage', () => {
  /**
   * La régression qui a coûté deux bonus.
   *
   * L'écran désarmait toute carte sans cheval à viser — donc le rejeu et le dé
   * pipé, qui n'en visent aucun. Ils se rangeaient dans la milliseconde suivant
   * l'appui, restaient en main pour toujours, et finissaient par boucher la
   * main entière.
   */
  it('garde une carte qui ne vise aucun cheval', () => {
    for (const power of ['rejeu', 'des'] as const) {
      expect(keepArmed({ power }, { playable: HAND, targets: [] })).toEqual({ power })
    }
  })

  it('garde une carte qui vise un cheval, et la désignation avec', () => {
    const armed = { power: 'bouclier' as const, pawnId: 'p0-1' }
    expect(keepArmed(armed, { playable: HAND, targets: ['p0-0', 'p0-1'] })).toEqual(armed)
  })

  it('oublie une désignation périmée sans ranger la carte', () => {
    const armed = { power: 'galop' as const, pawnId: 'p0-3' }
    expect(keepArmed(armed, { playable: HAND, targets: ['p0-0'] })).toEqual({ power: 'galop' })
  })

  it('range une carte qui ne vise plus aucun cheval', () => {
    expect(keepArmed({ power: 'galop' }, { playable: HAND, targets: [] })).toBeNull()
  })

  // Le tour qui passe emporte la carte : elle n'est plus jouable, et la garder
  // armée ferait croire au joueur suivant qu'elle est à lui.
  it('range une carte qui n’est plus jouable', () => {
    expect(keepArmed({ power: 'rejeu' }, { playable: [], targets: [] })).toBeNull()
  })

  it('ne fabrique rien à partir de rien', () => {
    expect(keepArmed(null, { playable: HAND, targets: ['p0-0'] })).toBeNull()
  })
})

describe('ce que la carte réclame', () => {
  it('sait laquelle demande un cheval', () => {
    expect(needsPawn('bouclier')).toBe(true)
    expect(needsPawn('galop')).toBe(true)
    expect(needsPawn('rejeu')).toBe(false)
    expect(needsPawn('des')).toBe(false)
  })

  it('déclare prête une carte sans cible, et pas une cible manquante', () => {
    expect(armedReady(null)).toBe(false)
    expect(armedReady({ power: 'des' })).toBe(true)
    expect(armedReady({ power: 'bouclier' })).toBe(false)
    expect(armedReady({ power: 'bouclier', pawnId: 'p0-0' })).toBe(true)
  })
})
