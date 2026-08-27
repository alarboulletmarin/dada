/**
 * Rendu du plateau.
 *
 * La grille des cases est construite une seule fois ; seuls les pions bougent,
 * sur une couche séparée positionnée en `transform`. Un déplacement est joué
 * case par case plutôt qu'en ligne droite : c'est ce qui permet de « compter »
 * le dé des yeux et de comprendre ce qui vient de se passer.
 *
 * **Tout est posé en pourcentage, pas en grille CSS.** L'ancien plateau était
 * une `grid` de 15×15 et chaque case une cellule ; c'était plus court à écrire,
 * mais cela interdisait tout ce qui ne tombe pas sur un entier — donc le rond
 * et le serpent. Une case connaît maintenant son coin haut-gauche en unités de
 * case, éventuellement flottant, et se pose en `left`/`top`/`width`/`height`.
 *
 * Le dessin suit la maquette « plateau illustré » : circuit ivoire cerné
 * d'encre, écuries pleines couleur, cœur en moulin à quatre pointes.
 */

import { cellOf, geometryFor, type BoardGeometry, type Cell } from '../game/board.ts'
import { pawnSlot } from '../game/engine.ts'
import { STABLE, type GameState, type Move, type Seat, type Variant } from '../game/types.ts'
import { t } from './i18n.ts'
import { bindZoom, zoomed, type BoardZoom } from './zoom.ts'

const SEATS: Seat[] = [0, 1, 2, 3]
/**
 * Le temps entre deux pas d'un cheval qui marche.
 *
 * Le CSS le reçoit (voir `--step`) plutôt que de le recopier : la transition
 * d'un pion doit rester plus COURTE que cet intervalle, sinon chaque
 * interpolation est coupée par la suivante et le cheval ne se pose jamais
 * visiblement sur une case. Deux nombres écrits dans deux fichiers finissent
 * toujours par se contredire ; celui-ci n'existe donc qu'ici.
 */
const STEP_MS = 115
/**
 * Le temps que dure l'impact, avant que le cheval mangé ne rentre.
 *
 * Il ne rentre qu'ici, et c'est tout l'objet de ce délai : l'écran plaçait les
 * chevaux à leur position finale **avant** de faire marcher celui qui avance,
 * si bien que la victime rentrait à l'écurie pendant que son bourreau était
 * encore à quatre cases de là. On savait qu'on allait se faire manger une
 * seconde avant de l'être — la seule chose que le jeu n'avait pas à dire.
 */
const STRUCK_MS = 200
/**
 * Le temps d'arrêt sur la case pouvoir, avant que la carte ne pousse le cheval.
 *
 * Sans lui, le cheval avance de six et recule de trois d'un seul élan : on lit
 * un déplacement de trois, et la case pouvoir n'a l'air de rien avoir fait.
 * C'est ce battement qui sépare « je suis arrivé ici » de « et voilà ce que la
 * case m'a fait ».
 */
const POWER_HOLD_MS = 420
const key = (c: Cell) => `${c.col.toFixed(3)},${c.row.toFixed(3)}`

/** Angle, en degrés depuis le haut et dans le sens horaire, de `from` vers `to`. */
const headingBetween = (from: Cell, to: Cell): number =>
  (Math.atan2(to.col - from.col, from.row - to.row) * 180) / Math.PI

/**
 * Le rayon de la ronde des chevaux qui partagent une case, en % de case.
 *
 * Vingt-sept : c'est ce qui met deux chevaux à 54 % l'un de l'autre, pour des
 * disques rétrécis à 62 % — ils se touchent, ils ne se cachent pas. Au-delà,
 * la ronde mordrait franchement sur les cases voisines et l'on ne saurait plus
 * de quelle case on parle ; à vingt-sept, elle en dépasse déjà de deux
 * pixels, ce que le trait d'encre des cases suffit à rattraper.
 *
 * Le rayon ne bouge pas avec le nombre — c'est le DISQUE qui rétrécit (voir
 * `.pawn.shared` dans la feuille de style, alimenté par `--share-n`). Élargir
 * la ronde à cinq ou huit chevaux l'aurait fait déborder d'autant ; la
 * rétrécir aurait déplacé les deux chevaux du cas courant, qui est cent fois
 * plus fréquent que tous les autres réunis.
 */
