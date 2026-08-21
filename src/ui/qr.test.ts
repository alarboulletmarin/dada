import { describe, expect, it } from 'vitest'
import { qrCode, QR_MAX_BYTES, type Qr } from './qr.ts'

const art = (qr: Qr): string[] =>
  Array.from({ length: qr.size }, (_, y) =>
    Array.from({ length: qr.size }, (_, x) => (qr.dark[y * qr.size + x] ? '#' : '.')).join(''),
  )

const at = (qr: Qr, x: number, y: number): boolean => qr.dark[y * qr.size + x]!

describe('qrCode', () => {
  /**
   * Le témoin du module : un lien d'invitation, module par module.
   *
   * Il a été vérifié deux fois — par un encodeur du commerce, qui rend
   * exactement cette grille, et par un lecteur qui y relit le lien. C'est ce
   * qui permet à tout le reste du fichier de n'être que des propriétés : si
   * une seule ligne de l'encodage dérive, celle-ci le dit tout de suite.
   */
  it("rend le symbole attendu pour un lien d'invitation", () => {
    expect(art(qrCode('https://dada.jeu/#7KQ2M9AB')!)).toEqual([
      '#######.#..#####..#######',
      '#.....#...#...#.#.#.....#',
      '#.###.#..#..#.#...#.###.#',
      '#.###.#.#..###..#.#.###.#',
      '#.###.#.##.###.#..#.###.#',
      '#.....#.#...#...#.#.....#',
      '#######.#.#.#.#.#.#######',
      '........#.#...##.........',
      '#...#.####.#.#..######..#',
      '#.####...#.#..###...##.#.',
      '#.#...##.#####.#.#...##..',
      '.....#..#...#.##...#..##.',
      '..#.###.#.####...###.####',
      '###.....#.#.##.##...#..#.',
      '.....##..#.#...##..####..',
      '..###...###...#.##.##.##.',
      '###...####..#.#########..',
      '........#.#..#..#...#....',
      '#######.#.####..#.#.#....',
      '#.....#....#....#...#####',
      '#.###.#.#...##..#######..',
      '#.###.#..##...#.####..###',
      '#.###.#....##.#..##..#.#.',
      '#.....#..#.#..##.#.#####.',
      '#######.##.#..#..##...###',
    ])
  })

  it('prend la plus petite version qui tient le texte', () => {
    // Les seuils du mode octet en correction M, version par version : un
    // caractère de plus, et le symbole grandit de quatre modules.
    const seuils: [number, number][] = [
      [14, 21],
      [15, 25],
      [26, 25],
      [27, 29],
      [42, 29],
      [43, 33],
      [62, 33],
      [63, 37],
      [84, 37],
      [85, 41],
      [106, 41],
      [107, 45],
      [122, 45],
      [123, 49],
      [152, 49],
      [153, 53],
      [180, 53],
    ]
    for (const [length, size] of seuils) {
      expect(qrCode('a'.repeat(length))!.size, `${length} octets`).toBe(size)
    }
  })

  it('compte en octets, pas en caractères', () => {
    // « é » pèse deux octets en UTF-8, « ✓ » trois : quatorze caractères
    // accentués ne tiennent pas là où quatorze lettres tiennent.
    expect(qrCode('é'.repeat(7))!.size).toBe(21)
    expect(qrCode('é'.repeat(8))!.size).toBe(25)
  })

  it('rend null plutôt que de tronquer un texte trop long', () => {
    expect(QR_MAX_BYTES).toBe(180)
    expect(qrCode('a'.repeat(QR_MAX_BYTES))).not.toBeNull()
    expect(qrCode('a'.repeat(QR_MAX_BYTES + 1))).toBeNull()
  })

  it('pose les trois repères et leur séparation blanche', () => {
    const qr = qrCode('https://dada.jeu/#7KQ2M9AB')!
    for (const [ox, oy] of [
      [0, 0],
      [qr.size - 7, 0],
      [0, qr.size - 7],
    ] as const) {
      for (let dy = 0; dy < 7; dy++) {
        for (let dx = 0; dx < 7; dx++) {
          const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3))
          expect(at(qr, ox + dx, oy + dy), `repère ${ox},${oy} en ${dx},${dy}`).toBe(ring !== 2)
        }
      }
    }
    // La huitième colonne d'un repère est toujours blanche : c'est elle qui
    // l'isole des données.
    for (let y = 0; y < 8; y++) expect(at(qr, 7, y)).toBe(false)
  })

  it("garde les horloges alternées et le module toujours encré", () => {
    const qr = qrCode('https://dada.jeu/#7KQ2M9AB')!
    for (let i = 8; i < qr.size - 8; i++) {
      expect(at(qr, i, 6), `horloge horizontale en ${i}`).toBe(i % 2 === 0)
      expect(at(qr, 6, i), `horloge verticale en ${i}`).toBe(i % 2 === 0)
    }
    expect(at(qr, 8, qr.size - 8)).toBe(true)
  })

  it('recopie les mêmes quinze bits de format aux deux endroits', () => {
    const qr = qrCode('https://dada.jeu/#7KQ2M9AB')!
    const first = [
      ...Array.from({ length: 6 }, (_, i) => at(qr, 8, i)),
      at(qr, 8, 7),
      at(qr, 8, 8),
      at(qr, 7, 8),
      ...Array.from({ length: 6 }, (_, i) => at(qr, 5 - i, 8)),
    ]
    const second = [
      ...Array.from({ length: 8 }, (_, i) => at(qr, qr.size - 1 - i, 8)),
      ...Array.from({ length: 7 }, (_, i) => at(qr, 8, qr.size - 7 + i)),
    ]
    expect(first).toEqual(second)
  })
})
