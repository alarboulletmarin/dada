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

/** Retourne le prochain état et un entier dans [1,6]. */
export function rollDie(state: number): [number, number] {
  const [next, f] = nextFloat(state)
  return [next, Math.floor(f * 6) + 1]
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
