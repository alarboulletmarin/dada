/**
 * Thème clair / sombre.
 *
 * Trois états et non deux : « auto » suit le réglage du téléphone, et c'est le
 * défaut. Un choix explicite pose `data-theme` sur la racine, ce que la feuille
 * de style sait honorer dans les deux sens.
 */

const KEY = 'dada.theme'

export type Theme = 'auto' | 'light' | 'dark'

const THEMES: Theme[] = ['auto', 'light', 'dark']

/** Couleur de la barre système, pour que le navigateur suive le jeu. */
const BAR: Record<'light' | 'dark', string> = { light: '#FBF2DF', dark: '#1E1712' }

export const THEME_LABEL: Record<Theme, string> = {
  auto: 'Auto',
  light: 'Clair',
  dark: 'Sombre',
}

export const THEME_ICON: Record<Theme, string> = { auto: '◐', light: '☀', dark: '☾' }

export function readTheme(): Theme {
  const saved = localStorage.getItem(KEY)
  return THEMES.includes(saved as Theme) ? (saved as Theme) : 'auto'
}

/** Ce qu'on voit réellement à l'écran, une fois « auto » résolu. */
export function resolvedTheme(theme: Theme = readTheme()): 'light' | 'dark' {
  if (theme !== 'auto') return theme
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  localStorage.setItem(KEY, theme)

  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', BAR[resolvedTheme(theme)])
}

/** Fait tourner auto → clair → sombre → auto. */
export function nextTheme(theme: Theme = readTheme()): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!
}

/** En mode auto, un changement de réglage système doit suivre immédiatement. */
export function watchSystemTheme(): void {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (readTheme() === 'auto') applyTheme('auto')
  })
}
