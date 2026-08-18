/**
 * La mise à jour de l'app installée, et la sortie de secours.
 *
 * Le service worker est enregistré en mode « prompt » (voir `vite.config.ts`) :
 * une nouvelle version s'installe, précache, puis **attend**. Rien ne bouge tant
 * que personne n'a dit oui. La raison est propre à ce jeu : une partie en ligne
 * est un lien WebRTC entre plusieurs téléphones, et recharger le rompt — pour
 * soi, et pour les autres qui attendent l'arbitre.
 *
 * D'où deux sorties, et aucune troisième. « Recharger » donne la main au worker
 * en attente, qui s'active et fait recharger la page. « Plus tard » range le
 * bandeau : l'ancienne version continue de tourner, la nouvelle reste en
 * attente, et la proposition revient au prochain démarrage.
 *
 * `clearAppCaches` est autre chose : le geste de dernier recours quand c'est
 * l'app cachée elle-même qui est cassée. Recharger la ressert à l'identique ;
 * seul un désenregistrement du worker et un vidage des caches la fait
 * retélécharger. Il ne touche à aucune donnée de jeu.
 */

import { registerSW } from 'virtual:pwa-register'
import { h } from './dom.ts'
import { lang } from './i18n.ts'

/**
 * Une heure. Assez rare pour ne rien coûter, assez fréquent pour qu'une version
 * publiée le matin soit proposée dans la journée.
 */
const CHECK_INTERVAL_MS = 60 * 60 * 1000

/**
 * Les textes vivent ici et non dans `i18n.ts`, à dessein : ce module doit
 * pouvoir s'afficher même le jour où le catalogue change de forme, puisque
 * c'est précisément lui qui sert à sortir d'une version cassée. Quatre lignes,
 * et elles n'ont pas de raison de bouger.
 */
const TEXT = {
  fr: {
    message: 'Une nouvelle version est prête.',
    reload: 'Recharger',
    later: 'Plus tard',
  },
  en: {
    message: 'A new version is ready.',
    reload: 'Reload',
    later: 'Later',
  },
} as const

/**
 * Le navigateur ne recompare `sw.js` que lorsqu'il charge une page. Une app
 * installée, elle, n'en charge plus : on la *reprend* là où on l'avait laissée,
 * parfois des jours plus tard. Sans relance explicite, la version publiée
 * entre-temps n'arrive jamais avant la vérification périodique du navigateur
 * (~24 h) — c'est-à-dire jamais, sur un téléphone.
 *
 * Redemander est sûr par construction : `update()` ne peut qu'installer un
 * worker de plus dans l'état `waiting`. Sans `skipWaiting` nulle part, rien ne
 * l'active que le bouton ci-dessous.
 */
function watchForUpdate(registration: ServiceWorkerRegistration | undefined): void {
  if (!registration) return

  const check = (): void => {
    // Redemander pendant une installation la relancerait pour rien ; hors ligne,
    // la requête échouerait à coup sûr.
    if (registration.installing || !navigator.onLine) return
    void registration.update().catch(() => {})
  }

  // Revenir sur l'app est le moment où la question se pose : c'est là qu'on la
  // repose, plutôt qu'à l'aveugle toutes les heures seulement.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
  window.setInterval(check, CHECK_INTERVAL_MS)
}

/**
 * Enregistre le service worker et pose le bandeau quand une version attend.
 *
 * À appeler une seule fois, au démarrage. Le bandeau s'ajoute directement au
 * `<body>`, au-dessus des écrans : il ne dépend d'aucun écran en particulier et
 * survit donc aux changements de vue.
 */
export function mountUpdatePrompt(): void {
  let banner: HTMLElement | null = null

  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW: (_url, registration) => watchForUpdate(registration),
    onNeedRefresh: () => {
      if (banner) return
      banner = renderBanner(
        () => {
          /*
           * Donner la main au worker en attente, puis recharger.
           *
           * Le rechargement est normalement l'affaire du module
           * d'enregistrement, qui écoute le changement de contrôleur. Il s'en
           * abstient dans un cas : la page qui a installé le tout premier
           * worker n'était contrôlée par personne au départ, et il n'y voit donc
           * pas une mise à jour. Le worker s'active, la page reste sur
           * l'ancienne version, et le bandeau ne s'en va plus.
           *
           * D'où ce second rechargement, armé au clic seulement : `clientsClaim`
           * change lui aussi de contrôleur à la première visite, et recharger
           * sur ce signal-là sans y avoir été invité tournerait en boucle.
           */
          navigator.serviceWorker?.addEventListener(
            'controllerchange',
            () => window.location.reload(),
            { once: true },
          )
          void updateSW()
        },
        () => {
          banner?.remove()
          banner = null
        },
      )
      document.body.append(banner)
    },
  })
}

function renderBanner(onReload: () => void, onLater: () => void): HTMLElement {
  const text = TEXT[lang()]

  return h(
    'div',
    { class: 'update-bar', attrs: { role: 'status', 'aria-live': 'polite' } },
    h('p', { class: 'update-bar__message', text: text.message }),
    h(
      'div',
      { class: 'update-bar__actions' },
      h('button', {
        class: 'btn small',
        type: 'button',
        text: text.later,
        on: { click: onLater },
      }),
      h('button', {
        class: 'btn small blue',
        type: 'button',
        text: text.reload,
        on: { click: onReload },
      }),
    ),
  )
}

/**
 * Vide les caches de l'app et désenregistre les service workers.
 *
 * Ce qu'il faut pour sortir d'un écran blanc qui se reproduit à l'identique :
 * le worker sert l'app depuis son cache, une version cassée y reste, et
 * recharger la ressert. L'appelant recharge ensuite.
 *
 * Il ne touche **pas** au `localStorage` : ni le nom du joueur, ni la partie
 * sauvegardée, ni la langue. C'est ce qu'un libellé doit promettre, et la seule
 * raison pour laquelle on ose le proposer à quelqu'un qui vient de voir l'app
 * casser.
 */
export async function clearAppCaches(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
  }
  if ('caches' in globalThis) {
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
  }
}

/** Sans service worker, il n'y a rien à réinstaller — donc rien à proposer. */
export function canClearAppCaches(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}