const SHARE_RADIUS = 27

/**
 * La place du `i`-ième cheval d'une case qui en porte `n`, en % de case.
 *
 * Deux chevaux se posent côte à côte, horizontalement : c'est le cas de loin
 * le plus fréquent, et une paire verticale se lit moins bien qu'une paire
 * horizontale sur un plateau dont les couloirs sont verticaux. Au-delà, une
 * ronde, la première place en haut.
 */
/** Le décalage d'un cheval sur sa case, et combien ils y tiennent ensemble. */
type Offset = { x: number; y: number; n: number }

/** Un cheval seul sur sa case. */
const ALONE: Offset = { x: 0, y: 0, n: 1 }

export function sharedOffset(i: number, n: number): { x: number; y: number } {
  if (n <= 1) return { x: 0, y: 0 }
  if (n === 2) return { x: i === 0 ? -SHARE_RADIUS : SHARE_RADIUS, y: 0 }
  const angle = (i / n) * 2 * Math.PI - Math.PI / 2
  return {
    x: Math.round(Math.cos(angle) * SHARE_RADIUS * 100) / 100,
    y: Math.round(Math.sin(angle) * SHARE_RADIUS * 100) / 100,
  }
}

export class BoardView {
  private board: HTMLElement
  private layer: HTMLElement
  private pawns = new Map<string, HTMLElement>()
  /** Dernière position connue de chaque pion, pour savoir quoi animer. */
  private previous = new Map<string, number>()
  private animating = false
  private pending: (() => void) | null = null
  /** Ce qui attend que le plateau ait fini de bouger. Voir `settled`. */
  private settlers: (() => void)[] = []
  /** Ce qui doit se jouer pendant l'arrêt sur la case pouvoir. Voir `onPowerHold`. */
  private holding: ((pawnId: string) => Promise<void>) | null = null
  private geometry: BoardGeometry

  private root: HTMLElement
  /** Ce qui grossit quand on pince : la grille et les chevaux ensemble. */
  private view: HTMLElement
  private zoom: BoardZoom
  private zoomListener: (() => void) | null = null

  constructor(root: HTMLElement, private variant: Variant) {
    this.root = root
    this.geometry = geometryFor(this.variant)
    root.classList.add('board-wrap')
    root.style.setProperty('--grid', String(this.geometry.grid))
    root.style.setProperty('--step', `${STEP_MS}ms`)
    // Une couche entre le cadre et le dessin. Le zoom s'y pose d'un seul
    // `transform` : sur la grille et sur les chevaux séparément, il faudrait
    // l'écrire deux fois et les tenir d'accord au pixel près pendant qu'un
    // cheval marche.
    this.view = document.createElement('div')
    this.view.className = 'board-view'
    root.append(this.view)
    this.board = this.buildGrid()
    this.view.append(this.board)
    this.layer = document.createElement('div')
    this.layer.className = 'pawns'
    this.view.append(this.layer)
    this.zoom = bindZoom({
      frame: root,
      layer: this.view,
      onChange: () => this.zoomListener?.(),
      // Toucher un cheval, c'est jouer un coup. Deux chevaux touchés coup sur
      // coup — la chose la plus ordinaire du jeu — tombaient dans la fenêtre
      // du double appui, et le second grossissait le plateau au lieu de jouer.
      ignore: '.pawn',
    })
  }

  /**
   * Pose un élément sur le plateau. `col`/`row` sont le coin haut-gauche en
   * unités de case, `w`/`h` la taille dans la même unité — tous flottants.
   */
  private at(
    className: string,
    col: number,
    row: number,
    w = 1,
    h = 1,
    seat: Seat | null = null,
    rot = 0,
  ): HTMLElement {
    const grid = this.geometry.grid
    const el = document.createElement('div')
    el.className = className
    const pc = (n: number) => `${(n / grid) * 100}%`
    el.style.left = pc(col)
    el.style.top = pc(row)
    el.style.width = pc(w)
    el.style.height = pc(h)
    if (rot) el.style.setProperty('--tilt', `${rot}deg`)
    if (seat !== null) {
      el.style.setProperty('--seat', `var(--seat-${seat})`)
      el.style.setProperty('--on', `var(--on-${seat})`)
      el.dataset.seat = String(seat)
    }
    this.board.append(el)
    return el
  }

