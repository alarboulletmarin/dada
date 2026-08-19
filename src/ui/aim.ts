/**
 * Ce que devient une carte armée quand l'état de la partie bouge.
 *
 * Une carte touchée ne part pas : elle attend devant son joueur, avec son
 * cheval désigné s'il en faut un, jusqu'au lancer du dé. Entre les deux, la
 * partie continue de vivre — le tour peut passer, le cheval visé rentrer ou se
 * faire manger. Il faut donc, à chaque passe d'affichage, décider si la carte
 * armée tient encore.
 *
 * Cette décision vit ici, à part et pure, parce qu'elle s'est déjà trompée une
 * fois et que la faute était invisible : l'écran désarmait toute carte sans
 * cheval à viser. Or deux bonus n'en visent aucun — le **rejeu** et le **dé
 * pipé**. Les deux se rangeaient donc d'eux-mêmes dans la milliseconde qui
 * suivait l'appui, et restaient en main pour toujours : impossible de les
 * jouer, impossible de s'en défaire, et une main qui ne se vide plus finit par
 * refuser les cartes suivantes.
 *
 * Une règle qu'un test peut tenir ne se re-casse pas en silence.
 */

import { POWERS, type PowerId } from '../game/powers.ts'

/** Une carte posée devant soi, en attente du dé. */
export type Armed = { power: PowerId; pawnId?: string }

/**
 * La carte armée après coup, ou `null` si elle ne tient plus.
 *
 * - `playable` : les cartes de la main jouables à cet instant (voir
 *   `playablePowers` dans le moteur). Une carte qui n'y est plus se range —
 *   c'est ce qui la fait tomber quand le tour passe.
 * - `targets` : les chevaux que cette carte peut viser. Vide et sans objet
 *   pour une carte qui ne vise personne ; vide pour une carte qui en demande
 *   un, c'est qu'elle ne mène plus à rien.
 *
 * Une désignation périmée ne fait pas tomber la carte : elle s'oublie, et le
 * joueur redésigne. Perdre la carte parce que le cheval visé vient de rentrer
 * serait le punir deux fois.
 */
export function keepArmed(
  armed: Armed | null,
  opts: { playable: readonly PowerId[]; targets: readonly string[] },
): Armed | null {
  if (!armed) return null
  if (!opts.playable.includes(armed.power)) return null
  if (POWERS[armed.power].target !== 'cheval') return { power: armed.power }
  if (opts.targets.length === 0) return null
  if (armed.pawnId !== undefined && !opts.targets.includes(armed.pawnId)) {
    return { power: armed.power }
  }
  return armed
}

/** Cette carte demande-t-elle qu'on lui désigne un cheval sur le plateau ? */
export const needsPawn = (power: PowerId): boolean => POWERS[power].target === 'cheval'

/** Une carte armée n'attend-elle plus que le dé ? */
export const armedReady = (armed: Armed | null): boolean =>
  armed !== null && (!needsPawn(armed.power) || armed.pawnId !== undefined)
