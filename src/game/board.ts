/**
 * Géométrie du plateau.
 *
 * Deux choses se règlent ici, et il faut les tenir séparées :
 *
 * 1. **Les nombres** — longueur du circuit, longueur de l'escalier, écart entre
 *    deux départs, position des cases étoile et des cases pouvoir. Ce sont eux
 *    qui font l'équilibre d'une partie, et ils viennent de la variante.
 * 2. **Le dessin** — où tombe chaque case sur le plateau. C'est la *forme*
 *    (`BoardShape`), choisie dans le salon, et elle ne change aucun nombre.
 *
 * Un plateau rond et un plateau en croix se jouent donc exactement pareil :
 * même circuit, mêmes distances, mêmes cases protégées. C'est ce qui permet de
 * proposer quatre décors sans avoir à ré-équilibrer quatre jeux.
 *
 * ## Les circuits officiels
 *
 * | Variante        | Circuit | Bras | Escalier | Plateau                       |
 * |-----------------|---------|------|----------|-------------------------------|
 * | Petits chevaux  | 56      | 14   | 6        | croix française, coins inclus |
 * | Ludo            | 52      | 13   | 6        | croix internationale          |
 * | Rapide          | 40      | 10   | 4        | croix réduite                 |
 *
 * Le plateau français des petits chevaux compte **56 cases, 14 par quart** : le
 * tracé passe par les quatre angles du carré central, ce qui rend le circuit
 * orthogonalement continu. Le plateau international du Ludo en compte **52, 13
 * par quart** : il coupe ces quatre angles, et le pion y tourne en diagonale.
 * C'est la seule différence entre les deux dessins — même grille 15×15, mêmes
 * écuries, mêmes escaliers de 6 marches.
 *
 * ## Coordonnées
 *
 * `Cell` est en unités de case, mais **en flottant** : le rendu positionne
 * chaque case en pourcentage plutôt qu'en cellule de grille CSS. Sans cela, ni
 * le rond ni le serpent ne seraient dessinables.
 */

import type { Seat, Variant } from './types.ts'

export type Cell = {
  col: number
  row: number
  /** Rotation de la case, en degrés — les plateaux courbes orientent les leurs. */
  rot?: number
}

/** Les quatre décors. Le jeu est le même sur les quatre. */
export const BOARD_SHAPES = ['croix', 'carre', 'rond', 'serpent'] as const
export type BoardShape = (typeof BOARD_SHAPES)[number]

export const isBoardShape = (v: unknown): v is BoardShape =>
  typeof v === 'string' && (BOARD_SHAPES as readonly string[]).includes(v)

const SEATS: Seat[] = [0, 1, 2, 3]

/**
 * Une case est repérée par son **coin haut-gauche**, en unités de case. Le
 * rendu la pose en pourcentage de la grille : `left = col / grid`. Les nombres
 * entiers retombent exactement sur la grille de l'ancien plateau ; les
 * flottants servent aux formes courbes.
 */
const cell = (col: number, row: number, rot?: number): Cell =>
  rot === undefined ? { col, row } : { col, row, rot }

/**
 * Longueur de l'escalier, déduite du bras.
 *
 * C'est un nombre de jeu, pas de dessin : il vaut la même chose sur les quatre
 * formes, sinon changer de décor changerait la longueur d'une partie. Bras de
 * 14 ou 13 → 6 marches (les deux plateaux officiels) ; bras de 10 → 4.
 */
export const homeLengthFor = (arm: number): number => Math.floor((arm - 1) / 2)

/** Génère un segment droit de `count` cases depuis (col,row) dans la direction (dc,dr). */
function segment(col: number, row: number, dc: number, dr: number, count: number): Cell[] {
  return Array.from({ length: count }, (_, i) => cell(col + dc * i, row + dr * i))
}

const forSeat = <T>(fn: (seat: Seat) => T): Record<Seat, T> => {
  const out = {} as Record<Seat, T>
  for (const seat of SEATS) out[seat] = fn(seat)
  return out
}

// ───────────────────────────── ce qu'une forme produit ─────────────────────────────