  private buildGrid(): HTMLElement {
    const board = document.createElement('div')
    board.className = `board shape-${this.geometry.shape}`
    this.board = board

    // Le plateau ne doit annoncer que les règles réellement appliquées : une
    // étoile dessinée là où rien ne protège est un mensonge.
    const geo = this.geometry
    const safeStars = this.variant.starSquaresAreSafe
    const starts = new Map(SEATS.map((s) => [geo.startIndex[s], s]))
    // Chaque case étoile est le relais d'un camp : elle en prend la couleur.
    // `starIndices` est construit siège par siège, dans l'ordre des sièges.
    const starOwner = new Map(geo.starIndices.map((index, seat) => [index, seat as Seat]))

    // 1. Le circuit commun : trait fin entre deux cases, trait d'encre sur les
    //    cases qui comptent (départ, étoile, pouvoir).
    geo.track.forEach((c, i) => {
      const next = geo.track[(i + 1) % geo.track.length]!
      const heading = headingBetween(c, next)
      const startSeat = starts.get(i)

      if (startSeat !== undefined) {
        // Une flèche dans le sens de la marche : le plateau explique lui-même
        // par où l'on part et dans quel sens on tourne.
        const cell = this.at('cell start', c.col, c.row, 1, 1, startSeat, c.rot ?? 0)
        const arrow = document.createElement('i')
        // La flèche est dessinée pointe à droite ; `heading` compte depuis le
        // haut. Sur un plateau courbe, la case est déjà inclinée : on retire
        // son inclinaison pour ne pas la compter deux fois.
        arrow.style.setProperty('--rot', `${heading - 90 - (c.rot ?? 0)}deg`)
        cell.append(arrow)
      } else if (safeStars && starOwner.has(i)) {
        this.at('cell safe', c.col, c.row, 1, 1, starOwner.get(i)!, c.rot ?? 0)
      } else if (geo.powerIndexSet.has(i)) {
        this.at('cell power', c.col, c.row, 1, 1, null, c.rot ?? 0).append(
          document.createElement('i'),
        )
      } else this.at('cell', c.col, c.row, 1, 1, null, c.rot ?? 0)
    })

    // 2. Les écuries : bloc plein, enclos ivoire, emplacements pointillés.
    //    Le retrait de l'enclos est une fraction du bloc et non une case
    //    pleine : les écuries d'un plateau rond tiennent dans un coin de trois
    //    cases et demie, où un retrait fixe ne laisserait plus d'enclos du tout.
    for (const seat of SEATS) {
      const box = geo.stableBox[seat]
      const inset = box.size * 0.16
      this.at('deco stable', box.col, box.row, box.size, box.size, seat)
      this.at('deco pen', box.col + inset, box.row + inset, box.size - 2 * inset, box.size - 2 * inset, seat)
      for (const slot of geo.stableSlots[seat]) this.at('deco slot', slot.col, slot.row, 1, 1, seat)
    }

    // 3. Le cœur, posé AVANT les escaliers : sur les plateaux où les angles du
    //    carré central sont libres, il occupe trois cases sur trois, et les
    //    dernières marches des escaliers viennent alors se poser dessus. Une
    //    pointe par camp, tournée vers le couloir d'où il arrive.
    const size = geo.centerSize
    const center = this.at(
      'deco center',
      geo.center.col - (size - 1) / 2,
      geo.center.row - (size - 1) / 2,
      size,
      size,
    )
    for (const seat of SEATS) {
      const path = geo.homePath[seat]
      const tri = document.createElement('i')
      tri.style.setProperty('--rot', `${headingBetween(geo.center, path[path.length - 1]!)}deg`)
      tri.style.setProperty('--seat', `var(--seat-${seat})`)
      tri.dataset.seat = String(seat)
      center.append(tri)
    }

    // 4. Les escaliers, marche par marche.
    //
    //    L'ancien dessin en posait un seul bloc plein par siège. C'était plus
    //    net, mais cela supposait un escalier droit — impossible sur un plateau
    //    rond.
    //
    //    Les numéros, eux, ne sont pas décoratifs : ils sont imprimés sur le
    //    plateau français, dont la règle stricte demande le chiffre exact de la
    //    marche visée. Le couloir d'arrivée du Ludo est une bande de couleur, et
    //    le numéroter reviendrait à dessiner un plateau qui n'existe pas.
    const numbered = this.variant.numberedHome
    for (const seat of SEATS) {
      geo.homePath[seat].forEach((c, i) => {
        const step = this.at('cell home', c.col, c.row, 1, 1, seat, c.rot ?? 0)
        if (!numbered) return
        const label = document.createElement('b')
        label.textContent = String(i + 1)
        label.style.setProperty('--rot', `${-(c.rot ?? 0)}deg`)
        step.append(label)
      })
    }

    return board
  }

