/**
 * Les pouvoirs : ce qu'on ramasse sur une case marquée du circuit.
 *
 * ## Pourquoi un paquet et pas un dé
 *
 * Tirer chaque pouvoir au hasard, indépendamment, serait injuste à l'échelle
 * d'une partie : sur douze cases ramassées, il n'est pas rare qu'un joueur
 * n'ait vu que des malus et un autre que des bonus. Les pouvoirs sont donc un
 * **paquet de cartes** — composition fixe, mélangé au début, consommé par le
 * haut, remélangé quand il est vide. Au bout d'un paquet, la table a vu
 * exactement `DECK` et rien d'autre. Le hasard décide de l'ordre, pas des
 * proportions.
 *
 * ## Pourquoi les cases sont symétriques
 *
 * Les cases pouvoir sont posées à un décalage fixe du départ de **chaque**
 * siège (voir `powerOffsets` dans `board.ts`). Le motif se répète donc à
 * l'identique tous les quarts de tour : chaque joueur croise le même nombre de
 * cases, aux mêmes distances de chez lui. Personne n'a « le bon coin du
 * plateau ». L'équité est dans la géométrie ; elle n'a pas à être corrigée
 * ensuite.
 *
 * ## Pourquoi ça ne s'enchaîne pas
 *
 * Un pouvoir qui déplace un cheval (`galop`, `faux-pas`) ne redéclenche pas la
 * case sur laquelle il l'amène. Sans cette règle, deux cases voisines
 * pourraient se renvoyer la balle indéfiniment, et l'on ne saurait plus lire
 * ce qui vient de se passer.
 */

export const POWER_IDS = [
  'bouclier',
  'galop',
  'rejeu',
  'des',
  'fauxpas',
  'saute',
  'ecurie',
] as const

export type PowerId = (typeof POWER_IDS)[number]

export type PowerKind = 'bonus' | 'malus'

export type Power = {
  id: PowerId
  kind: PowerKind
  /** Combien d'exemplaires dans un paquet. */
  copies: number
  /** Nombre de cases pour les pouvoirs qui déplacent ; 0 sinon. */
  steps: number
}

/**
 * Le paquet. Dix bonus pour six malus : ramasser une case doit rester une
 * bonne nouvelle, sinon on l'évite, et une case qu'on évite ne change rien au
 * jeu — elle ne fait que rétrécir le plateau.
 *
 * Le malus le plus dur (retour à l'écurie) n'existe qu'en un exemplaire : il
 * doit rester l'histoire qu'on raconte après la partie, pas celle qui la
 * décide.
 */
export const POWERS: Record<PowerId, Power> = {
  bouclier: { id: 'bouclier', kind: 'bonus', copies: 3, steps: 0 },
  galop: { id: 'galop', kind: 'bonus', copies: 3, steps: 3 },
  rejeu: { id: 'rejeu', kind: 'bonus', copies: 2, steps: 0 },
  des: { id: 'des', kind: 'bonus', copies: 2, steps: 0 },
  fauxpas: { id: 'fauxpas', kind: 'malus', copies: 3, steps: 3 },
  saute: { id: 'saute', kind: 'malus', copies: 2, steps: 0 },
  ecurie: { id: 'ecurie', kind: 'malus', copies: 1, steps: 0 },
}

/** L'ordre d'affichage dans le salon : les bonus d'abord, puis les malus. */
export const POWER_LIST: Power[] = POWER_IDS.map((id) => POWERS[id])

/** Un paquet neuf, non mélangé. */
export const freshDeck = (): PowerId[] =>
  POWER_LIST.flatMap((p) => Array.from({ length: p.copies }, () => p.id))

export const DECK_SIZE = freshDeck().length

export const bonusCount = POWER_LIST.filter((p) => p.kind === 'bonus').reduce(
  (n, p) => n + p.copies,
  0,
)
