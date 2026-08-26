/**
 * Grossir le plateau, et s'y promener.
 *
 * ## Pourquoi le plateau a besoin de ça
 *
 * Le plateau est carré et il occupe déjà toute la largeur de l'écran : sur un
 * téléphone tenu debout, ce n'est pas la hauteur qui le limite mais la largeur,
 * et il n'y a donc *rien* à lui reprendre. Comprimer l'en-tête, les cartes des
 * joueurs ou la ligne du dé n'agrandit pas le plateau d'un pixel — ça agrandit
 * le vide au-dessus et au-dessous.
 *
 * Or une croix de 360 px, c'est une case de 24 px ; un plateau rond, dont la
 * même largeur doit loger vingt et une cases, c'est une case de 16 px. À ce
 * régime, on ne compte plus les cases : on les devine. La seule façon de voir
 * réellement plus grand est donc de montrer *moins de plateau à la fois*.
 *
 * ## Pourquoi pas le zoom du navigateur
 *
 * Il marche — `index.html` refuse volontairement `user-scalable=no` — mais il
 * zoome la PAGE. Le dé, les cartes et la barre du haut grossissent avec le
 * plateau et sortent d'un écran qui, lui, ne défile jamais : on gagne un
 * plateau lisible et on perd le bouton qui permet de jouer. Le geste est donc
 * pris sur le cadre du plateau et rendu au plateau seul, qui grossit à
 * l'intérieur de son cadre pendant que tout le reste de l'écran ne bouge pas.
 *
 * ## Ce que ce fichier contient
 *
 * Le calcul, en fonctions pures et testables — bornes, recadrage, point fixe
 * d'un pincement — puis le liage aux événements, qui n'est que de la
 * plomberie. C'est le même partage que dans `swipe.ts`, et pour la même
 * raison : la géométrie d'un geste se vérifie, l'écoute d'un `pointerdown`
 * non.
 */

/** Au repos le plateau remplit déjà son cadre : il n'y a pas de « moins ». */
export const MIN_SCALE = 1
/**
 * Au-delà, on ne voit plus assez du plateau pour savoir où l'on est.
 *
 * Deux et demi, ce n'est pas un chiffre rond par hasard : c'est ce qu'il faut
 * pour amener la case d'un plateau rond (16 px) au-dessus des 40 px d'une
 * cible tactile confortable, sans descendre sous le quart de plateau visible —
 * en deçà, on perd de vue les chevaux qui arrivent par derrière.
 */
export const MAX_SCALE = 2.5
/** Le cran du double appui et du bouton : un plateau lisible en un geste. */
export const STEP_SCALE = 1.9
/** En deçà, le doigt n'a pas bougé : c'est un appui, et il vise un cheval. */
export const PAN_PX = 8
/** Deux appuis au même endroit dans cet intervalle : un double appui. */
export const DOUBLE_TAP_MS = 320
/** Et à moins de ça l'un de l'autre. */
export const DOUBLE_TAP_PX = 28

/** L'état du plateau : de combien il est grossi, et de combien il est décalé. */
export type View = { scale: number; x: number; y: number }

/** Le plateau au repos, entier dans son cadre. */
export const REST: View = { scale: 1, x: 0, y: 0 }

export const clampScale = (scale: number): number =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number.isFinite(scale) ? scale : MIN_SCALE))

/**
 * Le décalage admissible, dans un sens comme dans l'autre.
 *
 * Le plateau est posé en `translate(...) scale(...)` autour de son centre :
 * grossi de `s`, il déborde de `(s − 1) × côté / 2` de chaque côté du cadre.
 * C'est exactement ce qu'on peut promener — au-delà, on ferait entrer du vide
 * dans le cadre, et un bord blanc qui apparaît sous le doigt se lit comme un
 * plateau cassé plutôt que comme une limite.
 */
export const clampPan = (offset: number, scale: number, size: number): number => {
  const slack = ((clampScale(scale) - 1) * size) / 2
  if (!Number.isFinite(offset)) return 0
  return Math.min(slack, Math.max(-slack, offset))
}

/**
 * Le décalage qui garde un point immobile pendant que l'échelle change.
 *
 * `offset` est la distance de ce point au centre du cadre. Sans ce calcul, un
 * pincement grossit autour du centre du plateau : on écarte les doigts sur son
 * écurie et c'est le cœur du plateau qui vient sous les doigts, ce qui donne
 * l'impression que le plateau fuit le geste.
 */
