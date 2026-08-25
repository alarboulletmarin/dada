/**
 * Moteur de jeu : `(état, action) → état`.
 *
 * Aucune dépendance au DOM, au réseau ou à l'horloge. Le même code sert au
 * mode « on se passe le téléphone », à l'hôte d'une partie en ligne et aux
 * tests. Toute la logique de règles vit ici et nulle part ailleurs.
 */

import { geometryFor, hasFinished, isOnTrack, trackIndexOf } from './board.ts'
import { freshDeck, HAND_LIMIT, POWERS, type PowerId } from './powers.ts'
import { rollDie, shuffle } from './rng.ts'
import {
  DICE_BOOSTS_PER_PLAYER,
  STABLE,
  type Action,
  type GameError,
  type GameState,
  type LogEvent,
  type Move,
  type Pawn,
  type Player,
  type Seat,
  type SeatStats,
  type Team,
  type Variant,
} from './types.ts'

const LOG_LIMIT = 60

export const pawnId = (seat: Seat, index: number): string => `p${seat}-${index}`
export const pawnSlot = (id: string): number => Number(id.split('-')[1] ?? 0)

const emptyStats = (): SeatStats => ({
  rolls: 0,
  pips: 0,
  sixes: 0,
  captures: 0,
  losses: 0,
  distance: 0,
  powers: 0,
})

/**
 * Compteurs d'un siège, dans un état qui n'en aurait pas.
 *
 * Le `?? ` n'est pas de la timidité : un pair resté sur une version d'avant les
 * statistiques envoie un état qui n'en porte pas, et la partie doit continuer
 * plutôt que de tomber sur un `undefined`.
 */
export const statsOf = (state: GameState, seat: Seat): SeatStats =>
  state.stats?.[seat] ?? emptyStats()

/** Applique un delta aux compteurs d'un siège. Sans effet de bord. */
function countUp(state: GameState, seat: Seat, delta: Partial<SeatStats>): GameState {
  const stats = [0, 1, 2, 3].map((s) => statsOf(state, s as Seat))
  const current = stats[seat]!
  stats[seat] = { ...current }
  for (const [key, value] of Object.entries(delta) as [keyof SeatStats, number][]) {
    stats[seat]![key] = current[key] + value
  }
  return { ...state, stats }
}

/** Les cartes gardées par un siège. */
export const handOf = (state: GameState, seat: Seat): PowerId[] => state.hands?.[seat] ?? []

function setHand(state: GameState, seat: Seat, cards: PowerId[]): GameState {
  const hands = [0, 1, 2, 3].map((s) => (s === seat ? cards : handOf(state, s as Seat)))
  return { ...state, hands }
}

export function createGame(opts: {
  players: Player[]
  variant: Variant
  seed: number
}): GameState {
  const players = [...opts.players].sort((a, b) => a.seat - b.seat)

  // Une équipe de un contre une équipe de deux ne serait pas une variante mais
  // un handicap. Le salon l'interdit déjà ; le moteur le redit, parce qu'un état
  // peut aussi arriver par le réseau, et qu'une partie bancale vaut moins
  // qu'une partie refusée.
  if (opts.variant.teams && new Set(players.map((p) => p.seat)).size !== 4) {
    throw new Error('La variante équipes demande exactement quatre joueurs.')
  }

  const pawns: Pawn[] = players.flatMap((p) =>
    Array.from({ length: opts.variant.pawnsPerPlayer }, (_, i) => ({
      id: pawnId(p.seat, i),
      owner: p.seat,
      steps: STABLE,
    })),
  )

  // Le paquet de pouvoirs est mélangé une fois, ici, avec la graine de la
  // partie : tous les appareils obtiennent le même — un pouvoir qui divergerait
  // d'un téléphone à l'autre ferait diverger la partie entière.
  const [rng, deck] = opts.variant.powers ? shuffle(opts.seed, freshDeck()) : [opts.seed, undefined]

  return {
    variant: opts.variant,
    players,
    pawns,
    turn: players[0]!.seat,
    dice: null,
    consecutiveSixes: 0,
    voided: false,
    phase: 'rolling',
    ranking: [],
    // Hors variante équipes, le champ n'existe pas : rien à faire voyager.
    finishers: opts.variant.teams ? [] : undefined,
    rng,
    diceBoosts: [
      DICE_BOOSTS_PER_PLAYER,
      DICE_BOOSTS_PER_PLAYER,
      DICE_BOOSTS_PER_PLAYER,
      DICE_BOOSTS_PER_PLAYER,
    ],
    stuck: [0, 0, 0, 0],
    deck,
    skips: [0, 0, 0, 0],
    hands: [[], [], [], []],
    stats: [emptyStats(), emptyStats(), emptyStats(), emptyStats()],
    log: [
      { seq: 0, seat: players[0]!.seat, actor: '', event: { kind: 'start', variant: opts.variant.id } },
    ],
    logSeq: 1,
    seq: 0,
  }
}

// ─────────────────────────────── lectures ───────────────────────────────

export const playerAt = (state: GameState, seat: Seat): Player | undefined =>
  state.players.find((p) => p.seat === seat)

export const pawnsOf = (state: GameState, seat: Seat): Pawn[] =>
  state.pawns.filter((p) => p.owner === seat)

export const hasWon = (state: GameState, seat: Seat): boolean => {
  const geometry = geometryFor(state.variant)
  return pawnsOf(state, seat).every((p) => hasFinished(geometry, p.steps))
}

// ─────────────────────────────── équipes ───────────────────────────────

/**
 * Le camp d'un siège. Les sièges pairs ensemble, les impairs ensemble —
 * c'est-à-dire les sièges opposés autour du plateau.
 *
 * La fonction répond pour n'importe quelle variante : c'est de l'arithmétique
 * sur un numéro de siège, pas une règle. C'est `areAllies` qui décide si ce
 * camp compte, et il ne compte qu'en variante équipes.
 */
export const teamOf = (seat: Seat): Team => (seat % 2) as Team

export const otherTeam = (team: Team): Team => (team === 0 ? 1 : 0)

