/**
 * Rend chaque affiche de `posters.html` en PNG 1080 × 1920.
 *
 * Les visuels sont dessinés avec la feuille de style du jeu — mêmes couleurs,
 * mêmes traits d'encre, mêmes ombres franches — plutôt qu'assemblés à la main
 * dans un éditeur : quand la direction artistique de l'app bouge, il suffit de
 * relancer ce script.
 *
 *   node promo/render.mjs
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const CHROME = process.env.CHROME_PATH || undefined

// Playwright n'est pas une dépendance du jeu : on le prend là où il est
// installé — dans le projet, ou globalement via PLAYWRIGHT_PATH.
const require = createRequire(import.meta.url)
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright')

const b = await pw.chromium.launch(CHROME ? { executablePath: CHROME } : {})
const p = await b.newPage({ viewport: { width: 1180, height: 2000 }, deviceScaleFactor: 1 })
await p.goto('file://' + join(HERE, 'posters.html'), { waitUntil: 'networkidle' })
await p.evaluate(() => document.fonts.ready)
await p.waitForTimeout(400)

const ids = await p.$$eval('.poster', (els) => els.map((el) => el.id))
for (const id of ids) {
  await p.locator('#' + id).screenshot({ path: join(HERE, 'out', `${id}.png`) })
  console.log('→ promo/out/' + id + '.png')
}
await b.close()
