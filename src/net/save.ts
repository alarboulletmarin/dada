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
const INVITE_KEY = 'dada.invite'
/**
 * 3 : les bonus de dé sont un budget par siège (`diceBoosts`, un tableau), et
 * non plus une réserve commune à la table.
 *
 * 2 : l'état porte le compteur de tours passés à l'écurie (`stuck`).
 *
 * Le numéro ne monte que quand le **moteur** change. Le salon a gagné depuis un
 * règne (`epoch`) et un numéro de manche (`round`), mais ces deux-là ne servent
 * qu'en ligne — où rien n'est sauvegardé — et se comblent à la lecture. Monter
 * le format pour eux aurait jeté toutes les parties locales en cours, sans rien
 * régler.
 */
const VERSION = 3
/**
 * Au-delà, la partie qu'on avait quittée est finie depuis longtemps : proposer
 * d'y revenir ne ferait que promettre une salle vide.
 */
const INVITE_TTL = 2 * 60 * 60 * 1000

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
    // Champs de salon apparus après coup : ils n'ont de sens qu'en ligne, et
    // leur absence ne rend pas la partie moins jouable.
    save.lobby.epoch ??= 0
    save.lobby.round ??= 0
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

// ─────────────────────────── partie en ligne quittée ───────────────────────────

/**
 * Le code de la dernière partie en ligne où l'on jouait.
 *
 * Une partie en ligne ne se sauvegarde pas — elle vit sur la table, pas sur ce
 * téléphone. Mais quitter ne doit pas être un aller simple : le siège reste le
 * nôtre pendant que la table continue (voir `presence.ts`), encore faut-il
 * pouvoir retrouver le code. C'est tout ce que garde cette entrée.
 */
export type Invite = { code: string; at: number }

export function writeInvite(code: string): void {
  try {
    localStorage.setItem(INVITE_KEY, JSON.stringify({ code, at: Date.now() } satisfies Invite))
  } catch {
    // Quota plein ou mode privé : on ne pourra pas proposer le retour, c'est tout.
  }
}

export function readInvite(): Invite | null {
  try {
    const raw = localStorage.getItem(INVITE_KEY)
    if (!raw) return null
    const invite = JSON.parse(raw) as Invite
    if (!invite?.code || Date.now() - invite.at > INVITE_TTL) return null
    return invite
  } catch {
    return null
  }
}

export function clearInvite(): void {
  try {
    localStorage.removeItem(INVITE_KEY)
  } catch {
    // Sans conséquence : une invitation périmée est écartée à la lecture.
  }
}