/** Le siège d'en face. */
export const partnerOf = (seat: Seat): Seat => ((seat + 2) % 4) as Seat

export const sameTeam = (a: Seat, b: Seat): boolean => teamOf(a) === teamOf(b)

/** Les sièges d'un camp, dans l'ordre du plateau. */
export const seatsOfTeam = (state: GameState, team: Team): Seat[] =>
  state.players.map((p) => p.seat).filter((seat) => teamOf(seat) === team)

/**
 * Ces deux sièges jouent-ils dans le même camp ?
 *
 * Un siège est toujours son propre allié : les deux seules questions que le
 * moteur pose — « puis-je manger ce cheval ? », « me barre-t-il la route ? » —
 * ont la même réponse pour un cheval à soi et pour un cheval du partenaire.
 * Hors variante équipes, on n'est allié que de soi-même.
 */
export const areAllies = (state: GameState, a: Seat, b: Seat): boolean =>
  a === b || (state.variant.teams === true && sameTeam(a, b))

/** Les huit chevaux d'un camp sont-ils rentrés ? */
export const teamHasWon = (state: GameState, team: Team): boolean => {
  const seats = seatsOfTeam(state, team)
  return seats.length > 0 && seats.every((seat) => hasWon(state, seat))
}

/**
 * Le siège **dont on joue les chevaux** — qui n'est pas toujours celui dont
 * c'est le tour.
 *
 * En équipes, un joueur qui a rentré ses quatre chevaux ne s'assied pas pour
 * regarder : il continue de lancer le dé, et déplace les chevaux de son
 * partenaire. Sa main de cartes, elle, reste la sienne (voir `applyHeldPower`).
 *
 * Toute la variante tient dans cette fonction et dans `areAllies` : partout où
 * le moteur lisait `state.turn` pour désigner des chevaux, il lit ceci.
 * L'écran s'en sert pour la même raison — savoir quels chevaux rendre saisissables.
 */
export function activeSeatFor(state: GameState): Seat {
  // Partie finie : plus personne ne joue les chevaux de personne. Sans ce
  // garde-fou, l'écran de fin désignerait le partenaire du dernier joueur.
  if (state.phase === 'finished') return state.turn
  if (state.variant.teams !== true || !hasWon(state, state.turn)) return state.turn
  return partnerOf(state.turn)
}

/**
 * Ce siège n'a-t-il plus rien à jouer ?
 *
 * En solo, rentrer ses quatre chevaux clôt la partie du joueur. En équipes, on
 * ne s'arrête qu'avec son partenaire — d'où deux façons de répondre à la même
 * question, et une seule fonction pour ne pas les mélanger.
 */
const isOut = (state: GameState, seat: Seat): boolean =>
  state.variant.teams === true ? teamHasWon(state, teamOf(seat)) : hasWon(state, seat)

/**
 * Ce joueur est-il bloqué à l'écurie — c'est-à-dire : seule une face de sortie
 * peut lui donner quelque chose à jouer ?
 */
export function isPenned(state: GameState, seat: Seat): boolean {
  const geometry = geometryFor(state.variant)
  const running = pawnsOf(state, seat).filter((p) => !hasFinished(geometry, p.steps))
  return running.length > 0 && running.every((p) => p.steps === STABLE)
}

/**
 * De 0 à 1 : à quel point le dé penche vers la sortie pour ce siège.
 *
 * Zéro tant que le joueur a un cheval dehors, ou si la variante ne connaît pas
 * la pitié. Sinon un cran par tour passé à l'écurie, jusqu'à 1 — la sortie
 * certaine. Le premier essai, lui, se joue toujours au dé franc : la pitié
 * répare une attente, elle ne l'anticipe pas.
 */
export function mercyOf(state: GameState, seat: Seat): number {
  const { mercyExit } = state.variant
  if (mercyExit <= 0 || !isPenned(state, seat)) return 0
  return Math.min(1, (state.stuck?.[seat] ?? 0) / mercyExit)
}

/**
 * Bonus de dé restants à ce siège.
 *
 * Défensif sur deux fronts. Le champ peut manquer — un état d'une version
 * d'avant le compteur. Et il peut arriver du réseau sous sa forme d'avant, un
 * seul nombre pour la table : c'est un hôte resté sur l'ancienne version qui
 * l'envoie, et c'est lui qui arbitrera les lancers, alors on lit sa réserve
 * commune telle qu'elle est plutôt que d'afficher zéro à tout le monde.
 */
export function boostsOf(state: GameState, seat: Seat): number {
  const boosts = state.diceBoosts as number[] | number | undefined
  if (typeof boosts === 'number') return boosts
  return boosts?.[seat] ?? 0
}

/** La réserve après un bonus dépensé par ce siège. */
function spendBoost(state: GameState, seat: Seat): number[] {
  const boosts = [...(Array.isArray(state.diceBoosts) ? state.diceBoosts : [0, 0, 0, 0])]
  boosts[seat] = Math.max(0, (boosts[seat] ?? 0) - 1)
  return boosts
}

/** La réserve après un bonus rendu à ce siège — le dé pipé. */
function creditBoost(state: GameState, seat: Seat): number[] {
  const boosts = [...(Array.isArray(state.diceBoosts) ? state.diceBoosts : [0, 0, 0, 0])]
  boosts[seat] = (boosts[seat] ?? 0) + 1
  return boosts
}

/** Une case du circuit est-elle protégée de la capture ? */
export function isSafeIndex(variant: Variant, index: number): boolean {
  const g = geometryFor(variant)
  if (variant.startSquaresAreSafe && g.startIndexSet.has(index)) return true
  if (variant.starSquaresAreSafe && g.starIndexSet.has(index)) return true
  return false
}

/** Pions présents sur une case absolue du circuit. */
function pawnsOnTrackIndex(state: GameState, index: number, exceptId?: string): Pawn[] {
  const geometry = geometryFor(state.variant)
  return state.pawns.filter(
    (p) =>
      p.id !== exceptId &&
      isOnTrack(geometry, p.steps) &&
      trackIndexOf(geometry, p.owner, p.steps) === index,
  )
}

