/**
 * La marque de Dada, en un seul endroit.
 *
 * Le dessin : un dé qui vient de tomber, et sur sa face les quatre pions —
 * vert, jaune, bleu, rouge, dans l'ordre où les sièges tournent autour du
 * plateau. C'est le jeu entier en un seul objet : un dé que quatre personnes
 * se passent. Rien d'autre n'était nécessaire, et rien de plus n'aurait
 * survécu à seize pixels de côté — la marque se lit dans un onglet comme sur
 * un écran d'accueil.
 *
 * L'encre chaude, la crème et les quatre couleurs sortent de `styles.css` : la
 * marque n'a pas de palette à elle, elle emprunte celle du plateau. Le dé
 * penché et l'ombre franche sous lui viennent de l'accueil, où deux dés sont
 * posés de travers sous le titre.
 *
 * Le dessin est décrit une fois, en formes (`iconShapes`), et non en SVG :
 * `iconSvg` en tire le fichier vectoriel, `make-icons.mjs` en tire les PNG en
 * les peignant lui-même. Deux sorties, une seule vérité — un SVG qu'il aurait
 * fallu re-parser pour le rendre en aurait fait deux.
 */

// Les jetons de `styles.css`, recopiés : un SVG ne lit pas de variables CSS.
const INK = '#3b2a1e' // --ink
const CREAM = '#fff7e6' // --cream
const SHADE = '#2a1e15' // --on-1 : l'ombre, une encre plus profonde que le fond
// Sièges : 0 en haut à gauche, puis dans le sens horaire — comme `--seat-N`.
const SEATS = ['#57b26a', '#f4c43c', '#4c93d8', '#e9564b']

/** Le dé est penché comme celui qu'on vient de lâcher. */
const TILT = -6

/**
 * Trois cadrages, un seul dessin.
 *
 * `app` — le fond porte ses propres coins arrondis : l'icône telle quelle,
 *   dans un onglet ou une liste d'applications qui ne la retouche pas.
 * `maskable` — le système découpe ce qu'il veut, jusqu'au cercle inscrit à
 *   80 % du côté. Fond carré à bord perdu, et un dé assez petit pour tenir
 *   entier dans ce cercle, ombre comprise.
 * `apple` — iOS arrondit lui-même et n'aime pas la transparence : fond carré,
 *   mais le dé garde sa taille.
 */
const FRAMES = {
  app: { radius: 112, die: 322 },
  maskable: { radius: 0, die: 300 },
  apple: { radius: 0, die: 322 },
}

export const FRAME_NAMES = /** @type {const} */ (Object.keys(FRAMES))

/** Le côté du carré de référence. Tout le dessin est exprimé dedans. */
export const CANVAS = 512

/**
 * @typedef {{ kind: 'rect', x: number, y: number, w: number, h: number, r: number, fill: string, tilt?: number }} Rect
 * @typedef {{ kind: 'circle', cx: number, cy: number, r: number, fill: string, tilt?: number }} Circle
 * @typedef {Rect | Circle} Shape
 */

/**
 * Le dessin, du fond vers le dessus.
 *
 * @param {keyof FRAMES} frame
 * @returns {Shape[]}
 */
export function iconShapes(frame = 'app') {
  const { radius, die } = FRAMES[frame]
  const c = CANVAS / 2
  const half = die / 2
  // Le rayon des coins du dé suit celui des dés de l'accueil (20 px sur ~70).
  const r = Math.round(die * 0.23)
  // Les pastilles tiennent le quart intérieur, comme les coins d'une face de
  // dé — assez grosses pour rester quatre taches de couleur en tout petit.
  const off = Math.round(die * 0.26)
  const pip = Math.round(die * 0.125)
  const drop = Math.round(die * 0.05)

  return [
    { kind: 'rect', x: 0, y: 0, w: CANVAS, h: CANVAS, r: radius, fill: INK },
    { kind: 'rect', x: c - half, y: c - half + drop, w: die, h: die, r, fill: SHADE, tilt: TILT },
    { kind: 'rect', x: c - half, y: c - half, w: die, h: die, r, fill: CREAM, tilt: TILT },
    ...[
      [c - off, c - off],
      [c + off, c - off],
      [c + off, c + off],
      [c - off, c + off],
    ].map(([cx, cy], i) => ({
      kind: /** @type {'circle'} */ ('circle'),
      cx,
      cy,
      r: pip,
      fill: SEATS[i],
      tilt: TILT,
    })),
  ]
}

/**
 * Le même dessin, en SVG. Les formes penchées partagent un seul groupe pivoté :
 * c'est ce qu'on écrirait à la main, et ça évite six `transform` identiques.
 *
 * @param {keyof FRAMES} frame
 */
export function iconSvg(frame = 'app') {
  const shapes = iconShapes(frame)
  const c = CANVAS / 2
  const draw = (s) =>
    s.kind === 'rect'
      ? `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"${s.r ? ` rx="${s.r}"` : ''} fill="${s.fill}" />`
      : `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${s.fill}" />`

  const flat = shapes.filter((s) => !s.tilt).map((s) => `  ${draw(s)}`)
  const tilted = shapes.filter((s) => s.tilt).map((s) => `    ${draw(s)}`)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" role="img" aria-label="Dada">
  <title>Dada</title>
${flat.join('\n')}
  <!-- Le dé, penché comme celui qu'on vient de lâcher, et son ombre portée. -->
  <g transform="rotate(${TILT} ${c} ${c})">
${tilted.join('\n')}
  </g>
</svg>
`
}