export const focalPan = (pan: number, from: number, to: number, offset: number): number =>
  from <= 0 ? pan : offset - (to / from) * (offset - pan)

/** La vue, ramenée à ce que le cadre peut réellement montrer. */
export const settle = (view: View, size: number): View => {
  const scale = clampScale(view.scale)
  return { scale, x: clampPan(view.x, scale, size), y: clampPan(view.y, scale, size) }
}

/** Le plateau est-il grossi ? — la question que pose le bouton. */
export const zoomed = (scale: number): boolean => scale > MIN_SCALE + 0.001

/**
 * Grossir (ou revenir) en visant un point du cadre.
 *
 * `offset` se compte depuis le centre du cadre, comme dans `focalPan`. Le
 * bouton vise le centre, le double appui vise le doigt.
 */
export function zoomTo(view: View, size: number, scale: number, offset: { x: number; y: number }): View {
  const next = clampScale(scale)
  return settle(
    {
      scale: next,
      x: focalPan(view.x, view.scale, next, offset.x),
      y: focalPan(view.y, view.scale, next, offset.y),
    },
    size,
  )
}

/** Les deux doigts, résumés : leur écart, et leur milieu. */
export type Grip = { gap: number; x: number; y: number }

export const gripOf = (a: { x: number; y: number }, b: { x: number; y: number }): Grip => ({
  gap: Math.hypot(b.x - a.x, b.y - a.y),
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
})

/**
 * Ce qu'un pincement fait de la vue.
 *
 * Deux choses à la fois, et il faut les deux : l'écart des doigts donne
 * l'échelle, leur milieu donne le déplacement. Ne garder que l'écart, c'est un
 * zoom qu'on ne peut pas recadrer sans lever les doigts ; ne garder que le
 * milieu, c'est un glissement.
 */
export function pinch(view: View, size: number, from: Grip, to: Grip, centre: { x: number; y: number }): View {
  const scale = from.gap > 0 ? clampScale(view.scale * (to.gap / from.gap)) : view.scale
  return settle(
    {
      scale,
      x: focalPan(view.x, view.scale, scale, from.x - centre.x) + (to.x - from.x),
      y: focalPan(view.y, view.scale, scale, from.y - centre.y) + (to.y - from.y),
    },
    size,
  )
}

/** Le plateau qu'on promène au doigt, une fois grossi. */
export function pan(view: View, size: number, dx: number, dy: number): View {
  return settle({ scale: view.scale, x: view.x + dx, y: view.y + dy }, size)
}

/** Deux appuis assez rapprochés, dans le temps et sur l'écran. */
export const isDoubleTap = (
  previous: { at: number; x: number; y: number } | null,
  tap: { at: number; x: number; y: number },
): boolean =>
  previous !== null &&
  tap.at - previous.at <= DOUBLE_TAP_MS &&
  Math.hypot(tap.x - previous.x, tap.y - previous.y) <= DOUBLE_TAP_PX

// ─────────────────────────── le liage ───────────────────────────

export type BoardZoom = {
  /** Le grossissement courant — ce que le bouton affiche. */
  scale(): number
  /** Le bouton : un cran de plus, ou le retour au plateau entier. */
  toggle(): void
  /** Le plateau entier, tout de suite — et le geste en cours oublié. */
  reset(): void
  /**
   * Défait tout ce que `bindZoom` a posé.
   *
   * Ce n'est pas de la politesse : la suite d'un geste s'écoute sur la
   * FENÊTRE, qui survit à l'écran de partie. Sans ce détachement, chaque
   * plateau reconstruit — une manche de plus, un retour depuis les règles —
   * laisserait derrière lui trois écouteurs qui ne servent plus rien.
   */
  destroy(): void
}

type Options = {
  /** Le cadre qui découpe — c'est lui qui prend les gestes. */
  frame: HTMLElement
  /** La couche qui bouge. */
  layer: HTMLElement
  /** Appelé chaque fois que le grossissement change d'état visible. */
  onChange?: () => void
  /**
   * Ce qu'un appui ne doit jamais faire passer pour un double appui.
   *
   * Sur ce plateau, taper est le geste du JEU : c'est comme ça qu'on avance un
   * cheval. Deux chevaux touchés coup sur coup — ce qui arrive tout le temps —
   * tombaient dans la fenêtre du double appui, et le second appui grossissait
   * le plateau au lieu de jouer le coup. Un sélecteur plutôt qu'une
   * connaissance du plateau en dur : ce fichier n'a pas à savoir ce qu'est un
   * cheval.
   */
  ignore?: string
}

