/**
 * Ce que le palmarès doit tenir.
 *
 * Trois promesses, et les tests d'ici ne parlent que d'elles :
 *
 * 1. Deux téléphones qui ont joué la même partie en fabriquent le **même**
 *    enregistrement — sans quoi la fusion compterait chaque soirée deux fois.
 * 2. Fusionner deux registres est une réunion d'ensembles : sans ordre, sans
 *    doublon, sans perte.
 * 3. On s'y reconnaît au prénom, accents et majuscules compris.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  addMatches,
  clearLedger,
  matchIdOf,
  matchOf,
  nameKey,
  readLedger,
  sanitize,
  tallies,
  MAX_MATCHES,
  type Match,
} from './ledger.ts'
import type { GameState, Player, Seat, SeatStats } from '../game/types.ts'

const memoryStorage = () => {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}
globalThis.localStorage ??= memoryStorage() as Storage

const stats = (over: Partial<SeatStats> = {}): SeatStats => ({
  rolls: 10,
  pips: 35,
  sixes: 2,
  captures: 1,
  losses: 1,
  distance: 100,
  powers: 0,
  ...over,
})

const seat = (n: Seat, name: string, kind: Player['kind'] = 'local'): Player => ({
  seat: n,
  name,
  kind,
  peerId: null,
  connected: true,
})

const finished = (over: Partial<GameState> = {}): GameState =>
  ({
    variant: { id: 'petits-chevaux', pawnsPerPlayer: 4 },
    players: [seat(0, 'Léa'), seat(1, 'Sami')],
    phase: 'finished',
    ranking: [1, 0],
    rng: 987654,
    stats: [stats(), stats({ captures: 5 })],
    ...over,
  }) as unknown as GameState

const match = (id: string, at: number, winner: string, loser = 'Sami'): Match => ({
  id,
  at,
  variantId: 'petits-chevaux',
  teams: false,
  players: [
    { seat: 0, name: winner, place: 1, bot: false, won: true, stats: stats() },
    { seat: 1, name: loser, place: 2, bot: false, won: false, stats: stats() },
  ],
})

describe('la partie telle qu’elle entre au registre', () => {
  beforeEach(() => clearLedger())

  it('donne le même identifiant sur deux appareils qui ont vu la même partie', () => {
    const game = finished()
    expect(matchIdOf('ABCD1234', 2, game)).toBe(matchIdOf('ABCD1234', 2, { ...game }))
  })

  /**
   * Sur un seul téléphone, le code vaut `LOCAL` et la manche repart de zéro
   * chaque soir : sans l'état du générateur, deux soirées porteraient le même
   * identifiant et la seconde n'aurait jamais été comptée.
   */
  it('distingue deux parties locales que le code et la manche confondraient', () => {
    const a = matchIdOf('LOCAL', 0, finished({ rng: 111 }))
    const b = matchIdOf('LOCAL', 0, finished({ rng: 222 }))
    expect(a).not.toBe(b)
  })

  it('ne range rien d’une partie qui n’est pas finie', () => {
    expect(matchOf('LOCAL', 0, finished({ phase: 'rolling' }))).toBeNull()
  })

  it('classe dans l’ordre d’arrivée et couronne le premier', () => {
    const recorded = matchOf('LOCAL', 0, finished(), 1000)!
    expect(recorded.players.map((p) => p.name)).toEqual(['Sami', 'Léa'])
    expect(recorded.players[0]!.won).toBe(true)
    expect(recorded.players[1]!.won).toBe(false)
  })

  /**
   * Une partie quittée en cours de route a quand même eu lieu : les sièges qui
   * n'ont pas fini suivent ceux qui ont fini, ils ne disparaissent pas.
   */
  it('garde les joueurs absents du classement', () => {
    const game = finished({ players: [seat(0, 'Léa'), seat(1, 'Sami'), seat(2, 'Max')], ranking: [1] })
    expect(matchOf('LOCAL', 0, game)!.players.map((p) => p.name)).toEqual(['Sami', 'Léa', 'Max'])
  })

  /** En équipes on gagne à deux : le partenaire du vainqueur a gagné aussi. */
  it('couronne les deux sièges du camp vainqueur', () => {
    const game = finished({
      variant: { id: 'equipes', teams: true, pawnsPerPlayer: 4 } as GameState['variant'],
      players: [seat(0, 'Léa'), seat(1, 'Sami'), seat(2, 'Max'), seat(3, 'Zoé')],
      ranking: [1, 3, 0, 2],
    })
    const won = matchOf('LOCAL', 0, game)!.players.filter((p) => p.won)
    expect(won.map((p) => p.name).sort()).toEqual(['Sami', 'Zoé'])
  })

  it('marque les sièges tenus par un ordinateur', () => {
    const game = finished({ players: [seat(0, 'Léa'), seat(1, 'Bot 2', 'bot')] })
    expect(matchOf('LOCAL', 0, game)!.players.find((p) => p.name === 'Bot 2')!.bot).toBe(true)
  })
})

