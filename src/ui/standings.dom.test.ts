// @vitest-environment jsdom
/**
 * Le palmarès, du plateau jusqu'à l'accueil.
 *
 * Le registre lui-même a ses tests (`net/ledger.test.ts`, `net/session.ledger.test.ts`) :
 * ici on ne vérifie qu'une chose, mais c'est celle qui compte pour qui joue —
 * **une partie terminée finit-elle par se voir ?** Elle traverse le moteur, la
 * session, `localStorage`, l'accueil et deux écrans avant d'y arriver, et
 * chacune de ces marches s'est déjà cassée toute seule ailleurs.
 */

import { describe, expect, it } from 'vitest'
import type { Hello } from '../net/room.ts'
import { t } from './i18n.ts'
import {
  finish,
  gameOf,
  lobbyOf,
  mountApp,
  seatOf,
  setupDom,
  stateOf,
  type Ui,
} from './test-dom.ts'
import { lastRoom, type FakeChannel } from './test-room.ts'

const CODE = 'ABCDEFGH'

/**
 * Une partie en ligne jouée jusqu'au bout, et le retour à l'accueil.
 *
 * `round` distingue deux soirées : c'est ce que fait une revanche, et c'est ce
 * qui empêche les deux parties de n'en faire qu'une au registre.
 */
function played(round: number, name = 'Camille'): { ui: Ui; channel: FakeChannel } {
  const ui = mountApp()
  ui.type(t('home.name.placeholder'), name)
  ui.click(t('home.join'))
  ui.type(t('join.code.label'), CODE)
  ui.click(t('join.action'))

  const channel = lastRoom()
  channel.join('p-hote')
  const self = (channel.of('hello')[0]?.data as Hello).clientId

  const lobby = lobbyOf({
    hostClientId: 'hote',
    started: true,
    round,
    players: [
      seatOf({ seat: 0, clientId: 'hote', peerId: 'p-hote', name: 'Alan' }),
      seatOf({ seat: 1, clientId: self, peerId: 'moi-le-pair', name }),
    ],
  })
  channel.receive('lobby', structuredClone(lobby), 'p-hote')
  channel.receive('state', stateOf(lobby, gameOf(lobby, self)), 'p-hote')
  channel.receive('state', stateOf(lobby, finish(gameOf(lobby, self), 0)), 'p-hote')

  return { ui, channel }
}

describe('le palmarès sur l’accueil', () => {
  setupDom()

  /**
   * Un accueil de premier soir n'a pas à grandir d'un bouton qui ne mène qu'à
   * une page vide.
   */
  it('ne se propose pas tant qu’il n’y a rien dedans', () => {
    const ui = mountApp()
    expect(ui.hasText(t('standings.open'))).toBe(false)
  })

  it('apparaît tout seul au retour de la première partie', () => {
    const { ui } = played(0)
    expect(ui.find('.overlay.podium')).toBeTruthy()

    ui.click(t('win.home'))

    expect(ui.hasText(t('standings.open'))).toBe(true)
  })

  it('dit qui a gagné, et combien de fois', () => {
    const { ui } = played(0)
    ui.click(t('win.home'))
    ui.click(t('standings.open'))

    expect(ui.screen()).toContain(t('standings.title'))
    expect(ui.screen()).toContain('Alan')
    expect(ui.byLabel(t('standings.wins.one'))).toBeTruthy()
    // Le perdant est du palmarès lui aussi : il a joué une partie.
    expect(ui.screen()).toContain('Camille')
  })

  it('compte deux soirées comme deux soirées', () => {
    played(0).ui.click(t('win.home'))
    const { ui } = played(1)
    ui.click(t('win.home'))
    ui.click(t('standings.open'))

    expect(ui.byLabel(t('standings.wins', { n: 2 }))).toBeTruthy()
  })

  it('s’oublie quand on le demande, et le bouton s’en va avec lui', () => {
    const { ui } = played(0)
    ui.click(t('win.home'))
    ui.click(t('standings.open'))

    ui.click(t('standings.clear'))
    ui.click(t('standings.clear.confirm'))

    expect(ui.screen()).toContain(t('standings.empty'))
    ui.clickLabel(t('common.back'))
    expect(ui.hasText(t('standings.open'))).toBe(false)
  })
})

describe('le palmarès sous la feuille de match', () => {
  setupDom()

  /**
   * Sur la toute première partie, la ligne ne ferait que redire en plus petit
   * le podium posé juste au-dessus.
   */
  it('se tait sur la première partie', () => {
    const { ui } = played(0)
    expect(ui.find('.overlay.podium')).toBeTruthy()
    expect(ui.find('.tally-strip')).toBeNull()
  })

  it('donne le général dès la deuxième, et l’ouvre en entier', () => {
    played(0).ui.click(t('win.home'))
    const { ui } = played(1)

    const strip = ui.find('.tally-strip')!
    expect(strip).toBeTruthy()
    expect(strip.textContent).toContain('Alan')

    strip.click()

    expect(ui.find('.overlay.podium')).toBeNull()
    expect(ui.find('.overlay.standings-sheet')).toBeTruthy()
    expect(ui.screen()).toContain(t('standings.recent'))
  })

  /** On ne quitte pas la feuille de match pour lire le palmarès : on y revient. */
  it('rend la feuille de match en se refermant', () => {
    played(0).ui.click(t('win.home'))
    const { ui } = played(1)

    ui.find('.tally-strip')!.click()
    ui.click(t('common.close'))

    expect(ui.find('.overlay.standings-sheet')).toBeNull()
    expect(ui.find('.overlay.podium')).toBeTruthy()
  })
})
