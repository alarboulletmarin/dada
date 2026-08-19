/**
 * Modèle de données du jeu.
 *
 * Position d'un pion : un seul entier `steps`, compté depuis SA propre case de départ.
 *   -1                              → à l'écurie
 *   0..trackLength-1                → sur le circuit commun
 *   trackLength..lastStep           → dans l'escalier privé
 *   lastStep                        → arrivé
 * `trackLength` et `lastStep` dépendent de la géométrie de la variante en
 * cours (voir `geometryFor` dans `board.ts`), pas de constantes fixes.
 * Cette représentation relative rend le moteur trivial : avancer = `steps + dé`.
 * La conversion vers une case absolue du plateau se fait dans `board.ts`.
 */

import type { BoardShape } from './board.ts'
import type { PowerId } from './powers.ts'

export const STABLE = -1
export const DICE_BOOSTS_PER_GAME = 3

/** Siège autour du plateau. 0 = haut-gauche, puis sens horaire. */
export type Seat = 0 | 1 | 2 | 3

export type Pawn = {
  id: string
  owner: Seat
  /** Voir l'en-tête du fichier. */
  steps: number
  /**
   * Ce cheval porte un bouclier : la prochaine capture le manque et le
   * bouclier se brise. Ramassé sur une case pouvoir, il ne survit pas à un
   * retour à l'écurie.
   */
  shield?: boolean
}

export type Player = {
  seat: Seat
  name: string
  /** 'local' : joué sur cet appareil. 'remote' : joué par un pair. 'bot' : joué par l'IA. */
  kind: 'local' | 'remote' | 'bot'
  /** Identifiant du pair Trystero qui contrôle ce siège (null si local ou bot). */
  peerId: string | null
  connected: boolean
}

export type Variant = {
  /** Sert aussi de clé de traduction : le nom affiché n'est pas dans l'état. */
  id: string
  /**
   * Longueur du circuit — 56 sur le plateau français des petits chevaux, 52
   * sur le plateau international du Ludo, 40 sur le plateau réduit. Doit être
   * un multiple de 4 : les quatre départs sont équidistants.
   *
   * Toute la géométrie en découle (voir `geometryFor` dans `board.ts`) : bras,
   * escaliers, cases étoile, cases pouvoir.
   */
  trackLength: number
  /** Nombre de pions par joueur. */
  pawnsPerPlayer: number
  /**
   * Le décor du plateau. Réglé dans le salon, jamais dans les règles : les
   * quatre formes partagent le même circuit et les mêmes distances, seul le
   * dessin change. Absent = la croix officielle.
   */
  shape?: BoardShape
  /**
   * Les cases pouvoir sont-elles posées sur le circuit ? Réglé dans le salon.
   * Voir `powers.ts` pour ce qu'on y gagne — et ce qu'on y perd.
   */
  powers?: boolean
  /** Valeurs du dé permettant de sortir un pion de l'écurie. */
  exitRolls: number[]
  /**
   * Tours passés à l'écurie sans pouvoir en sortir après lesquels la sortie est
   * certaine. 0 laisse le dé entièrement franc.
   *
   * Attendre un 6 est une loi de probabilité, pas une épreuve d'adresse : une
   * fois sur quinze, la règle stricte laisse un joueur à l'écurie plus de
   * quinze lancers pendant que la table fait le tour du plateau. Le dé reste
   * franc au premier essai ; il ne penche qu'à mesure que l'attente dure, d'un
   * cran par tour bloqué, jusqu'à la certitude. Voir `mercyOf` dans
   * `engine.ts`.
   */
  mercyExit: number
  /** Relancer le dé après un 6. */
  extraTurnOnSix: boolean
  /** Nombre de 6 consécutifs après lequel le tour est annulé (0 = illimité). */
  maxConsecutiveSixes: number
  /** Rejouer après avoir mangé un pion adverse. */
  extraTurnOnCapture: boolean
  /** Rejouer après avoir amené un pion à l'arrivée. */
  extraTurnOnFinish: boolean
  /** Les 8 cases étoilées du circuit protègent de la capture. */
  starSquaresAreSafe: boolean
  /** Les 4 cases de départ protègent de la capture. */
  startSquaresAreSafe: boolean
  /**
   * Deux pions d'un même joueur sur une case forment un barrage : aucun pion
   * **adverse** ne peut s'y arrêter ni le franchir. Le barrage n'arrête jamais
   * son propriétaire — c'est un mur qu'on dresse contre les autres, pas une
   * case qu'on se condamne à soi-même.
   */
  blockades: boolean
  /**
   * Une case, un cheval.
   *
   * La règle française : « deux chevaux ne peuvent pas occuper la même case ;
   * s'il s'agit de vos propres chevaux, l'un reste derrière l'autre ». Un coup
   * qui amènerait un cheval sur une case déjà tenue par un cheval qu'il ne peut
   * pas manger — le sien, ou un adversaire protégé — n'est donc pas jouable.
   *
   * L'arrivée fait exception, évidemment : c'est là que les quatre se rejoignent.
   *
   * Le Ludo ne connaît pas cette règle, et ne peut pas la connaître : empiler
   * deux pions d'une même couleur est exactement ce qui y forme un barrage.
   */
  onePerSquare: boolean
  /** L'entrée à l'arrivée exige le compte exact (sinon le coup est illégal). */
  exactFinish: boolean
  /**
   * Les marches de l'escalier portent-elles leur numéro ?
   *
   * Oui sur le plateau français, où les six marches sont imprimées 1 à 6 et où
   * la règle stricte demande le chiffre exact de la marche visée. Non sur le
   * plateau international du Ludo, dont le couloir est une simple bande de
   * couleur : y écrire des numéros serait inventer un plateau qui n'existe pas.
   *
   * C'est bien du dessin, et pas de la règle : le moteur ne lit jamais ce champ.
   */
  numberedHome: boolean
}

