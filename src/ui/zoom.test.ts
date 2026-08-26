/**
 * Ce qu'un plateau grossi n'a pas le droit de faire.
 *
 * `zoom.ts` sépare la géométrie du geste de son écoute, exactement comme
 * `swipe.ts` ; c'est la géométrie qu'on fige ici — les bornes, le recadrage, et
 * le point qui doit rester immobile sous les doigts pendant que l'échelle
 * change.
 *
 * Le trou que ces tests bouchent : une vue fausse ne se signale jamais autrement
 * qu'en cassant le plateau, et toujours trop tard. Un décalage qui échappe à ses
 * bornes fait entrer une bande de vide dans le cadre ; une échelle sous 1 laisse
 * glisser hors de son cadre un plateau qui le remplit déjà ; un pincement dont
 * l'écart de départ vaut zéro produit un NaN dont la vue ne se relève plus,
 * puisque toute la suite se calcule à partir d'elle. Trois accidents nés de
 * trois lignes d'arithmétique que personne ne relit, et qu'aucun test d'écran ne
 * verrait : on les vérifie donc en fonctions pures, sans jsdom.
 */

import { describe, expect, it } from 'vitest'
import {
  clampPan,
  clampScale,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_PX,
  focalPan,
  gripOf,
  isDoubleTap,
  MAX_SCALE,
  MIN_SCALE,
  pan,
  pinch,
  REST,
  settle,
  STEP_SCALE,
  zoomed,
  zoomTo,
  type View,
} from './zoom.ts'

/** Le côté du cadre, en pixels : un plateau de téléphone tenu debout. */
const SIZE = 360

/** Le centre du cadre à l'écran — l'origine depuis laquelle se comptent les visées. */
const CENTRE = { x: 200, y: 200 }

/** Le débord promenable à une échelle donnée : `(échelle − 1) × côté / 2`. */
const slackAt = (scale: number): number => ((scale - 1) * SIZE) / 2

/**
 * La vue, débarrassée du zéro négatif.
 *
 * `Math.min(0, Math.max(-0, offset))` rend `-0` dès que le décalage est négatif
 * et le plateau au repos. C'est le même décalage, et l'écran ne fait aucune
 * différence — mais `toEqual` compare les nombres avec `Object.is`, pour qui
 * `-0` et `0` sont deux valeurs distinctes. Sans ce nettoyage, le test
 * échouerait sur un écart que personne ne peut voir.
 */
const plain = (view: View): View => ({ scale: view.scale + 0, x: view.x + 0, y: view.y + 0 })

/**
 * Où se trouve, sur le plateau, le point qui s'affiche à `offset` du centre.
 *
 * La couche est posée en `translate(pan) scale(s)` : un point du plateau situé
 * à `board` du centre s'affiche donc à `pan + s × board`. On remonte au point
 * de plateau avant le zoom, on redescend à l'écran après, et les deux doivent
 * tomber au même pixel.
 */
const boardPoint = (offset: number, shift: number, scale: number): number =>
  (offset - shift) / scale

/** Le chemin inverse : où ce point de plateau se pose à l'écran. */
const screenPoint = (board: number, shift: number, scale: number): number => shift + scale * board

