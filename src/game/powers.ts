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

/**
 * Ce qu'il faut désigner pour jouer la carte.
 *
 * - `aucune` : elle s'applique toute seule (relancer le dé, garnir le budget).
 * - `cheval` : elle demande un cheval, qu'on choisit sur le plateau.
 */
export type PowerTarget = 'aucune' | 'cheval'

export type Power = {
  id: PowerId
  kind: PowerKind
  /** Combien d'exemplaires dans un paquet. */
  copies: number
  /** Nombre de cases pour les pouvoirs qui déplacent ; 0 sinon. */
  steps: number
  /**
   * La carte se garde-t-elle en main ?
   *
   * **Les bonus se gardent, les malus se subissent.** C'est la règle entière,
   * et elle se retient. Un bonus dont on choisit l'instant vaut bien plus qu'un
   * bonus qui part tout seul : le bouclier posé juste avant que l'adversaire
   * n'arrive à portée, c'est un coup joué, pas un lot de tombola. Un malus,
   * lui, ne se garde pas — sinon personne ne le jouerait jamais.
   */
  held: boolean
  /** Ce que la carte demande de désigner. Sans objet pour un malus. */
  target: PowerTarget
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
  bouclier: { id: 'bouclier', kind: 'bonus', copies: 3, steps: 0, held: true, target: 'cheval' },
  galop: { id: 'galop', kind: 'bonus', copies: 3, steps: 3, held: true, target: 'cheval' },
  rejeu: { id: 'rejeu', kind: 'bonus', copies: 2, steps: 0, held: true, target: 'aucune' },
  // Le dé pipé se garde comme les autres bonus. Il rejoignait autrefois la
  // réserve de la table à la seconde où on le ramassait — un bonus qui se joue
  // tout seul, c'est-à-dire un bonus dont on ne décide rien. Gardé en main, il
  // se dépense au moment choisi : on l'arme, on demande son petit ou son grand
  // nombre, et le même geste range la carte et penche le dé.
  des: { id: 'des', kind: 'bonus', copies: 2, steps: 0, held: true, target: 'aucune' },
  fauxpas: { id: 'fauxpas', kind: 'malus', copies: 3, steps: 3, held: false, target: 'aucune' },
  saute: { id: 'saute', kind: 'malus', copies: 2, steps: 0, held: false, target: 'aucune' },
  ecurie: { id: 'ecurie', kind: 'malus', copies: 1, steps: 0, held: false, target: 'aucune' },
}

/**
 * Cartes qu'on peut garder devant soi.
 *
 * Trois, et pas davantage. Sans plafond, la main devient un magasin : on
 * ramasse sans jamais dépenser, et la fin de partie se joue en vidant un stock
 * que personne n'a vu venir. Avec trois, ramasser une quatrième carte oblige à
 * en jouer une — c'est là qu'est la décision.
 */
export const HAND_LIMIT = 3

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
