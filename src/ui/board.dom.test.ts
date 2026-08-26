// @vitest-environment jsdom
/**
 * Les deux réglages qu'on prend avec un doigt : la difficulté d'un bot, et la
 * taille du plateau.
 *
 * Ce sont les deux endroits où l'interface a renoncé à un bouton posé à côté.
 * La jauge de niveau EST la pastille du siège, le zoom EST la pastille de la
 * ligne de tour, et le cheval porte sa marque de camp dans un `data-seat` que
 * la feuille de style dessine. Trois choix qui rendent l'écran lisible sur un
 * téléphone de 360 points, et trois choix qu'aucun test ne tenait : rien
 * n'empêchait la jauge de repousser sur un siège humain, le cycle des niveaux
 * de sauter un cran, ou le zoom de rester coincé au repos.
 *
 * Le trou le plus sournois est celui du zoom : son calcul se fait à partir de
 * la largeur du cadre, et sous jsdom cette largeur vaut zéro. Un zoom qui
 * n'aurait basculé que sur un cadre mesuré aurait passé toutes les relectures
 * et menti au premier appareil dont la mise en page arrive après le premier
 * dessin.
 */

import { describe, expect, it } from 'vitest'
import { BOT_LEVELS, type BotLevel } from '../game/bot.ts'
import { t } from './i18n.ts'
import { mountApp, setupDom, type Ui } from './test-dom.ts'

setupDom()

/** Accueil → « Un seul téléphone » → le salon local : un humain, un bot. */
function openLocalLobby(name = 'Léa'): Ui {
  const ui = mountApp()
  ui.type(t('home.name.placeholder'), name)
  ui.click(t('home.local'))
  ui.click(t('common.continue'))
  return ui
}

/** Le siège dont le champ de nom porte ce prénom. */
function seatNamed(ui: Ui, name: string): HTMLElement {
  const seat = ui
    .all('.seat')
    .find((s) => s.querySelector<HTMLInputElement>('input')?.value === name)
  expect(seat, `aucun siège au nom de « ${name} »`).toBeTruthy()
  return seat!
}

/** La jauge d'un siège, ou rien du tout — c'est aussi une réponse. */
const meterOf = (seat: HTMLElement): HTMLElement | null =>
  seat.querySelector<HTMLElement>('.tag--level')

/** Combien de points sont allumés sur la jauge de ce siège. */
const litDots = (seat: HTMLElement): number =>
  seat.querySelectorAll('.tag--level .tag__dot.on').length

/**
 * Le niveau qu'annonce la jauge, lu dans son étiquette traduite.
 *
 * Par l'étiquette et non par le nombre de points : c'est elle que lit celui qui
 * n'y voit rien, et c'est la seule des deux qui nomme le niveau.
 */
function levelShown(seat: HTMLElement, name: string): BotLevel {
  const label = meterOf(seat)?.getAttribute('aria-label') ?? ''
  const found = BOT_LEVELS.find(
    (level) => label === t('lobby.bot.level', { name, level: t(`level.${level}`) }),
  )
  expect(found, `étiquette de niveau inattendue : « ${label} »`).toBeTruthy()
  return found!
}

