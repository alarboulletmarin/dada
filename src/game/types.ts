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

export const STABLE = -1
export const DICE_BOOSTS_PER_GAME = 3

/** Siège autour du plateau. 0 = haut-gauche, puis sens horaire. */
export type Seat = 0 | 1 | 2 | 3

export type Pawn = {
  id: string
  owner: Seat
  /** Voir l'en-tête du fichier. */
  steps: number
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
   * Taille `S` du carré d'écurie de chaque siège : paramètre unique dont
   * dérive toute la géométrie du plateau (grille, circuit, escaliers,
   * emplacements d'écurie). Voir `geometryFor` dans `board.ts`.
   */
  boardSize: number
  /** Nombre de pions par joueur. */
  pawnsPerPlayer: number
  /** Valeurs du dé permettant de sortir un pion de l'écurie. */
  exitRolls: number[]
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
  /** Deux pions d'un même joueur sur une case bloquent le passage des autres. */
  blockades: boolean
  /** L'entrée à l'arrivée exige le compte exact (sinon le coup est illégal). */
  exactFinish: boolean
}

export type Phase = 'rolling' | 'moving' | 'finished'

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
  | { kind: 'win' }
  | { kind: 'rank'; place: number }

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
  log: LogEntry[]
  /** Compteur monotone : sert à départager deux états lors d'un changement d'hôte. */
  seq: number
}

export type Action =
  | { type: 'roll'; boost?: 'low' | 'high' }
  | { type: 'move'; pawnId: string }
  /** Aucun coup possible : passe la main. */
  | { type: 'pass' }

/** Un coup légal, précalculé pour l'affichage et pour l'IA. */
export type Move = {
  pawnId: string
  from: number
  to: number
  /** Pions adverses renvoyés à l'écurie par ce coup. */
  captures: string[]
  /** Le pion atteint l'arrivée. */
  finishes: boolean
  /** Le pion sort de l'écurie. */
  exits: boolean
}