  // ─────────────────────────── pions ───────────────────────────

  /**
   * Le cheval d'un siège — une pastille de couleur, et la marque de son camp.
   *
   * La marque est une FORME découpée en CSS, et non plus un caractère. Les
   * quatre glyphes géométriques d'avant (`● ▲ ■ ◆`) n'appartiennent pas au
   * sous-ensemble latin des fontes embarquées : ils retombaient sur celle du
   * système, donc sur un dessin différent d'un téléphone à l'autre — et à dix
   * pixels, le losange et le triangle du même système se confondaient déjà.
   *
   * Ce n'est pas un détail de décor : les quatre couleurs de siège ont presque
   * la même luminance (vert, bleu et rouge sont à moins de 1,4 l'un de
   * l'autre), et cette marque est le SEUL moyen de dire à qui est un cheval
   * quand on ne les distingue pas. Elle ne peut pas dépendre du système.
   */
  private pawnEl(id: string, seat: Seat): HTMLElement {
    let el = this.pawns.get(id)
    if (!el) {
      el = document.createElement('div')
      el.className = 'pawn'
      el.style.setProperty('--seat', `var(--seat-${seat})`)
      el.style.setProperty('--on', `var(--on-${seat})`)
      el.dataset.seat = String(seat)
      el.append(document.createElement('i'))
      this.layer.append(el)
      this.pawns.set(id, el)
    }
    return el
  }

  /**
   * Pose un cheval, et dit du même geste s'il partage sa case.
   *
   * La classe suit la POSITION DESSINÉE, et non l'état. Elle suivait l'état, et
   * un cheval qui allait rejoindre un voisin rétrécissait dès le premier pas :
   * il traversait le plateau centré et maigre pendant six dixièmes de seconde,
   * et n'expliquait pourquoi qu'en arrivant. Un cheval qui marche est seul sur
   * chaque case qu'il traverse — c'est vrai à l'écran, et ce doit l'être ici.
   */
  private place(el: HTMLElement, cell: Cell, offset: Offset): void {
    el.style.transform = `translate(${cell.col * 100 + offset.x}%, ${cell.row * 100 + offset.y}%)`
    el.classList.toggle('shared', offset.n > 1)
    el.style.setProperty('--share-n', String(offset.n))
  }

  /**
   * Décale les chevaux qui partagent une case, pour qu'aucun ne disparaisse
   * sous un autre.
   *
   * ## Pourquoi une ronde, et pas quatre coins
   *
   * L'ancien décalage posait les pions à `±10,4 %` et `±7,8 %` de case. Deux
   * défauts, et le second est une panne franche :
   *
   * 1. **Il ne séparait rien.** Un disque occupe 78 % de la case ; les écarter
   *    de 20 % les laisse superposés aux trois quarts. Pire, l'écart absolu
   *    (4,7 px sur une croix, 3,4 px sur un plateau rond) était plus petit que
   *    la seule bordure d'un pion : les deux traits d'encre se rejoignaient, et
   *    l'on ne voyait plus deux chevaux décalés mais une seule tache.
   * 2. **Il ne comptait que jusqu'à quatre.** `i % 2` et `i < 2` ne produisent
   *    que quatre positions, et le cinquième cheval se posait EXACTEMENT sous
   *    le troisième. Or seule la règle française interdit deux chevaux sur une
   *    case : au Ludo, en rapide et en équipes, une case abritée en porte
   *    autant qu'elle veut, et les quatre chevaux d'un même camp finissent de
   *    toute façon tous sur la case d'arrivée.
   *
   * La ronde règle les deux d'un coup : `n` positions pour `n` chevaux, quel
   * que soit `n`, et un rayon assez large pour que les disques — rétrécis par
   * la classe `shared`, voir la feuille de style — se distinguent.
   */
  private offsets(state: GameState): Map<string, Offset> {
    const byCell = new Map<string, string[]>()
    for (const p of state.pawns) {
      const k = key(cellOf(this.geometry, p.owner, p.steps, pawnSlot(p.id)))
      byCell.set(k, [...(byCell.get(k) ?? []), p.id])
    }

    const result = new Map<string, Offset>()
    for (const ids of byCell.values()) {
      ids.forEach((id, i) => result.set(id, { ...sharedOffset(i, ids.length), n: ids.length }))
    }
    return result
  }