/**
 * Le dessin, et lui seul. Les index (départs, étoiles, pouvoirs) sont calculés
 * après, à partir de la longueur du circuit : ils ne dépendent pas de la forme.
 */
type Drawing = {
  grid: number
  /** Circuit, en boucle fermée, dans le sens de la marche. */
  track: Cell[]
  /** Escalier privé de chaque siège, du circuit vers le cœur. */
  homePath: Record<Seat, Cell[]>
  /** Emplacements au repos, un par cheval. */
  stableSlots: Record<Seat, Cell[]>
  /** Bloc d'écurie : coin haut-gauche et taille, pour le décor. */
  stableBox: Record<Seat, { col: number; row: number; size: number }>
  center: Cell
  /**
   * Côté du cœur, en cases, centré sur `center`.
   *
   * Il vaut 1 sur la croix française, et pas trois : les quatre angles du carré
   * central y appartiennent au circuit — c'est même ce qui rend le tracé
   * continu — donc un bloc 3×3 les recouvrirait, et un cheval qui passe par là
   * semblerait déjà arrivé. Partout ailleurs, ces angles sont libres et le cœur
   * peut prendre toute la place.
   */
  centerSize: number
}

/**
 * Une forme reçoit la longueur d'un bras (`arm` = circuit / 4) et rend le
 * dessin correspondant. Elle est libre de la corriger — le carré, par exemple,
 * n'existe pas en bras impair — et c'est `track.length` qui fait foi ensuite.
 */
type ShapeBuilder = (arm: number, pawnsPerPlayer: number) => Drawing

// ───────────────────────────── la croix ─────────────────────────────

/**
 * La croix, dans ses deux tailles officielles.
 *
 * `S` est le côté du carré d'écurie ; la grille fait `2S+3`. Un bras pair
 * (14 → S=6) passe par les angles du carré central : c'est le plateau français
 * de 56 cases, orthogonalement continu. Un bras impair (13 → S=6) les coupe :
 * c'est le plateau international de 52 cases, où le pion tourne en diagonale
 * aux quatre angles — exactement comme sur un plateau imprimé.
 *
 *        col →   0 1 2 3 4 5 6 7 8 9 …
 *   row 0        ┌─────────┐ · · ┌─────────┐
 *     ↓          │ écurie  │ · · │ écurie  │
 *     …          └─────────┘ · · └─────────┘
 *     6          · · · · · · ·╳╳╳· · · · · ·
 *     7          · · · · · · ·╳✦╳· · · · · ·   ✦ = cœur
 *     8          · · · · · · ·╳╳╳· · · · · ·
 *     …          ┌─────────┐ · · ┌─────────┐
 *     …          └─────────┘ · · └─────────┘
 */
const buildCross: ShapeBuilder = (arm, pawnsPerPlayer) => {
  const corners = arm % 2 === 0
  const S = corners ? (arm - 2) / 2 : (arm - 1) / 2
  const grid = 2 * S + 3

  // Un quart de tour, du départ du siège 0 jusqu'au départ du siège 1. Le
  // premier segment longe la lisière du bras, remonte sa pointe, et bascule
  // sur le bras suivant.
  const quarter = (): Cell[] => [
    ...segment(0, S, 1, 0, corners ? S + 1 : S),
    ...segment(S, S - 1, 0, -1, S),
    cell(S + 1, 0),
  ]

  // Les trois autres quarts sont le premier, tourné d'un quart de tour autour
  // du centre. Écrire le tracé quatre fois inviterait la faute de frappe qui
  // décale un seul bras d'une case.
  const turn = (c: Cell): Cell => cell(grid - 1 - c.row, c.col)
  const track: Cell[] = []
  let q = quarter()
  for (let i = 0; i < 4; i++) {
    track.push(...q)
    q = q.map(turn)
  }

  const homeLength = homeLengthFor(arm)
  const homePath = forSeat<Cell[]>((seat) => {
    let path = segment(S + 1 - homeLength, S + 1, 1, 0, homeLength)
    for (let i = 0; i < seat; i++) path = path.map(turn)
    return path
  })

  const stableBox = forSeat((seat) => {
    const origin = [cell(0, 0), cell(S + 3, 0), cell(S + 3, S + 3), cell(0, S + 3)][seat]!
    return { col: origin.col, row: origin.row, size: S }
  })

  const stableSlots = forSeat<Cell[]>((seat) => {
    const box = stableBox[seat]
    return boxSlots(box.col, box.row, box.size, pawnsPerPlayer)
  })

  return {
    grid,
    track,
    homePath,
    stableSlots,
    stableBox,
    center: cell(S + 1, S + 1),
    centerSize: corners ? 1 : 3,
  }
}