/**
 * Les chevaux déjà posés sur la case où ce coup mènerait — les siens comme
 * ceux des autres. Le circuit est commun et se compte en cases absolues ;
 * l'escalier est privé, et seuls les chevaux du même siège peuvent s'y trouver.
 */
function occupantsAt(state: GameState, pawn: Pawn, to: number): Pawn[] {
  const geometry = geometryFor(state.variant)
  if (isOnTrack(geometry, to)) {
    return pawnsOnTrackIndex(state, trackIndexOf(geometry, pawn.owner, to)!, pawn.id)
  }
  return state.pawns.filter((p) => p.id !== pawn.id && p.owner === pawn.owner && p.steps === to)
}

/** Ce qu'un cheval trouve sur la case où on veut le poser. */
type Landing = {
  /** Chevaux adverses renvoyés à l'écurie par cette arrivée. */
  captures: string[]
  /** Chevaux adverses qui encaissent au bouclier : ils restent, il se brise. */
  shielded: string[]
  /** La case reste tenue par un cheval qu'on ne peut pas déloger : arrivée interdite. */
  blocked: boolean
}

/**
 * L'arrivée sur une case, avant qu'elle n'ait lieu.
 *
 * Une seule fonction pour le coup de dé et pour le galop : ce sont deux façons
 * d'amener un cheval quelque part, et une case ne peut pas dire oui à l'un et
 * non à l'autre. Le galop s'en est passé un temps — il posait son cheval sans
 * regarder, ce qui donnait deux chevaux sur une case en règle française et un
 * adversaire rattrapé qui survivait à la charge.
 *
 * Capture : uniquement sur le circuit, et jamais sur une case protégée. Un
 * cheval au bouclier reste sur la case : l'arrivée est permise, il n'est
 * simplement pas mangé, et son bouclier se brise à l'impact.
 *
 * Une case, un cheval (règle française) : si quelque chose reste sur la case
 * d'arrivée après le coup, le coup n'existe pas.
 *
 * Deux exceptions. L'arrivée, évidemment : c'est là que les quatre chevaux se
 * rejoignent. Et le bouclier — un pouvoir, pas un cheval : s'il rendait sa case
 * interdite, il cesserait d'être « une capture encaissée » pour devenir un mur,
 * et un mur que rien ne pourrait plus briser, puisque la charge qui le brise
 * n'aurait jamais lieu. Le cheval protégé encaisse donc le choc et partage sa
 * case le temps d'un tour.
 */
function landing(state: GameState, pawn: Pawn, to: number): Landing {
  const geometry = geometryFor(state.variant)
  const occupants = occupantsAt(state, pawn, to)
  const captures: string[] = []
  const shielded: string[] = []

  const huntable =
    isOnTrack(geometry, to) && !isSafeIndex(state.variant, trackIndexOf(geometry, pawn.owner, to)!)

  // Ce qui reste sur la case après le coup et qu'on ne peut pas déloger. Ni les
  // mangés ni les protégés n'en sont : les premiers repartent, le second cède
  // le passage en cassant son bouclier (voir plus haut).
  let held = 0
  for (const other of occupants) {
    // Un coéquipier n'est ni une proie ni un mur. Sa case se partage, exactement
    // comme celle d'un cheval de sa propre couleur au Ludo — c'est même toute la
    // variante équipes : le camp d'en face est le seul adversaire.
    if (other.owner !== pawn.owner && areAllies(state, other.owner, pawn.owner)) continue
    if (huntable && other.owner !== pawn.owner) {
      ;(other.shield ? shielded : captures).push(other.id)
      continue
    }
    held++
  }

  const blocked = state.variant.onePerSquare && to !== geometry.lastStep && held > 0
  return { captures, shielded, blocked }
}

/**
 * Tous les coups jouables avec le dé courant. Vide = le joueur doit passer.
 *
 * Les chevaux proposés sont ceux d'`activeSeatFor` et non ceux de `state.turn` :
 * en équipes, un joueur qui a fini joue ceux de son partenaire.
 */
export function legalMoves(state: GameState): Move[] {
  const { dice, variant } = state
  if (dice === null || state.phase !== 'moving' || state.voided) return []

  const geometry = geometryFor(variant)
  const moves: Move[] = []

  for (const pawn of pawnsOf(state, activeSeatFor(state))) {
    if (hasFinished(geometry, pawn.steps)) continue

    let to: number
    const exits = pawn.steps === STABLE

    if (exits) {
      if (!variant.exitRolls.includes(dice)) continue
      to = 0
    } else {
      to = pawn.steps + dice
      if (to > geometry.lastStep) {
        if (variant.exactFinish) continue
        to = geometry.lastStep
      }
    }

    const from = exits ? STABLE : pawn.steps

    const { captures, shielded, blocked } = landing(state, pawn, to)
    if (blocked) continue

    moves.push({
      pawnId: pawn.id,
      from,
      to,
      captures,
      shielded,
      finishes: to === geometry.lastStep,
      exits,
    })
  }

  return moves
}

// ─────────────────────────────── écritures ───────────────────────────────

export type ApplyResult = { state: GameState; error?: GameError }

/**
 * Applique une action au nom de `actor`. Le siège est vérifié ici : c'est le
 * seul rempart contre un pair qui jouerait à la place d'un autre.
 *
 * La fonction est **totale** : elle rend un état pour n'importe quelle entrée.
 * L'action vient du réseau, où le typage ne vaut plus rien — un pair d'une autre
 * version, un message abîmé, un `null`. Ce qu'on ne comprend pas est refusé, et
 * l'hôte, qui tient la partie de toute la table, continue de tourner.
 */
