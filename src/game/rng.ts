/**
 * Générateur pseudo-aléatoire déterministe (mulberry32).
 *
 * Pourquoi ne pas utiliser `Math.random()` : l'état du jeu doit être une valeur
 * pure et reproductible. Chaque pair rejouant la même suite d'actions sur le
 * même état obtient exactement le même résultat, ce qui rend les divergences
 * détectables et le débogage possible (on rejoue la partie depuis la graine).
 */

/** Retourne le prochain état et un flottant dans [0,1). */
export function nextFloat(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) | 0
  let r = Math.imul(t ^ (t >>> 15), 1 | t)
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
  return [t, ((r ^ (r >>> 14)) >>> 0) / 4294967296]
}

/**
 * Poids des six faces selon le bonus choisi : ~80% de chances côté favorisé
 * (chaque face du côté à égalité) contre ~6,7% chacune de l'autre — un vrai
 * bonus qui se sent, mais pas un dé truqué à 100%.
 */
const BIAS_WEIGHTS: Record<'low' | 'high', number[]> = {
  low: [4, 4, 4, 1, 1, 1],
  high: [1, 1, 1, 4, 4, 4],
}

const FAIR_WEIGHTS = [1, 1, 1, 1, 1, 1]

export type RollOptions = {
  /** Bonus de dé dépensé par le joueur : penche vers les petits ou les grands nombres. */
  bias?: 'low' | 'high'
  /** Faces qui font sortir un cheval de l'écurie, dans la variante en cours. */
  exitFaces?: number[]
  /**
   * De 0 à 1 : part du hasard qui est retirée au joueur bloqué à l'écurie.
   * 0 laisse le dé franc, 1 garantit une face de sortie. Entre les deux, la
   * probabilité de sortir monte à `p + (1 - p) × chance`, où `p` est celle
   * qu'avait le dé — le reste garde sa forme, bonus compris.
   */
  exitChance?: number
}

/**
 * Retourne le prochain état et un entier dans [1,6].
 *
 * Un seul tirage, quelles que soient les options : la suite reste la même pour
 * tout le monde, et une partie se rejoue à l'identique depuis sa graine.
 * Sans option, c'est un dé à six faces et rien d'autre.
 */
export function rollDie(state: number, options: RollOptions = {}): [number, number] {
  const [next, f] = nextFloat(state)
  const weights = weigh(options)

  let total = 0
  for (const w of weights) total += w

  let cursor = f * total
  for (let face = 1; face <= 6; face++) {
    cursor -= weights[face - 1]!
    if (cursor < 0) return [next, face]
  }
  // Inatteignable : `f` est dans [0,1). Le repli garde la fonction totale.
  return [next, 6]
}

/**
 * Le poids de chaque face. La pitié de sortie s'applique APRÈS le bonus, en
 * remontant la part des faces de sortie sans toucher aux proportions du reste :
 * un joueur bloqué qui dépense un bonus ne perd donc jamais au change.
 */
function weigh({ bias, exitFaces, exitChance = 0 }: RollOptions): number[] {
  const weights = [...(bias ? BIAS_WEIGHTS[bias] : FAIR_WEIGHTS)]
  if (exitChance <= 0 || !exitFaces?.length) return weights

  const isExit = (face: number): boolean => exitFaces.includes(face)
  let total = 0
  let exit = 0
  weights.forEach((w, i) => {
    total += w
    if (isExit(i + 1)) exit += w
  })
  // Aucune face ne sort, ou toutes : il n'y a rien à redistribuer.
  if (exit === 0 || exit === total) return weights

  const share = exit / total
  const wanted = Math.min(1, share + (1 - share) * exitChance)
  return weights.map((w, i) => (isExit(i + 1) ? (w / exit) * wanted : (w / (total - exit)) * (1 - wanted)))
}

/**
 * Mélange de Fisher-Yates, déterministe : retourne le prochain état et une
 * copie mélangée. Le tableau d'entrée n'est pas touché — l'état de la partie
 * est une valeur, pas un objet qu'on remue en place.
 */
export function shuffle<T>(state: number, items: readonly T[]): [number, T[]] {
  const out = [...items]
  let rng = state
  for (let i = out.length - 1; i > 0; i--) {
    const [next, f] = nextFloat(rng)
    rng = next
    const j = Math.floor(f * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return [rng, out]
}

/** Graine à partir d'une chaîne (le code de partie), pour que tous partent du même point. */
export function seedFrom(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h | 0
}
