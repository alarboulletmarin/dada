/**
 * Le tirage d'une carte, joué à l'écran.
 *
 * ## Pourquoi ça se joue chez tout le monde
 *
 * Un tirage est un **événement de table**, comme le dé qui roule : c'est le
 * moment où le plateau donne quelque chose à quelqu'un, et il vaut d'être vu
 * par ceux à qui il ne donne rien. Sans image, il ne restait qu'une ligne de
 * texte en haut de l'écran, et la case marchée n'avait l'air d'avoir rien fait.
 *
 * Mais une main est secrète : la carte d'un autre joueur voyage **dos visible**
 * et ne se retourne jamais. On montre qu'une carte est partie chez lui, pas
 * laquelle — exactement ce que l'annonce du haut d'écran dit déjà.
 *
 * ## Pourquoi une file et pas une superposition
 *
 * Une table de bots peut ramasser deux cases coup sur coup. Deux cartes qui
 * volent en même temps ne se lisent ni l'une ni l'autre : elles se suivent
 * donc, et rien ne se perd. La file vit au niveau du module parce qu'il n'y a
 * qu'un écran, et qu'un second appelant ne doit pas pouvoir l'ignorer.
 *
 * ## Ce que ça ne fait jamais
 *
 * Bloquer. La partie continue derrière — les pairs jouent, les bots jouent,
 * l'état se met à jour. Le calque ne prend aucun appui, et sous
 * `prefers-reduced-motion` il ne se crée même pas : on saute à l'état final,
 * et il ne reste que l'annonce écrite.
 */

import { h } from './dom.ts'
import { icon, type IconName } from './icons.ts'

/** Le calque dédié, au-dessus du plateau et sous les nouvelles du haut. */
const LAYER = 'cardfly-layer'

/** La carte à sa taille de lecture. Le reste n'est que mise à l'échelle. */
const CARD_W = 92
const CARD_H = 124

/**
 * Les durées. Elles descendent telles quelles dans le CSS par variables :
 * une seule source, sinon l'une des deux dérive et l'animation saute.
 *
 * Le compte : 900 ms pour voir la carte (elle se soulève, se retourne, se
 * laisse lire), puis le voyage. Moins, on ne lit pas le nom ; plus, on attend.
 * Total au pire — la carte refusée — 1,86 s.
 */
const LIFT_MS = 260
const FLIP_DELAY_MS = 180
const FLIP_MS = 420
/** Soulèvement + retournement + le temps de lire : la carte tient ce temps-là. */
const READ_MS = 900
const TRAVEL_MS = 480
const LAND_MS = 200
/** La carte refusée voyage un peu plus court : elle n'arrivera pas. */
const REJECT_TRAVEL_MS = 380
const REJECT_MS = 260
const FALL_MS = 320

/**
 * Ce que devient la carte à l'arrivée.
 *
 * - `bonus` : elle rétrécit vers la main (la sienne) ou vers la carte du joueur.
 * - `malus` : elle se pose sur ce qu'elle frappe — le cheval, ou le siège.
 * - `full` : elle rebondit et tombe en se fanant. La main était pleine.
 */
export type FlightKind = 'bonus' | 'malus' | 'full'

/** L'échelle d'arrivée, par famille : un bouton de main est petit, un cheval l'est plus. */
const SHRINK: Record<FlightKind, number> = { bonus: 0.26, malus: 0.4, full: 0.3 }

export type Flight = {
  kind: FlightKind
  /** La figure et le nom, ou `null` pour une carte qui reste dos visible. */
  face: { glyph: IconName; name: string } | null
  /** D'où elle se soulève : la case pouvoir, mesurée au moment du tirage. */
  from: () => DOMRect | null
  /**
   * Où elle va, mesuré au dernier moment : entre le tirage et le départ, le
   * bouton de la main a pu apparaître et la ligne de tour changer de hauteur.
   */
  to: () => DOMRect | null
  /** Le petit rebond de l'arrivée. Jamais appelé pour une carte refusée. */
  onArrive?: () => void
}

const reduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Deux trames avant de changer d'état : posé et modifié dans la même, le
 * navigateur ne voit qu'un seul état et la transition n'a pas lieu.
 */
const frame = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

let queue: Promise<void> = Promise.resolve()