/**
 * Les emplacements au repos dans un carré d'écurie de côté `size`.
 *
 * Les quatre coins, en retrait — le retrait est une *fraction* du côté et non
 * une case pleine : les écuries d'un plateau rond tiennent dans un coin de 3,5
 * cases, où un retrait fixe d'une case laisserait les chevaux dépasser de leur
 * enclos.
 */
function boxSlots(col: number, row: number, size: number, pawns: number): Cell[] {
  const near = size * 0.17
  const far = size - near - 1
  const corners = [cell(near, near), cell(far, near), cell(near, far), cell(far, far)]
  const picked = pawns === 4 ? corners : pawns === 2 ? [corners[0]!, corners[3]!] : null
  if (!picked) throw new Error(`pawnsPerPlayer=${pawns} non supporté (2 ou 4 attendu)`)
  return picked.map((c) => cell(c.col + col, c.row + row))
}

// ───────────────────────────── le carré ─────────────────────────────

/**
 * Le circuit fait le tour du plateau, les écuries occupent les quatre coins
 * intérieurs et les escaliers rejoignent le cœur en croix depuis le milieu de
 * chaque bord.
 *
 * Le carré demande un bras pair : l'escalier part du milieu d'un côté, et un
 * côté de longueur impaire n'a pas de milieu. Un bras impair est donc arrondi
 * au pair supérieur — le circuit gagne quatre cases, également réparties.
 */
const buildSquare: ShapeBuilder = (rawArm, pawnsPerPlayer) => {
  const arm = rawArm % 2 === 0 ? rawArm : rawArm + 1
  const grid = arm + 1
  const mid = (grid - 1) / 2

  // Le pourtour, dans le sens horaire depuis le coin haut-gauche.
  const ring: Cell[] = [
    ...segment(0, 0, 1, 0, grid),
    ...segment(grid - 1, 1, 0, 1, grid - 1),
    ...segment(grid - 2, grid - 1, -1, 0, grid - 1),
    ...segment(0, grid - 2, 0, -1, grid - 2),
  ]

  // Le siège 0 sort juste après le milieu du bord gauche et remonte vers son
  // écurie : sa dernière case de circuit est donc ce milieu, d'où part son
  // escalier. Faire commencer la boucle ailleurs mettrait les départs dans les
  // coins, où ils ne toucheraient l'écurie d'aucun siège.
  const entry = ring.findIndex((c) => c.col === 0 && c.row === mid)
  const track = [...ring.slice(entry + 1), ...ring.slice(0, entry + 1)]

  const homeLength = homeLengthFor(arm)
  const homePath = forSeat<Cell[]>((seat) => {
    const turn = (c: Cell): Cell => cell(grid - 1 - c.row, c.col)
    let path = segment(mid - homeLength, mid, 1, 0, homeLength)
    for (let i = 0; i < seat; i++) path = path.map(turn)
    return path
  })

  // Écuries : un carré posé dans chaque coin, à l'intérieur du pourtour et à
  // l'écart des escaliers, qui partent du milieu de chaque bord.
  const size = Math.min(pawnsPerPlayer === 4 ? 4.6 : 3.4, mid - 1.4)
  const far = grid - 1 - size
  const stableBox = forSeat((seat) => {
    const o = [cell(1, 1), cell(far, 1), cell(far, far), cell(1, far)][seat]!
    return { col: o.col, row: o.row, size }
  })
  const stableSlots = forSeat<Cell[]>((seat) => {
    const box = stableBox[seat]
    return boxSlots(box.col, box.row, size, pawnsPerPlayer)
  })

  return { grid, track, homePath, stableSlots, stableBox, center: cell(mid, mid), centerSize: 3 }
}