  /**
   * `chosen` : le cheval déjà désigné par une carte armée.
   *
   * Une carte se joue en deux temps — on désigne un cheval, puis on lance le dé
   * — et entre les deux il faut voir lequel on a désigné. Sans cette marque, le
   * joueur relit une rangée de chevaux tous cerclés pareil et ne sait plus sur
   * lequel il a appuyé.
   */
  render(
    state: GameState,
    moves: Move[],
    onPick: (pawnId: string) => void,
    chosen?: string,
  ): void {
    // Un état qui arrive pendant une animation attend son tour, sinon le pion
    // « saute » à sa position finale au milieu du mouvement.
    //
    // Mais il ne suffit pas d'attendre : le rendu différé laissait derrière lui
    // les gestes du rendu PRÉCÉDENT. Un cheval encore cerclé gardait le « joue
    // ce coup » d'avant, si bien qu'armer une carte puis toucher un cheval
    // pendant les quelques centaines de millisecondes du déplacement jouait le
    // coup au lieu de désigner la cible. Les gestes partent donc tout de suite ;
    // le dessin, lui, attend la fin du mouvement.
    if (this.animating) {
      for (const el of this.pawns.values()) {
        el.onclick = null
        el.onkeydown = null
      }
      this.pending = () => this.render(state, moves, onPick, chosen)
      return
    }

    const playable = new Map(moves.map((m) => [m.pawnId, m]))
    const offsets = this.offsets(state)

    for (const seat of SEATS) {
      this.board.classList.toggle(`has-${seat}`, state.players.some((p) => p.seat === seat))
    }

    // Repérer le pion qui a bougé, pour le déplacer case par case.
    //
    // `via` est la case où le dé l'avait posé, quand un pouvoir ramassé là l'a
    // ensuite déplacé (voir `Hop` dans `types.ts`). Sans elle, un six suivi d'un
    // faux pas se dessinait comme un déplacement de trois cases, et un retour à
    // l'écurie ne se dessinait pas du tout — le cheval reparaissait chez lui
    // sans avoir bougé, ce qui se lit comme un bug plutôt que comme un malus.
    let animated: { id: string; seat: Seat; from: number; to: number; via?: number } | null = null
    for (const p of state.pawns) {
      const before = this.previous.get(p.id)
      if (before === undefined || before === p.steps) continue
      const via = state.hop?.pawnId === p.id ? state.hop.at : null
      if (via !== null && via > before) {
        animated = { id: p.id, seat: p.owner, from: before, to: p.steps, via }
        break
      }
      if (p.steps > before) {
        animated = { id: p.id, seat: p.owner, from: before, to: p.steps }
        break
      }
    }

    // Les chevaux que ce déplacement renvoie à l'écurie. Ils restent où ils
    // sont tant que le cheval qui les mange n'est pas arrivé : une capture se
    // découvre à l'impact, pas quatre cases avant.
    //
    // Celui qui marche est exclu : un « retour à l'écurie » ramassé sur la case
    // d'arrivée le renvoie chez lui aussi, mais plus tard — après le temps
    // d'arrêt, et c'est `walk` qui s'en charge. Compté ici, il serait rentré à
    // l'instant de l'impact, sans qu'on ait vu la case qui l'y envoie.
    const struck = animated
      ? state.pawns
          .filter(
            (p) =>
              p.id !== animated!.id &&
              p.steps === STABLE &&
              (this.previous.get(p.id) ?? STABLE) >= 0,
          )
          .map((p) => ({ id: p.id, seat: p.owner }))
      : []
    const held = new Set(struck.map((p) => p.id))

    for (const p of state.pawns) {
      const el = this.pawnEl(p.id, p.owner)
      const move = playable.get(p.id)

      const offset = offsets.get(p.id) ?? ALONE
      el.classList.toggle('playable', move !== undefined)
      el.classList.toggle('chosen', chosen === p.id)
      el.classList.toggle('shielded', p.shield === true)
      el.onclick = move ? () => onPick(p.id) : null

      // Un cheval jouable devient un vrai bouton : atteignable au clavier et
      // annoncé par un lecteur d'écran. Les autres sortent de l'ordre de tabulation.
      if (move) {
        const labelKey = move.exits ? 'play.pawn.exit' : move.finishes ? 'play.pawn.finish' : 'play.pawn.move'
        el.setAttribute('role', 'button')
        el.setAttribute('tabindex', '0')
        el.setAttribute('aria-label', t(labelKey, { n: pawnSlot(p.id) + 1 }))
        el.onkeydown = (ev) => {
          if (ev.key !== 'Enter' && ev.key !== ' ') return
          ev.preventDefault()
          onPick(p.id)
        }
        // La tabulation peut atteindre un cheval qui est hors de la fenêtre
        // d'un plateau grossi, et rien ne l'y amènerait : le déplacement est un
        // `transform`, pas un défilement, donc le navigateur ne sait pas
        // recadrer tout seul. Le plateau vient donc le chercher — c'est ce qui
        // rend un plateau grossi jouable sans doigts.
        el.onfocus = () => this.lookAt(p.id)
      } else {
        el.removeAttribute('role')
        el.removeAttribute('tabindex')
        el.removeAttribute('aria-label')
        el.onkeydown = null
        el.onfocus = null
      }

      if (animated?.id !== p.id && !held.has(p.id)) {
        this.place(el, cellOf(this.geometry, p.owner, p.steps, pawnSlot(p.id)), offset)
      }
    }

    this.previous = new Map(state.pawns.map((p) => [p.id, p.steps]))

    if (animated) void this.walk(animated, offsets, struck)
  }

