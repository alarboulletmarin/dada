/**
 * Le jeu d'icônes du Dada — dessiné ici, et nulle part ailleurs.
 *
 * Pas d'emoji : leur dessin appartient au système, pas au jeu. Le même ℹ️ est
 * un rond bleu sur un téléphone, un carré blanc sur un autre, et rien du tout
 * sur un troisième — impossible de tenir une direction artistique là-dessus.
 * Pas de bibliothèque non plus (Material, Lucide et les autres) : leur trait
 * fin et leurs bouts carrés jurent avec des contours d'encre de 3 px, et ce
 * serait une dépendance de plus pour la vingtaine de glyphes d'un jeu de dés.
 *
 * Tout est donc tracé à la même main que le reste : grille de 24,
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
  /** La bulle de chat : un rectangle arrondi et sa pointe. Le corps est haut et
   *  la queue courte et ramenée vers le milieu — dessinée plus plate et plus à
   *  gauche, la bulle penchait visiblement vers le coin haut-gauche de son
   *  bouton, alors même que sa boîte était centrée. */
  chat: '<rect x="3.4" y="4" width="17.2" height="12.2" rx="4.2"/><path d="M9.2 16.2v3l3.4-3"/>',
  /** Mettre en pause : deux barres pleines, comme sur un magnétophone. */
  pause:
    '<rect x="7.6" y="4.8" width="3" height="14.4" rx="1.5" fill="currentColor" stroke-linejoin="round"/><rect x="13.4" y="4.8" width="3" height="14.4" rx="1.5" fill="currentColor" stroke-linejoin="round"/>',
  /** Reprendre : le triangle, plein lui aussi. */
  play: '<path d="M8.6 5.4 19 12 8.6 18.6Z" fill="currentColor" stroke-linejoin="round"/>',

  /* Les sept pouvoirs. Un dessin par carte : dans un paquet, on reconnaît une
     carte à sa figure bien avant de lire son nom. */
  /** Bouclier : l'écu, pointe en bas. */
  shield: '<path d="M12 3.4 19.4 6v5.9c0 4.1-2.9 7.2-7.4 8.7-4.5-1.5-7.4-4.6-7.4-8.7V6Z"/>',
  /** Galop : deux chevrons lancés vers l'avant. */
  gallop: '<path d="M5.4 6.8 10.6 12l-5.2 5.2"/><path d="M13 6.8 18.2 12 13 17.2"/>',
  /** Rejeu : la flèche qui fait le tour et revient. */
  replay: '<path d="M20 12a8 8 0 1 1-2.7-6"/><path d="M20.4 3.6v4.6h-4.6"/>',
  /** Dé pipé : le dé et ses trois points en diagonale. */
  loaded:
    '<rect x="4" y="4" width="16" height="16" rx="4.5"/><path d="M8.6 8.6v.1"/><path d="M12 12v.1"/><path d="M15.4 15.4v.1"/>',
  /** Faux pas : les mêmes chevrons, mais à contresens. */
  stumble: '<path d="M18.6 6.8 13.4 12l5.2 5.2"/><path d="M11 6.8 5.8 12 11 17.2"/>',
  /** Tour sauté : le rond barré — rien ne se passe. */
  skip: '<circle cx="12" cy="12" r="8.4"/><path d="M6.1 17.9 17.9 6.1"/>',
  /** Retour à l'écurie : le toit et la porte. */
  stable: '<path d="M3.8 10.9 12 4.2l8.2 6.7v8.9H3.8Z"/><path d="M9.4 19.8v-4.7h5.2v4.7"/>',

  /** Le QR code : ses trois repères d'angle, et quelques modules. C'est à ses
   *  coins qu'on reconnaît un QR — un damier complet, à cette taille, ne
   *  ferait qu'une tache grise. */
  qr:
    '<rect x="3.4" y="3.4" width="7.2" height="7.2" rx="1.8"/><rect x="13.4" y="3.4" width="7.2" height="7.2" rx="1.8"/><rect x="3.4" y="13.4" width="7.2" height="7.2" rx="1.8"/><path d="M13.4 13.4v.1M20.6 13.4v.1M17 17v.1M13.4 20.6v.1M20.6 20.6v.1"/>',

  /** Envoyer : l'avion de papier, plié en deux traits. */
  send: '<path d="M20.6 3.4 3.9 9.7a.6.6 0 0 0 0 1.1l6.7 2.6 2.6 6.7a.6.6 0 0 0 1.1 0Z"/><path d="M10.6 13.4 20.6 3.4"/>',
} as const

export type IconName = keyof typeof ICONS

/**
 * Recalage optique, en unités de la grille de 24.
 *
 * Une icône centrée n'est pas une icône dont la boîte est centrée : l'œil vise
 * la masse d'encre, pas les extrémités. Un chevron dont la pointe est à gauche,
 * un croissant dont le ventre est en bas, un point d'interrogation dont la
 * boucle occupe tout le haut — tous se lisent de travers dans un bouton carré
 * alors que leur boîte tombe juste.
 *
 * Chaque valeur ci-dessous a été mesurée puis vérifiée à l'œil dans le bouton
 * réel, à sa taille réelle : c'est la moitié de l'écart entre le centre de la
 * boîte encrée et le centre de masse, la règle habituelle du métier. Les
 * silhouettes symétriques — disque, croix, soleil, globe — n'y figurent pas :
 * pour elles l'œil vise le contour, et les décaler ferait exactement le
 * contraire de ce qu'on cherche.
 */
const NUDGE: Partial<Record<IconName, readonly [number, number]>> = {
  back: [0.6, 0],
  // Le corps de la bulle porte presque toute l'encre et la queue ne pèse rien :
  // même redessinée haute, elle reste lourde du haut et demande à descendre.
  chat: [0, 0.6],
  help: [-0.3, 0.7],
  moon: [1.2, -1.2],
  bolt: [0.5, 0],
  send: [-0.7, 0.7],
  // Le triangle du « reprendre » : toute sa masse est du côté de sa base, et
  // sa boîte se lit donc décalée à gauche dans un bouton rond.
  play: [0.9, 0],
  // L'écu s'affine vers le bas : il pèse du haut, et demande à descendre.
  shield: [0, 0.4],
}

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
  const shift = NUDGE[name]
  if (!shift) {
    svg.innerHTML = ICONS[name]
    return svg
  }
  // Le recalage est porté par un groupe et non par chaque tracé : le dessin
  // reste lisible tel qu'il a été composé, et la correction se lit à part.
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  group.setAttribute('transform', `translate(${shift[0]} ${shift[1]})`)
  group.innerHTML = ICONS[name]
  svg.append(group)
  return svg
}
