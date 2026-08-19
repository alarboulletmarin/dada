/**
 * Le jeu d'icônes du Dada — dessiné ici, et nulle part ailleurs.
 *
 * Pas d'emoji : leur dessin appartient au système, pas au jeu. Le même ℹ️ est
 * un rond bleu sur un téléphone, un carré blanc sur un autre, et rien du tout
 * sur un troisième — impossible de tenir une direction artistique là-dessus.
 * Pas de bibliothèque non plus (Material, Lucide et les autres) : leur trait
 * fin et leurs bouts carrés jurent avec des contours d'encre de 3 px, et ce
 * serait une dépendance de plus pour douze glyphes.
 *
 * Douze traits, donc, tracés à la même main que le reste : grille de 24,
 * trait épais, bouts et coins ronds, `currentColor` pour que chaque icône
 * prenne la couleur du bloc qui la porte.
 */

const STROKE = 2.5

/** Les tracés. `fill` marque les icônes pleines, qui n'ont pas de contour. */
const ICONS = {
  back: '<path d="M15 4.5 7.5 12 15 19.5"/>',
  close: '<path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/>',
  check: '<path d="M5.5 12.5 10 17.5 18.5 6.5"/>',
  /** Le point d'interrogation des règles : la boucle, puis le point. */
  help: '<path d="M8.5 8.6a3.6 3.6 0 1 1 3.6 3.9v2.2"/><path d="M12.1 18.6v.1"/>',
  /** Deux feuillets décalés : copier. */
  copy: '<rect x="8.5" y="3.5" width="12" height="14" rx="3.5"/><path d="M15.5 20.5H6.6a3 3 0 0 1-3-3V7.5"/>',
  /** Le globe des langues : le disque, l'équateur, un méridien penché. */
  globe:
    '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.4 3.6 5.3 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.3-3.6-8.5S9.6 5.9 12 3.5Z"/>',
  /** Le « i » des mentions : la barre et son point, dans un disque. */
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.6v.1"/>',
  /** L'éclair de la variante rapide : plein, pour tenir dans une pastille. */
  bolt: '<path d="M13.6 2.5 5.4 13.2h5.2l-1.2 8.3 8.2-10.7h-5.2l1.2-8.3Z" fill="currentColor" stroke-linejoin="round"/>',
  /** Thème clair : le disque et ses huit rais. */
  sun: '<circle cx="12" cy="12" r="4.4"/><path d="M12 1.8v2.6M12 19.6v2.6M22.2 12h-2.6M4.4 12H1.8M19.2 4.8l-1.9 1.9M6.7 17.3l-1.9 1.9M19.2 19.2l-1.9-1.9M6.7 6.7 4.8 4.8"/>',
  /** Thème sombre : le croissant. */
  moon: '<path d="M20 14.4A8.6 8.6 0 0 1 9.6 4a8.7 8.7 0 1 0 10.4 10.4Z"/>',
  /** Thème auto : le disque à moitié encré, comme un jour et une nuit. */
  auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" stroke="none"/>',
  /** L'étoile des cases sûres : quatre branches, comme une éclaboussure d'encre. */
  star: '<path d="M12 2.4c.7 4.6 2.6 6.5 7.2 7.2-4.6.7-6.5 2.6-7.2 7.2-.7-4.6-2.6-6.5-7.2-7.2 4.6-.7 6.5-2.6 7.2-7.2Z" fill="currentColor" stroke-linejoin="round" transform="translate(0 2.4)"/>',
  /** La bulle de chat : un rectangle arrondi et sa pointe. */
  chat: '<rect x="3.5" y="4.5" width="17" height="11" rx="4"/><path d="M8 15.5v3.6l4-3.6"/>',
  /** Envoyer : l'avion de papier, plié en deux traits. */
  send: '<path d="M20.6 3.4 3.9 9.7a.6.6 0 0 0 0 1.1l6.7 2.6 2.6 6.7a.6.6 0 0 0 1.1 0Z"/><path d="M10.6 13.4 20.6 3.4"/>',
} as const

export type IconName = keyof typeof ICONS

/**
 * Une icône, prête à poser dans un bouton.
 *
 * `aria-hidden` par défaut : dans ce jeu une icône double toujours un libellé
 * ou un `aria-label`, jamais elle ne porte seule le sens. Un lecteur d'écran
 * qui l'annoncerait ne ferait que répéter.
 */
export function icon(name: IconName, size = 22): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', String(STROKE))
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.classList.add('ico')
  // Le contenu vient de la table ci-dessus : aucune donnée extérieure ne passe
  // par ici, et `innerHTML` reste la seule façon de poser des tracés en un coup.
  svg.innerHTML = ICONS[name]
  return svg
}
