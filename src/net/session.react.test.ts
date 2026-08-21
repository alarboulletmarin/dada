/**
 * Les réactions, côté réseau.
 *
 * Elles empruntent le canal du chat — une réaction *est* un message d'un seul
 * emoji — et c'est la session qui les distingue, les freine et les plafonne.
 * Deux garde-fous, et ils ne protègent pas de la même chose :
 *
 * - chez l'émetteur, un intervalle minimal : un appui unique se répète très
 *   vite, et un doigt qui tambourine noierait la table sous ses bulles ;
 * - chez le récepteur, un plafond de bulles simultanées par siège : le frein
 *   d'en face vit chez quelqu'un d'autre, et quelqu'un d'autre peut tourner
 *   une version d'avant — ou mentir.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import {
  REACT_IN_FLIGHT_MAX,
  REACT_LIFE_MS,
  REACT_MIN_MS,
  Session,
  type RoomFactory,
  type SessionListeners,
} from './session.ts'
import type { ChatMessage, Room } from './room.ts'

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

function fakeRoom() {
  const handlers = new Map<string, (data: never, peer: string) => void>()
  const sent: { kind: string; data: unknown }[] = []
  const room: Room = {
    selfId: 'moi-le-pair',
    relaysUp: () => 3,
    peers: () => ['peer-1'],
    send: (kind, data) => void sent.push({ kind, data }),
    on: (kind, cb) => handlers.set(kind, cb as (data: never, peer: string) => void),
    onPeerJoin: () => {},
    onPeerLeave: () => {},
    leave: async () => {},
  }
  return {
    factory: (() => room) as RoomFactory,
    sent,
    receive: (kind: string, data: unknown, peer: string) => handlers.get(kind)?.(data as never, peer),
  }
}

const from = (clientId: string, text: string): ChatMessage => ({
  clientId,
  name: clientId === 'ami' ? 'Camille' : 'Alan',
  text,
  at: Date.now(),
  kind: 'reaction',
})

describe('les réactions passent par le canal du chat', () => {
  let channel: ReturnType<typeof fakeRoom>
  let heard: ChatMessage[]
  let host: Session

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'))
    localStorage.clear()
    channel = fakeRoom()
    heard = []
    const listeners: SessionListeners = {
      onChange: vi.fn(),
      onError: vi.fn(),
      onChat: (m) => void heard.push(m),
    }
    host = Session.online('ABCDEFGH', 'Alan', true, listeners, channel.factory)
    channel.receive('hello', { clientId: 'ami', name: 'Camille' }, 'peer-1')
    host.admit('ami')
    host.setVariant('petits-chevaux')
    host.start()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('diffuse un emoji typé, et se le sert à lui-même', () => {
    expect(host.sendReaction('😂')).toBe(true)

    // Trystero ne renvoie pas l'émetteur à lui-même : sans ce service local,
    // on serait le seul de la table à ne pas voir sa propre réaction.
    expect(heard).toHaveLength(1)
    expect(heard[0]).toMatchObject({ clientId: host.self, text: '😂', kind: 'reaction' })

    const chat = channel.sent.filter((s) => s.kind === 'chat')
    expect(chat).toHaveLength(1)
    expect(chat[0]!.data).toMatchObject({ text: '😂', kind: 'reaction', name: 'Alan' })
  })

  it('garde la trace dans la conversation, comme un message', () => {
    host.sendReaction('🎉')
    channel.receive('chat', from('ami', '🐴'), 'peer-1')

    expect(host.chatLog.map((m) => m.text)).toEqual(['🎉', '🐴'])
    expect(host.chatLog.every((m) => m.kind === 'reaction')).toBe(true)
  })

  it('reçoit celle d’un pair sans la confondre avec un message écrit', () => {
    channel.receive('chat', { clientId: 'ami', name: 'Camille', text: 'salut', at: Date.now() }, 'peer-1')
    channel.receive('chat', from('ami', '😱'), 'peer-1')

    expect(heard.map((m) => m.kind)).toEqual([undefined, 'reaction'])
  })

  describe('le frein de l’émetteur', () => {
    it('mange un second appui trop rapproché', () => {
      expect(host.sendReaction('😂')).toBe(true)
      vi.advanceTimersByTime(REACT_MIN_MS - 50)
      expect(host.sendReaction('😂')).toBe(false)

      expect(host.chatLog).toHaveLength(1)
      expect(channel.sent.filter((s) => s.kind === 'chat')).toHaveLength(1)
    })

    it('laisse repartir une fois l’intervalle écoulé', () => {
      expect(host.sendReaction('😂')).toBe(true)
      vi.advanceTimersByTime(REACT_MIN_MS)
      expect(host.sendReaction('🎉')).toBe(true)

      expect(host.chatLog.map((m) => m.text)).toEqual(['😂', '🎉'])
    })

    it('ne freine pas les mots : le chat écrit n’a rien à voir', () => {
      host.sendReaction('😂')
      host.sendChat('bien joué')
      host.sendChat('vraiment')

      expect(host.chatLog.map((m) => m.text)).toEqual(['😂', 'bien joué', 'vraiment'])
    })
  })

  describe('le plafond du récepteur', () => {
    it('ignore ce qui dépasse les bulles en vol d’un même siège', () => {
      // Un pair qui ne se freine pas : trois passent, la quatrième n'existe pas.
      for (let i = 0; i < REACT_IN_FLIGHT_MAX + 2; i++) channel.receive('chat', from('ami', '😡'), 'peer-1')

      expect(heard).toHaveLength(REACT_IN_FLIGHT_MAX)
      // Ni bulle ni ligne dans l'historique : c'est du bruit, l'archiver
      // reviendrait à le déplacer.
      expect(host.chatLog).toHaveLength(REACT_IN_FLIGHT_MAX)
    })

    it('rouvre le passage quand les bulles sont retombées', () => {
      for (let i = 0; i < REACT_IN_FLIGHT_MAX + 2; i++) channel.receive('chat', from('ami', '😡'), 'peer-1')
      vi.advanceTimersByTime(REACT_LIFE_MS)
      channel.receive('chat', from('ami', '🐴'), 'peer-1')

      expect(heard).toHaveLength(REACT_IN_FLIGHT_MAX + 1)
      expect(heard[heard.length - 1]!.text).toBe('🐴')
    })

    it('compte par siège : un joueur bavard n’étouffe pas les autres', () => {
      for (let i = 0; i < REACT_IN_FLIGHT_MAX + 2; i++) channel.receive('chat', from('ami', '😡'), 'peer-1')
      channel.receive('chat', from('autre', '🎲'), 'peer-2')

      expect(heard[heard.length - 1]).toMatchObject({ clientId: 'autre', text: '🎲' })
    })

    it('ne plafonne pas les messages écrits, qui ne font pas de bulle empilée', () => {
      for (let i = 0; i < REACT_IN_FLIGHT_MAX + 2; i++) {
        channel.receive('chat', { clientId: 'ami', name: 'Camille', text: `mot ${i}`, at: Date.now() }, 'peer-1')
      }

      expect(heard).toHaveLength(REACT_IN_FLIGHT_MAX + 2)
    })
  })
})