export type Phase = 'rolling' | 'moving' | 'finished'

/**
 * Ce qu'un siège a fait de sa partie.
 *
 * Rien ici ne sert au moteur : ces compteurs n'entrent dans aucune décision de
 * règle. Ils existent pour l'écran de fin — « tu as fait 4,1 de moyenne et tu
 * as perdu quand même » est la phrase qui fait relancer une manche, et on ne
 * peut pas la reconstituer après coup à partir de l'état final.
 */
export type SeatStats = {
  /** Lancers de dé. */
  rolls: number
  /** Somme des faces — la moyenne se calcule à l'affichage. */
  pips: number
  sixes: number
  /** Chevaux adverses renvoyés à l'écurie. */
  captures: number
  /** Ses propres chevaux renvoyés à l'écurie. */
  losses: number
  /** Cases parcourues vers l'avant, écurie et escalier compris. */
  distance: number
  /** Cartes pouvoir ramassées. */
  powers: number
}

/**
 * Un événement du journal, sous forme structurée et non de phrase.
 *
 * L'état de la partie circule d'un appareil à l'autre : s'il contenait du texte
 * traduit, deux amis ne pourraient pas jouer chacun dans sa langue. Le moteur
 * décrit donc ce qui s'est passé, et chaque écran le formule à sa façon.
 */
export type LogEvent =
  | { kind: 'start'; variant: string }
  | { kind: 'roll'; dice: number }
  | { kind: 'voided'; sixes: number }
  | { kind: 'exit'; pawn: number }
  | { kind: 'finish'; pawn: number }
  | { kind: 'advance'; pawn: number; dice: number }
  | { kind: 'capture'; pawn: number; victim: string }
  | { kind: 'pass' }
  | { kind: 'timeout' }
  | { kind: 'win' }
  | { kind: 'rank'; place: number }
  /** Un cheval a ramassé une case pouvoir. */
  | { kind: 'power'; power: PowerId; pawn: number }
  /** Une capture s'est brisée sur un bouclier. */
  | { kind: 'shielded'; pawn: number; owner: string }
  /** Un tour sauté par un malus déjà ramassé. */
  | { kind: 'skipped' }
  /** Une carte gardée vient d'être jouée. `pawn` vaut 0 si elle ne vise personne. */
  | { kind: 'played'; power: PowerId; pawn: number }
  /** Une carte bonus perdue faute de place en main. */
  | { kind: 'handFull'; power: PowerId }

export type LogEntry = {
  seq: number
  seat: Seat
  /** Nom du joueur concerné, vide pour un message système. */
  actor: string
  event: LogEvent
}

