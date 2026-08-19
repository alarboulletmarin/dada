import { describe, expect, it } from 'vitest'
import {
  BOARD_SHAPES,
  geometryFor,
  homeLengthFor,
  trackIndexOf,
  type BoardGeometry,
  type Cell,
} from './board.ts'
import type { Seat } from './types.ts'
import { VARIANTS } from './variants.ts'

const SEATS: Seat[] = [0, 1, 2, 3]
const key = (c: Cell) => `${c.col.toFixed(3)},${c.row.toFixed(3)}`
const distance = (a: Cell, b: Cell) => Math.hypot(a.col - b.col, a.row - b.row)

/**
 * Deux cases se suivent si l'on peut passer de l'une à l'autre sans « saut »
 * visible. Un pas orthogonal vaut 1, la diagonale des angles du plateau
 * international vaut √2, et l'arc d'un plateau rond vaut à peine moins de 1.
 * Au-delà de 1,5, le cheval téléporte.
 */
const STEP_MAX = 1.5

const CONFIGS = BOARD_SHAPES.flatMap((shape) =>
  VARIANTS.map((v) => ({
    label: `${v.id} · ${shape}`,
    shape,
    trackLength: v.trackLength,
    pawnsPerPlayer: v.pawnsPerPlayer,
  })),
)