export function apply(state: GameState, action: Action, actor: Seat): ApplyResult {
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
    return { state, error: 'illegal' }
  }
  if (state.phase === 'finished') return { state, error: 'finished' }
  if (actor !== state.turn) return { state, error: 'notYourTurn' }

  // L'étape intermédiaire ne vaut que pour le coup qui vient d'être joué. La
  // laisser traîner ferait rejouer, au coup suivant du même cheval, un détour
  // d'il y a trois tours.
  const fresh = state.hop === undefined ? state : { ...state, hop: undefined }

  const played = ((): ApplyResult => {
    switch (action.type) {
      case 'roll':
        return applyRoll(fresh, action)
      case 'move':
        return applyMove(fresh, action.pawnId)
      case 'pass':
        return applyPass(fresh)
      case 'power':
        return applyHeldPower(fresh, action.power, action.pawnId)
      // Une action d'une version qu'on ne connaît pas : refusée comme un coup
      // illégal, plutôt que de rendre `undefined` et de faire tomber l'hôte.
      default:
        return { state, error: 'illegal' }
    }
  })()

  // Un refus ne change rien — pas même l'étape intermédiaire du coup précédent,
  // que l'écran est peut-être en train de dessiner.
  return played.error ? { state, error: played.error } : played
}

/**
 * Lancer le dé — le geste qui valide une carte armée.
 *
 * Une carte choisie n'est pas une carte jouée : elle attend devant son joueur,
 * avec son cheval désigné s'il en faut un, et c'est le lancer qui la déclenche.
 * L'ordre compte donc, et il est ici : la carte d'abord, le dé ensuite. Un
 * bouclier posé après le lancer arriverait trop tard pour la relance qu'il
 * couvre, et un dé pipé rangé après coup ne pencherait plus rien.
 *
 * Trois cartes ne rendent pas de dé, et il ne faut pas leur en donner un :
 *   - `rejeu` **est** le lancer — il a déjà relancé, en relancer un second
 *     effacerait le résultat que le joueur vient de demander ;
 *   - une carte jouée alors que le dé est déjà sur la table (un galop pour
 *     rattraper un mauvais chiffre) ne remet pas le dé en jeu ;
 *   - un galop qui rentre le dernier cheval clôt le tour, et le siège suivant
 *     n'a pas à hériter d'un lancer qu'il n'a pas demandé.
 */
function applyRoll(
  state: GameState,
  opts: { boost?: 'low' | 'high'; power?: PowerId; pawnId?: string },
): ApplyResult {
  const { boost } = opts
  let base = state

  if (opts.power !== undefined) {
    const played = applyHeldPower(state, opts.power, opts.pawnId)
    // Une carte refusée annule le geste entier : le dé ne part pas sans elle,
    // sinon le joueur perdrait son lancer à cause d'un choix invalide.
    if (played.error) return played
    base = played.state
    if (opts.power === 'rejeu') return { state: base }
    if (base.phase !== 'rolling' || base.turn !== state.turn) return { state: base }
  } else if (state.phase !== 'rolling') {
    return { state, error: 'alreadyRolled' }
  }

  // Un boost sans bonus restant (UI périmée par la latence réseau) n'est pas
  // une faute du joueur : le lancer se fait simplement sans biais. Un boost
  // qu'on ne sait pas lire — il arrive par le réseau — est ignoré de même,
  // plutôt que d'aller chercher une table de poids qui n'existe pas.
  const useBoost = (boost === 'low' || boost === 'high') && boostsOf(base, base.turn) > 0
  const [rng, dice] = rollDie(base.rng, {
    bias: useBoost ? boost : undefined,
    exitFaces: base.variant.exitRolls,
    // La pitié suit les chevaux qu'on joue, pas le siège qui secoue le dé : en
    // équipes, un joueur qui a fini lance pour une écurie qui n'est pas la sienne.
    exitChance: mercyOf(base, activeSeatFor(base)),
  })
  const consecutiveSixes = dice === 6 ? base.consecutiveSixes + 1 : 0
  const max = base.variant.maxConsecutiveSixes
  const voided = max > 0 && dice === 6 && consecutiveSixes >= max

  let next: GameState = {
    ...base,
    rng,
    dice,
    consecutiveSixes,
    voided,
    phase: 'moving',
    // Le bonus se prend dans la réserve de qui secoue le dé — `base.turn`, pas
    // `activeSeatFor` : en équipes, un joueur qui a fini lance pour l'écurie de
    // son partenaire, et ce sont bien ses trois bonus à lui qu'il dépense.
    diceBoosts: useBoost ? spendBoost(base, base.turn) : base.diceBoosts,
    seq: base.seq + 1,
  }
  next = countUp(next, base.turn, { rolls: 1, pips: dice, sixes: dice === 6 ? 1 : 0 })
  next = addLog(next, base.turn, { kind: 'roll', dice })
  if (voided) next = addLog(next, base.turn, { kind: 'voided', sixes: max })

  return { state: next }
}

/**
 * Ce que l'arrivée d'un cheval fait aux chevaux qui étaient là : ceux qui sont
 * mangés repartent de l'écurie, ceux qui portaient un bouclier le perdent, et
 * le journal comme les compteurs en gardent trace.
 *
 * Écrit une fois pour le coup de dé et pour le galop : une capture doit se
 * raconter et se compter de la même façon, quel que soit ce qui a poussé le
 * cheval.
 */
function takeLanding(
  state: GameState,
  by: Seat,
  captures: string[],
  shielded: string[],
): GameState {
  if (captures.length === 0 && shielded.length === 0) return state

  // Un cheval renvoyé à l'écurie y laisse son bouclier : il ne le rapporte pas
  // au tour suivant comme s'il ne s'était rien passé.
  let next: GameState = {
    ...state,
    pawns: state.pawns.map((p) => {
      if (captures.includes(p.id)) return { ...p, steps: STABLE, shield: false }
      if (shielded.includes(p.id)) return { ...p, shield: false }
      return p
    }),
  }

  for (const captured of captures) {
    const owner = state.pawns.find((p) => p.id === captured)!.owner
    next = addLog(next, by, {
      kind: 'capture',
      pawn: pawnSlot(captured) + 1,
      victim: playerAt(state, owner)?.name ?? '',
    })
  }

  for (const saved of shielded) {
    const owner = state.pawns.find((p) => p.id === saved)!.owner
    next = addLog(next, by, {
      kind: 'shielded',
      pawn: pawnSlot(saved) + 1,
      owner: playerAt(state, owner)?.name ?? '',
    })
  }

  next = countUp(next, by, { captures: captures.length })
  for (const captured of captures) {
    next = countUp(next, state.pawns.find((p) => p.id === captured)!.owner, { losses: 1 })
  }
  return next
}