describe('les bornes du grossissement', () => {
  it('encadre le plateau entre le repos et le grossissement maximal', () => {
    expect(MIN_SCALE).toBe(1)
    expect(MAX_SCALE).toBeGreaterThan(MIN_SCALE)
    // Le cran du bouton et du double appui doit tomber dans les bornes, sinon
    // le geste demanderait une échelle que la vue lui refuserait aussitôt : le
    // plateau ne bougerait pas, et le bouton passerait pour cassé.
    expect(STEP_SCALE).toBeGreaterThan(MIN_SCALE)
    expect(STEP_SCALE).toBeLessThanOrEqual(MAX_SCALE)
    expect(clampScale(STEP_SCALE)).toBe(STEP_SCALE)
  })

  it('ne laisse jamais rétrécir le plateau sous son cadre', () => {
    // Un plateau plus petit que son cadre flotte dans du vide, et le vide se
    // lit comme un bug plutôt que comme une limite.
    expect(clampScale(0.5)).toBe(MIN_SCALE)
    expect(clampScale(0)).toBe(MIN_SCALE)
    expect(clampScale(-3)).toBe(MIN_SCALE)
    expect(clampScale(MIN_SCALE)).toBe(MIN_SCALE)
  })

  it('ne laisse jamais grossir le plateau au-delà du maximum', () => {
    expect(clampScale(10)).toBe(MAX_SCALE)
    expect(clampScale(MAX_SCALE)).toBe(MAX_SCALE)
    // Une échelle déjà dans les bornes passe telle quelle. Elle se calcule à
    // partir des bornes plutôt que de s'écrire en dur : le jour où l'on
    // resserre le maximum, un nombre écrit à la main tomberait dehors et ce
    // test échouerait sur son propre exemple, pas sur le code.
    expect(clampScale((MIN_SCALE + MAX_SCALE) / 2)).toBe((MIN_SCALE + MAX_SCALE) / 2)
  })

  it('ramène au repos une échelle qui n’est pas un nombre', () => {
    // Un pincement mal parti sait produire NaN et l'infini. Les laisser passer
    // fige le plateau à une échelle impossible : plus rien ne s'affiche, et
    // aucun geste ne rattrape une vue qui n'est plus un nombre.
    expect(clampScale(Number.NaN)).toBe(MIN_SCALE)
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(MIN_SCALE)
    expect(clampScale(Number.NEGATIVE_INFINITY)).toBe(MIN_SCALE)
  })
})

describe('le décalage que le cadre peut montrer', () => {
  it('colle le décalage à zéro tant que le plateau n’est pas grossi', () => {
    // C'est cette ligne qui garantit qu'un plateau non zoomé ne peut pas
    // glisser hors de son cadre : au repos il le remplit exactement, et le
    // moindre décalage ferait entrer du vide sur un bord.
    for (const offset of [-1000, -30, 0, 30, 1000]) {
      expect(clampPan(offset, MIN_SCALE, SIZE)).toBeCloseTo(0, 10)
    }
    // Une échelle sous 1 est d'abord ramenée à 1 : elle ne se paie pas en jeu.
    expect(clampPan(120, 0.4, SIZE)).toBeCloseTo(0, 10)
  })

  it('borne le décalage au débord réel du plateau grossi', () => {
    // Grossi de deux, le plateau déborde de 180 px de chaque côté du cadre :
    // c'est tout ce qu'on peut promener. Un pixel de plus et le cadre montre
    // du vide là où le joueur attend le bord du plateau.
    expect(slackAt(2)).toBe(180)
    expect(clampPan(1000, 2, SIZE)).toBe(180)
    expect(clampPan(-1000, 2, SIZE)).toBe(-180)
    expect(clampPan(180, 2, SIZE)).toBe(180)
    // En deçà de la borne, le décalage demandé passe tel quel.
    expect(clampPan(120, 2, SIZE)).toBe(120)
    expect(clampPan(-7.5, 2, SIZE)).toBe(-7.5)
  })

  it('borne encore au grossissement maximal', () => {
    expect(clampPan(1e6, MAX_SCALE, SIZE)).toBe(slackAt(MAX_SCALE))
    expect(clampPan(-1e6, MAX_SCALE, SIZE)).toBe(-slackAt(MAX_SCALE))
  })

  it('rend zéro pour un décalage qui n’est pas un nombre', () => {
    // Un NaN qui entre dans la vue y reste : toute la suite se calcule à partir
    // d'elle, et le plateau disparaît pour de bon.
    expect(clampPan(Number.NaN, 2, SIZE)).toBe(0)
    expect(clampPan(Number.POSITIVE_INFINITY, 2, SIZE)).toBe(0)
  })
})

