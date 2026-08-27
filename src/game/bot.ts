/**
 * Adversaire artificiel — utile quand on n'est que deux ou trois.
 *
 * ## Trois niveaux, et ce qui les sépare vraiment
 *
 * Un seul bot, c'était un bot qui convient à une seule table. Le nôtre jouait
 * correctement : il mangeait dès qu'il pouvait, il ne se garait jamais devant
 * un dé adverse, il ne gaspillait pas ses cartes. Contre des enfants ou pour
 * une première partie, c'est déjà trop.
 *
 * La difficulté ne se règle donc PAS en tirant au hasard dans les coups
 * légaux. Un bot qui refuse une capture gratuite ou ressort un cheval de son
 * escalier n'est pas facile, il est cassé — on ne joue pas contre lui, on le
 * regarde se tromper. Ce qu'on dégrade, c'est ce qu'il **voit** :
 *
 * - `tranquille` ne regarde pas derrière lui, oublie une fois sur quatre qu'il
 *   peut manger, hésite entre son meilleur coup et le suivant, et laisse
 *   dormir ses cartes tant que sa main n'est pas pleine ;
 * - `normal` est le bot d'avant, débarrassé de trois contresens ;
 * - `redoutable` compte ce qu'une capture rapporte vraiment, sait qu'une case
 *   étoilée le met à l'abri, joue ses cartes pour fuir autant que pour
 *   avancer, et dépense ses bonus de dé — ce que personne ne faisait.
 *
 * Le résultat de `tranquille` est reconnaissable : il avance, il se gare
 * devant un adversaire, il se fait manger, il oublie une carte. C'est l'erreur
 * humaine ordinaire, pas un coup absurde.
 *
 * ## Le hasard, sans toucher au dé
 *
 * Les hésitations de `tranquille` se tirent de l'état lui-même
 * (voir `wobble`), et **jamais** de `Math.random` ni de `state.rng`. Deux
 * raisons, et chacune suffirait : une partie doit se rejouer à l'identique à
 * graine égale — deux tests du dépôt ne vérifient que ça — et consommer le
 * générateur du jeu ferait changer le DÉ selon ce que le bot a pensé, ce qui
 * n'a aucun sens.
 */

import { geometryFor, hasFinished, isOnTrack, trackIndexOf } from './board.ts'
import {
  activeSeatFor,
  areAllies,
  boostsOf,
  canPlayPower,
  isPenned,
  isSafeIndex,
  legalMoves,
  pawnsOf,
  playablePowers,
} from './engine.ts'
import { HAND_LIMIT, POWERS, type PowerId } from './powers.ts'
import { nextFloat } from './rng.ts'
import type { Action, GameState, Move, Pawn, Seat } from './types.ts'

/** Du plus tranquille au plus redoutable — l'ordre du sélecteur du salon. */
export const BOT_LEVELS = ['tranquille', 'normal', 'redoutable'] as const

export type BotLevel = (typeof BOT_LEVELS)[number]

/**
 * Le niveau par défaut, et celui de tout ce qui n'en a pas choisi.
 *
 * Un bot qui prend le siège d'un joueur parti en fait partie : il tient des
 * chevaux qui ne sont pas les siens, et il joue donc comme le jeu, pas comme
 * un réglage que l'absent n'a jamais demandé.
 */
export const DEFAULT_LEVEL: BotLevel = 'normal'

export const isBotLevel = (value: unknown): value is BotLevel =>
  typeof value === 'string' && (BOT_LEVELS as readonly string[]).includes(value)

/**
 * Ce qu'un niveau voit, et ce qu'il laisse passer.
 *
 * Des drapeaux plutôt qu'un multiplicateur de score : « il ne regarde pas
 * derrière lui » se lit dans le jeu et se raconte à table, « ses coefficients
 * sont multipliés par 0,7 » ne se lit nulle part.
 */
type Profile = {
  /** Voit-il les chevaux qui peuvent le manger au tour suivant ? */
  wary: boolean
  /** Compte-t-il ce qu'une capture, une case abritée ou un blocage rapportent ? */
  sharp: boolean
  /** Sur combien de tours il ne voit pas qu'il peut manger. 0 : il voit toujours. */
  blind: number
  /** Sur combien de tours il joue son deuxième meilleur coup — jamais le pire. */
  hesitant: number
  /** Ce qu'il fait de sa main. */
  cards: 'oublie' | 'simple' | 'complet'
  /** Dépense-t-il ses bonus de dé ? */
  boosts: boolean
}

