/**
 * Qui tient encore son siège ?
 *
 * Trois règles de table, séparées du reste parce qu'elles n'ont besoin ni du
 * réseau ni de l'horloge du système : on leur passe des durées, elles répondent.
 * C'est ce qui les rend vérifiables par un test.
 *
 *   1. Un joueur a dix secondes pour jouer. Passé ce délai son tour saute —
 *      rien n'est joué à sa place, ne pas jouer est déjà toute la peine.
 *   2. Trois tours sautés d'affilée, et un bot prend la main à sa place.
 *   3. Un joueur parti d'une partie en ligne est remplacé de la même façon,
 *      après un court délai — le temps d'un rechargement de page.
 *
 * Dans les deux cas le siège reste le sien : il porte toujours son nom et son
 * identifiant d'appareil, le bot ne fait que le tenir au chaud. Revenir dans la
 * partie, ou reprendre la main, le lui rend intact.
 */

/** Temps laissé à un joueur pour lancer le dé, puis pour choisir son cheval. */
export const TURN_MS = 10_000

/**
 * Marge que l'hôte s'accorde avant de trancher. Le compte à rebours affiché
 * chez un pair démarre à la réception de l'état, donc toujours après celui de
 * l'hôte : sans ce délai, un coup parti à la dernière seconde arriverait après
 * la sanction, et le joueur verrait son tour sauter alors qu'il a joué.
 */
export const TURN_GRACE_MS = 1500

/** Tours sautés d'affilée après lesquels un bot prend la main. */
export const MISSED_TURNS_TO_BOT = 3

/**
 * Délai avant qu'un bot ne tienne le siège d'un joueur parti. Assez long pour
 * qu'un rechargement de page ou un tunnel de métro ne coûte rien, assez court
 * pour que la table n'attende pas quelqu'un qui ne revient plus.
 */
export const AWAY_TO_BOT_MS = 20_000

/** Ce que la présence a besoin de savoir d'un siège — un sous-ensemble de `LobbyPlayer`. */
export type SeatPresence = {
  kind: 'human' | 'bot'
  connected: boolean
  /** Un bot tient ce siège humain, en attendant son retour. */
  botFill: boolean
}

/** Un bot joue-t-il ce siège en ce moment, à demeure ou par intérim ? */
export const isBotSeat = (p: SeatPresence): boolean => p.kind === 'bot' || p.botFill

/**
 * Faut-il confier ce siège à un bot ? `awayFor` vaut null tant que le joueur
 * est là ; `missed` compte ses tours sautés d'affilée.
 */
export function shouldHandToBot(
  p: SeatPresence,
  { missed, awayFor }: { missed: number; awayFor: number | null },
): boolean {
  if (p.kind !== 'human' || p.botFill) return false
  if (awayFor !== null && !p.connected && awayFor >= AWAY_TO_BOT_MS) return true
  return missed >= MISSED_TURNS_TO_BOT
}

/**
 * Part du temps de réflexion qu'il reste, de 1 à 0 — de quoi peindre un
 * contour qui se vide sans que l'affichage ait à connaître les durées.
 */
export function turnLeft(endsAt: number | null, now: number): number | null {
  if (endsAt === null) return null
  return Math.max(0, Math.min(1, (endsAt - now) / TURN_MS))
}
