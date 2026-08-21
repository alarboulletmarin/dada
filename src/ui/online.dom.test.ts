// @vitest-environment jsdom
/**
 * Les écrans d'une partie en ligne, avec un transport en carton.
 *
 * `App` prend sa fabrique de salon en second argument, et le banc d'essai lui
 * passe le même canal double que les tests réseau (voir `test-room.ts`) : un
 * écran n'a pas à savoir comment on entre dans une salle, il transmet. Rien
 * d'autre n'est simulé : c'est une vraie `Session`, un vrai moteur, un vrai
 * battement de cœur.
 *
 * Ce qu'on vient vérifier tient en une phrase : **ce que le réseau a à dire
 * arrive-t-il à l'écran ?** C'était le trou le plus coûteux du jeu — un invité
 * coupé de l'hôte tapait dans le vide sans qu'aucun pixel ne le prévienne.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SILENCE_MS, TICK_MS } from '../net/presence.ts'
import type { Hello } from '../net/room.ts'
import { t } from './i18n.ts'
import {
  finish,
  gameOf,
  lobbyOf,
  mountApp,
  seatOf,
  setOnline,
  setupDom,
  stateOf,
  type Ui,
} from './test-dom.ts'
import { lastRoom, type FakeChannel } from './test-room.ts'

const CODE = 'ABCDEFGH'

/** L'invité tape le code et demande à s'asseoir. Le salon lui répond ensuite. */
function knock(name = 'Camille'): { ui: Ui; channel: FakeChannel; self: string } {
  const ui = mountApp()
  ui.type(t('home.name.placeholder'), name)
  ui.click(t('home.join'))
  ui.type(t('join.code.label'), CODE)
  ui.click(t('join.action'))

  const channel = lastRoom()
  channel.join('p-hote')
  const hello = channel.of('hello')[0]?.data as Hello | undefined
  expect(hello, "l'invité ne s'est pas présenté").toBeTruthy()
  return { ui, channel, self: hello!.clientId }
}

/** L'hôte accepte, lance, et envoie l'état : l'invité arrive sur le plateau. */
function seated(name = 'Camille') {
  const { ui, channel, self } = knock(name)
  const lobby = lobbyOf({
    hostClientId: 'hote',
    started: true,
    players: [
      seatOf({ seat: 0, clientId: 'hote', peerId: 'p-hote', name: 'Alan' }),
      seatOf({ seat: 1, clientId: self, peerId: 'moi-le-pair', name }),
    ],
  })
  channel.receive('lobby', structuredClone(lobby), 'p-hote')
  const game = gameOf(lobby, self)
  channel.receive('state', stateOf(lobby, game), 'p-hote')
  return { ui, channel, self, lobby, game }
}

describe('le bandeau de lien', () => {
  setupDom()

  let table: ReturnType<typeof seated>
  beforeEach(() => {
    table = seated()
    expect(table.ui.find('.play'), "l'invité n'est pas arrivé sur le plateau").toBeTruthy()
  })

  it('reste muet tant que l’hôte se fait entendre', () => {
    expect(table.ui.find('.linkbar')!.classList.contains('show')).toBe(false)
    expect(table.ui.hasText(t('link.reconnect'))).toBe(false)
  })

  it('annonce la coupure et propose de reconnecter', async () => {
    // Personne n'est parti — c'est bien le problème : plus un mot n'arrive.
    await table.ui.advance(SILENCE_MS + TICK_MS)

    const bar = table.ui.find('.linkbar')!
    expect(bar.classList.contains('show')).toBe(true)
    expect(bar.textContent).toContain(t('link.host.lost'))
    expect(table.ui.hasText(t('link.reconnect'))).toBe(true)
    // Rouge, et non « informé mais tranquille » : celui-là ne joue plus.
    expect(bar.classList.contains('linkbar--quiet')).toBe(false)
  })

  it('se tait de nouveau au premier battement retrouvé', async () => {
    await table.ui.advance(SILENCE_MS + TICK_MS)
    expect(table.ui.find('.linkbar')!.classList.contains('show')).toBe(true)

    table.channel.receive('tick', { from: 'hote', epoch: 0, seq: 0, at: Date.now() }, 'p-hote')
    expect(table.ui.find('.linkbar')!.classList.contains('show')).toBe(false)
  })

  it('ne propose aucun bouton quand le téléphone n’a plus de réseau', () => {
    setOnline(false)

    const bar = table.ui.find('.linkbar')!
    expect(bar.classList.contains('show')).toBe(true)
    expect(bar.textContent).toContain(t('link.lost.offline'))
    // Un bouton qui ne peut rien faire est pire que pas de bouton.
    expect(bar.querySelector('button')).toBeNull()

    setOnline(true)
    expect(table.ui.find('.linkbar')!.classList.contains('show')).toBe(false)
  })
})