describe('la fusion de deux registres', () => {
  beforeEach(() => clearLedger())

  it('réunit sans doublon, la plus récente devant', () => {
    addMatches([match('a', 1000, 'Léa')])
    const merged = addMatches([match('a', 1000, 'Léa'), match('b', 2000, 'Sami')])!
    expect(merged.map((m) => m.id)).toEqual(['b', 'a'])
  })

  it('ne réécrit rien quand l’ami n’apporte que du déjà-connu', () => {
    addMatches([match('a', 1000, 'Léa')])
    expect(addMatches([match('a', 1000, 'Léa')])).toBeNull()
  })

  it('se relit tel qu’il a été rangé', () => {
    addMatches([match('a', 1000, 'Léa')])
    expect(readLedger().map((m) => m.id)).toEqual(['a'])
  })

  it('coupe les plus anciennes quand le registre déborde', () => {
    let merged: Match[] = []
    for (let i = 0; i < MAX_MATCHES + 5; i++) merged = addMatches([match(`m${i}`, i * 1000, 'Léa')])!
    expect(merged).toHaveLength(MAX_MATCHES)
    expect(merged[0]!.id).toBe(`m${MAX_MATCHES + 4}`)
    expect(merged.at(-1)!.id).toBe('m5')
  })
})

describe('le classement', () => {
  it('range par victoires, puis par proportion', () => {
    const table = tallies([
      match('a', 1000, 'Léa'),
      match('b', 2000, 'Léa'),
      match('c', 3000, 'Sami', 'Léa'),
    ])
    expect(table.map((t) => [t.name, t.wins, t.games])).toEqual([
      ['Léa', 2, 3],
      ['Sami', 1, 3],
    ])
  })

  it('reconnaît le même prénom sous ses accents et ses majuscules', () => {
    expect(nameKey('  LÉA ')).toBe(nameKey('lea'))
    const table = tallies([match('a', 1000, 'Léa', 'Max'), match('b', 2000, 'LEA', 'Max')])
    expect(table).toHaveLength(2)
    expect(table[0]!.wins).toBe(2)
    // Le prénom affiché est celui de la dernière partie jouée.
    expect(table[0]!.name).toBe('LEA')
  })

  /**
   * Un bot n'est pas la même personne d'un soir à l'autre et n'en garde rien :
   * le voir premier au palmarès de la bande ne dirait rien à personne.
   */
  it('laisse les ordinateurs hors du classement', () => {
    const withBot = match('a', 1000, 'Léa')
    withBot.players[1] = { ...withBot.players[1]!, name: 'Bot 2', bot: true }
    expect(tallies([withBot]).map((t) => t.name)).toEqual(['Léa'])
  })

  it('additionne les compteurs de toutes les parties', () => {
    const table = tallies([match('a', 1000, 'Léa'), match('b', 2000, 'Léa')])
    expect(table[0]!.stats.rolls).toBe(20)
    expect(table[0]!.stats.pips).toBe(70)
  })
})

describe('ce qui arrive d’un ami', () => {
  it('écarte ce qui n’a pas la forme d’une partie', () => {
    expect(sanitize('bonjour')).toEqual([])
    expect(sanitize([{ id: 'a' }, null, { at: 1 }])).toEqual([])
  })

  it('écarte un deuxième enregistrement du même identifiant', () => {
    expect(sanitize([match('a', 1, 'Léa'), match('a', 2, 'Sami')])).toHaveLength(1)
  })

  it('borne le lot reçu', () => {
    const many = Array.from({ length: MAX_MATCHES + 50 }, (_, i) => match(`m${i}`, i, 'Léa'))
    expect(sanitize(many)).toHaveLength(MAX_MATCHES)
  })

  it('remet d’aplomb les compteurs douteux', () => {
    const broken = match('a', 1, 'Léa')
    broken.players[0] = {
      ...broken.players[0]!,
      stats: { ...broken.players[0]!.stats, captures: Number.NaN, distance: -5 },
    }
    const clean = sanitize([broken])[0]!.players[0]!.stats
    expect(clean.captures).toBe(0)
    expect(clean.distance).toBe(0)
  })

  it('coupe un prénom trop long plutôt que de le refuser', () => {
    const long = match('a', 1, 'A'.repeat(80))
    expect(sanitize([long])[0]!.players[0]!.name).toHaveLength(16)
  })
})
