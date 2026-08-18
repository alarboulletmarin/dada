/** Fabrique d'éléments minimale — évite de charger un framework pour trois écrans. */

export type Child = Node | string | number | null | undefined | false

type Props = {
  class?: string
  text?: string
  html?: string
  style?: Partial<CSSStyleDeclaration>
  attrs?: Record<string, string>
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (ev: HTMLElementEventMap[K]) => void }>
} & Record<string, unknown>

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  const { class: className, text, html, style, attrs, on, ...rest } = props

  if (className) el.className = className
  if (text !== undefined) el.textContent = text
  if (html !== undefined) el.innerHTML = html
  if (style) setStyle(el, style)
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  if (on) for (const [k, v] of Object.entries(on)) el.addEventListener(k, v as EventListener)
  Object.assign(el, rest)

  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    el.append(typeof child === 'object' ? child : String(child))
  }
  return el
}

/**
 * Applique un style inline. Les propriétés personnalisées (`--seat`) ne sont
 * pas des champs JS de `CSSStyleDeclaration` : une affectation directe est
 * ignorée sans erreur, il faut passer par `setProperty`.
 */
export function setStyle(el: HTMLElement, style: Partial<CSSStyleDeclaration>): void {
  for (const [k, v] of Object.entries(style)) {
    if (k.startsWith('--')) el.style.setProperty(k, String(v))
    else (el.style as unknown as Record<string, unknown>)[k] = v
  }
}

export function clear(el: HTMLElement): HTMLElement {
  el.replaceChildren()
  return el
}

/** Remplace le contenu d'un nœud en ignorant les enfants absents. */
export function fill(host: HTMLElement, ...children: Child[]): HTMLElement {
  host.replaceChildren(
    ...children.filter((c): c is Node | string | number => c !== null && c !== undefined && c !== false)
      .map((c) => (typeof c === 'object' ? c : String(c))),
  )
  return host
}

/** Empêche l'écran de s'éteindre pendant une partie ; sans effet si non supporté. */
export function keepAwake(enabled: boolean): void {
  const nav = navigator as Navigator & {
    wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> }
  }
  if (!nav.wakeLock) return

  if (!enabled) {
    void currentLock?.release().catch(() => {})
    currentLock = null
    return
  }
  if (currentLock) return

  nav.wakeLock
    .request('screen')
    .then((lock) => {
      currentLock = lock
    })
    .catch(() => {
      // Refusé (onglet en arrière-plan, batterie faible) : sans conséquence.
    })
}

let currentLock: { release: () => Promise<void> } | null = null

// iOS relâche le verrou dès que l'onglet passe en arrière-plan : on le reprend.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentLock === null && wantsAwake) keepAwake(true)
})

let wantsAwake = false
export function setKeepAwake(enabled: boolean): void {
  wantsAwake = enabled
  keepAwake(enabled)
}
