/**
 * Chasser au doigt ce qui flotte devant l'écran.
 *
 * Les annonces, les messages et les feuilles apparaissent par-dessus la partie.
 * Certaines s'en vont d'elles-mêmes au bout de quelques secondes — et ces
 * quelques secondes sont exactement le problème : on a lu, on a compris, et il
 * faut attendre que ça veuille bien partir. Attendre quelque chose qu'on a fini
 * de lire est la forme la plus bête d'attente qu'une interface puisse imposer.
 *
 * Un doigt qui pousse doit donc suffire. Le geste suit le doigt — pas
 * d'animation qui se déclenche au relâchement : ce qui bouge sous le doigt est
 * ce qu'on manipule, et l'on voit qu'on peut le renvoyer avant même de l'avoir
 * fait. Un simple appui vaut aussi, pour ce qui n'a rien d'autre à offrir : la
 * moitié des gens tapent avant de balayer.
 *
 * ## Pourquoi `translate` et non `transform`
 *
 * Ces éléments-là portent déjà un `transform` qui les place — un `translateX`
 * de -50 % pour se centrer, le plus souvent. Écrire dedans effacerait leur
 * position, et le premier pixel de glissement les enverrait à gauche de
 * l'écran. La propriété `translate` est indépendante et se compose avec eux :
 * on écrit dans la nôtre, ils gardent la leur.
 */

/** Distance au-delà de laquelle un geste chasse, quelle que soit sa vitesse. */
export const DISMISS_PX = 44
/** Vitesse (px/ms) au-delà de laquelle une chiquenaude courte chasse aussi. */
export const DISMISS_SPEED = 0.45
/** En deçà, le doigt n'a pas bougé : c'est un appui, pas un glissement. */
export const TAP_PX = 6

/**
 * Ce geste-là chasse-t-il l'élément ?
 *
 * Deux façons d'y arriver, et il en faut deux : la distance, pour le doigt qui
 * pousse lentement et regarde ce qui se passe ; la vitesse, pour la chiquenaude
 * sèche qui ne parcourt que vingt pixels mais ne veut clairement pas dire
 * autre chose. N'en garder qu'une exclut la moitié des gens.
 */
export function dismisses(distance: number, elapsedMs: number): boolean {
  const travelled = Math.abs(distance)
  if (travelled >= DISMISS_PX) return true
  if (travelled < TAP_PX * 2) return false
  return elapsedMs > 0 && travelled / elapsedMs >= DISMISS_SPEED
}

/** Le doigt n'a pas bougé : l'intention est un appui. */
export const isTap = (dx: number, dy: number): boolean => Math.hypot(dx, dy) < TAP_PX

/**
 * Le geste est-il vertical ?
 *
 * À égalité, on tranche pour le vertical : ces éléments-là ne font rien de
 * l'horizontal, et un geste de biais doit marcher plutôt que de ne rien faire.
 */
export const isVertical = (dx: number, dy: number): boolean => Math.abs(dy) >= Math.abs(dx)

/** Sens dans lequel un élément accepte de partir. */
export type SwipeWay = 'any' | 'up' | 'down'

/** Le glissement retenu, une fois le sens interdit amorti. */
export function pull(dy: number, way: SwipeWay): number {
  const wrongWay = (way === 'up' && dy > 0) || (way === 'down' && dy < 0)
  // Un quart du mouvement dans le sens qui ne mène nulle part : l'élément
  // résiste sans se figer. Figé, on croit l'interface bloquée ; libre, on croit
  // qu'il va partir par là.
  return wrongWay ? dy * 0.25 : dy
}

type Options = {
  /** Ce qu'il faut faire quand le geste aboutit. Appelé une seule fois. */
  onDismiss: () => void
  /** Le sens accepté. Par défaut les deux. */
  way?: SwipeWay
  /** L'élément qui bouge, si ce n'est pas celui qu'on touche (poignée d'une feuille). */
  moves?: HTMLElement
  /** Un appui sans glissement chasse aussi. Vrai par défaut. */
  tapAway?: boolean
  /**
   * Par où sort un élément qu'on a simplement tapé.
   *
   * Par le plus court chemin hors de l'écran, c'est-à-dire par le bord dont il
   * est proche : une annonce posée en haut remonte, un message posé en bas
   * descend. Un message du bas qui sortirait par le haut traverserait tout
   * l'écran pour rien.
   */
  tapWay?: 'up' | 'down'
}

