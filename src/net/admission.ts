/**
 * Qui entre dans le salon, et à quelles conditions.
 *
 * Une fonction pure, sortie de `session.ts` exprès : c'est la seule règle de
 * sécurité du jeu, et une règle de sécurité qu'on ne peut pas tester est une
 * règle qu'on espère.
 *
 * ## Pourquoi l'accord de l'hôte
 *
 * Le code de partie sert à deux choses à la fois : il désigne le point de
 * rendez-vous sur les relais publics, et il tient lieu de mot de passe. C'est
 * une case de trop pour un seul objet. L'identifiant d'app étant public — le
 * dépôt est libre — qui veut peut calculer le sujet correspondant à chaque code
 * possible, repérer les salons ouverts, et entrer.
 *
 * Allonger le code rend ce calcul déraisonnable, mais ne change pas la nature
 * du problème : connaître le code resterait *suffisant*. L'accord de l'hôte
 * sépare enfin les deux rôles — le code amène jusqu'à la porte, l'hôte l'ouvre.
 *
 * ## Ce qui ne doit surtout pas demander d'accord
 *
 * Un joueur **qui a déjà un siège** revient chez lui : rechargement de page,
 * tunnel, batterie. Lui redemander l'accord de l'hôte au milieu d'une partie
 * serait une porte qui claque dans le dos. Son identité d'appareil (`clientId`)
 * survit au rechargement précisément pour ça.
 */

import type { Lobby } from './room.ts'

export type Welcome =
  /** Ce siège est déjà le sien : il le reprend sans rien demander. */
  | { kind: 'reclaim' }
  /** Nouveau venu : l'hôte doit trancher. */
  | { kind: 'ask' }
  /** Table pleine ou partie lancée : il regarde. */
  | { kind: 'watch' }
  /** Déjà refusé une fois : on ne redemande pas à l'hôte. */
  | { kind: 'refused' }

export type Admission = {
  lobby: Lobby
  /** Identités d'appareil déjà refusées par l'hôte. */
  refused: ReadonlySet<string>
  /** Demandes en attente, par identité d'appareil. */
  pending: ReadonlySet<string>
  maxSeats: number
}

/**
 * Que faire du `hello` de cet appareil ?
 *
 * L'ordre des cas est la règle elle-même, et il n'est pas interchangeable :
 * un siège déjà attribué l'emporte sur tout le reste — y compris sur un refus
 * antérieur, puisque l'hôte a pu changer d'avis en l'invitant depuis.
 */
export function welcomeFor(state: Admission, clientId: string): Welcome {
  if (state.lobby.players.some((p) => p.clientId === clientId)) return { kind: 'reclaim' }
  if (state.refused.has(clientId)) return { kind: 'refused' }
  if (state.lobby.started || state.lobby.players.length >= state.maxSeats) return { kind: 'watch' }
  // `ask` vaut aussi pour une demande déjà en attente : le pair se represente à
  // chaque publication du salon, et c'est l'appelant qui déduplique la liste.
  return { kind: 'ask' }
}

/**
 * Cette demande a-t-elle encore un sens ?
 *
 * Entre le moment où l'hôte voit « X veut rejoindre » et celui où il appuie sur
 * « Accepter », la table a pu se remplir, la partie a pu être lancée, ou X a pu
 * repartir. Accepter dans le vide donnerait un siège fantôme, occupé par
 * personne et impossible à libérer.
 */
export function canAdmit(state: Admission, clientId: string): boolean {
  if (!state.pending.has(clientId)) return false
  if (state.lobby.started) return false
  if (state.lobby.players.length >= state.maxSeats) return false
  return !state.lobby.players.some((p) => p.clientId === clientId)
}