// ───────────────────────────── le rond et le serpent ─────────────────────────────

/**
 * Un anneau de cases posées sur un cercle. Le serpent est le même anneau avec
 * un rayon qui ondule : huit ventres, quatre par paire de sièges, pour que la
 * vague soit identique vue de chaque siège — un plateau qui serpente plus d'un
 * côté que de l'autre ne serait plus le même jeu pour tout le monde.
 *
 * Les cases sont orientées vers le cœur ; le rendu les tourne. C'est ce qui
 * fait la différence entre un anneau de cases et un collier de perles.
 */
/**
 * Un anneau de cases posées sur une courbe fermée. Le rond est un cercle ; le
 * serpent est le même cercle avec un rayon qui ondule — huit ventres, soit deux
 * par quart de tour, pour que la vague soit rigoureusement identique vue de
 * chaque siège. Un plateau qui serpenterait plus d'un côté que de l'autre ne
 * serait plus le même jeu pour tout le monde.
 *
 * **Les cases sont réparties à longueur d'arc constante, pas à angle constant.**
 * C'est toute la difficulté d'une courbe qui ondule : à angle constant, les
 * cases s'écartent sur les bosses et se chevauchent dans les creux, et le
 * plateau se lit comme un défaut d'impression. On mesure donc la courbe, puis on
 * y pose les cases tous les `longueur / trackLength`.
 *
 * Les cases sont orientées vers le cœur ; le rendu les tourne. C'est ce qui fait
 * la différence entre un anneau de cases et un collier de perles.
 */