describe('la jauge de niveau d’un bot du salon', () => {
  it('ne paraît que sur les sièges tenus par un bot', () => {
    const ui = openLocalLobby()

    // Un humain n'a pas de niveau à régler : une jauge sur son siège
    // proposerait un geste qui ne fait rien, et le mot « bot » a justement
    // disparu parce que la jauge suffit à dire qui est qui.
    expect(meterOf(seatNamed(ui, 'Léa'))).toBeNull()
    expect(meterOf(seatNamed(ui, 'Bot 2'))).toBeTruthy()
  })

  it('est un vrai bouton, et allume autant de points que le rang du niveau', () => {
    const ui = openLocalLobby()
    const bot = seatNamed(ui, 'Bot 2')

    // La pastille EST le bouton. Un `span` ici, et le geste n'existe plus que
    // dans la feuille de style : ni tabulation, ni entrée, ni lecteur d'écran.
    expect(meterOf(bot)!.tagName).toBe('BUTTON')

    // Le salon ouvre au niveau du jeu, deuxième des trois : deux points.
    expect(levelShown(bot, 'Bot 2')).toBe('normal')
    expect(litDots(bot)).toBe(BOT_LEVELS.indexOf('normal') + 1)

    // Le rang et non le nombre écrit à la main : c'est la seule chose que la
    // jauge promet — le troisième des trois niveaux allume trois points, quel
    // que soit le nombre de niveaux qu'on lui donnera un jour.
    const tap = (level: BotLevel): void =>
      ui.clickLabel(t('lobby.bot.level', { name: 'Bot 2', level: t(`level.${level}`) }))
    const dotsFor = (level: BotLevel): number => BOT_LEVELS.indexOf(level) + 1

    tap('normal')
    expect(levelShown(seatNamed(ui, 'Bot 2'), 'Bot 2')).toBe('redoutable')
    expect(litDots(seatNamed(ui, 'Bot 2'))).toBe(dotsFor('redoutable'))

    tap('redoutable')
    expect(levelShown(seatNamed(ui, 'Bot 2'), 'Bot 2')).toBe('tranquille')
    expect(litDots(seatNamed(ui, 'Bot 2'))).toBe(dotsFor('tranquille'))
  })

  it('fait tourner les trois niveaux et les écrit dans le salon', () => {
    const ui = openLocalLobby()
    const tap = (level: BotLevel): void =>
      ui.clickLabel(t('lobby.bot.level', { name: 'Bot 2', level: t(`level.${level}`) }))

    // Un cycle et non trois boutons : toucher trois fois doit ramener d'où
    // l'on part, sinon un niveau devient inatteignable au doigt.
    tap('normal')
    expect(levelShown(seatNamed(ui, 'Bot 2'), 'Bot 2')).toBe('redoutable')
    tap('redoutable')
    expect(levelShown(seatNamed(ui, 'Bot 2'), 'Bot 2')).toBe('tranquille')
    tap('tranquille')
    expect(levelShown(seatNamed(ui, 'Bot 2'), 'Bot 2')).toBe('normal')

    // Et c'est bien le salon qui a changé, pas seulement la pastille : c'est
    // lui que l'hôte publie et que le moteur relira au lancement.
    tap('normal')
    expect(ui.app.session?.botLevel(1)).toBe('redoutable')
  })

  it('explique le geste tant qu’il reste un bot à régler', () => {
    const ui = openLocalLobby()

    // Trois points ne disent pas d'eux-mêmes qu'ils se touchent.
    expect(ui.hasText(t('lobby.bot.hint'))).toBe(true)

    ui.clickLabel(t('lobby.remove', { name: 'Bot 2' }))

    // Plus de bot, plus de geste : une phrase qui reste à l'écran sans rien
    // désigner envoie chercher une jauge qui n'existe plus.
    expect(ui.find('.tag--level')).toBeNull()
    expect(ui.hasText(t('lobby.bot.hint'))).toBe(false)
  })
})

