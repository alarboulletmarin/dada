// @vitest-environment jsdom
/**
 * Le zoom du plateau, monté sur de vrais doigts.
 *
 * `zoom.test.ts` vérifie le calcul — bornes, recadrage, point fixe — et il le
 * fait bien. Mais toute la partie qui décide *ce qu'est* un geste vit ailleurs :
 * combien de doigts, lequel promène, lequel ne fait que passer, et lequel ne
 * doit surtout pas voler l'appui d'un cheval. Ce fichier-là ne teste que ça.
 *
 * Le trou qu'il bouche a une panne à son nom. Les deux doigts d'un pincement
 * se lèvent à quelques millisecondes et quelques pixels l'un de l'autre —
 * c'est-à-dire exactement dans la fenêtre d'un double appui — et le second
 * lever passait pour le second appui du premier. Pincer pour **revenir** au
 * plateau entier claquait donc le zoom à sa valeur de repos au relâchement,
 * annulant le geste qu'on venait de faire ; deux doigts simplement posés sur
 * le cadre le faisaient sauter à 1,9 sans qu'on ait rien demandé ; et un appui
 * sur un cheval juste après un pincement n'atteignait plus le cheval.
 *
 * Le calcul n'y était pour rien : `isDoubleTap` fait exactement ce qu'elle
 * promet. C'est le liage qui comptait les doigts de travers, et le liage
 * n'était monté nulle part.
 */

import { describe, expect, it } from 'vitest'
import { bindZoom, MAX_SCALE, MIN_SCALE, STEP_SCALE } from './zoom.ts'

/** Le côté du cadre dans ces tests — jsdom ne met rien en page tout seul. */
const SIZE = 300

/**
 * Un cadre de taille connue, et la couche qui bouge dedans.
 *
 * `clientWidth` vaut zéro sous jsdom et `getBoundingClientRect` rend des zéros :
 * sans ces deux-là, toute translation serait ramenée à zéro par le bornage et
 * l'on ne testerait plus que l'échelle.
 */
function mount(ignore?: string): {
  frame: HTMLElement
  layer: HTMLElement
  pawn: HTMLElement
  zoom: ReturnType<typeof bindZoom>
} {
  const frame = document.createElement('div')
  const layer = document.createElement('div')
  // Un cheval, pour vérifier qu'un appui qui le vise ne devient jamais autre
  // chose : sur ce plateau, taper EST le geste du jeu.
  const pawn = document.createElement('div')
  pawn.className = 'pawn'
  layer.append(pawn)
  frame.append(layer)
  document.body.append(frame)
  Object.defineProperty(frame, 'clientWidth', { value: SIZE, configurable: true })
  frame.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: SIZE, height: SIZE, right: SIZE, bottom: SIZE, x: 0, y: 0 }) as DOMRect
  const zoom = ignore === undefined ? bindZoom({ frame, layer }) : bindZoom({ frame, layer, ignore })
  return { frame, layer, pawn, zoom }
}

/**
 * Un événement de pointeur, en carton.
 *
 * jsdom n'implémente pas `PointerEvent`, et `timeStamp` est en lecture seule
 * sur un vrai événement — or c'est lui que le double appui consulte. Les deux
 * se posent donc à la main, ce qui a l'avantage de rendre le temps explicite
 * dans chaque test au lieu de dépendre de la vitesse de la machine.
 */
function point(type: string, id: number, x: number, y: number, at: number): Event {
  const ev = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'pointerId', { value: id })
  Object.defineProperty(ev, 'timeStamp', { value: at })
  return ev
}

/** L'échelle réellement posée sur la couche, lue dans son `transform`. */
function scaleOf(layer: HTMLElement): number {
  const found = /scale\(([\d.]+)\)/.exec(layer.style.transform)
  return found ? Number(found[1]) : 1
}

