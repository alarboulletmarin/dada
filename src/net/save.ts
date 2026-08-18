/**
 * Sauvegarde d'une partie sur cet appareil.
 *
 * Uniquement les parties locales : une partie en ligne appartient à la table,
 * pas à un téléphone, et la reprendre suppose que les autres soient encore là.
 * Tout l'état du moteur est du JSON pur — pas de fonction, pas de `Map`, un
 * générateur aléatoire réduit à un entier — donc la sauvegarde est une simple
 * copie, et la partie reprise se déroule exactement comme elle se serait
 * déroulée sans interruption.
 */

import type { GameState } from '../game/types.ts'
import type { Lobby } from './room.ts'

const KEY = 'dada.save'
const VERSION = 1

export type Save = {
  v: number
  lobby: Lobby
  game: GameState
  /** Horodatage de la dernière écriture, pour situer la partie à la reprise. */
  at: number
}

export function writeSave(lobby: Lobby, game: GameState): void {
  try {
    const save: Save = { v: VERSION, lobby, game, at: Date.now() }
    localStorage.setItem(KEY, JSON.stringify(save))
  } catch {
    // Quota plein ou mode privé : la partie continue, elle ne sera simplement
    // pas reprenable. Ce n'est pas une raison de l'interrompre.
  }
}

export function readSave(): Save | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const save = JSON.parse(raw) as Save
    // Une sauvegarde d'une version antérieure du format n'est pas rejouable :
    // mieux vaut l'oublier que de restaurer un état à moitié compris.
    if (save.v !== VERSION || !save.game || !save.lobby) return null
    if (save.game.phase === 'finished') return null
    return save
  } catch {
    return null
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Sans conséquence : au pire la sauvegarde périmée sera écartée à la lecture.
  }
}

/** « il y a 3 min », pour que la reprise dise de quand elle date. */
export function since(at: number): string {
  const min = Math.round((Date.now() - at) / 60000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const hours = Math.round(min / 60)
  if (hours < 24) return `il y a ${hours} h`
  const days = Math.round(hours / 24)
  return days === 1 ? 'hier' : `il y a ${days} jours`
}