function buildPolar(waves: number): ShapeBuilder {
  /** Finesse de l'échantillonnage de la courbe. Mille points suffisent : à
   *  cette densité, l'erreur sur la longueur d'arc est très inférieure au pixel. */
  const SAMPLES = 2000

  return (arm, pawnsPerPlayer) => {
    const trackLength = arm * 4
    const shape = (theta: number, radius: number) => radius * (1 + (waves === 0 ? 0 : 0.085 * Math.sin(waves * theta)))

    /** Longueur totale de la courbe pour un rayon donné. */
    const perimeter = (radius: number): number => {
      let total = 0
      let prev = at(0, radius)
      for (let i = 1; i <= SAMPLES; i++) {
        const point = at((i / SAMPLES) * Math.PI * 2, radius)
        total += Math.hypot(point.x - prev.x, point.y - prev.y)
        prev = point
      }
      return total
    }

    const at = (theta: number, radius: number) => {
      const r = shape(theta, radius)
      return { x: r * Math.sin(theta), y: -r * Math.cos(theta) }
    }

    // Une case occupe une unité : la courbe doit donc mesurer `trackLength`.
    // Trois corrections suffisent — le périmètre est presque proportionnel au
    // rayon, la suite converge en deux tours.
    let radius = trackLength / (2 * Math.PI)
    for (let i = 0; i < 3; i++) radius *= trackLength / perimeter(radius)

    // La courbe, échantillonnée une fois, avec sa longueur cumulée.
    const samples = Array.from({ length: SAMPLES + 1 }, (_, i) => {
      const theta = (i / SAMPLES) * Math.PI * 2
      return { theta, ...at(theta, radius) }
    })
    const lengths = [0]
    for (let i = 1; i <= SAMPLES; i++) {
      const a = samples[i - 1]!
      const b = samples[i]!
      lengths.push(lengths[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y))
    }
    const total = lengths[SAMPLES]!

    /** Le point de la courbe situé à `target` de longueur d'arc depuis midi. */
    const walk = (target: number) => {
      let i = 1
      while (i < SAMPLES && lengths[i]! < target) i++
      const a = samples[i - 1]!
      const b = samples[i]!
      const span = lengths[i]! - lengths[i - 1]!
      const f = span === 0 ? 0 : (target - lengths[i - 1]!) / span
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        // L'inclinaison suit la tangente : la case reste posée à plat sur la
        // courbe, comme une traverse sur un rail.
        rot: (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI - 90,
      }
    }

    const reach = Math.max(...samples.map((p) => Math.hypot(p.x, p.y)))
    const grid = 2 * reach + 3
    const c = grid / 2
    /** Coin haut-gauche d'une case dont le centre est en (x, y) autour du cœur. */
    const place = (x: number, y: number, rot: number): Cell => cell(c + x - 0.5, c + y - 0.5, rot)

    // L'angle 0 est en haut et l'on tourne dans le sens horaire, comme sur la
    // croix. Le siège 0 démarre donc à midi.
    const step = total / trackLength
    const track = Array.from({ length: trackLength }, (_, i) => {
      const p = walk(i * step)
      return place(p.x, p.y, p.rot)
    })

    const homeLength = homeLengthFor(arm)
    const homePath = forSeat<Cell[]>((seat) => {
      // L'escalier s'ouvre sur la case qui précède le départ du siège — c'est
      // là que le cheval quitte le circuit après son tour complet. Sa longueur
      // se mesure sur le circuit *à cet endroit-là* : sur le serpent, le rayon
      // ondule, et un escalier posé sur le rayon moyen se décrocherait du
      // circuit d'un creux à l'autre.
      const entry = walk((((seat * arm - 1) % trackLength) + trackLength) % trackLength * step)
      const from = Math.hypot(entry.x, entry.y)
      const outer = from - 1.4
      const inner = 1.2
      const gap = homeLength > 1 ? (outer - inner) / (homeLength - 1) : 0
      const rot = (Math.atan2(entry.x, -entry.y) * 180) / Math.PI
      return Array.from({ length: homeLength }, (_, i) => {
        const r = (outer - i * gap) / from
        return place(entry.x * r, entry.y * r, rot)
      })
    })

    // Les écuries prennent les quatre coins du carré, que la courbe laisse
    // libres — c'est même la seule place perdue d'un plateau rond.
    const size = Math.max(3, (c - reach / Math.SQRT2) * 0.96)
    const far = grid - size
    const stableBox = forSeat((seat) => {
      const o = [cell(0, 0), cell(far, 0), cell(far, far), cell(0, far)][seat]!
      return { col: o.col, row: o.row, size }
    })
    const stableSlots = forSeat<Cell[]>((seat) => {
      const box = stableBox[seat]
      return boxSlots(box.col, box.row, size, pawnsPerPlayer)
    })

    return {
      grid,
      track,
      homePath,
      stableSlots,
      stableBox,
      center: cell(c - 0.5, c - 0.5),
      centerSize: 2.4,
    }
  }
}

const SHAPES: Record<BoardShape, ShapeBuilder> = {
  croix: buildCross,
  carre: buildSquare,
  rond: buildPolar(0),
  serpent: buildPolar(8),
}

// ───────────────────────────── la géométrie complète ─────────────────────────────

export type BoardGeometry = {
  shape: BoardShape
  grid: number
  pawnsPerPlayer: number
  trackLength: number
  homeLength: number
  lastStep: number
  track: readonly Cell[]
  startIndex: Record<Seat, number>
  homePath: Record<Seat, readonly Cell[]>
  stableSlots: Record<Seat, readonly Cell[]>
  stableBox: Record<Seat, { col: number; row: number; size: number }>
  /** Côté du cœur, en cases, centré sur `center`. Voir `Drawing`. */
  centerSize: number
  /** Une case étoile par siège : le relais posé à l'entrée du bras suivant. */
  starIndices: readonly number[]
  /** Les cases pouvoir, si la table les a activées. Vides sinon. */
  powerIndices: readonly number[]
  startIndexSet: ReadonlySet<number>
  starIndexSet: ReadonlySet<number>
  powerIndexSet: ReadonlySet<number>
  center: Cell
}