/**
 * Deux doigts qui se posent, s'écartent d'un facteur, puis se lèvent.
 *
 * `half` est leur demi-écart de départ, et il compte : c'est lui qui décide
 * s'ils finissent loin l'un de l'autre ou presque au même endroit. Un
 * pincement qui RAPETISSE fait converger les doigts jusqu'à quelques
 * millimètres — et c'est précisément là que leurs deux levers ressemblaient à
 * un double appui.
 */
function pinchBy(frame: HTMLElement, factor: number, at = 1000, half = 40): void {
  const grown = half * factor
  frame.dispatchEvent(point('pointerdown', 1, 150 - half, 150, at))
  frame.dispatchEvent(point('pointerdown', 2, 150 + half, 150, at + 5))
  frame.dispatchEvent(point('pointermove', 1, 150 - grown, 150, at + 20))
  frame.dispatchEvent(point('pointermove', 2, 150 + grown, 150, at + 25))
  frame.dispatchEvent(point('pointerup', 1, 150 - grown, 150, at + 40))
  frame.dispatchEvent(point('pointerup', 2, 150 + grown, 150, at + 45))
}

describe('le plateau qu’on pince', () => {
  it('grossit de l’écart des doigts', () => {
    const { frame, layer, zoom } = mount()
    pinchBy(frame, 2)

    // Deux fois plus écartés, deux fois plus gros — et c'est bien la couche
    // qui porte le grossissement, pas le cadre.
    expect(zoom.scale()).toBeCloseTo(2, 5)
    expect(scaleOf(layer)).toBeCloseTo(2, 5)
    expect(frame.classList.contains('zoomed')).toBe(true)
  })

  it('reste grossi quand les doigts se lèvent au même endroit', () => {
    const { frame, zoom } = mount()
    // On écarte largement, puis on rapproche les doigts avant de lever — le
    // geste ordinaire de qui relâche un pincement sans y penser. Les deux
    // levers tombent alors dans la fenêtre d'un double appui.
    frame.dispatchEvent(point('pointerdown', 1, 90, 150, 1000))
    frame.dispatchEvent(point('pointerdown', 2, 210, 150, 1005))
    frame.dispatchEvent(point('pointermove', 1, 60, 150, 1020))
    frame.dispatchEvent(point('pointermove', 2, 240, 150, 1025))
    const grown = zoom.scale()
    frame.dispatchEvent(point('pointerup', 1, 148, 150, 1200))
    frame.dispatchEvent(point('pointerup', 2, 152, 150, 1205))

    // La panne d'origine : le second lever passait pour le second appui du
    // premier, et le plateau se remettait à plat au relâchement.
    expect(grown).toBeGreaterThan(1.2)
    expect(zoom.scale()).toBeGreaterThan(MIN_SCALE)
  })

  it('rend du plateau quand les doigts se rapprochent', () => {
    const { frame, zoom } = mount()
    pinchBy(frame, 2.4, 1000, 50)
    const wide = zoom.scale()
    expect(wide).toBeGreaterThan(2)

    // Le geste inverse recule d'un cran, il ne remet pas à plat : entre le
    // plateau entier et le plus gros grossissement, il y a tout ce qui rend le
    // zoom utilisable, et un pincement qui ne saurait aller que d'un bout à
    // l'autre ne servirait qu'à choisir entre deux tailles.
    pinchBy(frame, 0.7, 2000, 50)
    expect(zoom.scale()).toBeLessThan(wide)
    expect(zoom.scale()).toBeGreaterThan(MIN_SCALE)
  })

  it('ne fait rien de deux doigts posés puis relevés', () => {
    const { frame, zoom } = mount()
    frame.dispatchEvent(point('pointerdown', 1, 140, 150, 1000))
    frame.dispatchEvent(point('pointerdown', 2, 160, 150, 1005))
    frame.dispatchEvent(point('pointerup', 1, 140, 150, 1040))
    frame.dispatchEvent(point('pointerup', 2, 160, 150, 1045))

    // Un pouce qui traîne sur le cadre pendant qu'on regarde le plateau : rien
    // ne s'est écarté, rien ne doit grossir.
    expect(zoom.scale()).toBe(MIN_SCALE)
    expect(frame.classList.contains('zoomed')).toBe(false)
  })

  it('rend l’appui qui suit au cheval qu’il vise', () => {
    const { frame, zoom } = mount()
    let clicks = 0
    frame.addEventListener('click', () => clicks++)

    pinchBy(frame, 2, 1000)
    const was = zoom.scale()

    // Un appui simple posé là où le dernier doigt s'est levé, tout de suite
    // après : c'est quelqu'un qui vient de cadrer son plateau et qui touche un
    // cheval. Il ne doit ni basculer le zoom ni perdre son clic.
    frame.dispatchEvent(point('pointerdown', 3, 230, 150, 1100))
    frame.dispatchEvent(point('pointerup', 3, 230, 150, 1140))
    frame.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(zoom.scale()).toBeCloseTo(was, 5)
    expect(clicks).toBe(1)
  })

  it('ne dépasse jamais son plafond, même à quatre doigts d’écart', () => {
    const { frame, zoom } = mount()
    pinchBy(frame, 20)

    // Le bornage vit dans le calcul, mais rien ne garantissait que le liage
    // lui passe bien par là plutôt que d'écrire l'échelle en direct.
    expect(zoom.scale()).toBe(MAX_SCALE)
  })
})

