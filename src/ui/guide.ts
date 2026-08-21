/**
 * Le guidage des cartes pouvoir — une fois par appareil, et jamais deux.
 *
 * ## Pourquoi pas un tutoriel
 *
 * Tout ce que le jeu savait dire des pouvoirs était de la **référence** : le
 * catalogue au salon, le ⓘ des annonces, le règlement. On y va quand on a déjà
 * une question ; personne n'y va pour apprendre qu'il y a quelque chose à
 * savoir. Un tutoriel réglerait le problème dans le mauvais sens : il se place
 * avant la partie, quand rien n'a encore de nom, et il fait payer à tous les
 * joueurs suivants le prix du premier.
 *
 * On explique donc **au moment où le concept apparaît** — la première case
 * marquée, le premier bonus en main, le premier malus subi, la première carte
 * perdue — et une seule fois. Le reste de la vie de l'appareil, l'écran se tait.
 *
 * ## Pourquoi une mémoire injectable
 *
 * `localStorage` n'existe pas dans l'environnement de test (node, sans DOM), et
 * la décision « faut-il montrer cette feuille ? » est justement la seule partie
 * de ce guidage qu'on puisse tenir par un test. Elle est donc séparée du
 * stockage, qui n'est plus qu'un couple lire/écrire.
 */

import { POWERS, type PowerId } from '../game/powers.ts'

/**
 * La clé porte son numéro de version, comme celle du thème.
 *
 * Le jour où une feuille change de texte ou de contenu, on incrémente et tout
 * le monde la revoit une fois — plutôt que de laisser une explication périmée
 * marquée « déjà lue » sur les appareils qui l'avaient vue.
 */
export const GUIDE_KEY = 'dada.guide.v1'

/** Les quatre moments qui s'expliquent. */
export const GUIDE_IDS = ['squares', 'bonus', 'malus', 'full', 'welcome'] as const

export type GuideId = (typeof GUIDE_IDS)[number]

/**
 * Les feuilles de pouvoir — celles que « Revoir les explications » ramène.
 *
 * `welcome` n'en fait pas partie : ce n'est pas une explication qu'on redemande,
 * c'est un mot d'accueil qui ne vaut que tant qu'on n'a jamais joué. Le compter
 * parmi les feuilles ferait apparaître « Revoir les explications » chez qui n'a
 * jamais vu la moindre carte, et le bouton ramènerait l'accueil des débutants
 * sur le téléphone de quelqu'un qui vient de finir sa dixième partie.
 */
const SHEETS: readonly GuideId[] = ['squares', 'bonus', 'malus', 'full']

/** Le petit bout de mémoire du guidage, séparé pour être remplaçable en test. */
export type GuideStore = {
  read(): string | null
  write(value: string): void
  clear(): void
}

/** La mémoire réelle : le stockage local du navigateur, comme pour le thème. */
export const deviceStore = (): GuideStore => ({
  read: () => {
    try {
      return localStorage.getItem(GUIDE_KEY)
    } catch {
      // Navigation privée verrouillée, stockage refusé : le guidage se
      // remontrera, ce qui est infiniment moins grave que de planter l'écran.
      return null
    }
  },
  write: (value) => {
    try {
      localStorage.setItem(GUIDE_KEY, value)
    } catch {
      // Idem : ne rien retenir vaut mieux que ne rien afficher.
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(GUIDE_KEY)
    } catch {
      // Idem.
    }
  },
})

const parse = (raw: string | null): GuideId[] =>
  (raw ?? '')
    .split(',')
    .filter((id): id is GuideId => (GUIDE_IDS as readonly string[]).includes(id))

/**
 * Ce que cet appareil a déjà vu.
 *
 * `claim` est volontairement la seule porte : demander « faut-il montrer ? »
 * et noter « c'est montré » dans deux appels, c'est se garantir qu'un jour l'un
 * partira sans l'autre — et une feuille qui revient à chaque partie est pire
 * que pas de feuille du tout.
 */
export class Guide {
  private shown: Set<GuideId>

  constructor(private store: GuideStore) {
    this.shown = new Set(parse(store.read()))
  }

  /**
   * Déjà expliqué ?
   *
   * Sert à ne pas mettre en attente une feuille qui n'a plus lieu d'être : la
   * feuille peut attendre que le tour ne soit plus le nôtre, et entre-temps il
   * ne faut pas la compter comme vue. Vu = affiché, jamais « programmé ».
   */
  seen(id: GuideId): boolean {
    return this.shown.has(id)
  }

  /** Première fois ? Alors on la montre, et on ne la remontrera plus. */
  claim(id: GuideId): boolean {
    if (this.shown.has(id)) return false
    this.shown.add(id)
    this.store.write([...this.shown].join(','))
    return true
  }

  /** Rien n'a encore été expliqué : il n'y a donc rien à « revoir ». */
  get untouched(): boolean {
    return SHEETS.every((id) => !this.shown.has(id))
  }

  /** Tout oublier — le bouton « Revoir les explications » du catalogue. */
  forget(): void {
    // Sauf d'avoir déjà joué : les feuilles reviennent, l'accueil des tout
    // premiers pas non.
    const welcome = this.shown.has('welcome')
    this.shown = new Set(welcome ? (['welcome'] as GuideId[]) : [])
    if (welcome) this.store.write('welcome')
    else this.store.clear()
  }
}

/**
 * La feuille qu'appelle un ramassage de carte, ou rien du tout.
 *
 * On n'explique qu'à qui subit : voir ramasser une carte à l'autre bout de la
 * table n'apprend rien, et une feuille qui s'ouvre sur le tour de quelqu'un
 * d'autre se lit comme une interruption.
 *
 * `lost` : la main était pleine, la carte est perdue. Ce cas passe devant le
 * bonus, parce que c'est lui qu'il faut expliquer — la carte n'entre pas dans
 * la main, et sans un mot le joueur croit à une panne.
 */
export function guideForDraw(
  power: PowerId,
  opts: { mine: boolean; lost: boolean },
): GuideId | null {
  if (!opts.mine) return null
  if (opts.lost) return 'full'
  return POWERS[power].kind === 'bonus' ? 'bonus' : 'malus'
}

/**
 * Le geste qui reste à faire pour jouer cette carte, une fois qu'elle est en main.
 *
 * Trois familles, et pas une par carte : « désignez un cheval » (bouclier,
 * galop), « lancez le dé » (rejeu), « demandez votre petit ou grand nombre »
 * (dé pipé, qui ne part pas d'un lancer nu — voir `throwDie`).
 */
export type Gesture = 'pawn' | 'roll' | 'boost'

export function gestureOf(power: PowerId): Gesture {
  if (power === 'des') return 'boost'
  return POWERS[power].target === 'cheval' ? 'pawn' : 'roll'
}
