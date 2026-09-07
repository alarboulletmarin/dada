/**
 * Le palmarès : ce que les soirées d'avant ont laissé.
 *
 * La feuille de match dit qui a gagné *cette* partie ; elle s'en va avec elle.
 * Or on ne joue pas une partie, on joue tous les soirs — et la question qui
 * revient en rangeant les téléphones est « il en est à combien, lui ? ». Ce
 * fichier est la réponse : un registre des parties terminées, sur l'appareil,
 * et de quoi en tirer un classement.
 *
 * ── Chacun tient le sien ───────────────────────────────────────────────────
 *
 * L'idée naturelle est que l'hôte garde les comptes et les distribue. Elle ne
 * tient pas ici : l'hôte n'est pas une institution, c'est le téléphone qui a
 * créé le salon ce soir-là. Il change d'un soir à l'autre, il change au milieu
 * d'une partie quand la couronne passe (voir `epoch` dans `room.ts`), et le
 * jour où il désinstalle l'application, tout le palmarès de la bande part avec
 * lui. Un registre qui vit sur un seul appareil est un registre qu'on perd.
 *
 * Chaque appareil garde donc **le sien**, entier, et les registres se
 * rejoignent quand les téléphones se parlent : une partie terminée est un fait
 * daté et immuable, portant un identifiant que tout le monde calcule pareil, si
 * bien que fusionner deux registres n'est qu'une réunion d'ensembles. Pas
 * d'arbitre, pas d'ordre à respecter, pas de conflit possible. Et un ami qui
 * arrive avec un téléphone vide repart avec l'histoire complète de la bande.
 *
 * ── On s'y reconnaît au prénom ─────────────────────────────────────────────
 *
 * Un joueur est identifié par son **prénom**, et non par l'identifiant de son
 * appareil. Ce n'est pas un raccourci : sur un seul téléphone qu'on se passe,
 * les quatre joueurs partagent le même `clientId`, et un palmarès par appareil
 * n'y aurait qu'une seule ligne. Le prénom, lui, désigne la même personne
 * qu'elle joue sur son téléphone, sur celui de son frère, ou autour de la table
 * du salon — c'est exactement ce dont un palmarès a besoin.
 *
 * Le prix est connu et assumé : deux Camille dans la même bande ne feront
 * qu'une ligne. C'est un jeu entre amis, et c'est déjà comme cela qu'on compte
 * les points à voix haute.
 */

import type { GameState, Seat, SeatStats } from '../game/types.ts'

const KEY = 'dada.ledger'
/**
 * 1 : première version du registre.
 *
 * Contrairement à la sauvegarde d'une partie (voir `save.ts`), un registre
 * périmé ne se jette pas : il ne contient rien d'exécutable, seulement des
 * nombres. Un jour où le format changerait, on comblera plutôt qu'on
 * n'effacera — perdre le palmarès de six mois pour un champ ajouté serait le
 * seul vrai bug que ce fichier puisse avoir.
 */
const VERSION = 1

/**
 * Parties gardées, au plus.
 *
 * Deux cents parties, c'est près d'une année à une partie par soir — et une
 * centaine de kilo-octets, qui doivent tenir dans `localStorage` **et** passer
 * sur le réseau d'un coup quand un ami arrive. Au-delà, les plus anciennes
 * s'effacent : un palmarès n'est pas une archive.
 */
export const MAX_MATCHES = 200

/** Longueur maximale d'un prénom, la même que le champ de l'accueil. */
const MAX_NAME = 16

/** Ce qu'un siège a fait d'une partie terminée. */
export type Standing = {
  seat: Seat
  name: string
  /** Rang final, 1 pour le vainqueur. */
  place: number
  /** Ce siège était tenu par un ordinateur. */
  bot: boolean
  /**
   * Cette partie est gagnée.
   *
   * Un champ plutôt qu'un `place === 1` : en équipes on gagne à deux, et le
   * second du camp vainqueur est bien vainqueur. Le calcul se fait une fois, au
   * moment où la variante est encore sous la main, plutôt qu'à chaque lecture.
   */
  won: boolean
  stats: SeatStats
}

/** Une partie terminée, telle qu'elle se range et telle qu'elle voyage. */
export type Match = {
  /**
   * Le même sur tous les appareils qui ont joué cette partie-là.
   *
   * C'est ce qui fait de la fusion une réunion d'ensembles plutôt qu'un
   * problème. Voir `matchIdOf`.
   */
  id: string
  at: number
  variantId: string
  teams: boolean
  players: Standing[]
}

export type Ledger = { v: number; matches: Match[] }

