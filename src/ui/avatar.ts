/**
 * Le portrait d'un joueur — la petite tête posée à côté de son nom.
 *
 * Un nom seul ne se reconnaît pas d'un coup d'œil. Dans le salon, sur les
 * cartes de la partie, au tableau d'arrivée, l'œil cherche une figure avant de
 * lire six lettres — et une table de quatre lignes de texte a tout d'un
 * formulaire et rien d'un jeu. Chacun a donc une tête, et c'est elle qu'on
 * retient : « c'est la rousse qui joue », bien avant « c'est le vert ».
 *
 * Le portrait ne remplace pas le pion : le pion porte la couleur du siège et sa
 * forme, celles qu'on retrouve sur le plateau, et c'est à lui qu'on reconnaît
 * SES chevaux. Le portrait, lui, dit QUI c'est. Les deux voisinent.
 *
 * **Ce sont les seuls dessins du jeu qui ne sortent pas d'ici.** Le reste de
 * l'iconographie est tracé à la main dans `icons.ts`, et pour de bonnes raisons
 * — mais une icône de barre d'outils tient en quatre traits d'encre, pas un
 * visage. Ils viennent donc de **DiceBear**, style *Big Smile* d'Ashley Seo :
 * un vrai dessin de portraitiste, et surtout une combinatoire — coupe, teint,
 * bouche, accessoires — qui donne un visage différent à chaque nom plutôt
 * qu'une galerie de douze figures qu'on aurait vite fait le tour.
 *
 * Empaqueté avec le jeu, pas appelé chez DiceBear : le jeu part hors ligne avec
 * son service worker, et un visage qui manque au fond d'un train ne serait pas
 * un visage. Voir `THIRD-PARTY.md` pour la notice.
 */

import { bigSmile } from '@dicebear/collection'
import { createAvatar } from '@dicebear/core'

/**
 * Les portraits déjà dessinés, par nom.
 *
 * `createAvatar` compose une trentaine de tracés à chaque appel, et l'écran de
 * jeu se redessine à chaque lancer de dé, pour quatre joueurs qui ne changent
 * pas de tête. Le cache est volontairement sans limite : il ne connaît que les
 * noms croisés dans la session — au plus quatre joueurs, plus les curieux qui
 * frappent à la porte du salon.
 */
const DRAWN = new Map<string, string>()

/**
 * Le portrait d'un nom, en `data:` — l'image entière, sans requête.
 *
 * Tiré du nom et de rien d'autre : pas d'un `Math.random()` au moment de
 * s'asseoir, ni d'un champ de plus dans le salon. Deux raisons, et la seconde
 * est la vraie : un tirage vivrait dans l'état du salon, il faudrait le
 * transmettre, le fusionner à chaque changement d'hôte, et un ami resté sur la
 * version d'avant verrait quatre cases vides. Un nom, lui, est déjà là et
 * arrive partout en même temps ; chacun dessine le même visage dans son coin,
 * sans qu'on ait à en dire un mot sur le réseau.
 *
 * Le hasard n'y perd rien — personne ne devine ce que donne « Léa » — et on y
 * gagne une identité stable : d'une partie à l'autre, Léa a la même tête. Qui
 * n'aime pas la sienne se renomme, et en tire une autre.
 */
export function avatarUri(name: string): string {
  const seed = name.trim().toLowerCase()
  const drawn = DRAWN.get(seed)
  if (drawn !== undefined) return drawn
  const uri = createAvatar(bigSmile, { seed }).toDataUri()
  DRAWN.set(seed, uri)
  return uri
}

/**
 * Un portrait, prêt à poser à côté d'un nom.
 *
 * `alt` vide et `aria-hidden` : il double un nom qui est toujours écrit juste à
 * côté, et un lecteur d'écran n'a rien à dire d'un visage tiré au sort. Non
 * déplaçable, aussi : sur un plateau où l'on fait glisser des chevaux, une
 * image qu'on peut arracher de sa carte n'a rien à faire.
 */
export function avatar(name: string, size = 30): HTMLImageElement {
  const img = new Image(size, size)
  img.src = avatarUri(name)
  img.alt = ''
  img.className = 'avatar'
  img.draggable = false
  img.setAttribute('aria-hidden', 'true')
  return img
}