const PROFILES: Record<BotLevel, Profile> = {
  tranquille: { wary: false, sharp: false, blind: 0.25, hesitant: 0.35, cards: 'oublie', boosts: false },
  normal: { wary: true, sharp: false, blind: 0, hesitant: 0, cards: 'simple', boosts: false },
  redoutable: { wary: true, sharp: true, blind: 0, hesitant: 0, cards: 'complet', boosts: true },
}

/**
 * Le temps qu'un bot prend avant chacun de ses gestes.
 *
 * Il ne réfléchit pas, et n'a aucune raison d'attendre : ce délai est pour
 * ceux qui regardent. Il fait aussi partie du personnage — un adversaire
 * redoutable qui répond du tac au tac ne se joue pas comme un adversaire
 * tranquille qui prend son temps — et le tour d'un bot ne compte pas dans le
 * temps de réflexion, donc l'allonger ne coûte rien à personne.
 */
export const BOT_DELAY: Record<BotLevel, number> = {
  tranquille: 1450,
  normal: 1150,
  redoutable: 850,
}

/**
 * Un flottant dans [0,1) tiré de l'état, sans rien y consommer.
 *
 * `logSeq` avance à chaque action jouée : deux tours différents donnent deux
 * tirages différents, et la même partie rejouée depuis la même graine donne la
 * même suite. `salt` sépare deux décisions prises dans le même tour — sans
 * lui, « est-ce que j'oublie de manger ? » et « est-ce que j'hésite ? »
 * tireraient toujours le même nombre, donc toujours ensemble.
 */
function wobble(state: GameState, salt: number): number {
  // `seq` en secours, et pas zéro : un pair resté sur une version d'avant le
  // journal envoie un état sans `logSeq`, et la graine se réduisait alors à
  // une constante par siège — le même tirage à chaque tour, donc un bot
  // tranquille aveugle en permanence ou hésitant en permanence. `seq` avance
  // à chaque état, il fait exactement le même travail.
  const tick = state.logSeq ?? state.seq
  const seed = (Math.imul(tick, 2654435761) + state.turn * 40503 + salt) | 0
  return nextFloat(seed)[1]
}

/** Le cheval désigné par un identifiant, s'il existe encore. */
const pawnById = (state: GameState, id: string): Pawn | undefined =>
  state.pawns.find((p) => p.id === id)

function score(move: Move, state: GameState, profile: Profile, blind: boolean): number {
  const geometry = geometryFor(state.variant)
  const trackLength = geometry.trackLength
  const seat = activeSeatFor(state)
  let s = 0

  // Manger reste le coup le plus rentable : l'adversaire repart de zéro.
  if (move.captures.length > 0 && !blind) {
    s += 1000 + move.captures.length * 100
    // Ce qu'on lui fait perdre, et non le simple fait de le manger : renvoyer
    // un cheval à deux cases de son écurie et un cheval à deux cases de son
    // arrivée n'est pas le même coup, et le bot les jouait à l'identique.
    if (profile.sharp) {
      for (const id of move.captures) s += 3 * (pawnById(state, id)?.steps ?? 0)
      // Et dans les variantes où manger rend la main, c'est un tour de plus.
      if (state.variant.extraTurnOnCapture) s += 250
    }
  }

  // Rentrer un cheval est définitif.
  if (move.finishes) {
    s += 800
    if (profile.sharp && state.variant.extraTurnOnFinish) s += 250
  }

  // Sortir de l'écurie met un cheval en jeu ; d'autant plus utile qu'on en a
  // peu dehors. « Dehors » exclut les chevaux rentrés : ils comptaient, si
  // bien que l'envie de sortir s'éteignait à mesure que la partie se gagnait —
  // exactement l'inverse de ce qu'il faut.
  if (move.exits) {
    const outside = state.pawns.filter(
      (p) => p.owner === seat && p.steps >= 0 && !hasFinished(geometry, p.steps),
    ).length
    s += 400 - outside * 80
  }

  // Se mettre à l'abri dans l'escalier.
  if (move.to >= trackLength && move.from < trackLength) s += 300

  // À défaut, faire progresser le cheval le plus avancé.
  s += move.to * 2

  const landing = trackIndexOf(geometry, seat, move.to)
  const safe = landing !== null && isSafeIndex(state.variant, landing)

  // Éviter de finir juste devant un adversaire qui pourrait nous manger au
  // tour suivant — sauf là où il ne peut rien nous faire. Le bot se pénalisait
  // d'aller sur une case étoilée ou sur un départ, c'est-à-dire là où il est
  // intouchable : un contresens permanent dans trois variantes sur quatre.
  const shielded = pawnById(state, move.pawnId)?.shield === true
  if (profile.wary && move.to < trackLength && !safe && !shielded) {
    s -= threatOn(state, move.to) * 60
  }

  if (profile.sharp) {
    // Une case abritée n'est pas seulement « pas dangereuse » : c'est un
    // rocher sur lequel on peut attendre son tour.
    if (safe) s += 120
    // Et se poser sur le départ d'un adversaire, là où une case ne porte qu'un
    // cheval, lui ferme sa propre sortie.
    if (state.variant.onePerSquare && landing !== null && blocksSomeone(state, landing, seat)) {
      s += 150
    }
  }

  return s
}

