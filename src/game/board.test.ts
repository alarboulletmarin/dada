import { describe, expect, it } from 'vitest'
import { geometryFor, trackIndexOf, type BoardGeometry, type Cell } from './board.ts'
import type { Seat } from './types.ts'

const SEATS: Seat[] = [0, 1, 2, 3]
const key = (c: Cell) => `${c.col},${c.row}`
const adjacent = (a: Cell, b: Cell) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1

const CONFIGS = [
  { label: 'standard (petits-chevaux/ludo)', boardSize: 6, pawnsPerPlayer: 4 },
  { label: 'rapide (plateau réduit)', boardSize: 4, pawnsPerPlayer: 2 },
]

describe.each(CONFIGS)('$label', ({ boardSize, pawnsPerPlayer }) => {
  const geometry: BoardGeometry = geometryFor({ boardSize, pawnsPerPlayer })
  const inGrid = (c: Cell) => c.col >= 0 && c.col < geometry.grid && c.row >= 0 && c.row < geometry.grid
  const armLength = 2 * boardSize + 2

  describe('circuit', () => {
    it(`compte ${geometry.trackLength} cases distinctes`, () => {
      expect(geometry.track).toHaveLength(geometry.trackLength)
      expect(new Set(geometry.track.map(key)).size).toBe(geometry.trackLength)
    })

    it(`tient dans la grille ${geometry.grid}×${geometry.grid}`, () => {
      expect(geometry.track.every(inGrid)).toBe(true)
    })

    // C'est la propriété qui permet d'animer un pion case par case : sans elle,
    // un pion « saute » visuellement dans les coins.
    it('est orthogonalement continu, boucle comprise', () => {
      for (let i = 0; i < geometry.trackLength; i++) {
        const a = geometry.track[i]!
        const b = geometry.track[(i + 1) % geometry.trackLength]!
        expect(adjacent(a, b), `case ${i} ${key(a)} → ${key(b)}`).toBe(true)
      }
    })

    it(`répartit les départs tous les ${armLength} crans`, () => {
      expect(SEATS.map((s) => geometry.startIndex[s])).toEqual(SEATS.map((s) => s * armLength))
    })

    it(`place les étoiles ${boardSize + 2} cases après chaque départ`, () => {
      expect(geometry.starIndices).toEqual(
        SEATS.map((s) => (geometry.startIndex[s] + boardSize + 2) % geometry.trackLength),
      )
    })
  })

  describe('escaliers', () => {
    it(`font ${geometry.homeLength} cases continues chacun`, () => {
      for (const seat of SEATS) {
        const path = geometry.homePath[seat]
        expect(path).toHaveLength(geometry.homeLength)
        expect(path.every(inGrid)).toBe(true)
        for (let i = 0; i < path.length - 1; i++) {
          expect(adjacent(path[i]!, path[i + 1]!), `siège ${seat}, case ${i}`).toBe(true)
        }
      }
    })

    it("s'enchaînent avec la dernière case du circuit", () => {
      for (const seat of SEATS) {
        const lastTrack = geometry.track[trackIndexOf(geometry, seat, geometry.trackLength - 1)!]!
        expect(adjacent(lastTrack, geometry.homePath[seat][0]!), `siège ${seat}`).toBe(true)
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

    it('convergent vers le centre sans le recouvrir', () => {
      for (const seat of SEATS) {
        const last = geometry.homePath[seat][geometry.homeLength - 1]!
        expect(adjacent(last, geometry.center)).toBe(true)
      }
    })
  })

  describe('écuries', () => {
    it(`donnent ${pawnsPerPlayer} emplacements par siège, hors circuit`, () => {
      const track = new Set(geometry.track.map(key))
      for (const seat of SEATS) {
        const slots = geometry.stableSlots[seat]
        expect(slots).toHaveLength(pawnsPerPlayer)
        expect(slots.every(inGrid)).toBe(true)
        expect(slots.every((c) => !track.has(key(c)))).toBe(true)
      }
    })

    it('restent dans le quadrant de leur siège', () => {
      const mid = geometry.grid / 2
      const quadrant = (c: Cell) => `${c.col < mid ? 'G' : 'D'}${c.row < mid ? 'H' : 'B'}`
      const expected: Record<Seat, string> = { 0: 'GH', 1: 'DH', 2: 'DB', 3: 'GB' }
      for (const seat of SEATS) {
        for (const c of geometry.stableSlots[seat]) expect(quadrant(c)).toBe(expected[seat])
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

  describe('carré central', () => {
    it("ne laisse qu'une seule case libre au centre", () => {
      // Les quatre angles du carré 3×3 appartiennent au circuit — c'est même ce
      // qui rend le tracé orthogonalement continu — et les quatre milieux sont
      // les dernières marches des escaliers. Seul le centre est libre.
      //
      // Ce test existe parce que l'inverse a été dessiné : un bloc 3×3 posé au
      // centre recouvrait quatre cases du circuit, et un cheval qui passait par
      // là semblait déjà arrivé.
      const onTrack = new Set(geometry.track.map((c) => `${c.col},${c.row}`))
      const onHome = new Set(SEATS.flatMap((s) => geometry.homePath[s].map((c) => `${c.col},${c.row}`)))

      const free: string[] = []
      for (let col = geometry.center.col - 1; col <= geometry.center.col + 1; col++) {
        for (let row = geometry.center.row - 1; row <= geometry.center.row + 1; row++) {
          const k = `${col},${row}`
          if (!onTrack.has(k) && !onHome.has(k)) free.push(k)
        }
      }
      expect(free).toEqual([`${geometry.center.col},${geometry.center.row}`])
    })
  })
})