function applyMove(state: GameState, id: string): ApplyResult {
  if (state.phase !== 'moving') return { state, error: 'rollFirst' }

  const move = legalMoves(state).find((m) => m.pawnId === id)
  if (!move) return { state, error: 'illegal' }

  const pawns = state.pawns.map((p) => (p.id === move.pawnId ? { ...p, steps: move.to } : p))
  let next: GameState = { ...state, pawns, seq: state.seq + 1 }

  const pawn = pawnSlot(move.pawnId) + 1
  if (move.exits) next = addLog(next, state.turn, { kind: 'exit', pawn })
  else if (move.finishes) next = addLog(next, state.turn, { kind: 'finish', pawn })
  else next = addLog(next, state.turn, { kind: 'advance', pawn, dice: state.dice ?? 0 })

  next = takeLanding(next, state.turn, move.captures, move.shielded)

  // Le déplacement compte pour la distance parcourue ; la sortie d'écurie ne
  // vaut aucune case (on passe de « nulle part » à la case de départ).
  next = countUp(next, state.turn, {
    distance: move.exits ? 0 : Math.max(0, move.to - move.from),
  })

  const power = resolvePower(next, move.pawnId)
  next = settleShields(power.state)

  // Le pouvoir a pu déplacer le cheval après coup : c'est sa position finale,
  // et non celle du coup joué, qui dit s'il vient de rentrer.
  const geometry = geometryFor(next.variant)
  const landed = next.pawns.find((p) => p.id === move.pawnId)!
  const settled: Move = { ...move, to: landed.steps, finishes: hasFinished(geometry, landed.steps) }

  // Le cheval est reparti de la case où le dé l'avait posé : un faux pas l'a
  // reculé, un retour à l'écurie l'a renvoyé chez lui. L'état ne garde que la
  // position finale, et l'écran, qui ne voit que des positions, dessinait « six
  // moins trois » comme un tranquille déplacement de trois cases — ou ne
  // dessinait rien et retrouvait le cheval à l'écurie. On note donc l'étape,
  // pour que le coup puisse se raconter en deux temps.
  if (landed.steps !== move.to) next = { ...next, hop: { pawnId: move.pawnId, at: move.to } }

  return { state: endTurn(next, settled, power.replay) }
}

// ─────────────────────────────── pouvoirs ───────────────────────────────

/**
 * Le cheval vient-il de s'arrêter sur une case pouvoir ? Alors il pioche.
 *
 * Un pouvoir qui déplace ne redéclenche pas la case d'arrivée : sans cette
 * règle, deux cases voisines pourraient se renvoyer la balle sans fin, et le
 * journal deviendrait illisible.
 */
function resolvePower(state: GameState, pawnId: string): { state: GameState; replay: boolean } {
  if (!state.variant.powers) return { state, replay: false }

  const geometry = geometryFor(state.variant)
  const pawn = state.pawns.find((p) => p.id === pawnId)!
  if (!isOnTrack(geometry, pawn.steps)) return { state, replay: false }
  const index = trackIndexOf(geometry, pawn.owner, pawn.steps)
  if (index === null || !geometry.powerIndexSet.has(index)) return { state, replay: false }

  const drawn = draw(state)
  let next = countUp(drawn.state, state.turn, { powers: 1 })
  next = addLog(next, state.turn, {
    kind: 'power',
    power: drawn.power,
    pawn: pawnSlot(pawnId) + 1,
  })

  // Les bonus se gardent, les malus se subissent. Une main pleine refuse la
  // carte plutôt que d'en pousser une dehors : perdre une carte qu'on avait
  // choisi de garder serait la pire des surprises.
  if (POWERS[drawn.power].held) {
    const hand = handOf(next, next.turn)
    if (hand.length >= HAND_LIMIT) {
      return { state: addLog(next, next.turn, { kind: 'handFull', power: drawn.power }), replay: false }
    }
    return { state: setHand(next, next.turn, [...hand, drawn.power]), replay: false }
  }

  return { state: applyPower(next, pawnId, drawn.power), replay: false }
}

/**
 * Joue une carte gardée en main.
 *
 * Jouer une carte ne consomme pas le tour : on peut poser un bouclier *puis*
 * lancer le dé, ou relancer un dé décevant *puis* jouer son coup. C'est tout
 * l'intérêt d'une carte qu'on garde — elle sert à choisir l'instant, pas à
 * remplacer un tour.
 */
function applyHeldPower(state: GameState, power: PowerId, target?: string): ApplyResult {
  const hand = handOf(state, state.turn)
  if (!hand.includes(power)) return { state, error: 'noSuchPower' }
  if (!canPlayPower(state, power, target)) return { state, error: 'powerNotNow' }

  // Un seul exemplaire retiré, et non tous ceux du même nom.
  const at = hand.indexOf(power)
  let next = setHand(state, state.turn, [...hand.slice(0, at), ...hand.slice(at + 1)])
  next = { ...next, seq: next.seq + 1 }
  next = addLog(next, next.turn, {
    kind: 'played',
    power,
    pawn: target ? pawnSlot(target) + 1 : 0,
  })

  if (power === 'rejeu') return { state: rerollFor(next) }

  const played = settleShields(applyPower(next, target, power))
  // Un galop peut rentrer le dernier cheval. Sans ce passage par `endTurn`, le
  // siège gagnait sans figurer au classement : la partie continuait autour d'un
  // joueur qui n'avait plus rien à jouer, et qui passait son tour jusqu'à la fin.
  if (isOut(played, played.turn)) return { state: endTurn(played, null) }
  return { state: played }
}