/**
 * Cette case du circuit est-elle le départ d'un adversaire ?
 *
 * S'y poser lui ferme sa propre sortie, là où une case ne porte qu'un cheval.
 * Un coéquipier n'y change rien — on ne bloque pas son camp — et soi-même non
 * plus : `areAllies` répond vrai pour un siège et lui-même, ce qui suffit à
 * écarter les deux cas d'un coup.
 */
function blocksSomeone(state: GameState, index: number, seat: Seat): boolean {
  const geometry = geometryFor(state.variant)
  return state.players.some(
    (p) => !areAllies(state, p.seat, seat) && geometry.startIndex[p.seat] === index,
  )
}

/**
 * Nombre de chevaux adverses situés 1 à 6 cases derrière cette position.
 *
 * Le calcul se fait en cases absolues du circuit : chaque joueur compte ses pas
 * depuis son propre départ, comparer des `steps` bruts n'aurait aucun sens.
 *
 * `steps` se compte depuis le départ du siège dont on joue les chevaux — le
 * partenaire, le cas échéant — et un coéquipier n'est jamais une menace : il ne
 * peut pas manger, donc il ne fait pas fuir.
 */
function threatOn(state: GameState, steps: number): number {
  const geometry = geometryFor(state.variant)
  if (!isOnTrack(geometry, steps)) return 0
  const seat = activeSeatFor(state)
  const target = trackIndexOf(geometry, seat, steps)
  if (target === null) return 0

  let threats = 0
  for (const p of state.pawns) {
    if (areAllies(state, p.owner, seat) || !isOnTrack(geometry, p.steps)) continue
    const from = trackIndexOf(geometry, p.owner, p.steps)!
    const gap = (target - from + geometry.trackLength) % geometry.trackLength
    if (gap >= 1 && gap <= 6) threats++
  }
  return threats
}

/**
 * Le meilleur coup selon l'heuristique, ou null s'il n'y en a aucun.
 *
 * Le niveau est optionnel et vaut `normal` : c'est ce qui permet à tous les
 * appels d'avant de continuer à dire exactement ce qu'ils disaient.
 */
export function chooseMove(state: GameState, level: BotLevel = DEFAULT_LEVEL): Move | null {
  const moves = legalMoves(state)
  if (moves.length === 0) return null
  const profile = PROFILES[level]
  const blind = profile.blind > 0 && wobble(state, 0x51ed) < profile.blind
  // Un tri stable, et non un `reduce` : à score égal le premier de la liste
  // gagne dans les deux cas, mais le tri donne aussi le SECOND, dont le niveau
  // tranquille a besoin. Le tableau vient de `legalMoves`, il est neuf — l'état
  // est gelé pendant les tests, on ne trie jamais quelque chose qui lui
  // appartient.
  const ranked = [...moves].sort(
    (a, b) => score(b, state, profile, blind) - score(a, state, profile, blind),
  )
  // Il hésite : il prend le suivant, jamais le dernier. Un bot qui jouerait
  // son plus mauvais coup ne ferait pas une partie plus facile, il ferait une
  // partie qui ne finit pas.
  const second = ranked.length > 1 && profile.hesitant > 0 && wobble(state, 0x2f9a) < profile.hesitant
  return ranked[second ? 1 : 0]!
}