describe('la vue ramenée à ce que le cadre peut montrer', () => {
  it('recadre en même temps l’échelle et les deux décalages', () => {
    expect(settle({ scale: 9, x: 9999, y: -9999 }, SIZE)).toEqual({
      scale: MAX_SCALE,
      x: slackAt(MAX_SCALE),
      y: -slackAt(MAX_SCALE),
    })
  })

  it('remet le plateau entier et centré quand l’échelle retombe au repos', () => {
    // Le décalage doit tomber avec l'échelle, et dans le même calcul : recadrer
    // le décalage avec l'ancienne échelle laisserait un plateau au repos posé
    // de travers dans son cadre.
    expect(plain(settle({ scale: 0.25, x: 40, y: -40 }, SIZE))).toEqual(REST)
  })
})

describe('le plateau est-il grossi ?', () => {
  it('répond non au repos, et non à un millième près', () => {
    expect(zoomed(MIN_SCALE)).toBe(false)
    // Un pincement rendu laisse souvent traîner un résidu minuscule. Sans la
    // marge, le bouton « revenir » resterait allumé sur un plateau entier.
    expect(zoomed(1.0005)).toBe(false)
  })

  it('répond oui dès que le plateau déborde vraiment', () => {
    expect(zoomed(1.05)).toBe(true)
    expect(zoomed(STEP_SCALE)).toBe(true)
    expect(zoomed(MAX_SCALE)).toBe(true)
  })
})

describe('les deux doigts, résumés', () => {
  it('donne leur écart et leur milieu', () => {
    expect(gripOf({ x: 0, y: 0 }, { x: 6, y: 8 })).toEqual({ gap: 10, x: 3, y: 4 })
  })

  it('ne dépend pas de l’ordre dans lequel les doigts se sont posés', () => {
    // Les pointeurs arrivent dans l'ordre du système, pas dans le nôtre : un
    // écart qui changerait de signe selon le doigt lu en premier ferait sauter
    // le plateau d'un pincement à l'autre.
    const a = { x: 40, y: 90 }
    const b = { x: 160, y: 30 }
    expect(gripOf(b, a)).toEqual(gripOf(a, b))
  })

  it('rend un écart nul pour deux doigts au même endroit', () => {
    expect(gripOf({ x: 70, y: 70 }, { x: 70, y: 70 }).gap).toBe(0)
  })
})

describe('le point que le zoom doit garder immobile', () => {
  it('laisse le décalage tel quel quand l’échelle ne change pas', () => {
    expect(focalPan(17, 1.7, 1.7, 250)).toBeCloseTo(17, 10)
  })

  it('ne divise pas par une échelle de départ nulle', () => {
    // Sans la garde, le rapport des échelles vaudrait 2 / 0 : le décalage
    // partirait à l'infini pour un état que le liage peut très bien produire.
    expect(focalPan(5, 0, 2, 100)).toBe(5)
    expect(focalPan(5, -1, 2, 100)).toBe(5)
  })

  it('éloigne du centre le point qu’on vise à côté', () => {
    // Grossir de deux autour d'un point posé à 100 px du centre demande de
    // reculer la couche de 100 px : sans ce recul, c'est le cœur du plateau
    // qui viendrait sous les doigts.
    expect(focalPan(0, 1, 2, 100)).toBe(-100)
    // Visé en plein centre, le grossissement ne décale rien.
    expect(focalPan(0, 1, 2, 0)).toBe(0)
  })

  it('garde sous le doigt le point visé quand on grossit', () => {
    const before: View = { scale: 1.4, x: 20, y: -10 }
    const aim = { x: 60, y: 40 }
    const bx = boardPoint(aim.x, before.x, before.scale)
    const by = boardPoint(aim.y, before.y, before.scale)

    const after = zoomTo(before, SIZE, 2, aim)

    // LA propriété du zoom au doigt : le point visé se retrouve au même pixel
    // après le zoom. Sans elle, le plateau fuit le geste — on écarte les doigts
    // sur son écurie et c'est le centre du plateau qui vient dessous.
    expect(screenPoint(bx, after.x, after.scale)).toBeCloseTo(aim.x, 10)
    expect(screenPoint(by, after.y, after.scale)).toBeCloseTo(aim.y, 10)
  })

  it('garde sous le doigt le point visé quand on rapetisse', () => {
    const before: View = { scale: 2, x: 40, y: -20 }
    const aim = { x: 30, y: -15 }
    const bx = boardPoint(aim.x, before.x, before.scale)
    const by = boardPoint(aim.y, before.y, before.scale)

    const after = zoomTo(before, SIZE, 1.5, aim)

    // Le retour en arrière obéit à la même règle : le point visé ne bouge pas.
    expect(screenPoint(bx, after.x, after.scale)).toBeCloseTo(aim.x, 10)
    expect(screenPoint(by, after.y, after.scale)).toBeCloseTo(aim.y, 10)
  })
})