/**
 * L'identifiant d'une partie terminée, calculé de la même façon partout.
 *
 * Trois ingrédients, tous présents à l'identique sur chaque téléphone au moment
 * où la partie s'achève : le code du salon, le numéro de manche, et l'état du
 * générateur aléatoire.
 *
 * Le dernier est celui qui fait le travail. Le code et la manche ne suffisent
 * pas — une partie sur un seul téléphone n'a pas de code (`LOCAL`) et repart de
 * la manche zéro chaque soir, si bien que deux soirées se seraient confondues.
 * L'état du générateur, lui, est un entier de trente-deux bits qui dépend de
 * toute l'histoire de la partie : deux parties différentes ne le partagent pas,
 * et les quatre joueurs de la même partie l'ont forcément identique — c'est la
 * définition même d'un état de partie qui circule.
 */
export function matchIdOf(code: string, round: number, game: GameState): string {
  return `${code}:${round}:${game.rng >>> 0}`
}

/**
 * La partie terminée, telle qu'elle entre au registre.
 *
 * Tout se lit dans l'état du jeu, qui est le même chez tout le monde — noms,
 * sièges, compteurs, classement. Rien n'est lu dans ce que cet appareil-ci sait
 * de lui-même : c'est ce qui garantit que les quatre téléphones fabriquent le
 * même enregistrement, au millième de seconde près de la date.
 */
export function matchOf(code: string, round: number, game: GameState, at = Date.now()): Match | null {
  if (game.phase !== 'finished' || game.players.length === 0) return null

  // Le classement d'abord, complété de ceux qui n'ont pas fini : une partie
  // abandonnée en cours de route n'a pas moins eu lieu.
  const ranked: Seat[] = [
    ...game.ranking,
    ...game.players.map((p) => p.seat).filter((seat) => !game.ranking.includes(seat)),
  ]
  const teams = game.variant.teams === true
  // En équipes, le camp du premier gagne — ses deux sièges, pas seulement celui
  // qui a rentré son dernier cheval le premier.
  const champion = ranked[0] === undefined ? null : ranked[0] % 2

  const players: Standing[] = ranked.map((seat, index) => {
    const player = game.players.find((p) => p.seat === seat)
    return {
      seat,
      name: cleanName(player?.name ?? ''),
      place: index + 1,
      bot: player?.kind === 'bot',
      won: teams ? champion !== null && seat % 2 === champion : index === 0,
      stats: cleanStats(game.stats?.[seat]),
    }
  })

  return { id: matchIdOf(code, round, game), at, variantId: game.variant.id, teams, players }
}

// ───────────────────────────── le registre ─────────────────────────────

export function readLedger(): Match[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const ledger = JSON.parse(raw) as Partial<Ledger>
    if (ledger?.v !== VERSION) return []
    return sanitize(ledger.matches)
  } catch {
    return []
  }
}

function writeLedger(matches: Match[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, matches } satisfies Ledger))
  } catch {
    // Quota plein ou mode privé : la partie qui vient de se terminer ne sera
    // pas comptée, et c'est tout. Ce n'est pas une raison de la gâcher.
  }
}

export function clearLedger(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Sans conséquence.
  }
}

/**
 * Range des parties au registre et rend le registre à jour.
 *
 * La réunion de deux ensembles : une partie déjà connue n'est pas remplacée —
 * elle est la même, et la version déjà là est celle dont on connaît la
 * provenance. Rend `null` si rien n'était nouveau, ce qui évite de réécrire
 * `localStorage` et de rediffuser à toute la table à chaque salon publié.
 */
export function addMatches(incoming: Match[]): Match[] | null {
  const known = readLedger()
  const seen = new Set(known.map((m) => m.id))
  const fresh = sanitize(incoming).filter((m) => !seen.has(m.id))
  if (fresh.length === 0) return null

  // Les plus récentes devant : c'est l'ordre dans lequel on les lit, et c'est
  // par la fin qu'il faut couper quand le registre déborde.
  const matches = [...known, ...fresh]
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_MATCHES)
  writeLedger(matches)
  return matches
}

// ───────────────────────────── le classement ─────────────────────────────

/** Les comptes d'un joueur sur toutes ses parties. */
export type Tally = {
  /** Le prénom réduit à ce qui l'identifie. Voir `nameKey`. */
  key: string
  /** Le prénom tel qu'il s'écrivait la dernière fois. */
  name: string
  games: number
  wins: number
  /**
   * Les compteurs de fin de partie, additionnés — la feuille de match de
   * toutes les soirées à la fois.
   *
   * Les mêmes sept champs que pour une partie, et pas une sélection : les
   * choisir ici reviendrait à décider une fois pour toutes ce qu'un écran a le
   * droit d'afficher, alors que c'est à l'écran d'en montrer ce qui tient.
   */
  stats: SeatStats
  /** Date de la dernière partie jouée. */
  at: number
}

