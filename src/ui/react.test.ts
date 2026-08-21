/**
 * « Ce qui vient d'arriver appelle-t-il une réaction ? »
 *
 * La décision est sortie de l'écran pour être vérifiable : elle dépend du
 * journal, de mon siège, de mon nom et de qui a la main — quatre choses dont
 * trois ne se voient nulle part, et dont la combinaison décide si six boutons
 * poussent sous le pouce de quelqu'un qui ne les a pas demandés.
 */

import { describe, expect, it } from 'vitest'
import { cueFor, REACTIONS, type CueContext } from './react.ts'
import type { LogEntry, LogEvent, Seat } from '../game/types.ts'

const entry = (seat: Seat, event: LogEvent, seq = 7): LogEntry => ({ seq, seat, actor: 'peu importe', event })

/** Moi : siège 1, prénom Camille, et ce n'est pas mon tour. */
const me: CueContext = { seat: 1, name: 'Camille', myTurn: false }

describe('la réaction proposée après une entrée de journal', () => {
  it('propose le cri quand mon cheval vient de se faire manger', () => {
    const cue = cueFor(entry(0, { kind: 'capture', pawn: 2, victim: 'Camille' }), me)
    expect(cue).toEqual({ emoji: '😱', tone: 'eaten' })
  })

  it('propose la fête quand c’est moi qui mange', () => {
    const cue = cueFor(entry(1, { kind: 'capture', pawn: 3, victim: 'Sami' }), me)
    expect(cue).toEqual({ emoji: '🎉', tone: 'ate' })
  })

  it('ne propose rien pour une capture entre deux autres', () => {
    expect(cueFor(entry(0, { kind: 'capture', pawn: 1, victim: 'Sami' }), me)).toBeNull()
  })

  it('ne vole jamais le focus du dé : rien pendant mon tour', () => {
    // Le cas existe : une capture peut me viser juste avant que la main ne me
    // revienne, et l'éventail pousserait à côté du dé au moment où on le vise.
    const victime = entry(0, { kind: 'capture', pawn: 2, victim: 'Camille' })
    expect(cueFor(victime, { ...me, myTurn: true })).toBeNull()
  })

  it('ne propose rien à qui n’a pas de siège', () => {
    const victime = entry(0, { kind: 'capture', pawn: 2, victim: 'Camille' })
    expect(cueFor(victime, { ...me, seat: null })).toBeNull()
  })

  it('ne réagit qu’aux captures', () => {
    const autres: LogEvent[] = [
      { kind: 'roll', dice: 6 },
      { kind: 'exit', pawn: 1 },
      { kind: 'finish', pawn: 2 },
      { kind: 'shielded', pawn: 1, owner: 'Camille' },
      { kind: 'timeout' },
      { kind: 'win' },
    ]
    for (const event of autres) {
      expect(cueFor(entry(0, event), me)).toBeNull()
      expect(cueFor(entry(1, event), me)).toBeNull()
    }
  })

  it('penche vers le cri quand deux joueurs portent le même prénom', () => {
    // Un cheval ne se mange jamais lui-même : « victime nommée comme moi ET
    // mangée par mon propre siège » ne peut être qu'un homonyme. Dans le doute
    // on ne propose pas de fêter ce qui est peut-être son propre malheur.
    const homonyme = entry(2, { kind: 'capture', pawn: 1, victim: 'Camille' })
    expect(cueFor(homonyme, me)).toEqual({ emoji: '😱', tone: 'eaten' })
  })

  it('ne propose qu’un emoji qui est déjà dans l’éventail', () => {
    // Sinon la rangée changerait de contenu selon le moment, et l'on ne
    // pourrait plus viser de mémoire.
    const cues = [
      cueFor(entry(0, { kind: 'capture', pawn: 2, victim: 'Camille' }), me),
      cueFor(entry(1, { kind: 'capture', pawn: 3, victim: 'Sami' }), me),
    ]
    for (const cue of cues) expect(REACTIONS).toContain(cue!.emoji)
  })
})

describe('la rangée elle-même', () => {
  it('tient en six, sans doublon', () => {
    expect(REACTIONS).toHaveLength(6)
    expect(new Set(REACTIONS).size).toBe(6)
  })
})
