/**
 * Le QR code du salon — encodé ici, et nulle part ailleurs.
 *
 * Comme les icônes, et pour les mêmes raisons : une bibliothèque de QR pèse
 * plus lourd que le code ci-dessous, sert quarante versions et huit modes
 * quand il n'en faut qu'un, et ferait une dépendance de plus — donc une ligne
 * de plus dans les composants tiers — pour dessiner un carré noir et blanc.
 *
 * Le symbole produit est un **QR modèle 2, mode octet, correction M**. Rien
 * d'autre n'est nécessaire : ce qu'on encode est toujours la même chose, un
 * lien d'invitation de quelques dizaines de caractères.
 *
 * **Le mode octet plutôt que l'alphanumérique.** Le mode alphanumérique du
 * standard tiendrait le code de partie en deux fois moins de place, mais il
 * ne connaît pas les minuscules : un lien commence par `https://`, et le mode
 * qui l'accepte est le seul qui vaille.
 *
 * **La correction M plutôt que L.** Le symbole est lu sur une vitre : un
 * reflet, une trace de doigt, un écran qui n'est pas tout à fait en face. M
 * restitue environ 15 % du symbole abîmé, contre 7 % pour L, et ne coûte que
 * quatre modules de côté sur un lien de la taille du nôtre.
 *
 * Aucun DOM ici : le module rend une grille de booléens, et c'est l'interface
 * qui en fait un dessin. C'est ce qui permet de le tester sans navigateur.
 */

/** Les deux bits du niveau de correction M, tels qu'ils entrent dans le format. */
const EC_BITS = 0b00

/**
 * Le découpage en blocs, pour la correction M — une ligne par version.
 *
 * `[correcteurs par bloc, blocs courts, données par bloc court, blocs longs,
 * données par bloc long]`. Les blocs longs portent une donnée de plus que les
 * courts ; les versions qui n'en ont pas mettent des zéros.
 *
 * Les versions s'arrêtent à 9 — 53 modules de côté, 180 octets. À la dixième,
 * le compte de caractères passerait de huit à seize bits et cette table
 * gagnerait trente lignes, pour un lien d'invitation qui n'atteindra jamais
 * 180 octets. Au-delà, `qrCode` rend `null` et l'écran s'en tient au code
 * écrit et au lien, qui marchent toujours.
 */
const BLOCKS: Record<number, readonly [number, number, number, number, number]> = {
  1: [10, 1, 16, 0, 0],
  2: [16, 1, 28, 0, 0],
  3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0],
  5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0],
  8: [22, 2, 38, 2, 39],
  9: [22, 3, 36, 2, 37],
}

/** Les centres des motifs d'alignement, par version. La version 1 n'en a pas. */
const ALIGN: Record<number, readonly number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
}

const VERSIONS = Object.keys(BLOCKS).map(Number)

/** Ce que la plus grande version acceptée tient d'octets, en mode octet. */
export const QR_MAX_BYTES = dataCodewords(9) - 2

/** Les huit masques du standard : lesquels des modules de données s'inversent. */
const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

export type Qr = {
  /** Le côté du symbole, en modules. La marge blanche n'en fait pas partie. */
  size: number
  /** Les modules encrés, ligne par ligne : `dark[y * size + x]`. */
  dark: boolean[]
}

/**
 * Le symbole d'un texte, ou `null` s'il est trop long pour la version 9.
 *
 * `null` et non une exception : un lien démesuré est un cas d'affichage, pas
 * une panne. L'appelant montre alors le code et le lien, qui marchent toujours.
 */
export function qrCode(text: string): Qr | null {
  const bytes = new TextEncoder().encode(text)
  const version = VERSIONS.find((v) => bytes.length <= dataCodewords(v) - 2)
  if (version === undefined) return null

  const codewords = interleave(version, payload(version, bytes))
  const size = 17 + 4 * version
  const fixed = new Array<boolean>(size * size).fill(false)
  const dark = new Array<boolean>(size * size).fill(false)

  drawFunctions(size, version, dark, fixed)
  drawData(size, dark, fixed, codewords)

  // Le masque se choisit sur le résultat : on les essaie tous les huit et l'on
  // garde celui que le standard pénalise le moins — c'est ce qui évite qu'un
  // symbole présente de grandes plages unies ou de faux motifs de repérage,
  // que les lecteurs confondraient avec les coins.
  let best = 0
  let bestScore = Infinity
  for (let mask = 0; mask < MASKS.length; mask++) {
    applyMask(size, dark, fixed, mask)
    drawFormat(size, dark, fixed, mask)
    const score = penalty(size, dark)
    if (score < bestScore) {
      bestScore = score
      best = mask
    }
    applyMask(size, dark, fixed, mask) // le masque est son propre inverse
  }
  applyMask(size, dark, fixed, best)
  drawFormat(size, dark, fixed, best)

  return { size, dark }
}

/** Le nombre de mots de données d'une version, tous blocs confondus. */
function dataCodewords(version: number): number {
  const [, short, shortData, long, longData] = BLOCKS[version]!
  return short * shortData + long * longData
}

