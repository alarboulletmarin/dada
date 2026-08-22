// @vitest-environment jsdom
/**
 * Composer la table dans le salon.
 *
 * En équipes, la place à table est une information de règle : les sièges 0 et 2
 * jouent contre les sièges 1 et 3, parce que ce sont les coins opposés du
 * plateau. Jusqu'ici l'ordre d'arrivée décidait des camps — le troisième à
 * cliquer jouait avec le premier, et personne ne pouvait rien y faire.
 *
 * Le geste ajouté ici ne recolle pas une étiquette « équipe » sur un joueur qui
 * n'a pas bougé : il échange deux places. C'est le même geste qui change de
 * camp et qui change de couleur, parce qu'à table c'est le même geste.
 */

import { describe, expect, it } from 'vitest'
import { t } from './i18n.ts'
import { mountApp, setupDom, type Ui } from './test-dom.ts'

setupDom()

/** Accueil → « Un seul téléphone » → la variante → le salon, rempli à quatre. */
function lobbyOfFour(variant: 'equipes' | 'petits-chevaux'): Ui {
  const ui = mountApp()
  ui.type(t('home.name.placeholder'), 'Léa')
  ui.click(t('home.local'))
  ui.click(t(`variant.${variant}.name`))
  ui.click(t('common.continue'))
  // Le salon local n'ouvre pas toujours sur le même nombre de sièges : on
  // remplit jusqu'à quatre plutôt que de compter des clics.
  while (ui.hasText(t('lobby.addBot'))) ui.click(t('lobby.addBot'))
  return ui
}

/** Les noms lus dans l'ordre des sièges, tels que le salon les montre. */
const seated = (ui: Ui): string[] =>
  ui.all('.seat input').map((el) => (el as HTMLInputElement).value)

describe('changer de place dans le salon', () => {
  it('échange deux joueurs en deux touches', () => {
    const ui = lobbyOfFour('equipes')
    expect(seated(ui)).toEqual(['Léa', 'Bot 2', 'Bot 3', 'Bot 4'])

    ui.clickLabel(t('lobby.swap', { name: 'Bot 2' }))
    ui.clickLabel(t('lobby.swap', { name: 'Bot 3' }))

    // Les noms se lisent toujours dans l'ordre des sièges : c'est cet ordre
    // qui dit les camps, et une liste qui garderait l'ordre d'arrivée
    // montrerait « Équipe A » deux fois de suite.
    expect(seated(ui)).toEqual(['Léa', 'Bot 3', 'Bot 2', 'Bot 4'])
  })

  it('change le camp de celui qu’on déplace', () => {
    const ui = lobbyOfFour('equipes')
    const teamOfName = (name: string): string | null =>
      ui.all('.seat').find((s) => s.querySelector<HTMLInputElement>('input')?.value === name)
        ?.dataset.team ?? null

    expect(teamOfName('Léa')).toBe(teamOfName('Bot 3'))

    ui.clickLabel(t('lobby.swap', { name: 'Bot 2' }))
    ui.clickLabel(t('lobby.swap', { name: 'Bot 3' }))

    expect(teamOfName('Léa')).toBe(teamOfName('Bot 2'))
    expect(teamOfName('Léa')).not.toBe(teamOfName('Bot 3'))
  })

  it('repose le joueur qu’on avait pris, si on le retouche', () => {
    const ui = lobbyOfFour('equipes')

    ui.clickLabel(t('lobby.swap', { name: 'Bot 2' }))
    // Le bouton du siège soulevé ne dit plus la même chose : c'est lui qui le
    // repose, et son étiquette le dit plutôt que de répéter « changer de place ».
    ui.clickLabel(t('lobby.swap.cancel', { name: 'Bot 2' }))

    expect(seated(ui)).toEqual(['Léa', 'Bot 2', 'Bot 3', 'Bot 4'])
    // Le salon ne reste pas en attente d'une seconde touche qui ne viendra pas.
    expect(ui.hasText(t('lobby.swap.hint'))).toBe(false)
  })

  it('dit ce qu’il attend entre les deux touches', () => {
    const ui = lobbyOfFour('equipes')

    ui.clickLabel(t('lobby.swap', { name: 'Bot 2' }))

    expect(ui.hasText(t('lobby.swap.hint'))).toBe(true)
  })

  it('sert aussi hors équipes — c’est la couleur qu’on y choisit', () => {
    const ui = lobbyOfFour('petits-chevaux')

    ui.clickLabel(t('lobby.swap', { name: 'Léa' }))
    ui.clickLabel(t('lobby.swap', { name: 'Bot 4' }))

    expect(seated(ui)).toEqual(['Bot 4', 'Bot 2', 'Bot 3', 'Léa'])
  })

  it('repose tout seul un joueur qui quitte la table pendant qu’on le tient', () => {
    const ui = lobbyOfFour('equipes')

    ui.clickLabel(t('lobby.swap', { name: 'Bot 2' }))
    ui.clickLabel(t('lobby.remove', { name: 'Bot 2' }))

    // Sans quoi le salon attendrait une seconde touche pour un joueur qui
    // n'est plus là, et la phrase resterait à l'écran sans rien désigner.
    expect(ui.hasText(t('lobby.swap.hint'))).toBe(false)
  })

  it('ne propose rien quand il n’y a personne avec qui échanger', () => {
    const ui = lobbyOfFour('equipes')
    for (const name of ['Bot 2', 'Bot 3', 'Bot 4']) {
      ui.clickLabel(t('lobby.remove', { name }))
    }

    // Un seul siège : « échanger » n'a plus de deuxième terme, et un bouton
    // qui ne peut rien faire est un bouton qui ment.
    expect(seated(ui)).toEqual(['Léa'])
    expect(ui.find('.seat__swap')).toBeNull()
  })
})