/**
 * Rend un élément renvoyable au doigt. Retourne de quoi tout détacher.
 *
 * Un appui qui commence sur un bouton de l'élément lui appartient : le ⓘ d'une
 * annonce ouvre le catalogue, il ne fait pas glisser l'annonce. Sans cette
 * réserve, tout enfant cliquable d'un élément balayable devient injouable.
 */
export function swipeAway(el: HTMLElement, options: Options): () => void {
  const {
    onDismiss,
    way = 'any',
    moves = el,
    tapAway = true,
    tapWay = way === 'down' ? 'down' : 'up',
  } = options
  let pointer: number | null = null
  let x0 = 0
  let y0 = 0
  let start = 0
  let shift = 0
  let dragged = false
  let gone = false

  const paint = (dy: number, fade: number): void => {
    moves.style.translate = `0 ${dy.toFixed(1)}px`
    moves.style.opacity = fade.toFixed(3)
  }

  const settle = (): void => {
    moves.style.transition = 'translate 0.16s ease-out, opacity 0.16s ease-out'
    moves.style.translate = ''
    moves.style.opacity = ''
    setTimeout(() => {
      moves.style.transition = ''
    }, 170)
  }

  const leave = (dy: number): void => {
    if (gone) return
    gone = true
    const out = dy < 0 ? -1 : 1
    moves.style.transition = 'translate 0.16s ease-in, opacity 0.16s ease-in'
    paint(out * (moves.offsetHeight + 60), 0)
    setTimeout(onDismiss, 160)
  }

  const onDown = (ev: PointerEvent): void => {
    if (pointer !== null || gone) return
    // Un bouton de l'élément garde son geste à lui.
    const hit = ev.target as Element | null
    if (hit && hit !== el && hit.closest('button, a, input, select, textarea')) return
    pointer = ev.pointerId
    x0 = ev.clientX
    y0 = ev.clientY
    start = ev.timeStamp
    shift = 0
    dragged = false
    // L'animation d'arrivée écrit dans `transform` ; la laisser courir pendant
    // qu'on tire ferait sautiller l'élément sous le doigt.
    moves.style.animation = 'none'
    moves.style.transition = ''
    el.setPointerCapture(ev.pointerId)
  }

  const onMove = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointer) return
    const dx = ev.clientX - x0
    const dy = ev.clientY - y0
    if (!dragged) {
      if (isTap(dx, dy)) return
      // Un geste horizontal ne nous appartient pas : on le rend au navigateur,
      // qui a peut-être une page à faire défiler dessous.
      if (!isVertical(dx, dy)) {
        el.releasePointerCapture(ev.pointerId)
        pointer = null
        return
      }
      dragged = true
    }
    shift = pull(dy, way)
    // L'élément pâlit à mesure qu'il s'en va : à mi-chemin, on sait déjà que
    // lâcher le fera partir.
    paint(shift, Math.max(0.25, 1 - Math.abs(shift) / (DISMISS_PX * 2.4)))
  }

  const onUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointer) return
    pointer = null
    const elapsed = ev.timeStamp - start
    if (!dragged) {
      if (tapAway) leave(tapWay === 'down' ? 1 : -1)
      return
    }
    const wrongWay = (way === 'up' && shift > 0) || (way === 'down' && shift < 0)
    if (!wrongWay && dismisses(shift, elapsed)) leave(shift)
    else settle()
  }

  const onCancel = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointer) return
    pointer = null
    settle()
  }

  // Un glissement ne doit pas se terminer en clic : sans ce filtre, chasser une
  // annonce d'un doigt qui passe sur son ⓘ ouvrirait le catalogue au passage.
  const onClick = (ev: MouseEvent): void => {
    if (dragged) {
      ev.stopPropagation()
      ev.preventDefault()
    }
  }

  el.style.touchAction = 'none'
  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onCancel)
  el.addEventListener('click', onClick, true)

  return () => {
    el.removeEventListener('pointerdown', onDown)
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onCancel)
    el.removeEventListener('click', onClick, true)
  }
}