/**
 * Le flux de données : l'en-tête, le texte, puis le remplissage.
 *
 * Quatre bits de mode, huit de longueur (le compte tient sur un octet jusqu'à
 * la version 9), les octets, un terminateur, puis les deux octets de bourrage
 * du standard en alternance jusqu'à remplir la version.
 */
function payload(version: number, bytes: Uint8Array): Uint8Array {
  const total = dataCodewords(version)
  const out = new Uint8Array(total)
  // Les bits s'accumulent dans un octet en cours, vidé dès qu'il est plein.
  // Le mode et le compte font douze bits : rien ne tombe sur une frontière
  // d'octet, et sans cet accumulateur il faudrait relire chaque octet déjà
  // écrit pour y ajouter le bit suivant.
  let acc = 0
  let held = 0
  let put = 0

  const push = (value: number, width: number): void => {
    for (let i = width - 1; i >= 0; i--) {
      acc = (acc << 1) | ((value >> i) & 1)
      if (++held === 8) {
        out[put++] = acc
        acc = 0
        held = 0
      }
    }
  }

  push(0b0100, 4)
  push(bytes.length, 8)
  for (const byte of bytes) push(byte, 8)
  push(0, Math.min(4, (total - put) * 8 - held)) // le terminateur, tronqué si la place manque
  if (held > 0) out[put++] = acc << (8 - held)

  for (let i = put; i < total; i++) out[i] = (i - put) % 2 === 0 ? 0xec : 0x11
  return out
}

/**
 * Les blocs, leurs correcteurs, et l'entrelacement.
 *
 * Un symbole ne porte pas ses blocs l'un après l'autre : il prend le premier
 * mot de chaque bloc, puis le deuxième, etc. Une éraflure abîme ainsi un peu
 * de chaque bloc plutôt que tout un bloc — et chacun se répare de son côté.
 */
function interleave(version: number, data: Uint8Array): Uint8Array {
  const [ecPerBlock, short, shortData, long, longData] = BLOCKS[version]!
  const blocks: { data: Uint8Array; ec: Uint8Array }[] = []

  let at = 0
  for (let i = 0; i < short + long; i++) {
    const size = i < short ? shortData : longData
    const slice = data.subarray(at, at + size)
    at += size
    blocks.push({ data: slice, ec: remainder(slice, ecPerBlock) })
  }

  const out = new Uint8Array(data.length + (short + long) * ecPerBlock)
  let put = 0
  for (let i = 0; i < Math.max(shortData, longData); i++) {
    for (const block of blocks) if (i < block.data.length) out[put++] = block.data[i]!
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of blocks) out[put++] = block.ec[i]!
  }
  return out
}

/* ── le corps fini à 256 éléments ───────────────────────────────────────────
   Les codes de Reed-Solomon comptent dans un corps où l'addition est un
   ou-exclusif et la multiplication un jeu de tables : les deux tables ci-dessous
   se lisent l'une l'autre, exp[log[a] + log[b]] valant a × b. */
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x
  LOG[x] = i
  x <<= 1
  if (x & 0x100) x ^= 0x11d // le polynôme du standard
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!

/** Le polynôme générateur de degré `n`, produit des (x − α^i). */
function generator(n: number): Uint8Array {
  let poly = new Uint8Array([1])
  for (let i = 0; i < n; i++) {
    const next = new Uint8Array(poly.length + 1)
    for (let j = 0; j < poly.length; j++) {
      next[j] = next[j]! ^ poly[j]!
      next[j + 1] = next[j + 1]! ^ EXP[LOG[poly[j]!]! + i]!
    }
    poly = next
  }
  return poly
}

/** Les mots de correction d'un bloc : le reste de sa division par le générateur. */
function remainder(data: Uint8Array, n: number): Uint8Array {
  const gen = generator(n)
  const out = new Uint8Array(data.length + n)
  out.set(data)
  for (let i = 0; i < data.length; i++) {
    const lead = out[i]!
    if (lead === 0) continue
    for (let j = 1; j < gen.length; j++) out[i + j] = out[i + j]! ^ EXP[LOG[gen[j]!]! + LOG[lead]!]!
  }
  return out.slice(data.length)
}

/* ── le dessin ──────────────────────────────────────────────────────────────
   `fixed` marque les modules qui appartiennent au symbole lui-même — repères,
   alignements, horloges, zone de format. Ils ne portent pas de données et le
   masque ne les touche jamais. */