describe('grossir en visant un point du cadre', () => {
  it('monte au cran du bouton sans décaler quand on vise le centre', () => {
    expect(zoomTo(REST, SIZE, STEP_SCALE, { x: 0, y: 0 })).toEqual({
      scale: STEP_SCALE,
      x: 0,
      y: 0,
    })
  })

  it('borne l’échelle demandée et le décalage qui en découle', () => {
    const next = zoomTo(REST, SIZE, 10, { x: 1000, y: -1000 })

    // Dix fois n'existe pas : on s'arrête au maximum.
    expect(next.scale).toBe(MAX_SCALE)
    // Et la visée, absurde, ne fait pas sortir le plateau de son cadre : le
    // point fixe cède devant la borne, parce qu'un bord blanc se voit et pas
    // un pixel de dérive.
    expect(Math.abs(next.x)).toBeLessThanOrEqual(slackAt(MAX_SCALE))
    expect(Math.abs(next.y)).toBeLessThanOrEqual(slackAt(MAX_SCALE))
  })

  it('remet le plateau entier et centré quand on demande moins que le repos', () => {
    expect(plain(zoomTo({ scale: 2, x: 90, y: -90 }, SIZE, 0.2, { x: 0, y: 0 }))).toEqual(REST)
  })
})

describe('ce qu’un pincement fait de la vue', () => {
  it('grossit sans décaler quand les doigts s’écartent autour de leur milieu', () => {
    const from = gripOf({ x: 150, y: 200 }, { x: 250, y: 200 })
    const to = gripOf({ x: 100, y: 200 }, { x: 300, y: 200 })

    // Le milieu n'a pas bougé, et il tombe sur le centre du cadre : l'écart a
    // doublé, donc l'échelle double, et rien ne se décale.
    expect(pinch(REST, SIZE, from, to, CENTRE)).toEqual({ scale: 2, x: 0, y: 0 })
  })

  it('déplace sans grossir quand les doigts glissent sans s’écarter', () => {
    const from = gripOf({ x: 150, y: 200 }, { x: 250, y: 200 })
    const to = gripOf({ x: 180, y: 230 }, { x: 280, y: 230 })
    const view: View = { scale: 2, x: 0, y: 0 }

    // Ne garder que l'écart, c'est un zoom qu'on ne peut pas recadrer sans
    // lever les doigts : le milieu qui glisse doit promener le plateau.
    expect(pinch(view, SIZE, from, to, CENTRE)).toEqual({ scale: 2, x: 30, y: 30 })
  })

  it('ne rend ni NaN ni l’infini quand les deux doigts partent du même point', () => {
    const view: View = { scale: 1.6, x: 12, y: -4 }
    const from = gripOf({ x: 100, y: 100 }, { x: 100, y: 100 })
    const to = gripOf({ x: 80, y: 100 }, { x: 120, y: 100 })

    const next = pinch(view, SIZE, from, to, CENTRE)

    // Sans la garde `from.gap > 0`, le rapport des écarts vaudrait 40 / 0 :
    // l'échelle partirait à l'infini et les décalages à NaN. Une vue qui n'est
    // plus un nombre ne se rattrape pas, même en levant les doigts.
    expect(Number.isFinite(next.scale)).toBe(true)
    expect(Number.isFinite(next.x)).toBe(true)
    expect(Number.isFinite(next.y)).toBe(true)
    // Faute d'écart de départ, il n'y a pas de rapport à appliquer : la vue
    // reste ce qu'elle était, et le geste reprend dès que les doigts s'écartent.
    expect(next).toEqual(view)
  })

  it('resserre le décalage quand le pincement rend du plateau', () => {
    const from = gripOf({ x: 100, y: 200 }, { x: 300, y: 200 })
    const to = gripOf({ x: 150, y: 200 }, { x: 250, y: 200 })
    // Le plateau est grossi au maximum et poussé contre son bord droit.
    const view: View = { scale: MAX_SCALE, x: slackAt(MAX_SCALE), y: 0 }

    const next = pinch(view, SIZE, from, to, CENTRE)

    // L'écart des doigts a fondu de moitié, donc l'échelle aussi — et le débord
    // promenable avec elle. Un décalage qui était légitime à l'échelle d'avant
    // ne l'est plus, et le garder laisserait une bande de vide sur le bord que
    // le pincement vient de découvrir.
    //
    // La moitié du maximum, et non le nombre qu'elle vaut aujourd'hui : le
    // maximum est un réglage de confort, et le resserrement du décalage n'a
    // rien à voir avec la valeur qu'on lui donne.
    const half = MAX_SCALE / 2
    expect(next).toEqual({ scale: half, x: slackAt(half), y: 0 })
  })
})