  private async walk(
    step: { id: string; seat: Seat; from: number; to: number; via?: number },
    offsets: Map<string, Offset>,
    struck: { id: string; seat: Seat }[] = [],
  ): Promise<void> {
    const el = this.pawns.get(step.id)
    if (!el) return

    this.animating = true
    el.classList.add('moving')

    // 1. Le dé : jusqu'à la case où il pose le cheval.
    const landing = step.via ?? step.to
    await this.march(el, step, step.from, landing, offsets, step.via === undefined)

    // 2. L'impact : ce qu'on mange se découvre en arrivant, pas avant.
    await this.sendHome(struck, offsets)

    // 3. La case pouvoir, s'il y en avait une qui déplace. Un temps d'arrêt
    //    d'abord : on doit voir qu'on est arrivé là avant d'en être chassé.
    if (step.via !== undefined) {
      await new Promise((r) => setTimeout(r, POWER_HOLD_MS))
      // Et le temps qu'il faut à la carte tirée pour venir se poser sur le
      // cheval. Le moteur a déjà appliqué l'effet ; l'écran, lui, doit montrer
      // la cause avant la conséquence — sinon le cheval recule d'abord et la
      // carte arrive après coup, ce qui raconte l'histoire à l'envers.
      await this.holding?.(step.id)
      if (step.to === STABLE) await this.sendHome([{ id: step.id, seat: step.seat }], offsets)
      else await this.march(el, step, step.via, step.to, offsets, true)
    }

    el.classList.remove('moving')
    this.animating = false
    this.release()

    const next = this.pending
    this.pending = null
    next?.()
  }

