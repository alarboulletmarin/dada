/**
 * Les réactions de table : six emoji, un appui, et rien d'autre.
 *
 * Le chat existe depuis le début et personne n'y tape en jouant — c'est
 * normal : écrire demande d'ouvrir un panneau, de viser un champ, de composer,
 * de valider, et de rater son tour pendant ce temps. Une réaction ne demande
 * qu'un doigt et ne quitte pas le plateau.
 *
 * Ce fichier ne touche pas au DOM : il tient la liste et la seule décision qui
 * mérite d'être vérifiée à part — « ce qui vient d'arriver appelle-t-il une
 * réaction, et laquelle ? ».
 */

import type { LogEntry, Seat } from '../game/types.ts'
import type { Key } from './i18n.ts'

/**
 * Les six, dans l'ordre où l'éventail les déploie.
 *
 * Six et pas seize : la rangée du chat est un catalogue qu'on parcourt, celle-ci
 * se vise sans lire. Le choix penche vers ce qu'une table de petits chevaux
 * ressent — on rit, on hurle en se faisant manger, on râle, on parle chevaux,
 * on accuse le dé, on fête une capture.
 *
 * 😱 et 🎉 tiennent leur place parce que ce sont EUX que la table propose après
 * une capture (voir `cueFor`) : une suggestion doit désigner un bouton déjà là,
 * sinon l'éventail changerait de contenu selon le moment et l'on viserait de
 * mémoire un bouton qui a bougé. 😭 en fait les frais — il disait la même chose
 * que 😱, en moins fort.
 */
export const REACTIONS = ['😂', '😱', '😡', '🐴', '🎲', '🎉'] as const

export type Reaction = (typeof REACTIONS)[number]

/** Le nom de chaque réaction, pour les lecteurs d'écran. Même ordre. */
export const REACTION_KEYS: readonly Key[] = [
  'react.laugh',
  'react.scream',
  'react.anger',
  'react.horse',
  'react.dice',
  'react.cheer',
]

/**
 * Ce que la table propose, et sur quel ton.
 *
 * `eaten` : on vient de se faire manger. `ate` : on vient de manger.
 */
export type ReactionCue = { emoji: Reaction; tone: 'eaten' | 'ate' }

/**
 * Ce qu'il faut savoir de soi pour décider. Le journal ne nomme sa victime que
 * par son nom — le moteur n'y met pas de siège — d'où le `name` à côté du
 * `seat`.
 */
export type CueContext = {
  /** Mon siège, ou `null` : spectateur, ou partie pas encore commencée. */
  seat: Seat | null
  /** Mon nom tel que le moteur l'écrit dans le journal. */
  name: string
  /** C'est mon tour : voir plus bas, la suggestion se tait. */
  myTurn: boolean
}

/**
 * « Cette entrée de journal appelle-t-elle une réaction ? »
 *
 * Une capture, et rien d'autre : c'est le seul moment où la table a quelque
 * chose à se dire tout de suite. Un six, une carte ramassée, une arrivée — on
 * les commente si on veut, mais rien ne justifie de mettre six boutons sous le
 * pouce de quelqu'un qui ne les avait pas demandés.
 *
 * **Jamais pendant son propre tour.** Le dé attend un appui, et faire pousser
 * un éventail à côté de lui au moment précis où l'on vise, c'est déplacer la
 * cible. Une capture qui rend la main tout de suite ne proposera donc rien —
 * c'est voulu : on n'a pas besoin d'être invité à fêter un coup qu'on vient de
 * jouer, on a le bouton sous les yeux.
 */
export function cueFor(entry: LogEntry, ctx: CueContext): ReactionCue | null {
  if (ctx.myTurn || ctx.seat === null) return null
  const { event } = entry
  if (event.kind !== 'capture') return null

  // La victime d'abord : deux joueurs peuvent porter le même prénom, et dans le
  // doute mieux vaut proposer le cri que la fête. Un cheval ne se mange jamais
  // lui-même, donc « victime nommée comme moi ET mangée par mon siège » ne peut
  // être qu'un homonyme — dont je suis peut-être la victime.
  if (event.victim === ctx.name && entry.seat !== ctx.seat) return { emoji: '😱', tone: 'eaten' }
  if (entry.seat === ctx.seat) return { emoji: '🎉', tone: 'ate' }
  return null
}