/**
 * Le bonus de dé que ce lancer mérite, s'il en mérite un.
 *
 * Personne ne les dépensait : chaque siège reçoit trois bonus en début de
 * partie et le bot lançait toujours `{ type: 'roll' }` tout sec, si bien qu'il
 * finissait la partie avec sa réserve intacte. Deux moments les justifient, et
 * ce sont ceux où un chiffre précis change quelque chose : sortir de l'écurie
 * quand tout le monde y est, et rentrer un cheval.
 *
 * **Rien plutôt qu'à moitié.** Un bonus ne penche pas le dé, il en écrase un
 * côté : les trois faces favorisées passent à 26,7 % chacune et les trois
 * autres tombent à 6,7 %. Choisi du mauvais côté, il rend donc le lancer plus
 * mauvais que le dé franc — et il coûte une ressource dont on n'a que trois
 * exemplaires. C'est ce que faisait la première version, qui regardait le
 * cheval le plus proche de l'arrivée au lieu de regarder où tombait le gros de
 * la troupe : à trois chevaux qui réclamaient 1, 5 et 6, elle demandait un
 * petit nombre et faisait passer les chances de rentrer de 50 % à 40 %.
 */
function chooseBoost(state: GameState, profile: Profile): 'low' | 'high' | undefined {
  if (!profile.boosts || boostsOf(state, state.turn) <= 0) return undefined
  const seat = activeSeatFor(state)
  const geometry = geometryFor(state.variant)

  if (isPenned(state, seat)) {
    // Le dernier reste pour l'arrivée. Sans ce garde-fou, les trois bonus
    // partaient dans les premiers lancers de la partie — c'est là qu'ils
    // rapportent le plus, mais la réserve était vide bien avant le moment du
    // compte exact, et le second usage annoncé plus haut n'existait pas.
    if (boostsOf(state, state.turn) <= 1) return undefined
    const exits = state.variant.exitRolls
    if (exits.length === 0) return undefined
    // Une variante qui sort sur 1 OU sur 6 ne se laisse aider par aucun des
    // deux : ce qu'un côté gagne, l'autre le perd exactement.
    if (exits.every((n) => n >= 4)) return 'high'
    if (exits.every((n) => n <= 3)) return 'low'
    return undefined
  }

  const needed = pawnsOf(state, seat)
    .filter((p) => p.steps >= 0 && !hasFinished(geometry, p.steps))
    .map((p) => geometry.lastStep - p.steps)
    .filter((n) => n >= 1 && n <= 6)
  if (needed.length === 0) return undefined

  // Sans compte exact, il suffit d'atteindre l'arrivée : le petit nombre n'a
  // rien à offrir, et le grand ne sert que là où le petit ne suffirait pas.
  // Sans cette règle, la variante rapide — la seule qui n'exige pas le compte
  // exact — ne dépensait pas un seul bonus de la partie, alors que c'est
  // précisément ce que le niveau redoutable promet de faire.
  if (!state.variant.exactFinish) return Math.min(...needed) >= 4 ? 'high' : undefined

  const low = needed.filter((n) => n <= 3).length
  const high = needed.length - low
  if (low === high) return undefined
  return low > high ? 'low' : 'high'
}

/**
 * La carte que le bot jouerait maintenant, s'il en a une qui vaut le coup.
 *
 * Volontairement frugale : un bot qui viderait sa main dès qu'il le peut
 * gaspillerait ses cartes, et un bot qui ne les jouerait jamais donnerait à la
 * table l'impression que les pouvoirs ne marchent pas.
 */
