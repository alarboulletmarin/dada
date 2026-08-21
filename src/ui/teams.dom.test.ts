// @vitest-environment jsdom
/**
 * Les écrans de la variante « Équipes ».
 *
 * Deux contre deux, c'est la seule variante où l'écran doit dire des choses
 * qu'aucun plateau ne montre : qui joue avec qui, et de qui l'on joue les
 * chevaux. Le moteur, lui, sait déjà tout — `areAllies` et `activeSeatFor`
 * sont fixés par `teams.test.ts`. Ce qui est en jeu ici, c'est que rien de
 * cela ne reste invisible.
 *
 * Le garde de la table complète est vérifié des deux côtés : l'écran (le
 * bouton refuse de s'allumer) et la session (`Session.start` ne fabrique rien).
 * Le moteur LÈVE sur une table incomplète en équipes — un écran qui laisserait
 * passer le clic ferait tomber la partie, pas seulement le bouton.
 */

import { describe, expect, it } from 'vitest'
import { geometryFor } from '../game/board.ts'
import { activeSeatFor } from '../game/engine.ts'
import type { GameState, Seat } from '../game/types.ts'
import type { Hello } from '../net/room.ts'
import { t } from './i18n.ts'
import {
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

/** Accueil → « Un seul téléphone » → la carte « Équipes » → le salon. */
function teamLobby(): Ui {
  const ui = mountApp()
  ui.type(t('home.name.placeholder'), 'Léa')
  ui.click(t('home.local'))
  ui.click(t('variant.equipes.name'))
  ui.click(t('common.continue'))
  return ui
}

/**
 * Une table de quatre, en ligne, dont on tient le siège 1.
 *
 * `prep` retouche l'état **avant** le premier envoi, et non après : le plateau
 * anime tout cheval dont la case change entre deux états, et faire rentrer
 * quatre chevaux d'un coup vaut soixante-quatre pas de cent quinze
 * millisecondes. Ce qui est en jeu ici n'est pas l'animation ; on pose donc la
 * situation d'emblée, et l'état suivant ne déplace plus rien.
 */
function seatedTeams(prep: (game: GameState) => GameState = (g) => g): {
  ui: Ui
  channel: FakeChannel
  self: string
  game: GameState
  lobby: ReturnType<typeof lobbyOf>
} {
  const ui = mountApp()
  ui.type(t('home.name.placeholder'), 'Camille')
  ui.click(t('home.join'))
  ui.type(t('join.code.label'), CODE)
  ui.click(t('join.action'))

  const channel = lastRoom()
  channel.join('p-hote')
  const self = (channel.of('hello')[0]?.data as Hello).clientId

  const lobby = lobbyOf({
    hostClientId: 'hote',
    started: true,
    variantId: 'equipes',
    players: [
      seatOf({ seat: 0, clientId: 'hote', peerId: 'p-hote', name: 'Alan' }),
      seatOf({ seat: 1, clientId: self, peerId: 'moi-le-pair', name: 'Camille' }),
      seatOf({ seat: 2, clientId: 'sami', peerId: 'p-sami', name: 'Sami' }),
      seatOf({ seat: 3, clientId: 'noa', peerId: 'p-noa', name: 'Noa' }),
    ],
  })
  channel.receive('lobby', structuredClone(lobby), 'p-hote')
  const game = prep(gameOf(lobby, self))
  channel.receive('state', stateOf(lobby, game), 'p-hote')
  return { ui, channel, self, game, lobby }
}

/** Les quatre chevaux de ce siège sont rentrés, et c'est son tour. */
function home(game: GameState, seat: Seat): GameState {
  const last = geometryFor(game.variant).lastStep
  return {
    ...game,
    turn: seat,
    phase: 'rolling',
    dice: null,
    pawns: game.pawns.map((p) => (p.owner === seat ? { ...p, steps: last } : p)),
    finishers: [],
    seq: game.seq + 1,
  }
}

/** …et le moteur en a pris acte : c'est là que le relais commence. */
const penned = (game: GameState, seat: Seat): GameState => ({
  ...home(game, seat),
  finishers: [seat],
  seq: game.seq + 2,
})

describe('choisir la variante « Équipes »', () => {
  setupDom()

  it('propose une quatrième carte, et se laisse choisir', () => {
    const ui = mountApp()
    ui.click(t('home.create'))

    expect(ui.screen()).toContain(t('variant.equipes.name'))
    expect(ui.screen()).toContain(t('variant.equipes.desc'))

    const card = ui.byText(t('variant.equipes.name')).closest('.game-card') as HTMLElement
    expect(card.getAttribute('aria-pressed')).toBe('false')

    card.click()
    const again = ui.byText(t('variant.equipes.name')).closest('.game-card') as HTMLElement
    expect(again.getAttribute('aria-pressed')).toBe('true')
    // La pastille a sa propre couleur : quatre cartes, quatre repères.
    expect(again.querySelector('.badge.b4')).toBeTruthy()
  })
})

describe('le salon en équipes', () => {
  setupDom()

  it('étiquette chaque siège de son équipe, et dit qui joue avec qui', () => {
    const ui = teamLobby()

    expect(ui.screen()).toContain(t('lobby.teams.hint'))
    const labels = ui.all('.seat__team').map((el) => el.textContent)
    // Deux sièges occupés au départ : l'hôte en A, le bot d'en face en B.
    expect(labels).toEqual([t('lobby.team', { team: 'A' }), t('lobby.team', { team: 'B' })])
  })

  it('refuse de lancer tant que la table n’est pas complète', () => {
    const ui = teamLobby()

    ui.click(t('lobby.addBot'))
    const three = ui.byText(t('lobby.needFour')) as HTMLButtonElement
    expect(three.disabled).toBe(true)
    // Et surtout pas « il faut au moins 2 joueurs » : ici il en faut quatre.
    expect(ui.hasText(t('lobby.needTwo'))).toBe(false)

    ui.click(t('lobby.addBot'))
    const four = ui.byText(t('lobby.start')) as HTMLButtonElement
    expect(four.disabled).toBe(false)

    four.click()
    expect(ui.find('.play')).toBeTruthy()
  })

  it('donne aux cartes de joueur la marque de leur équipe', () => {
    const ui = teamLobby()
    ui.click(t('lobby.addBot'))
    ui.click(t('lobby.addBot'))
    ui.click(t('lobby.start'))

    const marks = ui.all('.pcard__team')
    expect(marks).toHaveLength(4)
    expect(ui.all('.pcard[data-team="A"]')).toHaveLength(2)
    expect(ui.all('.pcard[data-team="B"]')).toHaveLength(2)
  })
})

describe('jouer pour son partenaire', () => {
  setupDom()

  it('le dit sur la ligne de tour quand le siège courant a fini', () => {
    const { ui, game } = seatedTeams((g) => penned(g, 0))

    expect(activeSeatFor(game)).toBe(2)
    // Alan a fini ; c'est toujours son tour, mais ce sont les chevaux de Sami.
    expect(ui.find('.turnline')!.textContent).toContain(
      t('play.playFor', { name: 'Alan', partner: 'Sami' }),
    )
  })

  it('cercle les chevaux du partenaire, et non ceux du siège courant', async () => {
    // C'est NOTRE tour — siège 1, celui qu'on tient — et nos quatre chevaux
    // sont rentrés : on joue donc ceux du siège 3. Un 6 sur la table, et les
    // seuls coups possibles sont des sorties d'écurie ; s'il s'en cercle un,
    // il ne peut appartenir qu'au partenaire.
    //
    // C'est le moteur qui le décide (`activeSeatFor`) ; ce test dit que l'écran
    // n'y remet aucun filtre de son cru sur `state.turn`.
    const { ui } = seatedTeams((g) => ({ ...penned(g, 1), phase: 'moving', dice: 6 }))
    // Le dé roule avant que rien ne se cercle : tant qu'il tourne, l'écran ne
    // vend pas la mèche.
    await ui.advance(2000)

    const lit = ui.all('.pawn.playable')
    expect(lit.length).toBeGreaterThan(0)
    for (const pawn of lit) expect(pawn.style.getPropertyValue('--seat')).toBe('var(--seat-3)')
  })

  it('annonce le relais au moment où le quatrième cheval rentre', async () => {
    const { ui, channel, lobby, game } = seatedTeams((g) => home(g, 0))

    // Rien n'est encore dit : le moteur n'a pas encore inscrit Alan.
    expect(ui.screen()).not.toContain(t('play.relay', { name: 'Alan', partner: 'Sami' }))

    channel.receive('state', stateOf(lobby, penned(game, 0)), 'p-hote')
    await ui.advance(50)

    expect(ui.screen()).toContain(t('play.relay', { name: 'Alan', partner: 'Sami' }))
  })

  it('ne le redit pas à chaque état qui repasse', async () => {
    const { ui, channel, lobby, game } = seatedTeams((g) => home(g, 0))

    const relayed = penned(game, 0)
    channel.receive('state', stateOf(lobby, relayed), 'p-hote')
    await ui.advance(50)
    channel.receive('state', stateOf(lobby, { ...relayed, seq: relayed.seq + 1 }), 'p-hote')
    await ui.advance(50)

    const said = ui.all('.cardnote').filter((n) =>
      n.textContent?.includes(t('play.relay', { name: 'Alan', partner: 'Sami' })),
    )
    expect(said).toHaveLength(1)
  })
})

describe('la feuille de match en équipes', () => {
  setupDom()

  it('range les quatre joueurs en deux blocs, le camp gagnant devant', () => {
    const { ui, channel, lobby, game } = seatedTeams()

    // L'équipe B l'emporte : Camille puis Noa, et l'équipe A derrière.
    const over: GameState = {
      ...game,
      phase: 'finished',
      ranking: [1, 3, 0, 2],
      dice: null,
      seq: game.seq + 1,
    }
    channel.receive('state', stateOf(lobby, over), 'p-hote')

    const blocks = ui.all('.podium__team')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.textContent).toContain(t('lobby.team', { team: 'B' }))
    expect(blocks[0]!.textContent).toContain('Camille')
    expect(blocks[0]!.textContent).toContain('Noa')
    expect(blocks[1]!.textContent).toContain(t('lobby.team', { team: 'A' }))
    expect(blocks[1]!.textContent).toContain('Alan')
    expect(blocks[1]!.textContent).toContain('Sami')

    // La feuille de match ne change pas de forme pour autant.
    expect(ui.find('.overlay.podium')).toBeTruthy()
  })

  it('titre la victoire des deux prénoms, pas d’un seul', () => {
    const { ui, channel, lobby, game } = seatedTeams()

    channel.receive(
      'state',
      stateOf(lobby, { ...game, phase: 'finished', ranking: [1, 3, 0, 2], dice: null, seq: game.seq + 1 }),
      'p-hote',
    )

    // On gagne à deux : « Camille gagne ! » effacerait Noa de sa propre victoire.
    const heading = ui.find('.overlay.podium h2')!
    expect(heading.textContent).toBe(t('win.title.team', { a: 'Camille', b: 'Noa' }))
    expect(heading.textContent).not.toContain(t('win.title', { name: 'Camille' }))
    // Le sous-titre, lui, ne bouge pas d'un mot.
    expect(ui.screen()).toContain(t('variant.equipes.name'))
  })
})