describe('le plateau qu’on tape et qu’on promène', () => {
  it('laisse passer un doigt tant qu’il est au repos', () => {
    const { frame, layer, zoom } = mount()
    let clicks = 0
    frame.addEventListener('click', () => clicks++)

    frame.dispatchEvent(point('pointerdown', 1, 100, 100, 1000))
    frame.dispatchEvent(point('pointermove', 1, 180, 160, 1020))
    frame.dispatchEvent(point('pointerup', 1, 180, 160, 1040))
    frame.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    // C'est la règle qui rend tout le reste sans danger : un plateau entier se
    // touche exactement comme avant, et un doigt qui glisse dessus ne lui vole
    // ni son clic ni sa place.
    expect(zoom.scale()).toBe(MIN_SCALE)
    expect(layer.style.transform).toBe('')
    expect(clicks).toBe(1)
  })

  it('se promène au doigt une fois grossi, et garde le clic pour lui', () => {
    const { frame, layer, zoom } = mount()
    let clicks = 0
    frame.addEventListener('click', () => clicks++)

    zoom.toggle()
    expect(zoom.scale()).toBe(STEP_SCALE)

    frame.dispatchEvent(point('pointerdown', 1, 100, 100, 1000))
    frame.dispatchEvent(point('pointermove', 1, 160, 140, 1020))
    frame.dispatchEvent(point('pointerup', 1, 160, 140, 1040))
    frame.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    // Le plateau a suivi le doigt...
    expect(layer.style.transform).toContain('translate(')
    expect(layer.style.transform).not.toContain('translate(0px, 0px)')
    // ...et le clic qui termine le geste ne doit pas atteindre le cheval sur
    // lequel le doigt s'est arrêté : on déplaçait, on ne jouait pas.
    expect(clicks).toBe(0)
  })

  it('grossit d’un double appui, et remontre tout au suivant', () => {
    const { frame, zoom } = mount()

    frame.dispatchEvent(point('pointerdown', 1, 120, 120, 1000))
    frame.dispatchEvent(point('pointerup', 1, 120, 120, 1020))
    frame.dispatchEvent(point('pointerdown', 1, 122, 121, 1100))
    frame.dispatchEvent(point('pointerup', 1, 122, 121, 1120))
    expect(zoom.scale()).toBe(STEP_SCALE)

    frame.dispatchEvent(point('pointerdown', 1, 122, 121, 1300))
    frame.dispatchEvent(point('pointerup', 1, 122, 121, 1320))
    frame.dispatchEvent(point('pointerdown', 1, 124, 122, 1400))
    frame.dispatchEvent(point('pointerup', 1, 124, 122, 1420))
    expect(zoom.scale()).toBe(MIN_SCALE)
  })

  it('rend l’appui suivant au cheval même quand aucun clic ne suit le glissement', () => {
    const { frame, zoom, pawn } = mount()
    let clicks = 0
    frame.addEventListener('click', () => clicks++)

    zoom.toggle()
    // On promène le plateau. Au-delà d'une quinzaine de pixels, le navigateur
    // d'un téléphone ne synthétise AUCUN clic derrière le geste — et c'est le
    // cas normal, promener un plateau grossi se compte en centaines de pixels.
    frame.dispatchEvent(point('pointerdown', 1, 100, 100, 1000))
    frame.dispatchEvent(point('pointermove', 1, 220, 200, 1020))
    frame.dispatchEvent(point('pointerup', 1, 220, 200, 1040))

    // Le drapeau « avale le clic » n'était remis à faux que par un clic qui
    // arrivait : sans clic, il restait armé et mangeait l'appui SUIVANT, celui
    // qui visait un cheval. Un coup mort à chaque fois qu'on recadre.
    frame.dispatchEvent(point('pointerdown', 2, 150, 150, 2000))
    frame.dispatchEvent(point('pointerup', 2, 150, 150, 2020))
    pawn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clicks).toBe(1)
  })

  it('laisse deux chevaux touchés coup sur coup jouer leurs deux coups', () => {
    const { frame, zoom, pawn } = mount('.pawn')
    let clicks = 0
    frame.addEventListener('click', () => clicks++)

    // Deux appuis rapprochés sur des chevaux, c'est le geste ORDINAIRE du jeu,
    // pas une demande de zoom. Sans l'exception, le second était avalé et
    // grossissait le plateau à la place du coup qu'on voulait jouer.
    for (const at of [1000, 1100]) {
      pawn.dispatchEvent(point('pointerdown', 1, 150, 150, at))
      pawn.dispatchEvent(point('pointerup', 1, 152, 151, at + 20))
      pawn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    }

    expect(zoom.scale()).toBe(MIN_SCALE)
    expect(clicks).toBe(2)
  })

  it('oublie le geste en cours quand la manche repart', () => {
    const { frame, zoom, pawn } = mount('.pawn')
    let clicks = 0
    frame.addEventListener('click', () => clicks++)

    zoom.toggle()
    frame.dispatchEvent(point('pointerdown', 1, 150, 150, 1000))
    window.dispatchEvent(point('pointermove', 1, 150, 220, 1020))
    // L'hôte relance une partie pendant qu'un doigt promène le plateau. Le
    // plateau revient à sa taille — mais le doigt, lui, est toujours posé.
    zoom.reset()
    window.dispatchEvent(point('pointermove', 1, 150, 260, 1040))
    window.dispatchEvent(point('pointerup', 1, 150, 260, 1060))

    // Sans ce ménage, le déplacement continuait dans le vide, réarmait
    // l'avalage du clic, et le premier appui de la manche neuve mourait.
    frame.dispatchEvent(point('pointerdown', 2, 150, 150, 2000))
    window.dispatchEvent(point('pointerup', 2, 150, 150, 2050))
    pawn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clicks).toBe(1)
  })

  it('ne garde pas un doigt relâché hors du cadre', () => {
    const { frame, zoom } = mount()

    // Le doigt part du plateau et se relève ailleurs — sur le dé, sur la barre
    // du haut, hors de l'écran. Écoutée sur le cadre seul, cette levée-là ne
    // nous parvenait jamais : le doigt restait inscrit à vie, et le moindre
    // appui comptait ensuite pour un DEUXIÈME contact, donc pour un pincement.
    frame.dispatchEvent(point('pointerdown', 9, 10, 10, 500))
    window.dispatchEvent(point('pointerup', 9, 400, 900, 550))

    frame.dispatchEvent(point('pointerdown', 1, 150, 150, 1000))
    window.dispatchEvent(point('pointermove', 1, 150, 190, 1030))
    window.dispatchEvent(point('pointerup', 1, 150, 190, 1050))

    // Plateau au repos : un doigt ne fait rien, et surtout pas grossir.
    expect(zoom.scale()).toBe(MIN_SCALE)
  })

  it('ne prend pas deux appuis éloignés dans le temps pour un double', () => {
    const { frame, zoom } = mount()

    frame.dispatchEvent(point('pointerdown', 1, 120, 120, 1000))
    frame.dispatchEvent(point('pointerup', 1, 120, 120, 1020))
    // Deux secondes plus tard : ce sont deux coups joués, pas un geste.
    frame.dispatchEvent(point('pointerdown', 1, 120, 120, 3000))
    frame.dispatchEvent(point('pointerup', 1, 120, 120, 3020))

    expect(zoom.scale()).toBe(MIN_SCALE)
  })

  it('oublie un doigt que le système lui reprend', () => {
    const { frame, zoom } = mount()

    frame.dispatchEvent(point('pointerdown', 1, 140, 150, 1000))
    frame.dispatchEvent(point('pointerdown', 2, 160, 150, 1005))
    // Un appel arrive, le geste est annulé : le plateau ne doit pas rester
    // avec deux doigts fantômes qui fausseraient le pincement suivant.
    frame.dispatchEvent(point('pointercancel', 1, 140, 150, 1010))
    frame.dispatchEvent(point('pointercancel', 2, 160, 150, 1012))

    pinchBy(frame, 2, 2000)
    expect(zoom.scale()).toBeCloseTo(2, 5)
  })

  it('retrouve son double appui après un geste que le système a repris', () => {
    const { frame, zoom } = mount()

    frame.dispatchEvent(point('pointerdown', 1, 140, 150, 1000))
    frame.dispatchEvent(point('pointerdown', 2, 160, 150, 1005))
    frame.dispatchEvent(point('pointercancel', 1, 140, 150, 1010))
    frame.dispatchEvent(point('pointercancel', 2, 160, 150, 1012))

    // Le drapeau « ce geste comptait deux doigts » ne retombait qu'au relâché
    // normal : après une annulation il restait posé pour toujours, et il
    // fallait alors TROIS appuis pour obtenir un double appui.
    frame.dispatchEvent(point('pointerdown', 3, 120, 120, 2000))
    frame.dispatchEvent(point('pointerup', 3, 120, 120, 2020))
    frame.dispatchEvent(point('pointerdown', 3, 122, 121, 2100))
    frame.dispatchEvent(point('pointerup', 3, 122, 121, 2120))
    expect(zoom.scale()).toBe(STEP_SCALE)
  })

  it('ne saute pas quand un troisième doigt entre dans le geste', () => {
    const { frame, zoom } = mount()

    // Deux doigts pincent, une paume effleure le bord du plateau — qui va bord
    // à bord, c'est le geste normal d'une main. Puis l'un des deux se lève.
    frame.dispatchEvent(point('pointerdown', 1, 110, 150, 1000))
    frame.dispatchEvent(point('pointerdown', 2, 190, 150, 1005))
    frame.dispatchEvent(point('pointermove', 1, 90, 150, 1020))
    frame.dispatchEvent(point('pointerdown', 3, 150, 295, 1040))
    const before = zoom.scale()
    frame.dispatchEvent(point('pointerup', 1, 90, 150, 1060))

    // L'écart de référence décrivait encore les deux premiers doigts, alors
    // que la prise suivante en désignait deux autres : le rapport des deux
    // envoyait le plateau au plafond au premier pixel de mouvement.
    frame.dispatchEvent(point('pointermove', 2, 191, 150, 1080))
    expect(zoom.scale()).toBeCloseTo(before, 1)
  })
})