/**
 * Ce qu'un galop ferait à ce cheval, ou `null` s'il ne peut rien lui faire.
 *
 * Une seule fonction pour la question et pour la réponse : `canPlayPower` la lit
 * pour refuser la carte, `applyPower` la relit pour la jouer. Deux tests
 * séparés pourraient diverger, et la carte quitterait alors la main pour ne rien
 * produire — le pire qui puisse arriver à un bonus qu'on avait gardé.
 *
 * Le galop pousse un cheval déjà sorti, jamais au-delà de l'arrivée — gagner par
 * accident serait plus frustrant qu'un pouvoir perdu — et jamais sur une case
 * qu'un coup de dé lui aurait refusée.
 */
function galopFor(
  state: GameState,
  pawn: Pawn,
): { to: number; captures: string[]; shielded: string[] } | null {
  const geometry = geometryFor(state.variant)
  const to = pawn.steps + POWERS.galop.steps
  if (pawn.steps < 0 || to > geometry.lastStep) return null
  const { captures, shielded, blocked } = landing(state, pawn, to)
  return blocked ? null : { to, captures, shielded }
}

/**
 * La carte peut-elle être jouée dans l'état où l'on est ?
 *
 * Exportée : l'écran des cartes en main s'en sert pour griser celles qui ne
 * mènent à rien, plutôt que de laisser le joueur les taper pour rien.
 */
export function canPlayPower(state: GameState, power: PowerId, target?: string): boolean {
  if (state.phase === 'finished') return false
  const spec = POWERS[power]
  if (!spec.held) return false

  // Relancer suppose un dé sur la table, et un tour qui n'est pas déjà perdu.
  if (power === 'rejeu') return state.phase === 'moving' && !state.voided

  if (spec.target === 'cheval') {
    const geometry = geometryFor(state.variant)
    // Le cheval visé est un cheval qu'on joue — le sien, ou celui du partenaire
    // quand on a rentré les siens. Une carte reste une carte : elle ne désigne
    // jamais un cheval qu'on ne pourrait pas déplacer soi-même.
    const pawn = state.pawns.find((p) => p.id === target && p.owner === activeSeatFor(state))
    if (!pawn) return false
    if (hasFinished(geometry, pawn.steps)) return false
    // Un bouclier se pose sur un cheval que quelque chose peut atteindre —
    // c'est-à-dire sur le circuit. À l'écurie comme dans l'escalier, il serait
    // une carte dépensée pour rien.
    if (power === 'bouclier') return isOnTrack(geometry, pawn.steps) && !pawn.shield
    if (power === 'galop') return galopFor(state, pawn) !== null
  }
  return true
}

/**
 * Les cartes de la main jouables tout de suite, cheval visé compris.
 *
 * La main est celle du siège dont c'est le tour — on ne joue jamais les cartes
 * de son partenaire ; les chevaux, eux, sont ceux qu'on déplace.
 */
export function playablePowers(state: GameState): PowerId[] {
  return [...new Set(handOf(state, state.turn))].filter((power) => {
    const spec = POWERS[power]
    if (spec.target === 'aucune') return canPlayPower(state, power)
    return pawnsOf(state, activeSeatFor(state)).some((p) => canPlayPower(state, power, p.id))
  })
}

/** Les chevaux sur lesquels cette carte peut se poser. */
export function powerTargets(state: GameState, power: PowerId): string[] {
  if (POWERS[power].target !== 'cheval') return []
  return pawnsOf(state, activeSeatFor(state))
    .filter((p) => canPlayPower(state, power, p.id))
    .map((p) => p.id)
}

/**
 * Relance le dé sans changer de main.
 *
 * La chaîne de 6 ne repart pas de zéro : sans cela, relancer serait aussi le
 * moyen d'effacer deux 6 déjà posés et d'échapper à la règle des trois.
 */
function rerollFor(state: GameState): GameState {
  const [rng, dice] = rollDie(state.rng, {
    exitFaces: state.variant.exitRolls,
    exitChance: mercyOf(state, activeSeatFor(state)),
  })
  const consecutiveSixes = dice === 6 ? state.consecutiveSixes + 1 : 0
  const max = state.variant.maxConsecutiveSixes
  const voided = max > 0 && dice === 6 && consecutiveSixes >= max

  let next: GameState = { ...state, rng, dice, consecutiveSixes, voided, phase: 'moving' }
  next = countUp(next, state.turn, { rolls: 1, pips: dice, sixes: dice === 6 ? 1 : 0 })
  next = addLog(next, state.turn, { kind: 'roll', dice })
  if (voided) next = addLog(next, state.turn, { kind: 'voided', sixes: max })
  return next
}

/** Retire la carte du dessus, en remélangeant un paquet neuf s'il est vide. */
function draw(state: GameState): { state: GameState; power: PowerId } {
  let rng = state.rng
  let deck = state.deck ?? []
  if (deck.length === 0) {
    const [seeded, fresh] = shuffle(rng, freshDeck())
    rng = seeded
    deck = fresh
  }
  const [power, ...rest] = deck as [PowerId, ...PowerId[]]
  return { state: { ...state, rng, deck: rest }, power }
}

/**
 * L'effet d'une carte, une fois qu'on a décidé de la jouer.
 *
 * `pawnId` peut être absent : les cartes qui ne désignent personne (`rejeu`,
 * `des`, `saute`) n'en ont pas besoin. Celles qui en ont besoin sont passées par
 * `canPlayPower`, qui refuse un cheval introuvable.
 */