  /**
   * Un cheval qui parcourt les cases une à une, en avant ou en arrière.
   *
   * En arrière n'est pas un détail : le faux pas recule de trois, et un cheval
   * qui saute sa nouvelle place d'un coup ne montre pas qu'il a reculé — il a
   * juste changé d'endroit. `last` dit s'il s'agit du dernier tronçon, celui au
   * bout duquel le cheval prend son décalage de case partagée.
   */
  private async march(
    el: HTMLElement,
    step: { id: string; seat: Seat },
    from: number,
    to: number,
    offsets: Map<string, Offset>,
    last: boolean,
  ): Promise<void> {
    const slot = pawnSlot(step.id)
    const way = to > from ? 1 : -1
    for (let s = from + way; way > 0 ? s <= to : s >= to; s += way) {
      const settled = s === to && last
      this.place(
        el,
        cellOf(this.geometry, step.seat, s, slot),
        settled ? (offsets.get(step.id) ?? ALONE) : ALONE,
      )
      await new Promise((r) => setTimeout(r, STEP_MS))
    }
  }

  /**
   * Le plateau désigne une cible de carte, et non des coups à jouer.
   *
   * Les deux se disaient du même anneau d'encre : une rangée de chevaux tous
   * cerclés pareil, et rien pour dire si les toucher joue un coup ou vise une
   * carte. Le vert est celui de la carte armée et du cheval déjà désigné —
   * une couleur, un geste.
   */
  setAiming(on: boolean): void {
    this.root.classList.toggle('aiming', on)
  }

  /**
   * Le plateau est-il grossi ?
   *
   * C'est ce que le bouton du zoom lit pour savoir s'il propose d'agrandir ou
   * de tout remontrer. Le geste et le bouton commandent le même plateau : un
   * bouton qui garderait son propre état finirait par mentir dès le premier
   * pincement.
   */
  zoomedIn(): boolean {
    return zoomed(this.zoom.scale())
  }

  /**
   * Le bouton du zoom : on grossit d'un cran, ou l'on remontre tout.
   *
   * Et l'on grossit **là où l'on va jouer**. Sur un plateau de petits chevaux,
   * ce qu'on touche est aux quatre coins — les écuries — ou le long d'un bras ;
   * grossir sur le milieu, qui est le défaut naturel, les faisait tous sortir
   * du cadre. Mesuré : après un appui sur le bouton, les quatre écuries avaient
   * leur centre hors du cadre, et l'écran demandait pendant ce temps de choisir
   * un cheval cerclé. Le bouton visait donc précisément l'endroit où il n'y a
   * jamais rien à faire.
   */
  toggleZoom(): void {
    this.zoom.toggle(this.aimOfPlayable())
  }

  /**
   * Le milieu des chevaux jouables, en écart au centre du cadre.
   *
   * Rien à viser — c'est le tour d'un autre, ou le dé n'est pas lancé — et l'on
   * s'en remet au centre : mieux vaut le milieu du plateau qu'un coin choisi au
   * hasard.
   */
  private aimOfPlayable(): { x: number; y: number } {
    const boxes = [...this.pawns.values()]
      .filter((el) => el.classList.contains('playable'))
      .map((el) => el.getBoundingClientRect())
    if (boxes.length === 0) return { x: 0, y: 0 }
    const frame = this.root.getBoundingClientRect()
    const cx = boxes.reduce((n, b) => n + b.left + b.width / 2, 0) / boxes.length
    const cy = boxes.reduce((n, b) => n + b.top + b.height / 2, 0) / boxes.length
    return { x: cx - (frame.left + frame.width / 2), y: cy - (frame.top + frame.height / 2) }
  }

  /** Amène ce cheval sous les yeux, si le plateau est grossi. */
  private lookAt(id: string): void {
    const box = this.pawns.get(id)?.getBoundingClientRect()
    if (!box) return
    const frame = this.root.getBoundingClientRect()
    this.zoom.look({
      x: box.left + box.width / 2 - (frame.left + frame.width / 2),
      y: box.top + box.height / 2 - (frame.top + frame.height / 2),
    })
  }

  /** Ce qu'il faut repeindre quand le grossissement change — le bouton. */
  onZoom(fn: (() => void) | null): void {
    this.zoomListener = fn
  }

  /**
   * Le plateau quitte l'écran.
   *
   * Les gestes s'écoutent sur la fenêtre, qui lui survit (voir `zoom.ts`) : un
   * plateau démonté sans cet appel laisse derrière lui des écouteurs qui
   * répondent pour un cadre qui n'existe plus.
   */
  dispose(): void {
    this.zoom.destroy()
    this.zoomListener = null
  }