/**
 * Décalages, comptés depuis le départ de chaque siège.
 *
 * L'étoile tombe cinq cases avant le départ suivant — sur un bras de 13, c'est
 * la huitième case, exactement l'étoile du plateau international. Les deux
 * cases pouvoir se posent au quart et aux trois quarts du bras.
 *
 * Tous ces décalages sont **relatifs au départ** : le motif absolu se répète
 * donc à l'identique tous les quarts de tour. Chaque joueur rencontre les mêmes
 * cases aux mêmes distances de chez lui — l'équité est dans la géométrie, elle
 * n'a pas à être vérifiée coup par coup.
 */
const starOffset = (arm: number): number => Math.max(2, arm - 5)
const powerOffsets = (arm: number): number[] => {
  const wanted = [Math.round(arm / 4), Math.round((arm * 3) / 4)]
  const taken = new Set([0, starOffset(arm)])
  return [...new Set(wanted.filter((o) => o > 0 && o < arm && !taken.has(o)))]
}

function buildGeometry(
  shape: BoardShape,
  trackTarget: number,
  pawnsPerPlayer: number,
  powers: boolean,
): BoardGeometry {
  const drawing = SHAPES[shape](trackTarget / 4, pawnsPerPlayer)
  const trackLength = drawing.track.length
  const arm = trackLength / 4
  const homeLength = drawing.homePath[0].length
  const startIndex = forSeat((seat) => seat * arm)
  const starIndices = SEATS.map((s) => (startIndex[s] + starOffset(arm)) % trackLength)
  const powerIndices = powers
    ? SEATS.flatMap((s) => powerOffsets(arm).map((o) => (startIndex[s] + o) % trackLength))
    : []

  return {
    shape,
    grid: drawing.grid,
    pawnsPerPlayer,
    trackLength,
    homeLength,
    lastStep: trackLength + homeLength - 1,
    track: drawing.track,
    startIndex,
    homePath: drawing.homePath,
    stableSlots: drawing.stableSlots,
    stableBox: drawing.stableBox,
    centerSize: drawing.centerSize,
    starIndices,
    powerIndices,
    startIndexSet: new Set(Object.values(startIndex)),
    starIndexSet: new Set(starIndices),
    powerIndexSet: new Set(powerIndices),
    center: drawing.center,
  }
}

const cache = new Map<string, BoardGeometry>()

export type GeometrySpec = Pick<Variant, 'trackLength' | 'pawnsPerPlayer'> &
  Partial<Pick<Variant, 'shape' | 'powers'>>

/** Mémoïsée : évite de reconstruire les tableaux à chaque frame de rendu. */
export function geometryFor(v: GeometrySpec): BoardGeometry {
  const shape = isBoardShape(v.shape) ? v.shape : 'croix'
  const powers = v.powers === true
  const key = `${shape}:${v.trackLength}:${v.pawnsPerPlayer}:${powers}`
  const cached = cache.get(key)
  if (cached) return cached
  const geometry = buildGeometry(shape, v.trackLength, v.pawnsPerPlayer, powers)
  cache.set(key, geometry)
  return geometry
}

/** Convertit une position relative en index absolu du circuit, ou null si hors circuit. */
export function trackIndexOf(geometry: BoardGeometry, seat: Seat, steps: number): number | null {
  if (steps < 0 || steps >= geometry.trackLength) return null
  return (geometry.startIndex[seat] + steps) % geometry.trackLength
}

/** Case du plateau occupée par un pion à la position `steps`, ou null s'il est à l'écurie. */
export function cellOf(geometry: BoardGeometry, seat: Seat, steps: number, stableSlot: number): Cell {
  if (steps < 0) return geometry.stableSlots[seat][stableSlot % geometry.pawnsPerPlayer]!
  if (steps < geometry.trackLength) return geometry.track[trackIndexOf(geometry, seat, steps)!]!
  return geometry.homePath[seat][steps - geometry.trackLength]!
}

export const isOnTrack = (geometry: BoardGeometry, steps: number): boolean =>
  steps >= 0 && steps < geometry.trackLength
export const isInHomePath = (geometry: BoardGeometry, steps: number): boolean =>
  steps >= geometry.trackLength
export const hasFinished = (geometry: BoardGeometry, steps: number): boolean => steps === geometry.lastStep
