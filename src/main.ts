// Les fontes sont empaquetées avec l'app : la PWA doit garder son allure
// hors-ligne, sans dépendre d'un CDN de polices.
import '@fontsource/baloo-2/latin-700.css'
import '@fontsource/baloo-2/latin-800.css'
import '@fontsource/nunito/latin-600.css'
import '@fontsource/nunito/latin-700.css'
import '@fontsource/nunito/latin-800.css'
import './styles.css'
import { registerSW } from 'virtual:pwa-register'
import { App } from './ui/app.ts'
import { applyTheme, readTheme, watchSystemTheme } from './ui/theme.ts'

if (import.meta.env.DEV) {
  // En dev, un service worker laissé par un build précédent continue de servir
  // son cache sur le même hôte : la page s'ouvre sur l'ancienne version, voire
  // sur un écran vide. On le retire, et le cache avec, dès le chargement.
  void navigator.serviceWorker?.getRegistrations().then((all) => all.forEach((r) => void r.unregister()))
  void caches?.keys().then((keys) => keys.forEach((k) => void caches.delete(k)))
} else {
  // Le jeu doit démarrer même sans réseau : le service worker sert toute l'app
  // depuis le cache et se met à jour silencieusement au chargement suivant.
  registerSW({ immediate: true })
}

// Avant tout rendu : sinon l'écran clignote en clair puis bascule.
applyTheme(readTheme())
watchSystemTheme()

const root = document.getElementById('app')
if (root) new App(root).start()