describe('le zoom du plateau', () => {
  /** Accueil → salon local → la partie lancée, plateau à l'écran. */
  const play = (): Ui => {
    const ui = openLocalLobby()
    ui.click(t('lobby.start'))
    return ui
  }

  it('pose la grille et les chevaux sur une seule couche qui grossit', () => {
    const ui = play()

    const wrap = ui.find('.board-wrap')!
    const view = wrap.querySelector<HTMLElement>(':scope > .board-view')
    expect(view).toBeTruthy()

    // Les deux DANS la même couche : le zoom s'y pose d'un seul `transform`,
    // et une grille grossie à part des chevaux les laisserait à côté de leur
    // case pendant tout le temps où l'un marche.
    expect(view!.querySelector('.board')).toBeTruthy()
    expect(view!.querySelector('.pawns')).toBeTruthy()
  })

  it('grossit et revient, même quand le cadre n’a aucune largeur', () => {
    const ui = play()
    const wrap = ui.find('.board-wrap')!

    // Sous jsdom, `clientWidth` vaut zéro : c'est exactement le cas d'un
    // premier dessin avant mise en page, et le bouton doit basculer quand
    // même. Un zoom qui exigerait un cadre mesuré resterait muet au repos.
    expect(wrap.clientWidth).toBe(0)

    const view = wrap.querySelector<HTMLElement>(':scope > .board-view')!
    const btn = ui.byLabel(t('play.zoom.in'))
    expect(btn.classList.contains('zoombtn')).toBe(true)
    expect(wrap.classList.contains('zoomed')).toBe(false)
    expect(view.style.transform).toBe('')

    btn.click()
    // L'étiquette suit le plateau : elle dit ce que la touche suivante fera,
    // et un bouton qui garderait « Agrandir » une fois agrandi mentirait dès
    // le premier pincement.
    expect(btn.getAttribute('aria-label')).toBe(t('play.zoom.out'))
    expect(wrap.classList.contains('zoomed')).toBe(true)
    // Et le plateau grossit pour de bon. La classe et l'étiquette se posent
    // sur d'autres éléments que la couche : les vérifier seules laisserait
    // passer un bouton qui allume tout l'écran sauf le plateau.
    expect(view.style.transform).toMatch(/scale\((?!1\))/)

    btn.click()
    expect(btn.getAttribute('aria-label')).toBe(t('play.zoom.in'))
    expect(wrap.classList.contains('zoomed')).toBe(false)
    expect(view.style.transform).toBe('')
  })

  it('marque chaque cheval du siège auquel il appartient', () => {
    const ui = play()

    const pawns = ui.all('.board-wrap .pawns .pawn')
    expect(pawns.length).toBeGreaterThan(0)

    /*
     * La marque de camp n'est plus un caractère mais un `data-seat` que la
     * feuille de style dessine : les quatre glyphes géométriques d'avant
     * n'étaient dans aucune fonte embarquée. Sans cet attribut, il ne reste que
     * quatre couleurs de luminance presque égale pour dire à qui est un cheval.
     *
     * On compte donc les chevaux siège par siège et on compare au moteur, au
     * lieu de vérifier que l'attribut ressemble à un chiffre : une passe
     * d'affichage qui marquerait TOUS les chevaux du même siège — un `seat`
     * capturé de travers, une pastille recyclée d'un cheval à l'autre — écrit
     * elle aussi des chiffres bien formés, et c'est exactement la panne contre
     * laquelle cet attribut existe.
     */
    const compte = (list: readonly { owner: number }[] | HTMLElement[]): Map<string, number> => {
      const out = new Map<string, number>()
      for (const item of list) {
        const seat =
          item instanceof HTMLElement ? (item.dataset.seat ?? '?') : String(item.owner)
        out.set(seat, (out.get(seat) ?? 0) + 1)
      }
      return out
    }

    const state = ui.app.session!.game!
    const marques = compte(pawns)
    // Une table d'un seul camp ne prouverait rien : c'est la répartition entre
    // deux sièges qui dit que la marque suit le cheval.
    expect(marques.size).toBeGreaterThan(1)
    expect(marques).toEqual(compte(state.pawns))

    // Et la marque doit dire le même siège que la couleur posée sur le même
    // cheval : deux écritures, un seul cheval, et un lecteur qui ne distingue
    // pas les couleurs n'a que la première.
    for (const pawn of pawns) {
      expect(pawn.style.getPropertyValue('--seat')).toBe(`var(--seat-${pawn.dataset.seat})`)
    }
  })
})