describe.each(CONFIGS)('$label', ({ shape, trackLength, pawnsPerPlayer }) => {
  const geometry: BoardGeometry = geometryFor({
    shape,
    trackLength,
    pawnsPerPlayer,
    powers: true,
  })
  const arm = geometry.trackLength / 4
  const inGrid = (c: Cell, w = 1) =>
    c.col >= -0.001 &&
    c.row >= -0.001 &&
    c.col + w <= geometry.grid + 0.001 &&
    c.row + w <= geometry.grid + 0.001

  describe('circuit', () => {
    it('compte quatre bras égaux, tous distincts', () => {
      expect(geometry.track).toHaveLength(geometry.trackLength)
      expect(geometry.trackLength % 4).toBe(0)
      expect(new Set(geometry.track.map(key)).size).toBe(geometry.trackLength)
    })

    it(`tient dans la grille ${geometry.grid.toFixed(2)}`, () => {
      expect(geometry.track.every((c) => inGrid(c))).toBe(true)
    })

    // C'est la propriété qui permet d'animer un pion case par case : sans elle,
    // un pion « saute » visuellement dans les coins.
    it('se suit sans saut, boucle comprise', () => {
      for (let i = 0; i < geometry.trackLength; i++) {
        const a = geometry.track[i]!
        const b = geometry.track[(i + 1) % geometry.trackLength]!
        expect(distance(a, b), `case ${i} ${key(a)} → ${key(b)}`).toBeLessThanOrEqual(STEP_MAX)
      }
    })

    it(`répartit les départs tous les ${arm} crans`, () => {
      expect(SEATS.map((s) => geometry.startIndex[s])).toEqual(SEATS.map((s) => s * arm))
    })

    it('pose une étoile par siège, au même décalage pour tous', () => {
      const offsets = SEATS.map(
        (s) => (geometry.starIndices[s]! - geometry.startIndex[s] + geometry.trackLength) % geometry.trackLength,
      )
      expect(new Set(offsets).size).toBe(1)
      expect(geometry.starIndexSet.size).toBe(4)
      // Une étoile ne doit jamais tomber sur un départ : deux protections sur
      // la même case, c'est une case perdue.
      expect([...geometry.starIndexSet].some((i) => geometry.startIndexSet.has(i))).toBe(false)
    })
  })

  describe('cases pouvoir', () => {
    // L'équité ne se corrige pas coup par coup : elle est posée dans la
    // géométrie. Le motif doit être invariant par rotation d'un quart de tour,
    // sinon un joueur croiserait plus de cases qu'un autre.
    it('se répètent à l’identique tous les quarts de tour', () => {
      expect(geometry.powerIndices.length).toBeGreaterThan(0)
      expect(geometry.powerIndices.length % 4).toBe(0)
      for (const index of geometry.powerIndexSet) {
        expect(geometry.powerIndexSet.has((index + arm) % geometry.trackLength)).toBe(true)
      }
    })

    it('ne recouvrent ni un départ ni une étoile', () => {
      for (const index of geometry.powerIndexSet) {
        expect(geometry.startIndexSet.has(index)).toBe(false)
        expect(geometry.starIndexSet.has(index)).toBe(false)
      }
    })

    it("n'existent pas si la table ne les a pas activées", () => {
      const plain = geometryFor({ shape, trackLength, pawnsPerPlayer })
      expect(plain.powerIndices).toHaveLength(0)
    })
  })

  describe('escaliers', () => {
    it(`font ${geometry.homeLength} marches, la même longueur sur toutes les formes`, () => {
      expect(geometry.homeLength).toBe(homeLengthFor(arm))
      for (const seat of SEATS) {
        const path = geometry.homePath[seat]
        expect(path).toHaveLength(geometry.homeLength)
        expect(path.every((c) => inGrid(c))).toBe(true)
        for (let i = 0; i < path.length - 1; i++) {
          expect(distance(path[i]!, path[i + 1]!), `siège ${seat}, marche ${i}`).toBeLessThanOrEqual(
            STEP_MAX,
          )
        }
      }
    })

    it("s'enchaînent avec la dernière case du circuit", () => {
      for (const seat of SEATS) {
        const lastTrack = geometry.track[trackIndexOf(geometry, seat, geometry.trackLength - 1)!]!
        expect(distance(lastTrack, geometry.homePath[seat][0]!), `siège ${seat}`).toBeLessThanOrEqual(
          STEP_MAX,
        )
      }
    })

    it('ne recouvrent ni le circuit ni les autres escaliers', () => {
      const track = new Set(geometry.track.map(key))
      const seen = new Set<string>()
      for (const seat of SEATS) {
        for (const c of geometry.homePath[seat]) {
          expect(track.has(key(c)), `${key(c)} chevauche le circuit`).toBe(false)
          expect(seen.has(key(c)), `${key(c)} en double`).toBe(false)
          seen.add(key(c))
        }
      }
    })

    it('convergent vers le cœur sans le recouvrir', () => {
      for (const seat of SEATS) {
        const last = geometry.homePath[seat][geometry.homeLength - 1]!
        const gap = distance(last, geometry.center)
        expect(gap, `siège ${seat}`).toBeLessThanOrEqual(STEP_MAX)
        expect(gap, `siège ${seat}`).toBeGreaterThan(0.5)
      }
    })
  })

  describe('écuries', () => {
    it(`donnent ${pawnsPerPlayer} emplacements par siège, hors circuit`, () => {
      const track = new Set(geometry.track.map(key))
      for (const seat of SEATS) {
        const slots = geometry.stableSlots[seat]
        expect(slots).toHaveLength(pawnsPerPlayer)
        expect(slots.every((c) => inGrid(c))).toBe(true)
        expect(slots.every((c) => !track.has(key(c)))).toBe(true)
      }
    })

    it('restent dans le quadrant de leur siège', () => {
      const mid = geometry.grid / 2
      const quadrant = (c: Cell) => `${c.col + 0.5 < mid ? 'G' : 'D'}${c.row + 0.5 < mid ? 'H' : 'B'}`
      const expected: Record<Seat, string> = { 0: 'GH', 1: 'DH', 2: 'DB', 3: 'GB' }
      for (const seat of SEATS) {
        for (const c of geometry.stableSlots[seat]) expect(quadrant(c)).toBe(expected[seat])
      }
    })

    it('tiennent dans le plateau', () => {
      for (const seat of SEATS) {
        const box = geometry.stableBox[seat]
        expect(inGrid({ col: box.col, row: box.row }, box.size), `siège ${seat}`).toBe(true)
      }
    })
  })

  describe('trackIndexOf', () => {
    it('déroule le tour complet depuis chaque départ', () => {
      for (const seat of SEATS) {
        expect(trackIndexOf(geometry, seat, 0)).toBe(geometry.startIndex[seat])
        const visited = new Set<number>()
        for (let s = 0; s < geometry.trackLength; s++) visited.add(trackIndexOf(geometry, seat, s)!)
        expect(visited.size).toBe(geometry.trackLength)
      }
    })

    it('renvoie null hors du circuit', () => {
      expect(trackIndexOf(geometry, 0, -1)).toBeNull()
      expect(trackIndexOf(geometry, 0, geometry.trackLength)).toBeNull()
    })
  })
})