describe('l’écran du spectateur', () => {
  setupDom()

  it('ne montre que la carte « vous regardez », et pas la table', () => {
    const { ui, channel, self } = knock()
    channel.receive('join', { clientId: self, status: 'watching' }, 'p-hote')

    expect(ui.screen()).toContain(t('join.watching'))
    // Ni les sièges, ni les réglages, ni « en attente du lancement » : ils
    // décriraient une table où l'on n'entrera peut-être jamais.
    expect(ui.all('.seat')).toHaveLength(0)
    expect(ui.find('.table-card')).toBeNull()
    expect(ui.hasText(t('lobby.waitHost'))).toBe(false)
    // Une porte de sortie, tout de même.
    expect(ui.hasText(t('link.otherCode'))).toBe(true)
  })

  it('le dit aussi en pleine partie, sans alarmer', () => {
    const { ui, channel, self } = knock()
    channel.receive('join', { clientId: self, status: 'watching' }, 'p-hote')

    const lobby = lobbyOf({
      hostClientId: 'hote',
      started: true,
      players: [
        seatOf({ seat: 0, clientId: 'hote', peerId: 'p-hote', name: 'Alan' }),
        seatOf({ seat: 1, clientId: 'sami', peerId: 'p-sami', name: 'Sami' }),
      ],
    })
    channel.receive('lobby', structuredClone(lobby), 'p-hote')
    channel.receive('state', stateOf(lobby, gameOf(lobby, self)), 'p-hote')

    expect(ui.find('.play')).toBeTruthy()
    const bar = ui.find('.linkbar')!
    expect(bar.classList.contains('show')).toBe(true)
    expect(bar.textContent).toContain(t('join.watching'))
    expect(bar.classList.contains('linkbar--quiet')).toBe(true)
  })
})

describe('la feuille de match', () => {
  setupDom()

  it('s’affiche à la fin, et disparaît avec le retour à l’accueil', () => {
    const { ui, channel, lobby, game } = seated()

    channel.receive('state', stateOf(lobby, finish(game, 0)), 'p-hote')

    expect(ui.find('.overlay.podium')).toBeTruthy()
    expect(ui.screen()).toContain(t('win.title', { name: 'Alan' }))

    ui.click(t('win.home'))

    // Un podium oublié se reposerait sur l'accueil, pour une partie qui
    // n'existe plus.
    expect(document.querySelectorAll('.overlay.podium')).toHaveLength(0)
    expect(ui.hasText(t('home.local'))).toBe(true)
  })

  it('survit à un chat ouvert au moment de la victoire', () => {
    const { ui, channel, lobby, game } = seated()

    ui.clickLabel(t('chat.title'))
    expect(ui.find('.overlay.chat')).toBeTruthy()

    channel.receive('state', stateOf(lobby, finish(game, 0)), 'p-hote')
    ;(ui.find(`.overlay.chat [aria-label="${t('common.close')}"]`) as HTMLButtonElement).click()

    expect(ui.find('.overlay.chat')).toBeNull()
    expect(ui.find('.overlay.podium')).toBeTruthy()
    expect(ui.screen()).toContain(t('win.title', { name: 'Alan' }))
  })

  it('ne se dédouble pas si l’état final repasse', () => {
    const { channel, lobby, game } = seated()

    const over = finish(game, 0)
    channel.receive('state', stateOf(lobby, over), 'p-hote')
    channel.receive('state', stateOf(lobby, { ...over, seq: over.seq + 1 }), 'p-hote')

    expect(document.querySelectorAll('.overlay.podium')).toHaveLength(1)
  })
})
