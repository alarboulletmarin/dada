import { describe, expect, it } from 'vitest'
import { DISMISS_PX, dismisses, isTap, isVertical, pull, TAP_PX } from './swipe.ts'

describe('ce qui chasse un élément, et ce qui ne le chasse pas', () => {
  it('chasse dès que le doigt a poussé assez loin, même lentement', () => {
    expect(dismisses(DISMISS_PX, 1200)).toBe(true)
    expect(dismisses(-DISMISS_PX, 1200)).toBe(true)
  })

  // La chiquenaude sèche ne parcourt que vingt pixels et ne veut clairement pas
  // dire autre chose. N'écouter que la distance l'ignorerait.
  it('chasse sur une chiquenaude courte et rapide', () => {
    expect(dismisses(22, 40)).toBe(true)
    expect(dismisses(-22, 40)).toBe(true)
  })

  it('ne chasse pas sur un glissement court et lent', () => {
    expect(dismisses(20, 600)).toBe(false)
  })

  // Sans plancher, le moindre frémissement du doigt sur un écran tactile —
  // trois pixels en cinq millisecondes — passerait pour une chiquenaude.
  it('ne prend pas un tremblement pour une chiquenaude', () => {
    expect(dismisses(4, 5)).toBe(false)
    expect(dismisses(0, 0)).toBe(false)
  })
})

describe('la nature du geste', () => {
  it('reconnaît un appui immobile', () => {
    expect(isTap(0, 0)).toBe(true)
    expect(isTap(3, 3)).toBe(true)
    expect(isTap(TAP_PX, TAP_PX)).toBe(false)
  })

  // Un geste horizontal appartient à la page, pas à l'élément posé dessus.
  it('rend l’horizontal au navigateur', () => {
    expect(isVertical(40, 5)).toBe(false)
    expect(isVertical(5, 40)).toBe(true)
    // À égalité on tranche pour le vertical : un geste de biais doit marcher.
    expect(isVertical(20, 20)).toBe(true)
  })
})

describe('le sens autorisé', () => {
  it('suit le doigt dans le bon sens', () => {
    expect(pull(-30, 'up')).toBe(-30)
    expect(pull(30, 'down')).toBe(30)
    expect(pull(30, 'any')).toBe(30)
    expect(pull(-30, 'any')).toBe(-30)
  })

  // Figé, on croit l'interface bloquée ; libre, on croit qu'il va partir par là.
  it('amortit le sens qui ne mène nulle part', () => {
    expect(pull(40, 'up')).toBe(10)
    expect(pull(-40, 'down')).toBe(-10)
  })
})