/**
 * Ce qui identifie un prénom : sans accent, sans casse, sans espaces en trop.
 *
 * « Léa », « lea » et « LEA  » sont la même personne autour d'une table, et
 * doivent l'être au palmarès. Un clavier de téléphone qui corrige, un ami qui
 * retape son prénom en majuscules — rien de tout cela ne doit ouvrir une
 * deuxième ligne.
 */
export function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * Le classement, du plus titré au moins titré.
 *
 * **Les ordinateurs n'y figurent pas.** Un bot n'a pas de palmarès : il n'est
 * pas la même personne d'un soir à l'autre, il n'en garde aucun souvenir, et le
 * voir premier au classement de la bande ne dirait rien à personne. Il reste en
 * revanche dans les parties elles-mêmes — la soirée où le bot a gagné a bien eu
 * lieu, et le journal des dernières parties le dit.
 */
const STAT_FIELDS = [
  'rolls',
  'pips',
  'sixes',
  'captures',
  'losses',
  'distance',
  'powers',
] as const satisfies readonly (keyof SeatStats)[]

export function tallies(matches: Match[]): Tally[] {
  const byKey = new Map<string, Tally>()

  for (const match of matches) {
    for (const player of match.players) {
      if (player.bot) continue
      const key = nameKey(player.name)
      if (key === '') continue
      const tally = byKey.get(key) ?? {
        key,
        name: player.name,
        games: 0,
        wins: 0,
        stats: zeroStats(),
        at: 0,
      }
      tally.games += 1
      if (player.won) tally.wins += 1
      for (const field of STAT_FIELDS) tally.stats[field] += player.stats[field]
      // Le prénom le plus récemment porté : qui se renomme se retrouve sous son
      // nouveau nom, sans perdre ce qu'il a gagné sous l'ancien.
      if (match.at >= tally.at) {
        tally.name = player.name
        tally.at = match.at
      }
      byKey.set(key, tally)
    }
  }

  // Les victoires d'abord — c'est la question posée. Puis la proportion, qui
  // départage celui qui a gagné dix fois sur douze de celui qui a gagné dix
  // fois sur quarante ; puis le prénom, pour que deux ex æquo ne changent pas
  // de place d'un affichage à l'autre.
  return [...byKey.values()].sort(
    (a, b) =>
      b.wins - a.wins ||
      b.wins / b.games - a.wins / a.games ||
      b.games - a.games ||
      a.key.localeCompare(b.key),
  )
}

// ───────────────────────── ce qui arrive du réseau ─────────────────────────

/**
 * Un registre reçu d'un ami n'est pas un registre de confiance.
 *
 * Non qu'on le soupçonne — c'est un jeu entre amis — mais il peut venir d'une
 * version d'avant, d'un `localStorage` à moitié écrasé, ou d'un onglet resté
 * ouvert depuis trois versions. Ce qui entre au registre est donc taillé à la
 * forme attendue, et ce qui n'y rentre pas est écarté plutôt que corrigé : une
 * partie douteuse en moins vaut mieux qu'un palmarès qui ment.
 */
export function sanitize(input: unknown): Match[] {
  if (!Array.isArray(input)) return []
  const matches: Match[] = []
  const seen = new Set<string>()

  for (const raw of input.slice(0, MAX_MATCHES)) {
    const match = raw as Partial<Match>
    if (typeof match?.id !== 'string' || match.id === '' || match.id.length > 80) continue
    if (seen.has(match.id)) continue
    if (!Number.isFinite(match.at) || typeof match.variantId !== 'string') continue
    if (!Array.isArray(match.players) || match.players.length === 0 || match.players.length > 4) continue

    const players = match.players.map((raw) => {
      const player = raw as Partial<Standing>
      return {
        seat: (Number(player?.seat) || 0) as Seat,
        name: cleanName(typeof player?.name === 'string' ? player.name : ''),
        place: count(player?.place, 1),
        bot: player?.bot === true,
        won: player?.won === true,
        stats: cleanStats(player?.stats),
      } satisfies Standing
    })

    seen.add(match.id)
    matches.push({
      id: match.id,
      at: Number(match.at),
      variantId: match.variantId.slice(0, 40),
      teams: match.teams === true,
      players,
    })
  }
  return matches
}

const cleanName = (name: string): string => name.trim().slice(0, MAX_NAME)

/** Un compteur : un entier positif, borné, jamais `NaN`. */
const count = (value: unknown, fallback = 0): number => {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 1e6) : fallback
}

/** Sept compteurs à zéro — le point de départ d'une addition. */
const zeroStats = (): SeatStats => cleanStats(undefined)

const cleanStats = (stats: Partial<SeatStats> | undefined): SeatStats => ({
  rolls: count(stats?.rolls),
  pips: count(stats?.pips),
  sixes: count(stats?.sixes),
  captures: count(stats?.captures),
  losses: count(stats?.losses),
  distance: count(stats?.distance),
  powers: count(stats?.powers),
})