/**
 * Le plateau prend le pincement, le double appui et le déplacement au doigt.
 *
 * **Tant que le plateau est au repos, un doigt ne fait rien.** C'est la règle
 * qui rend le reste sans danger : un cheval se touche exactement comme avant,
 * et le geste ne lui vole rien. Le déplacement au doigt ne s'ouvre qu'une fois
 * le plateau grossi — c'est-à-dire au moment où il y a quelque chose à
 * déplacer, et où le joueur vient lui-même de le demander.
 */
export function bindZoom({ frame, layer, onChange, ignore }: Options): BoardZoom {
  let view: View = REST
  const points = new Map<number, { x: number; y: number }>()
  let grip: Grip | null = null
  let dragging: { id: number; x: number; y: number; moved: boolean } | null = null
  let lastTap: { at: number; x: number; y: number } | null = null
  /**
   * Ce geste a compté deux doigts, et il les compte jusqu'au dernier relevé.
   *
   * Sans ce drapeau, les deux doigts d'un pincement se lèvent à quelques
   * millisecondes et quelques pixels l'un de l'autre — c'est-à-dire pile dans
   * la fenêtre d'un double appui — et le second lever passait pour le second
   * appui du premier. Pincer pour REVENIR au plateau entier claquait donc le
   * zoom à sa valeur de repos au moment même où l'on relâchait, et deux doigts
   * simplement posés puis relevés faisaient sauter le plateau à 1,9.
   */
  let multi = false
  /** Un geste vient de déplacer le plateau : le clic qui suit n'en est pas un. */
  let swallowClick = false

  const size = (): number => frame.clientWidth || frame.getBoundingClientRect().width || 0
  const centre = (): { x: number; y: number } => {
    const box = frame.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  }

  const paint = (glide: boolean): void => {
    layer.classList.toggle('gliding', glide)
    layer.style.transform =
      view.scale === 1 && view.x === 0 && view.y === 0
        ? ''
        : `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
    frame.classList.toggle('zoomed', zoomed(view.scale))
  }

  const show = (next: View, glide = false): void => {
    const was = zoomed(view.scale)
    view = next
    paint(glide)
    if (was !== zoomed(view.scale)) onChange?.()
  }

  const two = (): Grip | null => {
    const [a, b] = [...points.values()]
    return a && b ? gripOf(a, b) : null
  }

  const onDown = (ev: PointerEvent): void => {
    // Un nouveau geste commence : ce que le précédent a laissé traîner est
    // périmé. `swallowClick` en particulier n'était remis à faux que par un
    // `click` qui arrivait — or un glissement franc n'en produit AUCUN sur
    // Android au-delà d'une quinzaine de pixels, et promener un plateau
    // grossi, c'est cent pixels. Le drapeau restait donc armé et mangeait le
    // premier appui suivant, celui qui visait un cheval.
    if (points.size === 0) swallowClick = false
    points.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
    if (points.size >= 2) {
      // Le second doigt annule le glissement en cours : on ne promène pas et
      // on ne pince pas en même temps, sinon le plateau part de travers au
      // moment précis où le second doigt se pose.
      dragging = null
      // Et il annule l'appui d'avant : un doigt posé, puis un second, ce n'est
      // pas le début d'un double appui, c'est le début d'un pincement.
      lastTap = null
      multi = true
      grip = two()
      return
    }
    if (points.size !== 1) return
    // Le plateau au repos laisse passer : le doigt vise un cheval.
    if (!zoomed(view.scale)) return
    dragging = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false }
  }

  const onMove = (ev: PointerEvent): void => {
    if (!points.has(ev.pointerId)) return
    points.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })

    if (points.size >= 2) {
      const next = two()
      if (grip && next) {
        show(pinch(view, size(), grip, next, centre()))
        grip = next
      }
      return
    }

    if (!dragging || dragging.id !== ev.pointerId) return
    const dx = ev.clientX - dragging.x
    const dy = ev.clientY - dragging.y
    if (!dragging.moved && Math.hypot(dx, dy) < PAN_PX) return
    // Le doigt a bougé pour de bon : à partir d'ici c'est un déplacement, et le
    // clic qui terminera le geste ne doit pas atteindre le cheval qu'il survole.
    dragging.moved = true
    swallowClick = true
    if (frame.setPointerCapture) {
      try {
        frame.setPointerCapture(ev.pointerId)
      } catch {
        // Un pointeur déjà relâché : rien à capturer, rien à réparer.
      }
    }
    dragging = { ...dragging, x: ev.clientX, y: ev.clientY }
    show(pan(view, size(), dx, dy))
  }

  const onUp = (ev: PointerEvent): void => {
    if (!points.has(ev.pointerId)) return
    const point = points.get(ev.pointerId)
    points.delete(ev.pointerId)
    // Recalculé, et non simplement effacé quand il ne reste plus qu'un doigt :
    // à trois contacts — deux doigts qui pincent et une paume qui effleure le
    // bord — lever l'un des deux laissait `grip` décrire un écart qui n'existe
    // plus, tandis que la prise suivante en désignait un autre. Le rapport des
    // deux envoyait le plateau au plafond au premier pixel de mouvement.
    grip = points.size >= 2 ? two() : null

    const wasDrag = dragging?.id === ev.pointerId && dragging.moved
    if (dragging?.id === ev.pointerId) dragging = null
    // Un doigt de pincement ne compte pas comme un appui, ni maintenant ni
    // pour le geste suivant. Le drapeau ne retombe qu'une fois la main
    // entièrement levée : sinon le second doigt, relâché seul, redeviendrait
    // un appui simple.
    const wasMulti = multi
    if (points.size === 0) multi = false
    if (wasDrag || wasMulti || !point) return

    // Un appui simple, plateau au repos ou non : c'est le double appui qu'on
    // guette. Le premier des deux laisse passer — il vise peut-être un cheval,
    // et rien ne dit encore qu'un second viendra.
    // Un appui qui visait un cheval n'est pas un candidat au double appui : il
    // joue un coup, et un second coup joué dans la foulée ne doit pas devenir
    // un zoom.
    const target = ev.target
    if (ignore && target instanceof Element && target.closest(ignore)) {
      lastTap = null
      return
    }

    const tap = { at: ev.timeStamp, x: ev.clientX, y: ev.clientY }
    if (isDoubleTap(lastTap, tap)) {
      lastTap = null
      const middle = centre()
      swallowClick = true
      show(
        zoomed(view.scale)
          ? REST
          : zoomTo(view, size(), STEP_SCALE, { x: tap.x - middle.x, y: tap.y - middle.y }),
        true,
      )
      return
    }
    lastTap = tap
  }

  const onCancel = (ev: PointerEvent): void => {
    if (!points.has(ev.pointerId)) return
    points.delete(ev.pointerId)
    grip = points.size >= 2 ? two() : null
    if (dragging?.id === ev.pointerId) dragging = null
    // Un geste que le système reprend — un appel qui arrive, une notification
    // qu'on tire — doit laisser la place aussi nette qu'un geste terminé.
    // Sinon `multi` restait vrai à jamais et il fallait trois appuis pour
    // obtenir un double appui, et `swallowClick` mangeait le suivant.
    if (points.size === 0) {
      multi = false
      swallowClick = false
    }
  }

  /*
   * En capture, et avant tout le monde : le clic remonte du cheval jusqu'ici,
   * et l'arrêter à l'arrivée serait l'arrêter trop tard. C'est le même patron
   * que le renvoi d'une feuille dans `swipe.ts`.
   */
  const onClick = (ev: Event): void => {
    if (!swallowClick) return
    swallowClick = false
    ev.stopPropagation()
    ev.preventDefault()
  }

  /*
   * Le geste commence sur le cadre, mais il finit où il veut : un doigt qui
   * sort du plateau, une souris relâchée à côté, un pointeur que le système
   * reprend. Écoutés sur le cadre seul, ces relâchements-là ne nous
   * parvenaient jamais et le doigt restait inscrit à vie — après quoi le
   * moindre appui comptait pour un deuxième contact, donc pour un pincement,
   * et le plateau grossissait tout seul sous un doigt qui ne demandait rien.
   *
   * La suite se ramasse donc au niveau de la fenêtre, et chaque écouteur
   * commence par vérifier que ce pointeur-là est bien l'un des nôtres.
   */
  frame.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  frame.addEventListener('click', onClick, true)

  /** Tout ce qu'un geste a laissé derrière lui. */
  const forget = (): void => {
    points.clear()
    grip = null
    dragging = null
    lastTap = null
    multi = false
    swallowClick = false
  }

  return {
    scale: () => view.scale,
    toggle: () =>
      show(zoomed(view.scale) ? REST : zoomTo(view, size(), STEP_SCALE, { x: 0, y: 0 }), true),
    reset: () => {
      forget()
      show(REST, true)
    },
    destroy: () => {
      forget()
      frame.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      frame.removeEventListener('click', onClick, true)
    },
  }
}
