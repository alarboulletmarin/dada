import { describe, expect, it } from 'vitest'
import {
  CENTER,
  GRID,
  HOME_PATH,
  START_INDEX,
  STABLE_SLOTS,
  STAR_INDICES,
  TRACK,
  type Cell,
  trackIndexOf,
} from './board.ts'
import { HOME_LENGTH, TRACK_LENGTH, type Seat } from './types.ts'

const SEATS: Seat[] = [0, 1, 2, 3]
const key = (c: Cell) => `${c.col},${c.row}`
const adjacent = (a: Cell, b: Cell) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1
const inGrid = (c: Cell) => c.col >= 0 && c.col < GRID && c.row >= 0 && c.row < GRID

describe('circuit', () => {
  it('compte 56 cases distinctes', () => {
    expect(TRACK).toHaveLength(TRACK_LENGTH)
    expect(new Set(TRACK.map(key)).size).toBe(TRACK_LENGTH)
  })

  it('tient dans la grille 15×15', () => {
    expect(TRACK.every(inGrid)).toBe(true)
  })

  // C'est la propriété qui permet d'animer un pion case par case : sans elle,
  // un pion « saute » visuellement dans les coins.
  it('est orthogonalement continu, boucle comprise', () => {
    for (let i = 0; i < TRACK_LENGTH; i++) {
      const a = TRACK[i]!
      const b = TRACK[(i + 1) % TRACK_LENGTH]!
      expect(adjacent(a, b), `case ${i} ${key(a)} → ${key(b)}`).toBe(true)
    }
  })

  it('répartit les départs tous les 14 crans', () => {
    expect(SEATS.map((s) => START_INDEX[s])).toEqual([0, 14, 28, 42])
  })

  it('place les étoiles 8 cases après chaque départ', () => {
    expect(STAR_INDICES).toEqual(SEATS.map((s) => (START_INDEX[s] + 8) % TRACK_LENGTH))
  })
})

describe('escaliers', () => {
  it('font 6 cases continues chacun', () => {
    for (const seat of SEATS) {
      const path = HOME_PATH[seat]
      expect(path).toHaveLength(HOME_LENGTH)
      expect(path.every(inGrid)).toBe(true)
      for (let i = 0; i < path.length - 1; i++) {
        expect(adjacent(path[i]!, path[i + 1]!), `siège ${seat}, case ${i}`).toBe(true)
      }
    }
  })

  it("s'enchaînent avec la dernière case du circuit", () => {
    for (const seat of SEATS) {
      const lastTrack = TRACK[trackIndexOf(seat, TRACK_LENGTH - 1)!]!
      expect(adjacent(lastTrack, HOME_PATH[seat][0]!), `siège ${seat}`).toBe(true)
    }
  })

  it('ne recouvrent ni le circuit ni les autres escaliers', () => {
    const track = new Set(TRACK.map(key))
    const seen = new Set<string>()
    for (const seat of SEATS) {
      for (const c of HOME_PATH[seat]) {
        expect(track.has(key(c)), `${key(c)} chevauche le circuit`).toBe(false)
        expect(seen.has(key(c)), `${key(c)} en double`).toBe(false)
        seen.add(key(c))
      }
    }
  })

  it('convergent vers le centre sans le recouvrir', () => {
    for (const seat of SEATS) {
      const last = HOME_PATH[seat][HOME_LENGTH - 1]!
      expect(adjacent(last, { col: 7, row: 7 })).toBe(true)
    }
  })
})

describe('écuries', () => {
  it('donnent 4 emplacements par siège, hors circuit', () => {
    const track = new Set(TRACK.map(key))
    for (const seat of SEATS) {
      const slots = STABLE_SLOTS[seat]
      expect(slots).toHaveLength(4)
      expect(slots.every(inGrid)).toBe(true)
      expect(slots.every((c) => !track.has(key(c)))).toBe(true)
    }
  })

  it('restent dans le quadrant de leur siège', () => {
    const quadrant = (c: Cell) => `${c.col < 7 ? 'G' : 'D'}${c.row < 7 ? 'H' : 'B'}`
    const expected: Record<Seat, string> = { 0: 'GH', 1: 'DH', 2: 'DB', 3: 'GB' }
    for (const seat of SEATS) {
      for (const c of STABLE_SLOTS[seat]) expect(quadrant(c)).toBe(expected[seat])
    }
  })
})

describe('trackIndexOf', () => {
  it('déroule le tour complet depuis chaque départ', () => {
    for (const seat of SEATS) {
      expect(trackIndexOf(seat, 0)).toBe(START_INDEX[seat])
      const visited = new Set<number>()
      for (let s = 0; s < TRACK_LENGTH; s++) visited.add(trackIndexOf(seat, s)!)
      expect(visited.size).toBe(TRACK_LENGTH)
    }
  })

  it("renvoie null hors du circuit", () => {
    expect(trackIndexOf(0, -1)).toBeNull()
    expect(trackIndexOf(0, TRACK_LENGTH)).toBeNull()
  })
})

describe('carré central', () => {
  it("ne laisse qu'une seule case libre au centre", () => {
    // Les quatre angles du carré 3×3 appartiennent au circuit — c'est même ce
    // qui rend le tracé orthogonalement continu — et les quatre milieux sont
    // les dernières marches des escaliers. Seul (7,7) est libre.
    //
    // Ce test existe parce que l'inverse a été dessiné : un bloc 3×3 posé au
    // centre recouvrait quatre cases du circuit, et un cheval qui passait par
    // là semblait déjà arrivé.
    const onTrack = new Set(TRACK.map((c) => `${c.col},${c.row}`))
    const onHome = new Set(SEATS.flatMap((s) => HOME_PATH[s].map((c) => `${c.col},${c.row}`)))

    const free: string[] = []
    for (let col = 6; col <= 8; col++) {
      for (let row = 6; row <= 8; row++) {
        const key = `${col},${row}`
        if (!onTrack.has(key) && !onHome.has(key)) free.push(key)
      }
    }
    expect(free).toEqual([`${CENTER.col},${CENTER.row}`])
  })
})
