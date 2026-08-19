import { describe, expect, it } from 'vitest'
import { nextFloat, rollDie, seedFrom } from './rng.ts'

/** Suite de faces à partir d'une graine, pour compter à grande échelle. */
function faces(seed: number, count: number, options?: Parameters<typeof rollDie>[1]): number[] {
  const out: number[] = []
  let state = seed
  for (let i = 0; i < count; i++) {
    const [next, die] = rollDie(state, options)
    state = next
    out.push(die)
  }
  return out
}

const share = (list: number[], face: number): number =>
  list.filter((d) => d === face).length / list.length

describe('dé franc', () => {
  const list = faces(seedFrom('DADA'), 120_000)

  it('donne les six faces à parts égales', () => {
    for (let face = 1; face <= 6; face++) expect(share(list, face)).toBeCloseTo(1 / 6, 2)
  })

  /**
   * Le vrai risque d'un générateur partagé : que le joueur qui tire une fois
   * sur quatre tombe systématiquement du mauvais côté. Une table de quatre
   * verrait alors toujours le même malchanceux, et ce ne serait pas une
   * impression.
   */
  it('ne défavorise personne autour d’une table de quatre', () => {
    for (let seat = 0; seat < 4; seat++) {
      const mine = list.filter((_, i) => i % 4 === seat)
      expect(share(mine, 6)).toBeCloseTo(1 / 6, 2)
    }
  })

  it('rejoue exactement la même suite depuis la même graine', () => {
    expect(faces(1234, 50)).toEqual(faces(1234, 50))
  })
})

describe('bonus de dé', () => {
  it('donne ~80% aux trois faces favorisées', () => {
    const low = faces(seedFrom('BAS'), 60_000, { bias: 'low' })
    expect(share(low, 1) + share(low, 2) + share(low, 3)).toBeCloseTo(0.8, 2)

    const high = faces(seedFrom('HAUT'), 60_000, { bias: 'high' })
    expect(share(high, 4) + share(high, 5) + share(high, 6)).toBeCloseTo(0.8, 2)
  })

  /**
   * Le dé pondéré a remplacé deux tables de quinze cases. Il doit rendre
   * exactement les mêmes faces : une partie commencée avant la mise à jour se
   * rejoue à l'identique, et le bonus garde le poids qu'on lui connaissait.
   */
  it('rend face pour face ce que rendaient les tables de quinze cases', () => {
    const LOW = [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 5, 6]
    const HIGH = [1, 2, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6]

    let state = seedFrom('TABLES')
    for (let i = 0; i < 20_000; i++) {
      const [next, f] = nextFloat(state)
      expect(rollDie(state)[1]).toBe(Math.floor(f * 6) + 1)
      expect(rollDie(state, { bias: 'low' })[1]).toBe(LOW[Math.floor(f * LOW.length)])
      expect(rollDie(state, { bias: 'high' })[1]).toBe(HIGH[Math.floor(f * HIGH.length)])
      state = next
    }
  })
})

describe('pitié de sortie', () => {
  const exitFaces = [6]

  it('ne touche à rien tant que la pitié est à zéro', () => {
    const list = faces(seedFrom('ZERO'), 60_000, { exitFaces, exitChance: 0 })
    expect(share(list, 6)).toBeCloseTo(1 / 6, 2)
  })

  it('monte la sortie à mi-chemin du certain', () => {
    // 1/6 + (5/6 × 0,5) = 7/12
    const list = faces(seedFrom('MOITIE'), 60_000, { exitFaces, exitChance: 0.5 })
    expect(share(list, 6)).toBeCloseTo(7 / 12, 2)
  })

  it('garantit la sortie à un', () => {
    expect(faces(seedFrom('SUR'), 2_000, { exitFaces, exitChance: 1 })).toEqual(
      Array.from({ length: 2_000 }, () => 6),
    )
  })

  it('laisse les autres faces équiprobables entre elles', () => {
    const list = faces(seedFrom('RESTE'), 90_000, { exitFaces, exitChance: 0.5 })
    for (let face = 1; face <= 5; face++) expect(share(list, face)).toBeCloseTo(5 / 60, 2)
  })

  it('compte les deux faces de sortie de la variante rapide', () => {
    const list = faces(seedFrom('RAPIDE'), 60_000, { exitFaces: [1, 6], exitChance: 0.5 })
    // 2/6 + (4/6 × 0,5) = 2/3, partagé entre le 1 et le 6.
    expect(share(list, 1) + share(list, 6)).toBeCloseTo(2 / 3, 2)
    expect(share(list, 1)).toBeCloseTo(share(list, 6), 1)
  })

  /** Un joueur bloqué qui dépense un bonus ne doit jamais y perdre. */
  it('ne laisse pas un bonus mal choisi effacer la pitié', () => {
    const list = faces(seedFrom('BONUS'), 60_000, { bias: 'low', exitFaces, exitChance: 0.75 })
    expect(share(list, 6)).toBeGreaterThan(0.75)
  })
})
