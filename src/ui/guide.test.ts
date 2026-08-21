import { describe, expect, it } from 'vitest'
import { Guide, gestureOf, guideForDraw, type GuideStore } from './guide.ts'

/** Un `localStorage` de poche : les tests tournent sans DOM (voir `vite.config.ts`). */
function memory(initial: string | null = null): GuideStore & { value: string | null } {
  return {
    value: initial,
    read() {
      return this.value
    },
    write(v: string) {
      this.value = v
    },
    clear() {
      this.value = null
    },
  }
}

describe('ce que l’appareil a déjà vu', () => {
  it('montre une feuille une fois, et plus jamais', () => {
    const guide = new Guide(memory())
    expect(guide.claim('squares')).toBe(true)
    expect(guide.claim('squares')).toBe(false)
  })

  // Une feuille montrée à l'écran mais oubliée par le stockage reviendrait à
  // chaque partie : c'est le seul défaut pire que ne rien expliquer.
  it('retient ce qui a été montré, d’une session à l’autre', () => {
    const store = memory()
    new Guide(store).claim('bonus')
    expect(new Guide(store).claim('bonus')).toBe(false)
  })

  it('garde les quatre feuilles indépendantes', () => {
    const guide = new Guide(memory())
    guide.claim('bonus')
    expect(guide.claim('malus')).toBe(true)
    expect(guide.claim('full')).toBe(true)
  })

  // La feuille peut attendre que le tour ne soit plus le nôtre : entre la
  // demande et l'ouverture, elle ne doit surtout pas être comptée comme vue.
  it('sépare « déjà montré » de « demandé »', () => {
    const guide = new Guide(memory())
    expect(guide.seen('malus')).toBe(false)
    guide.claim('malus')
    expect(guide.seen('malus')).toBe(true)
  })

  it('sait qu’il n’y a rien à revoir tant que rien n’a été vu', () => {
    const guide = new Guide(memory())
    expect(guide.untouched).toBe(true)
    guide.claim('squares')
    expect(guide.untouched).toBe(false)
  })

  it('oublie tout, et les feuilles reviennent', () => {
    const store = memory()
    const guide = new Guide(store)
    guide.claim('squares')
    guide.forget()
    expect(store.value).toBeNull()
    expect(guide.claim('squares')).toBe(true)
  })

  // Une clé de version précédente, un stockage bricolé à la main : on ignore ce
  // qu'on ne reconnaît pas plutôt que de refuser d'expliquer quoi que ce soit.
  it('ignore ce qu’il ne reconnaît pas', () => {
    const guide = new Guide(memory('squares,tutoriel,,bonus'))
    expect(guide.claim('squares')).toBe(false)
    expect(guide.claim('bonus')).toBe(false)
    expect(guide.claim('malus')).toBe(true)
  })
})

describe('quelle feuille pour quel tirage', () => {
  it('n’explique qu’à celui qui ramasse', () => {
    expect(guideForDraw('bouclier', { mine: false, lost: false })).toBeNull()
    expect(guideForDraw('fauxpas', { mine: false, lost: false })).toBeNull()
  })

  it('distingue le bonus gardé du malus subi', () => {
    expect(guideForDraw('bouclier', { mine: true, lost: false })).toBe('bonus')
    expect(guideForDraw('des', { mine: true, lost: false })).toBe('bonus')
    expect(guideForDraw('fauxpas', { mine: true, lost: false })).toBe('malus')
    expect(guideForDraw('ecurie', { mine: true, lost: false })).toBe('malus')
  })

  // La main pleine passe devant le bonus : c'est le cas qu'il faut expliquer,
  // puisque la carte n'entre pas dans la main et que rien ne le dit.
  it('met la main pleine devant tout le reste', () => {
    expect(guideForDraw('bouclier', { mine: true, lost: true })).toBe('full')
  })
})

describe('le geste qui reste à faire', () => {
  it('sépare le cheval, le dé et le nombre demandé', () => {
    expect(gestureOf('bouclier')).toBe('pawn')
    expect(gestureOf('galop')).toBe('pawn')
    expect(gestureOf('rejeu')).toBe('roll')
    // Un lancer nu gaspillerait le dé pipé : l'écran le refuse, la phrase le dit.
    expect(gestureOf('des')).toBe('boost')
  })
})
