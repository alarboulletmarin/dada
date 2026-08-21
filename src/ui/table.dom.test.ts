// @vitest-environment jsdom
/**
 * Les écrans, montés pour de vrai, sur un seul téléphone.
 *
 * Ce que ces tests couvrent n'est pas « le rendu est joli » — c'est le
 * **parcours** : les quatre écrans s'enchaînent-ils, ce qu'on tape survit-il à
 * ce qui redessine, et les choses qui n'apparaissent qu'une fois par appareil
 * apparaissent-elles exactement une fois. Trois relectures avaient conclu que
 * oui ; personne ne l'avait jamais exécuté.
 *
 * Aucun instantané : un instantané dit « quelque chose a changé », jamais
 * « quelque chose est cassé », et cette interface change à chaque commit.
 */

import { describe, expect, it, vi } from 'vitest'
import { POWER_LIST } from '../game/powers.ts'
import { flyCard } from './cardfly.ts'
import { t } from './i18n.ts'
import { mountApp, setReducedMotion, setupDom, vibrations, type Ui } from './test-dom.ts'
import { readTheme } from './theme.ts'

/** Le nom du champ de prénom sert d'étiquette : c'est ainsi qu'on le vise. */
const NAME_FIELD = () => t('home.name.placeholder')

/** Accueil → « Un seul téléphone » → salon local, prêt à lancer. */
function openLocalLobby(name = 'Léa'): Ui {
  const ui = mountApp()
  ui.type(NAME_FIELD(), name)
  ui.click(t('home.local'))
  ui.click(t('common.continue'))
  return ui
}

describe('le parcours jusqu’au plateau', () => {
  setupDom()

  it('mène de l’accueil au plateau, avec un bot de plus', () => {
    const ui = openLocalLobby()

    // Le salon s'ouvre déjà avec un bot en face : on ne joue pas tout seul.
    expect(ui.screen()).toContain(t('lobby.title'))
    expect(ui.all('.seat').filter((s) => !s.classList.contains('empty'))).toHaveLength(2)

    ui.click(t('lobby.addBot'))
    expect(ui.all('.seat').filter((s) => !s.classList.contains('empty'))).toHaveLength(3)

    ui.click(t('lobby.start'))

    expect(ui.find('.play')).toBeTruthy()
    expect(ui.find('.turnline')).toBeTruthy()
    expect(ui.find('.dice-row .dice')).toBeTruthy()
    // C'est nous qui ouvrons, et le dé nous attend.
    expect(ui.screen()).toContain(t('play.yourTurn'))
    expect((ui.find('.dice') as HTMLButtonElement).disabled).toBe(false)
  })

  it('garde le prénom tapé quand le thème change', () => {
    const ui = mountApp()
    ui.type(NAME_FIELD(), 'Ana')

    const [theme] = ui.all('.settings button')
    theme!.click()

    expect(readTheme()).not.toBe('auto')
    expect(document.documentElement.getAttribute('data-theme')).toBe(readTheme())
    expect((ui.byLabel(NAME_FIELD()) as HTMLInputElement).value).toBe('Ana')
  })

  it('garde le prénom tapé quand la langue change', () => {
    const ui = mountApp()
    ui.type(NAME_FIELD(), 'Ana')

    const [, language] = ui.all('.settings button')
    language!.click()

    // L'écran a bien basculé — et le champ, lui, n'a pas bougé.
    expect(ui.screen()).toContain(t('home.local'))
    expect(t('home.local')).toBe('One phone only')
    expect((ui.byLabel(NAME_FIELD()) as HTMLInputElement).value).toBe('Ana')
  })

  it('propose un prénom déjà rempli sur l’écran « Rejoindre »', () => {
    const ui = mountApp()
    ui.type(NAME_FIELD(), 'Camille')
    ui.click(t('home.join'))

    // Sans ce champ, tous ceux qui arrivent par un lien s'asseyent « Joueur ».
    const field = ui.byLabel(NAME_FIELD()) as HTMLInputElement
    expect(field.value).toBe('Camille')
    expect(ui.byLabel(t('join.code.label'))).toBeTruthy()
  })
})