/** Refus opposé par le moteur, à traduire au moment de l'afficher. */
export type GameError =
  | 'finished'
  | 'notYourTurn'
  | 'alreadyRolled'
  | 'rollFirst'
  | 'illegal'
  | 'nothingToPass'
  | 'moveExists'
  /** Cette carte n'est pas dans votre main. */
  | 'noSuchPower'
  /** Cette carte ne peut pas être jouée maintenant. */
  | 'powerNotNow'

export type GameState = {
  variant: Variant
  players: Player[]
  pawns: Pawn[]
  /** Siège dont c'est le tour. */
  turn: Seat
  /** Résultat du dé en attente d'être joué, sinon null. */
  dice: number | null
  /** 6 consécutifs dans le tour courant. */
  consecutiveSixes: number
  /** Tour annulé (trop de 6 d'affilée) : le joueur doit passer sans jouer. */
  voided: boolean
  phase: Phase
  /** Ordre d'arrivée des joueurs (le premier a gagné). */
  ranking: Seat[]
  /** État du générateur pseudo-aléatoire — rend chaque partie rejouable et vérifiable. */
  rng: number
  /** Bonus de dé restants pour la partie entière — budget partagé, pas par joueur. */
  diceBoosts: number
  /**
   * Tours consécutifs terminés à l'écurie sans en sortir, par siège (l'indice
   * est le siège). C'est ce compteur qui fait pencher le dé vers la sortie ;
   * il retombe à zéro dès qu'un cheval est dehors.
   */
  stuck: number[]
  /**
   * La pioche des pouvoirs : un paquet mélangé et partagé par toute la table,
   * consommé par le haut. Un paquet, et non un tirage indépendant à chaque
   * case : c'est ce qui garantit qu'au bout de seize cases pouvoir, tout le
   * monde a vu exactement la même distribution de bonus et de malus. Vide ou
   * absent tant que la table n'a pas activé les pouvoirs.
   */
  deck?: PowerId[]
  /** Tours à sauter, par siège — un malus « tour sauté » déjà ramassé. */
  skips?: number[]
  /**
   * Les cartes que chaque siège garde devant lui, dans l'ordre du ramassage.
   * L'indice est le siège. Trois au plus (voir `HAND_LIMIT`).
   */
  hands?: PowerId[][]
  /** Ce que chaque siège a fait de sa partie. L'indice est le siège. */
  stats?: SeatStats[]
  log: LogEntry[]
  /** Compteur monotone : sert à départager deux états lors d'un changement d'hôte. */
  seq: number
}

export type Action =
  /**
   * Lancer le dé — et, le cas échéant, jouer d'abord la carte armée.
   *
   * **Le lancer est le validateur d'une carte.** Choisir une carte ne la joue
   * pas : elle reste armée devant soi, avec son cheval désigné s'il en faut un,
   * et c'est le dé qui la déclenche. Les deux voyagent donc ensemble dans une
   * seule action : deux intentions envoyées à la suite pourraient s'appliquer
   * dans l'ordre inverse chez l'hôte, et la carte jouerait après le dé qu'elle
   * devait piper.
   */
  | { type: 'roll'; boost?: 'low' | 'high'; power?: PowerId; pawnId?: string }
  | { type: 'move'; pawnId: string }
  /** Aucun coup possible : passe la main. */
  | { type: 'pass' }
  /**
   * Jouer une carte gardée en main, sans lancer le dé. `pawnId` désigne le
   * cheval visé pour les cartes qui en demandent un. Jouer une carte ne consomme
   * pas le tour.
   *
   * L'écran passe par `roll` : c'est le lancer qui valide une carte armée. Cette
   * action-ci reste la primitive — celle dont se sert le bot, et celle qui joue
   * une carte quand le dé est déjà sur la table.
   */
  | { type: 'power'; power: PowerId; pawnId?: string }

/** Un coup légal, précalculé pour l'affichage et pour l'IA. */
export type Move = {
  pawnId: string
  from: number
  to: number
  /** Pions adverses renvoyés à l'écurie par ce coup. */
  captures: string[]
  /**
   * Pions adverses présents sur la case d'arrivée mais protégés par un
   * bouclier : le coup reste légal, ils survivent, et leur bouclier se brise.
   */
  shielded: string[]
  /** Le pion atteint l'arrivée. */
  finishes: boolean
  /** Le pion sort de l'écurie. */
  exits: boolean
}