describe('le plateau qu’on promène au doigt', () => {
  it('ne bouge pas tant que le plateau est au repos', () => {
    // Au repos il n'y a rien à promener : le doigt vise un cheval, et le
    // laisser décaler le plateau volerait le geste au jeu.
    expect(plain(pan(REST, SIZE, 60, -60))).toEqual(REST)
  })

  it('suit le doigt une fois le plateau grossi', () => {
    expect(pan({ scale: 2, x: 0, y: 0 }, SIZE, 50, -30)).toEqual({ scale: 2, x: 50, y: -30 })
  })

  it('s’arrête au bord du plateau plutôt que de montrer du vide', () => {
    // Le décalage demandé vaut 250, le débord n'en autorise que 180 : le doigt
    // continue, le plateau non.
    expect(pan({ scale: 2, x: 150, y: 0 }, SIZE, 100, 0)).toEqual({ scale: 2, x: 180, y: 0 })
  })
})

describe('les deux appuis qui grossissent le plateau', () => {
  const first = { at: 1_000, x: 100, y: 100 }

  it('reconnaît deux appuis rapprochés dans le temps et sur l’écran', () => {
    expect(isDoubleTap(first, { at: 1_200, x: 104, y: 97 })).toBe(true)
    // Aux bornes exactes c'en est encore un : un doigt qui tombe pile à la
    // limite doit être servi, sinon le double appui paraît capricieux.
    expect(isDoubleTap(first, { at: first.at + DOUBLE_TAP_MS, x: first.x, y: first.y })).toBe(true)
    expect(isDoubleTap(first, { at: 1_100, x: first.x + DOUBLE_TAP_PX, y: first.y })).toBe(true)
  })

  it('refuse un second appui arrivé trop tard', () => {
    // Deux appuis séparés d'une demi-seconde sont deux gestes distincts, et
    // grossir le plateau sur le second surprendrait la main.
    expect(isDoubleTap(first, { at: first.at + DOUBLE_TAP_MS + 1, x: 100, y: 100 })).toBe(false)
    expect(isDoubleTap(first, { at: 1_600, x: 100, y: 100 })).toBe(false)
  })

  it('refuse un second appui posé trop loin', () => {
    // Deux appuis rapides sur deux chevaux différents ne sont pas un double
    // appui : ce sont deux coups joués, et le plateau ne doit pas sauter.
    const tooFar = { at: 1_100, x: first.x + DOUBLE_TAP_PX + 1, y: first.y }
    expect(isDoubleTap(first, tooFar)).toBe(false)
    // Compte en diagonale : hypot(24, 24) dépasse les 28 px, chaque axe non.
    expect(isDoubleTap(first, { at: 1_100, x: 124, y: 124 })).toBe(false)
  })

  it('refuse un appui quand il n’y a pas eu de premier', () => {
    expect(isDoubleTap(null, { at: 1_000, x: 100, y: 100 })).toBe(false)
  })
})