/**
 * Met un tirage à la file et rend la promesse de sa fin.
 *
 * L'appelant peut l'attendre pour enchaîner (une annonce, une feuille de
 * guidage) sans jamais bloquer la partie : rien de ce qui vit ici ne retient
 * l'état du jeu.
 */
export function flyCard(flight: Flight): Promise<void> {
  const next = queue.then(
    () => play(flight),
    () => play(flight),
  )
  queue = next.catch(() => {})
  return next
}

function layer(): HTMLElement {
  const found = document.querySelector<HTMLElement>(`.${LAYER}`)
  if (found) return found
  const host = h('div', { class: LAYER, attrs: { 'aria-hidden': 'true' } })
  document.body.append(host)
  return host
}

/** Retire le calque quand il ne reste plus rien à y montrer. */
function sweep(): void {
  const host = document.querySelector<HTMLElement>(`.${LAYER}`)
  if (host && host.children.length === 0) host.remove()
}

function build(flight: Flight): HTMLElement {
  const back = h('span', { class: 'cardfly__side cardfly__back' }, h('i'))
  const face = flight.face
    ? h(
        'span',
        { class: `cardfly__side cardfly__face cardfly__face--${flight.kind}` },
        h('span', { class: 'cardfly__glyph' }, icon(flight.face.glyph, 28)),
        h('strong', { class: 'cardfly__name', text: flight.face.name }),
      )
    : null
  const el = h(
    'div',
    {
      class: `cardfly cardfly--${flight.kind}${flight.face ? '' : ' cardfly--facedown'}`,
      attrs: { 'aria-hidden': 'true' },
    },
    h('div', { class: 'cardfly__flip' }, back, face),
  )
  // Les durées descendent dans le CSS : le JS reste le seul endroit où elles
  // sont écrites, et les deux ne peuvent plus diverger.
  el.style.setProperty('--lift', `${LIFT_MS}ms`)
  el.style.setProperty('--flip', `${FLIP_MS}ms`)
  el.style.setProperty('--flip-delay', `${FLIP_DELAY_MS}ms`)
  el.style.setProperty('--land', `${LAND_MS}ms`)
  el.style.setProperty('--reject', `${REJECT_MS}ms`)
  el.style.setProperty('--fall', `${FALL_MS}ms`)
  el.style.setProperty('--k', String(SHRINK[flight.kind]))
  return el
}

async function play(flight: Flight): Promise<void> {
  const from = flight.from()
  // Pas de case d'où partir (plateau démonté, manche relancée), ou un joueur
  // qui a demandé moins de mouvement : on va droit à l'état final.
  if (!from || reduced()) {
    flight.onArrive?.()
    return
  }

  const el = build(flight)
  // `position: fixed` : les rects du plateau sont déjà en coordonnées d'écran,
  // il n'y a rien à convertir — et rien à recalculer si la page défile.
  el.style.left = `${from.left + from.width / 2 - CARD_W / 2}px`
  el.style.top = `${from.top + from.height / 2 - CARD_H / 2}px`
  layer().append(el)

  await frame()
  el.classList.add('is-up')
  await wait(READ_MS)

  // La destination se mesure ici et pas avant : le bouton de la main vient
  // peut-être d'apparaître, et la ligne de tour a changé de hauteur avec lui.
  const to = flight.to() ?? from
  el.style.setProperty('--dx', `${to.left + to.width / 2 - (from.left + from.width / 2)}px`)
  el.style.setProperty('--dy', `${to.top + to.height / 2 - (from.top + from.height / 2)}px`)

  if (flight.kind === 'full') {
    el.style.setProperty('--travel', `${REJECT_TRAVEL_MS}ms`)
    el.classList.add('is-away')
    await wait(REJECT_TRAVEL_MS)
    el.classList.add('is-bounced')
    await wait(REJECT_MS)
    el.classList.add('is-fallen')
    await wait(FALL_MS)
  } else {
    el.style.setProperty('--travel', `${TRAVEL_MS}ms`)
    el.classList.add('is-away')
    await wait(TRAVEL_MS)
    flight.onArrive?.()
    el.classList.add('is-landed')
    await wait(LAND_MS)
  }

  el.remove()
  sweep()
}

/** Tout balayer : une manche relancée, une partie quittée. */
export function clearFlights(): void {
  document.querySelector(`.${LAYER}`)?.remove()
}
