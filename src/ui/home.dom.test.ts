// @vitest-environment jsdom
/**
 * L'accueil, pour qui arrive sans rien savoir.
 *
 * Trois boutons de la même taille ne disent pas lequel prendre : « Créer »,
 * « Rejoindre », « Un seul téléphone » sont trois phrases qui décrivent des
 * gestes, pas des situations. Ce que ces tests tiennent, c'est qu'il reste
 * sous chacun la phrase qui dit **à qui il s'adresse**, et que l'encart de
 * bienvenue s'efface à la première partie lancée — pas à sa fermeture : on ne
 * demande à personne de lire quoi que ce soit pour commencer à jouer.
 */

import { describe, expect, it } from 'vitest'
import { t } from './i18n.ts'
import { mountApp, setupDom } from './test-dom.ts'

describe('l’accueil dit à qui chaque bouton s’adresse', () => {
  setupDom()

  it('porte une ligne d’aide sous chacun des trois boutons', () => {
    const ui = mountApp()

    for (const key of ['home.create', 'home.join', 'home.local'] as const) {
      const btn = ui.byText(t(key)).closest('button')
      expect(btn, `le bouton « ${t(key)} » a perdu sa ligne d'aide`).toBeTruthy()
      expect(btn!.textContent).toContain(t(`${key}.hint` as 'home.create.hint'))
    }
  })

  it('garde chaque bouton d’un seul tenant', () => {
    const ui = mountApp()

    // Le libellé et son aide vivent DANS le bouton : deux cibles tactiles
    // côte à côte, c'est un doigt qui rate celle qui compte.
    const hint = ui.find('.btn__hint')!
    expect(hint.closest('button')).toBeTruthy()
    expect(ui.all('.btn__hint')).toHaveLength(3)
  })
})

describe('l’encart de bienvenue', () => {
  setupDom()

  it('accueille à la toute première ouverture, avec le lien du règlement', () => {
    const ui = mountApp()

    const card = ui.find('.welcome')
    expect(card, "rien n'accueille celui qui ouvre le jeu pour la première fois").toBeTruthy()
    expect(card!.textContent).toContain(t('home.welcome'))
    // « Pour essayer seul » sans dire où aller ne sert à rien.
    expect(card!.textContent).toContain(t('home.rules'))
  })

  it('ne se referme pas d’un bouton — il n’y en a pas', () => {
    const ui = mountApp()
    expect(ui.find('.welcome [aria-label]')).toBeNull()
    expect(ui.find('.overlay')).toBeNull()
  })

  it('disparaît dès qu’une partie a été lancée, sur cet appareil', () => {
    const first = mountApp()
    expect(first.find('.welcome')).toBeTruthy()

    first.type(t('home.name.placeholder'), 'Léa')
    first.click(t('home.local'))
    first.click(t('common.continue'))
    first.click(t('lobby.start'))
    expect(first.find('.play')).toBeTruthy()

    // Deuxième app, même appareil : le stockage se souvient qu'on a joué.
    const second = mountApp()
    expect(second.find('.welcome')).toBeNull()
    // Les lignes d'aide, elles, restent : elles ne s'apprennent pas par cœur.
    expect(second.all('.btn__hint')).toHaveLength(3)
  })
})
