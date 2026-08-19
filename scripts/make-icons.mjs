/**
 * Fabrique les icônes de `public/` à partir de `scripts/icon.mjs`.
 *
 *     npm run icons
 *
 * Le SVG est la source ; les PNG n'existent que parce que certains systèmes ne
 * savent pas lire autre chose — Android pour l'écran d'accueil, iOS pour son
 * `apple-touch-icon`, les vieux navigateurs pour l'onglet. Les regénérer d'un
 * seul geste évite qu'ils dérivent les uns des autres : c'est exactement le
 * genre de fichiers qu'on oublie de refaire une fois sur trois quand on les
 * retouche à la main.
 *
 * Le rendu est fait ici, sans rien installer. Ni `sharp`, ni `resvg`, ni un
 * Chromium en mode « headless » : trois dépendances natives ou un navigateur
 * entier, pour cinq fichiers qui changent une fois par an. La marque n'est
 * faite que de rectangles arrondis et de disques — cent lignes de distances
 * signées les peignent, avec un anticrénelage exact plutôt que suréchantillonné,
 * et `zlib` suffit à écrire le PNG.
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CANVAS, iconShapes, iconSvg } from './icon.mjs'

const publicDir = fileURLToPath(new URL('../public/', import.meta.url))

/** Ce qu'on écrit, et pourquoi. */
const TARGETS = [
  { file: 'icon-32.png', size: 32, frame: 'app', why: 'onglet, pour qui ne lit pas le SVG' },
  { file: 'icon-192.png', size: 192, frame: 'app', why: 'écran d’accueil Android' },
  { file: 'icon-512.png', size: 512, frame: 'app', why: 'écran de démarrage, magasins' },
  { file: 'icon-maskable-512.png', size: 512, frame: 'maskable', why: 'gabarit rogné par le système' },
  { file: 'apple-touch-icon.png', size: 180, frame: 'apple', why: 'écran d’accueil iOS' },
]

// ───────────────────────────── peinture ─────────────────────────────

/** `#rrggbb` → trois octets. */
function rgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Distance signée d'un point au bord d'une forme : négative dedans, positive
 * dehors, et — c'est tout l'intérêt — exprimée en unités du dessin. Un pixel
 * dont le centre est à un demi-pixel du bord est à moitié couvert ; la nuance
 * de bord tombe donc du calcul, sans suréchantillonner quoi que ce soit.
 */
function distance(shape, x, y) {
  if (shape.kind === 'circle') return Math.hypot(x - shape.cx, y - shape.cy) - shape.r

  // Rectangle arrondi : on se ramène au premier quadrant, on décale du rayon,
  // et il ne reste qu'une distance à un coin (dehors) ou au bord (dedans).
  const hw = shape.w / 2
  const hh = shape.h / 2
  const qx = Math.abs(x - (shape.x + hw)) - (hw - shape.r)
  const qy = Math.abs(y - (shape.y + hh)) - (hh - shape.r)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - shape.r
}

/**
 * Peint le dessin en RGBA, `size` pixels de côté.
 *
 * Les formes sont posées l'une sur l'autre dans l'ordre, en alpha droit : le
 * fond est opaque partout sauf dans les coins arrondis, qui doivent rester
 * transparents — c'est là que le blanc du système passera.
 */
function paint(shapes, size) {
  const px = CANVAS / size
  const out = new Uint8Array(size * size * 4)

  for (const shape of shapes) {
    const [r, g, b] = rgb(shape.fill)
    // Un dé penché se peint plus simplement en faisant tourner le point de vue
    // que la forme : on ramène chaque pixel dans le repère droit de la forme.
    const a = ((shape.tilt ?? 0) * Math.PI) / 180
    const cos = Math.cos(-a)
    const sin = Math.sin(-a)
    const c = CANVAS / 2

    for (let py = 0; py < size; py++) {
      for (let pxi = 0; pxi < size; pxi++) {
        // Le centre du pixel, dans les unités du dessin.
        const ux = (pxi + 0.5) * px - c
        const uy = (py + 0.5) * px - c
        const x = ux * cos - uy * sin + c
        const y = ux * sin + uy * cos + c

        const d = distance(shape, x, y)
        // Couverture du pixel : 1 dedans, 0 dehors, la rampe au bord.
        const cov = Math.min(Math.max(0.5 - d / px, 0), 1)
        if (cov <= 0) continue

        const i = (py * size + pxi) * 4
        const dst = out[i + 3] / 255
        const alpha = cov + dst * (1 - cov)
        // Mélange en alpha droit : sans repondérer par l'alpha du dessous, un
        // bord posé sur du transparent tirerait vers le noir.
        for (let k = 0; k < 3; k++) {
          const src = [r, g, b][k]
          out[i + k] = Math.round((src * cov + out[i + k] * dst * (1 - cov)) / alpha)
        }
        out[i + 3] = Math.round(alpha * 255)
      }
    }
  }

  return out
}

// ─────────────────────────────── PNG ───────────────────────────────

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const body = Buffer.concat([head.subarray(4), data])
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([head, data, tail])
}

/** Encode du RGBA en PNG. Filtre 0 partout : à ces tailles, rien à gagner. */
function png(rgba, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // 8 bits par canal
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ────────────────────────────── écriture ──────────────────────────────

writeFileSync(join(publicDir, 'icon.svg'), iconSvg('app'))
console.log('icon.svg'.padEnd(22), '     vectoriel · la source, servie telle quelle')

for (const { file, size, frame, why } of TARGETS) {
  const bytes = png(paint(iconShapes(frame), size), size)
  writeFileSync(join(publicDir, file), bytes)
  console.log(file.padEnd(22), `${String(size).padStart(3)} px · ${(bytes.length / 1024).toFixed(1)} ko · ${why}`)
}