function applyPower(state: GameState, pawnId: string | undefined, power: PowerId): GameState {
  const pawn = state.pawns.find((p) => p.id === pawnId)
  const setPawn = (patch: Partial<Pawn>): GameState => ({
    ...state,
    pawns: state.pawns.map((p) => (p.id === pawnId ? { ...p, ...patch } : p)),
  })

  switch (power) {
    case 'bouclier':
      return setPawn({ shield: true })

    case 'des':
      return { ...state, diceBoosts: creditBoost(state, state.turn) }

    case 'rejeu':
      // Le rejeu se joue dans `endTurn` : il n'y a rien à changer dans l'état.
      return state

    case 'saute': {
      const skips = [...(state.skips ?? [0, 0, 0, 0])]
      skips[state.turn] = (skips[state.turn] ?? 0) + 1
      return { ...state, skips }
    }

    case 'ecurie':
      return setPawn({ steps: STABLE, shield: false })

    case 'galop': {
      // Il arrive comme un coup de dé : il mange ce qu'il rattrape et brise les
      // boucliers. La carte n'a pas pu quitter la main sans que `galopFor` ait
      // dit oui — `canPlayPower` lit la même fonction, et refuse avant que la
      // main ne soit entamée. Le repli reste, pour un état venu du réseau.
      if (!pawn) return state
      const run = galopFor(state, pawn)
      if (!run) return state
      return takeLanding(setPawn({ steps: run.to }), state.turn, run.captures, run.shielded)
    }

    case 'fauxpas': {
      // Un malus ne doit pas se changer en aubaine : **on ne capture jamais en
      // reculant**. La case visée peut donc être tenue par n'importe qui, et
      // c'est alors la première case libre en deçà qui accueille le cheval — à
      // défaut, il reste où il est.
      //
      // Le recul s'arrête à la case de départ : un cheval ne retourne pas à
      // l'écurie par un faux pas, c'est le rôle du malus qui porte ce nom.
      if (!pawn) return state
      const floor = Math.max(0, pawn.steps - POWERS.fauxpas.steps)
      for (let target = floor; target < pawn.steps; target++) {
        // Hors règle française, aucune case n'est jamais tenue : la boucle
        // s'arrête au premier essai, et le cheval recule des trois cases.
        const taken = state.variant.onePerSquare && occupantsAt(state, pawn, target).length > 0
        if (!taken) return setPawn({ steps: target })
      }
      return state
    }
  }
}

/**
 * Un bouclier ne survit pas à l'arrivée.
 *
 * Il ne protège plus rien — l'escalier et l'arrivée sont hors d'atteinte — et
 * s'il restait posé, le cheval rentré porterait sa marque jusqu'à la fin de la
 * partie, comme si la table lui devait encore une capture.
 */
function settleShields(state: GameState): GameState {
  const geometry = geometryFor(state.variant)
  if (!state.pawns.some((p) => p.shield && hasFinished(geometry, p.steps))) return state
  return {
    ...state,
    pawns: state.pawns.map((p) =>
      p.shield && hasFinished(geometry, p.steps) ? { ...p, shield: false } : p,
    ),
  }
}

function applyPass(state: GameState): ApplyResult {
  if (state.phase !== 'moving') return { state, error: 'nothingToPass' }
  if (legalMoves(state).length > 0) return { state, error: 'moveExists' }

  const next = addLog({ ...state, seq: state.seq + 1 }, state.turn, { kind: 'pass' })
  return { state: endTurn(next, null) }
}

/**
 * Force la fin du tour d'un siège sans exiger l'absence de coup légal —
 * réservé à l'hôte pour l'abandon de tour d'un pair déconnecté. Un joueur ne
 * peut jamais déclencher ceci via `apply()`/`dispatch()` : ce n'est pas une
 * action du protocole réseau, seulement un utilitaire appelé côté hôte.
 */
export function forceSkipTurn(state: GameState, seat: Seat): GameState {
  if (state.phase === 'finished' || state.turn !== seat) return state
  // Le dé est effacé AVANT de clore le tour : un 6 resté sur la table vaut
  // rejeu (voir `endTurn`), et le tour qu'on voulait sauter reviendrait au même
  // joueur — indéfiniment, s'il est parti.
  const cleared = {
    ...state,
    seq: state.seq + 1,
    dice: null,
    consecutiveSixes: 0,
    voided: false,
    hop: undefined,
  }
  return endTurn(addLog(cleared, seat, { kind: 'timeout' }), null)
}

/**
 * Tours passés à l'écurie sans en sortir. C'est ici que le compteur se tient à
 * jour, à la fin de chaque tour : il monte tant que le joueur reste enfermé,
 * et retombe à zéro à la seconde où un cheval est dehors.
 *
 * Le siège passé est celui dont on jouait les chevaux, pas forcément celui qui
 * tenait le dé : la pitié compte des essais, et en équipes une écurie reçoit
 * les essais de ses deux joueurs.
 */
function countPenned(state: GameState, seat: Seat): GameState {
  // `?? []` : un état reçu d'un pair resté sur une version d'avant le compteur
  // n'en a pas. Il repart de zéro plutôt que de faire tomber la partie.
  const stuck = [...(state.stuck ?? [])]
  stuck[seat] = isPenned(state, seat) ? (stuck[seat] ?? 0) + 1 : 0
  return { ...state, stuck }
}

/**
 * Le classement d'une partie en équipes.
 *
 * Quatre sièges, dans cet ordre : le camp vainqueur d'abord — ses deux sièges
 * rangés par ordre d'arrivée, celui qui a rentré ses chevaux le premier devant —
 * puis le camp battu, rangé de même. On a gagné ou perdu **à deux** ; l'ordre
 * interne ne dit que qui a fini le travail en premier.
 */
function teamRanking(state: GameState, winner: Team): Seat[] {
  const byFinish = (team: Team): Seat[] => {
    const seats = seatsOfTeam(state, team)
    const done = (state.finishers ?? []).filter((seat) => seats.includes(seat))
    return [...done, ...seats.filter((seat) => !done.includes(seat))]
  }
  return [...byFinish(winner), ...byFinish(otherTeam(winner))]
}

/**
 * Note les sièges qui viennent de rentrer leurs quatre chevaux.
 *
 * On regarde les quatre sièges et non le seul joueur courant : en équipes, un
 * tour peut rentrer le dernier cheval du **partenaire**, et ce siège-là mérite
 * sa place dans l'ordre d'arrivée autant que les autres.
 */
function noteFinishers(state: GameState): GameState {
  const known = state.finishers ?? []
  const finishers = [...known]
  for (const player of state.players) {
    if (!finishers.includes(player.seat) && hasWon(state, player.seat)) finishers.push(player.seat)
  }
  return finishers.length === known.length ? state : { ...state, finishers }
}