export function choosePower(state: GameState, level: BotLevel = DEFAULT_LEVEL): Action | null {
  const hand = playablePowers(state)
  if (hand.length === 0) return null

  const profile = PROFILES[level]
  const geometry = geometryFor(state.variant)
  // Les chevaux qu'on joue, qui ne sont pas toujours les siens : en équipes, un
  // joueur qui a fini pose ses cartes sur les chevaux de son partenaire.
  const mine = pawnsOf(state, activeSeatFor(state)).filter((p) => !hasFinished(geometry, p.steps))
  const best = (power: PowerId): string | undefined =>
    mine
      .filter((p) => canPlayPower(state, power, p.id))
      .sort((a, b) => b.steps - a.steps)[0]?.id

  // Main pleine : mieux vaut dépenser que refuser la prochaine carte. C'est la
  // seule règle que garde le niveau tranquille — il ne regarde sa main que
  // lorsqu'elle déborde, comme quelqu'un qui a oublié qu'il avait des cartes.
  const spendFullHand = (): Action | null => {
    if ((state.hands?.[state.turn]?.length ?? 0) < HAND_LIMIT) return null
    for (const power of hand) {
      if (POWERS[power].target === 'aucune') return { type: 'power', power }
      const pawnId = best(power)
      if (pawnId) return { type: 'power', power, pawnId }
    }
    return null
  }

  if (profile.cards === 'oublie') return spendFullHand()

  // Un galop qui fait rentrer un cheval est toujours bon à prendre.
  if (hand.includes('galop')) {
    const finisher = mine.find(
      (p) => canPlayPower(state, 'galop', p.id) && p.steps + POWERS.galop.steps === geometry.lastStep,
    )
    if (finisher) return { type: 'power', power: 'galop', pawnId: finisher.id }
  }

  // Relancer un dé qui ne donne aucun coup : il n'y a rien à perdre.
  if (hand.includes('rejeu') && legalMoves(state).length === 0) return { type: 'power', power: 'rejeu' }

  // Protéger le cheval le plus avancé, quand il est vraiment menacé.
  if (hand.includes('bouclier')) {
    const target = mine
      .filter((p) => canPlayPower(state, 'bouclier', p.id))
      .sort((a, b) => b.steps - a.steps)
      // `canPlayPower` écarte déjà les chevaux qui en portent un : le
      // bouclier ne se double pas.
      .find((p) => threatOn(state, p.steps) > 0)
    if (target) return { type: 'power', power: 'bouclier', pawnId: target.id }
  }

  if (profile.cards === 'complet') {
    // Le galop sert aussi à FUIR, et pas seulement à finir : trois cases plus
    // loin, le cheval menacé n'est peut-être plus à portée du dé adverse. Le
    // bot ne s'en servait jamais ainsi — il gardait la carte jusqu'à ce
    // qu'elle rentre un cheval, ou jusqu'à ce que sa main déborde.
    if (hand.includes('galop')) {
      const runner = mine
        .filter((p) => canPlayPower(state, 'galop', p.id))
        .sort((a, b) => b.steps - a.steps)
        .find(
          (p) =>
            // Un cheval sous bouclier n'est pas menacé : la prochaine capture
            // le manque. Fuir lui coûterait une carte pour rien — et le même
            // fichier le sait déjà partout ailleurs.
            p.shield !== true &&
            threatOn(state, p.steps) > 0 &&
            threatOn(state, p.steps + POWERS.galop.steps) === 0,
        )
      if (runner) return { type: 'power', power: 'galop', pawnId: runner.id }
    }

    // Et le dé pipé se joue AVANT le lancer qu'il doit pencher : il ne fait que
    // regarnir la réserve de bonus (voir `applyHeldPower`), c'est le lancer qui
    // la dépense. Le jouer après serait le jouer pour rien.
    if (
      hand.includes('des') &&
      state.phase === 'rolling' &&
      boostsOf(state, state.turn) === 0 &&
      chooseBoost({ ...state, diceBoosts: [1, 1, 1, 1] }, profile) !== undefined
    ) {
      return { type: 'power', power: 'des' }
    }
  }

  return spendFullHand()
}

/**
 * Le tour d'un bot, en une action.
 *
 * L'ordre — une carte d'abord, puis le dé, puis le coup — vivait en double,
 * chez la session et dans le banc d'essai, et le lancer y était écrit en dur
 * hors de ce fichier. C'est ce qui interdisait au bot de dépenser un bonus de
 * dé : la seule décision qu'il n'avait pas le droit de prendre était celle-là.
 */
export function botTurn(state: GameState, level: BotLevel = DEFAULT_LEVEL): Action {
  const card = choosePower(state, level)
  if (card) return card
  if (state.phase === 'rolling') {
    const boost = chooseBoost(state, PROFILES[level])
    return boost ? { type: 'roll', boost } : { type: 'roll' }
  }
  const move = chooseMove(state, level)
  return move ? { type: 'move', pawnId: move.pawnId } : { type: 'pass' }
}