  /**
   * Se résout quand plus rien ne bouge sur le plateau — tout de suite si rien
   * ne bougeait.
   *
   * Sert aux nouvelles du haut de l'écran : annoncer une capture pendant que le
   * cheval qui mange marche encore, c'est la dire une seconde avant qu'elle
   * n'arrive. Une nouvelle qui devance ce qu'elle raconte gâche les deux.
   */
  settled(): Promise<void> {
    if (!this.animating) return Promise.resolve()
    return new Promise((resolve) => this.settlers.push(resolve))
  }

  /**
   * Ce qui doit se jouer pendant que le cheval marque son arrêt sur la case
   * pouvoir — c'est-à-dire avant que la carte ne le pousse.
   *
   * C'est le seul endroit du déplacement où le cheval est encore **sur** la
   * case marquée alors que l'état, lui, le donne déjà trois cases en arrière ou
   * à l'écurie. Une carte qui vient s'y poser doit donc s'y glisser ; le rendu
   * de la position finale attend qu'elle ait fini, comme il attend déjà le
   * temps d'arrêt.
   *
   * Rendu court, ou rien du tout, sinon le plateau reste figé : ce qui passe
   * ici est une animation, jamais une attente d'état.
   */
  onPowerHold(fn: ((pawnId: string) => Promise<void>) | null): void {
    this.holding = fn
  }

  /**
   * Où se trouve un cheval à l'écran, en coordonnées de fenêtre.
   *
   * Un pion occupe exactement une case : son rectangle **est** celui de la case
   * où il est posé, et c'est ce qu'on veut ici — l'endroit d'où une carte se
   * soulève est la case marquée, donc le cheval qui vient de s'y arrêter.
   */
  pawnRect(id: string): DOMRect | null {
    const box = this.pawns.get(id)?.getBoundingClientRect()
    if (!box) return null
    // Un plateau grossi montre le quart de lui-même, et le reste est rogné par
    // le cadre. Le rectangle d'un cheval hors fenêtre reste juste — c'est bien
    // là qu'il serait — mais la carte qui s'en soulèverait irait se retourner
    // et se lire pendant une seconde à un endroit que personne ne voit, voire
    // hors de l'écran. Mieux vaut alors pas d'animation du tout : `cardfly`
    // sait aller droit à l'état final, il le fait déjà pour qui a demandé
    // moins de mouvement.
    const frame = this.root.getBoundingClientRect()
    const x = box.left + box.width / 2
    const y = box.top + box.height / 2
    const inside = x >= frame.left && x <= frame.right && y >= frame.top && y <= frame.bottom
    return inside ? box : null
  }

  private release(): void {
    const waiting = this.settlers
    this.settlers = []
    for (const done of waiting) done()
  }

  /**
   * L'impact, puis le retour à l'écurie.
   *
   * Tenu à l'intérieur de `walk`, donc pendant que `animating` est encore vrai :
   * un état reçu entre-temps attend son tour au lieu de reposer les chevaux à
   * leur place finale au milieu du choc.
   */
  private async sendHome(
    struck: { id: string; seat: Seat }[],
    offsets: Map<string, Offset>,
  ): Promise<void> {
    if (struck.length === 0) return

    for (const p of struck) this.pawns.get(p.id)?.classList.add('struck')
    await new Promise((r) => setTimeout(r, STRUCK_MS))

    for (const p of struck) {
      const el = this.pawns.get(p.id)
      if (!el) continue
      el.classList.remove('struck')
      const slot = pawnSlot(p.id)
      this.place(el, cellOf(this.geometry, p.seat, STABLE, slot), offsets.get(p.id) ?? ALONE)
    }
  }

  /** Repart d'une page blanche entre deux manches. */
  reset(): void {
    this.pawns.forEach((el) => el.remove())
    this.pawns.clear()
    this.previous.clear()
    this.animating = false
    this.pending = null
    // Et le plateau entier : une manche qui commence ne commence pas dans le
    // coin où l'on regardait la précédente se finir.
    this.zoom.reset()
    // Rien ne bouge plus : ce qui attendait la fin d'un mouvement l'a, sinon il
    // attendrait la fin d'une manche qui n'existe plus.
    this.release()
  }
}