// ─────────────────────────── les deux plateaux officiels ───────────────────────────

/**
 * Ces deux plateaux ne sont pas des réglages : ce sont des objets qui existent,
 * imprimés, avec un nombre de cases qu'on peut compter. Les tests qui suivent
 * les fixent, pour qu'un refactor de géométrie ne les fasse pas dériver.
 */
describe('plateaux officiels', () => {
  const at = (g: BoardGeometry, i: number) => key(g.track[i]!)

  describe('petits chevaux — croix française, 56 cases', () => {
    const g = geometryFor({ shape: 'croix', trackLength: 56, pawnsPerPlayer: 4 })

    it('compte 56 cases, 14 par quart, sur une grille de 15', () => {
      expect(g.trackLength).toBe(56)
      expect(g.trackLength / 4).toBe(14)
      expect(g.grid).toBe(15)
      expect(g.homeLength).toBe(6)
    })

    // C'est le point qui sépare le plateau français du plateau international :
    // le tracé passe par les angles du carré central au lieu de les couper.
    it('passe par les quatre angles du carré central', () => {
      const corners = ['6.000,6.000', '8.000,6.000', '8.000,8.000', '6.000,8.000']
      const track = new Set(g.track.map(key))
      for (const c of corners) expect(track.has(c), `angle ${c}`).toBe(true)
    })

    it('est orthogonalement continu, sans une seule diagonale', () => {
      for (let i = 0; i < g.trackLength; i++) {
        const a = g.track[i]!
        const b = g.track[(i + 1) % g.trackLength]!
        expect(Math.abs(a.col - b.col) + Math.abs(a.row - b.row), `case ${i}`).toBe(1)
      }
    })

    it('part de la lisière du bras gauche et tourne dans le sens horaire', () => {
      expect(at(g, 0)).toBe('0.000,6.000')
      expect(at(g, 1)).toBe('1.000,6.000')
      expect(at(g, 14)).toBe('8.000,0.000')
      expect(at(g, 55)).toBe('0.000,7.000')
    })

    it("ouvre l'escalier du siège 0 juste après sa dernière case de circuit", () => {
      expect(g.homePath[0].map(key)).toEqual([
        '1.000,7.000',
        '2.000,7.000',
        '3.000,7.000',
        '4.000,7.000',
        '5.000,7.000',
        '6.000,7.000',
      ])
    })
  })

  describe('ludo — croix internationale, 52 cases', () => {
    const g = geometryFor({ shape: 'croix', trackLength: 52, pawnsPerPlayer: 4 })

    it('compte 52 cases, 13 par quart, sur la même grille de 15', () => {
      expect(g.trackLength).toBe(52)
      expect(g.trackLength / 4).toBe(13)
      expect(g.grid).toBe(15)
      expect(g.homeLength).toBe(6)
    })

    it('coupe les quatre angles du carré central', () => {
      const corners = ['6.000,6.000', '8.000,6.000', '8.000,8.000', '6.000,8.000']
      const track = new Set(g.track.map(key))
      for (const c of corners) expect(track.has(c), `angle ${c}`).toBe(false)
    })

    it('ne tourne en diagonale qu’aux quatre angles', () => {
      let diagonals = 0
      for (let i = 0; i < g.trackLength; i++) {
        const a = g.track[i]!
        const b = g.track[(i + 1) % g.trackLength]!
        if (Math.abs(a.col - b.col) + Math.abs(a.row - b.row) !== 1) diagonals++
      }
      expect(diagonals).toBe(4)
    })

    // La règle internationale : la case abritée tombe huit crans après le
    // départ, c'est-à-dire cinq cases avant le départ suivant.
    it('pose les cases étoile huit crans après chaque départ', () => {
      expect([...g.starIndexSet].sort((a, b) => a - b)).toEqual([8, 21, 34, 47])
    })
  })
})