function drawFunctions(size: number, version: number, dark: boolean[], fixed: boolean[]): void {
  const set = (x: number, y: number, on: boolean): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    dark[y * size + x] = on
    fixed[y * size + x] = true
  }

  // Les trois repères d'angle, et la séparation blanche qui les cerne : c'est
  // à eux que le lecteur reconnaît un QR et son orientation.
  const corners: readonly (readonly [number, number])[] = [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]
  for (const [cx, cy] of corners) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const reach = Math.max(Math.abs(dx), Math.abs(dy))
        set(cx + dx, cy + dy, reach !== 2 && reach !== 4)
      }
    }
  }

  // Les deux horloges, une ligne et une colonne alternées : elles donnent
  // l'échelle du symbole, module par module.
  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0)
    set(6, i, i % 2 === 0)
  }

  // Les alignements, sauf là où ils tomberaient sur un repère d'angle.
  const spots = ALIGN[version]!
  for (const cy of spots) {
    for (const cx of spots) {
      const first = spots[0]
      const last = spots.at(-1)
      const corner = (cx === first || cx === last) && (cy === first || cy === last)
      if (corner && !(cx === last && cy === last)) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
        }
      }
    }
  }

  // La zone de format est réservée avant le placement des données ; ses bits
  // ne seront écrits qu'une fois le masque choisi.
  for (let i = 0; i <= 8; i++) {
    if (i === 6) continue // la ligne et la colonne d'horloge traversent la zone
    set(8, i, false)
    set(i, 8, false)
  }
  for (let i = 0; i < 8; i++) {
    set(8, size - 1 - i, false)
    set(size - 1 - i, 8, false)
  }
  set(8, size - 8, true) // le module toujours encré du standard

  // Le numéro de version, à partir de la 7 : dix-huit bits protégés par leur
  // propre correcteur, recopiés près de deux repères d'angle. En dessous, la
  // version se déduit du nombre de modules et n'est pas écrite.
  if (version >= 7) {
    let rest = version
    for (let i = 0; i < 12; i++) rest = (rest << 1) ^ ((rest >> 11) * 0b1_1111_0010_0101)
    const bits = (version << 12) | rest
    for (let i = 0; i < 18; i++) {
      const on = ((bits >> i) & 1) === 1
      const far = size - 11 + (i % 3)
      const near = Math.floor(i / 3)
      set(far, near, on)
      set(near, far, on)
    }
  }
}

/**
 * Les données, en zigzag.
 *
 * Deux colonnes à la fois, de droite à gauche, en remontant puis en
 * redescendant — et la colonne 6, celle de l'horloge, se saute entièrement.
 */
function drawData(size: number, dark: boolean[], fixed: boolean[], codewords: Uint8Array): void {
  let bit = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let step = 0; step < size; step++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const up = ((right + 1) & 2) === 0
        const y = up ? size - 1 - step : step
        if (fixed[y * size + x] || bit >= codewords.length * 8) continue
        dark[y * size + x] = ((codewords[bit >> 3]! >> (7 - (bit & 7))) & 1) === 1
        bit++
      }
    }
  }
}

function applyMask(size: number, dark: boolean[], fixed: boolean[], mask: number): void {
  const rule = MASKS[mask]!
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!fixed[y * size + x] && rule(x, y)) dark[y * size + x] = !dark[y * size + x]
    }
  }
}

/**
 * Les quinze bits de format : le niveau de correction, le masque, et le code
 * correcteur qui les protège — recopiés à deux endroits pour qu'un coin abîmé
 * ne rende pas le symbole illisible.
 */
function drawFormat(size: number, dark: boolean[], fixed: boolean[], mask: number): void {
  const value = (EC_BITS << 3) | mask
  let bits = value << 10
  for (let i = 14; i >= 10; i--) if ((bits >> i) & 1) bits ^= 0b101_0011_0111 << (i - 10)
  bits = ((value << 10) | bits) ^ 0b101_0100_0001_0010

  const set = (x: number, y: number, i: number): void => {
    dark[y * size + x] = ((bits >> i) & 1) === 1
    fixed[y * size + x] = true
  }

  for (let i = 0; i <= 5; i++) set(8, i, i)
  set(8, 7, 6)
  set(8, 8, 7)
  set(7, 8, 8)
  for (let i = 9; i < 15; i++) set(14 - i, 8, i)

  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, i)
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, i)
}

/**
 * Le score du standard : plus il est bas, plus le symbole se lit facilement.
 *
 * Quatre pénalités — les longues suites d'une même couleur, les carrés unis,
 * les faux repères d'angle, et le déséquilibre entre noir et blanc.
 */
function penalty(size: number, dark: boolean[]): number {
  const at = (x: number, y: number): boolean => dark[y * size + x]!
  let score = 0

  for (let i = 0; i < size; i++) {
    for (const row of [true, false]) {
      let run = 1
      let history = 0
      for (let j = 0; j < size; j++) {
        const here = row ? at(j, i) : at(i, j)
        if (j > 0 && here === (row ? at(j - 1, i) : at(i, j - 1))) {
          run++
          if (run === 5) score += 3
          else if (run > 5) score++
        } else run = 1
        // Les onze derniers modules parcourus, pour y reconnaître le faux
        // repère : encré-vide-encré×3-vide-encré, et quatre vides d'un côté.
        history = ((history << 1) | (here ? 1 : 0)) & 0x7ff
        if (j >= 10 && (history === 0b000_0101_1101 || history === 0b101_1101_0000)) score += 40
      }
    }
  }

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const corner = at(x, y)
      if (corner === at(x + 1, y) && corner === at(x, y + 1) && corner === at(x + 1, y + 1)) score += 3
    }
  }

  const inked = dark.reduce((n, on) => n + (on ? 1 : 0), 0)
  score += Math.floor(Math.abs((inked * 100) / dark.length - 50) / 5) * 10
  return score
}