describe('l’anneau du temps de réflexion', () => {
  setupDom()

  it('entoure le dé pendant notre tour, et se vide', async () => {
    const ui = openLocalLobby()
    ui.click(t('lobby.start'))

    const ring = ui.find('.dieclock')!
    await ui.advance(50)
    expect(ring.classList.contains('on')).toBe(true)
    const first = Number(ring.style.getPropertyValue('--left'))
    expect(first).toBeGreaterThan(0.9)

    await ui.advance(3000)
    const later = Number(ring.style.getPropertyValue('--left'))
    expect(later).toBeLessThan(first)
    expect(later).toBeGreaterThan(0.5)
  })

  it('s’éteint dès que le tour n’est plus le nôtre', async () => {
    const ui = openLocalLobby()
    ui.click(t('lobby.start'))

    const ring = ui.find('.dieclock')!
    await ui.advance(50)
    expect(ring.classList.contains('on')).toBe(true)

    // Dix secondes sans rien toucher : le tour passe au bot, et ce n'est plus
    // notre temps qui s'écoule.
    await ui.advance(10_200)
    expect(ui.screen()).not.toContain(t('play.yourTurn'))
    expect(ring.classList.contains('on')).toBe(false)
  })

  it('fait vibrer le téléphone une fois, aux trois dernières secondes', async () => {
    const ui = openLocalLobby()
    ui.click(t('lobby.start'))

    await ui.advance(6500)
    expect(vibrations()).toHaveLength(0)

    // Un rappel, pas une alarme : le drapeau ne retombe qu'au tour suivant.
    await ui.advance(1000)
    expect(vibrations()).toHaveLength(1)
    await ui.advance(1000)
    expect(vibrations()).toHaveLength(1)
  })
})

describe('la feuille de guidage des cases marquées', () => {
  setupDom()

  /** Un salon local avec les cases pouvoir allumées, puis la partie lancée. */
  const playWithPowers = (): Ui => {
    const ui = openLocalLobby()
    ui.clickLabel(t('table.powers'))
    ui.click(t('lobby.start'))
    return ui
  }

  it('s’ouvre à la première partie avec pouvoirs, et jamais à la seconde', () => {
    const first = playWithPowers()
    expect(first.find('.overlay.guide')).toBeTruthy()
    expect(first.screen()).toContain(t('guide.squares.title'))

    // On a lu, on repart.
    first.click(t('guide.got'))
    expect(first.find('.overlay.guide')).toBeNull()

    // Deuxième partie sur le même appareil : le stockage se souvient.
    const second = playWithPowers()
    expect(second.find('.overlay.guide')).toBeNull()
  })

  it('ne dit rien d’une table sans cases pouvoir', () => {
    const ui = openLocalLobby()
    ui.click(t('lobby.start'))
    expect(ui.find('.overlay.guide')).toBeNull()
  })

  it('revient après « Revoir les explications »', () => {
    const first = playWithPowers()
    first.click(t('guide.got'))

    // Le catalogue des cartes, ouvert depuis le salon de la partie suivante :
    // c'est là qu'on se pose la question, donc c'est là qu'est le bouton.
    const again = openLocalLobby()
    again.clickLabel(t('table.powers'))
    again.click(t('table.powers.see', { n: POWER_LIST.length }))
    expect(again.find('.overlay.powers')).toBeTruthy()
    again.click(t('guide.again'))

    const third = playWithPowers()
    expect(third.find('.overlay.guide')).toBeTruthy()
    expect(third.screen()).toContain(t('guide.squares.title'))
  })
})

describe('« mouvement réduit »', () => {
  setupDom()

  const square = (): DOMRect => new DOMRect(10, 10, 20, 20)
  const flight = {
    kind: 'bonus' as const,
    face: { glyph: 'gallop' as const, name: 'Galop' },
    from: square,
    to: square,
  }

  it('ne fait voler aucune carte au tirage', async () => {
    setReducedMotion(true)
    let arrived = false

    const done = flyCard({ ...flight, onArrive: () => (arrived = true) })
    await vi.advanceTimersByTimeAsync(3000)
    await done

    // On saute à l'état final : la carte est arrivée, elle n'a jamais volé.
    expect(document.querySelector('.cardfly')).toBeNull()
    expect(document.querySelector('.cardfly-layer')).toBeNull()
    expect(arrived).toBe(true)
  })

  it('la fait voler quand rien ne l’en empêche', async () => {
    const done = flyCard(flight)
    await vi.advanceTimersByTimeAsync(100)
    expect(document.querySelector('.cardfly')).toBeTruthy()

    await vi.advanceTimersByTimeAsync(3000)
    await done
    expect(document.querySelector('.cardfly')).toBeNull()
  })
})
