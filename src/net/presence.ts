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
 *      après un long délai — le temps d'un changement de réseau.
 *
 * Dans les deux cas le siège reste le sien : il porte toujours son nom et son
 * identifiant d'appareil, le bot ne fait que le tenir au chaud. Revenir dans la
 * partie, ou reprendre la main, le lui rend intact.
 *
 * S'y ajoutent les deux durées du battement de cœur applicatif : l'hôte bat la
 * mesure, et c'est ce battement — et non l'avis du transport — qui dit qui est
 * encore là. Voir `session.ts`.
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
 * Délai avant qu'un bot ne tienne le siège d'un joueur parti.
 *
 * Quarante-cinq secondes, et non vingt. Passer du Wi-Fi aux données mobiles ne
 * rétablit pas un lien WebRTC : il faut se réannoncer sur les relais, refaire
 * une offre, retrouver un chemin ICE, refaire la poignée de main — quinze à
 * quarante secondes en pratique, sans compter le temps qu'a pris la détection.
 * À vingt secondes, le joueur voyait un bot prendre son siège avant même
 * d'avoir eu le temps de revenir ; il ne l'avait jamais quitté de son point de
 * vue.
 *
 * La même durée sert de grâce avant d'élire un nouvel hôte : ce sont les deux
 * faces d'une seule question — « est-il vraiment parti ? » — et deux réponses
 * différentes se contrediraient.
 */
export const AWAY_TO_BOT_MS = 45_000

/**
 * Période du battement de l'hôte. Il envoie un `tick`, chacun répond `pong` :
 * la présence se mesure alors sur des messages applicatifs, pas sur l'humeur du
 * transport, qui déclare un pair perdu sur cinq secondes de silence et ne dit
 * plus rien ensuite.
 */
export const TICK_MS = 2_000

/**
 * Silence au-delà duquel on considère l'autre injoignable — quatre battements
 * manqués. Assez pour absorber un creux de réseau, assez peu pour que l'écran
 * ne mente pas longtemps.
 */
export const SILENCE_MS = 8_000

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