/** Décide qui joue ensuite, en tenant compte des primes de rejeu. */
function endTurn(state: GameState, move: Move | null, powerReplay = false): GameState {
  const teams = state.variant.teams === true
  let next = countPenned(state, activeSeatFor(state))

  if (teams) {
    // Rentrer ses quatre chevaux ne sort pas du jeu : le siège garde sa place à
    // table et jouera pour son partenaire. Il n'entre donc pas au classement —
    // on note seulement l'ordre, qui départagera les deux alliés à la fin.
    next = noteFinishers(next)

    // Une équipe gagne quand ses huit chevaux sont rentrés, et la partie
    // s'arrête là : il n'y a plus de deuxième place à disputer entre deux camps.
    const team = teamOf(next.turn)
    if (teamHasWon(next, team)) {
      next = addLog(next, next.turn, { kind: 'win' })
      return {
        ...next,
        ranking: teamRanking(next, team),
        phase: 'finished',
        dice: null,
        voided: false,
      }
    }
  } else {
    // Un joueur qui vient de rentrer son dernier cheval prend place au classement.
    //
    // La condition ne regarde plus le coup joué : un cheval peut aussi rentrer par
    // une carte, et le galop qui rentrait le dernier laissait alors son joueur
    // hors du classement — vainqueur sans victoire, à passer son tour jusqu'à la
    // fin de la partie. C'est l'état du plateau qui décide, pas le geste.
    if (hasWon(next, next.turn) && !next.ranking.includes(next.turn)) {
      next = { ...next, ranking: [...next.ranking, next.turn] }
      // Le nom du joueur est déjà porté par `actor` : l'événement ne le répète pas.
      const place = next.ranking.length
      next = addLog(next, next.turn, place === 1 ? { kind: 'win' } : { kind: 'rank', place })
    }

    const stillPlaying = next.players.filter((p) => !next.ranking.includes(p.seat))
    if (stillPlaying.length <= 1) {
      const last = stillPlaying[0]
      const ranking = last ? [...next.ranking, last.seat] : next.ranking
      return { ...next, ranking, phase: 'finished', dice: null, voided: false }
    }
  }

  const v = next.variant
  const replays =
    !next.voided &&
    move !== null &&
    ((next.dice === 6 && v.extraTurnOnSix) ||
      (move.captures.length > 0 && v.extraTurnOnCapture) ||
      (move.finishes && v.extraTurnOnFinish))

  // Rejouer sur un 6 sans avoir bougé (aucun coup possible) reste un rejeu.
  const replaysOnBlockedSix = !next.voided && move === null && next.dice === 6 && v.extraTurnOnSix

  // En équipes, on est arrivé ici sans que le camp ait gagné : le joueur a donc
  // encore des chevaux à pousser, fussent-ils ceux du partenaire, et sa prime de
  // rejeu lui reste due.
  const stillPlaying = teams || !hasWon(next, next.turn)

  if ((replays || replaysOnBlockedSix || powerReplay) && stillPlaying) {
    return {
      ...next,
      phase: 'rolling',
      dice: null,
      voided: false,
      // Seule une chaîne de 6 doit continuer à s'accumuler.
      consecutiveSixes: next.dice === 6 ? next.consecutiveSixes : 0,
    }
  }

  return passTurn({
    ...next,
    phase: 'rolling',
    dice: null,
    consecutiveSixes: 0,
    voided: false,
  })
}

/**
 * Passe la main au siège suivant, en brûlant les tours dus au malus « tour
 * sauté ».
 *
 * Un tour sauté compte comme un tour passé à l'écurie : sans cela, un joueur
 * enfermé que le malus retarde verrait sa pitié de sortie gelée, et paierait le
 * malus deux fois.
 */
function passTurn(state: GameState): GameState {
  let next = state
  // Borne de sécurité : quatre sièges, et chacun ne peut cumuler qu'un nombre
  // fini de tours sautés. La boucle sort d'elle-même, la borne est un filet.
  for (let guard = 0; guard < 32; guard++) {
    const seat = nextActiveSeat(next, next.turn)
    next = { ...next, turn: seat }
    const owed = next.skips?.[seat] ?? 0
    if (owed <= 0) return next
    const skips = [...(next.skips ?? [0, 0, 0, 0])]
    skips[seat] = owed - 1
    const skipped = addLog({ ...next, skips }, seat, { kind: 'skipped' })
    next = countPenned(skipped, activeSeatFor(skipped))
  }
  return next
}

function nextActiveSeat(state: GameState, from: Seat): Seat {
  const order = state.players.map((p) => p.seat)
  const start = order.indexOf(from)
  for (let i = 1; i <= order.length; i++) {
    const seat = order[(start + i) % order.length]!
    if (!state.ranking.includes(seat)) return seat
  }
  return from
}

/**
 * Ajoute une entrée au journal, numérotée une fois pour toutes.
 *
 * Le numéro se lisait dans la longueur du journal — qui est tronqué à ses
 * soixante dernières entrées. Passé la soixantième, toutes portaient donc le
 * même numéro, et l'écran, qui n'annonce que ce qui dépasse le dernier numéro
 * vu (voir `announce` dans `app.ts`), ne voyait plus rien passer. Le compteur
 * est donc dans l'état, et il ne redescend jamais.
 *
 * Le `??` couvre un état venu d'une version d'avant le compteur : on repart
 * alors du dernier numéro posé, et non de zéro, pour rester croissant.
 */
function addLog(state: GameState, seat: Seat, event: LogEvent): GameState {
  const actor = playerAt(state, seat)?.name ?? ''
  const last = state.log[state.log.length - 1]
  const seq = state.logSeq ?? (last ? last.seq + 1 : 0)
  const entry = { seq, seat, actor, event }
  return { ...state, logSeq: seq + 1, log: [...state.log, entry].slice(-LOG_LIMIT) }
}

// ─────────────────────────────── divers ───────────────────────────────

/** Progression 0..1 d'un pion, pour la barre de chaque joueur. */
export const progressOf = (state: GameState, seat: Seat): number => {
  const geometry = geometryFor(state.variant)
  return (
    pawnsOf(state, seat).reduce((sum, p) => sum + Math.max(0, p.steps + 1), 0) /
    (state.variant.pawnsPerPlayer * (geometry.lastStep + 1))
  )
}
