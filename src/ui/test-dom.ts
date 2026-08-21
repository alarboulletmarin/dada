/**
 * Le banc d'essai des écrans.
 *
 * ## Pourquoi un harnais, et pas trois lignes dans chaque test
 *
 * Les écrans sont la seule partie du jeu qu'aucun test ne touchait : le moteur,
 * le réseau et la présence ont les leurs, mais « l'accueil mène-t-il vraiment
 * au plateau ? » n'était vérifié que par des yeux. Or un écran ne se monte pas
 * tout seul — il lui faut un `document`, un `localStorage` propre, un
 * `matchMedia` qui réponde, un `navigator.vibrate` qui ne casse rien, et des
 * minuteries qu'on puisse pousser à la main. Répéter ce montage dans chaque
 * fichier, c'était garantir qu'il dériverait d'un fichier à l'autre.
 *
 * ## L'environnement
 *
 * Les tests d'écran portent `// @vitest-environment jsdom` en tête de fichier,
 * et le suffixe `.dom.test.ts`. La directive plutôt qu'un `environmentMatchGlobs`
 * dans `vite.config.ts` : l'option est dépréciée dans Vitest 3 (elle affiche un
 * avertissement à chaque exécution), et un fichier qui déclare lui-même ce dont
 * il a besoin ne peut pas se retrouver dans le mauvais environnement par un
 * chemin mal recopié. Les tests `node` existants, eux, ne changent pas d'un
 * octet et ne paient pas le prix d'un DOM.
 *
 * ## Ce qui n'est PAS simulé
 *
 * Ni la session, ni le moteur, ni le guidage : les tests d'écran font une vraie
 * partie locale et une vraie session en ligne (avec le canal double du reste
 * des tests réseau). Seul le transport est faux — on ne va pas appeler des
 * relais publics pour savoir si un bandeau s'affiche.
 */

import { afterEach, beforeEach, expect, vi } from 'vitest'
import { createGame } from '../game/engine.ts'
import type { GameState, Seat } from '../game/types.ts'
import type { Lobby, LobbyPlayer, StateMessage } from '../net/room.ts'
import { tableVariant } from '../net/session.ts'
import { App } from './app.ts'
import { setLang } from './i18n.ts'
import { fakeJoinGameRoom, rooms } from './test-room.ts'

// ─────────────────────────── l'environnement ───────────────────────────

/** Les requêtes média qu'on veut voir répondre « oui ». */
const media = new Set<string>()

/** Les vibrations demandées depuis le début du test. */
let buzzes: number[] = []

export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/** Simule (ou lève) « mouvement réduit », lu par `cardfly` et par le dé. */
export function setReducedMotion(on: boolean): void {
  if (on) media.add(REDUCED_MOTION)
  else media.delete(REDUCED_MOTION)
}

/** Ce que `navigator.vibrate` a reçu — le rappel des trois dernières secondes. */
export function vibrations(): number[] {
  return buzzes
}

/**
 * Le téléphone perd (ou retrouve) le réseau, avec l'événement qui va avec.
 *
 * L'événement, et pas seulement le drapeau : c'est lui que l'app écoute pour
 * repeindre le bandeau, et un test qui se contenterait du drapeau vérifierait
 * un chemin que personne n'emprunte.
 */
export function setOnline(on: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: on, configurable: true })
  dispatchEvent(new Event(on ? 'online' : 'offline'))
}

function installGlobals(): void {
  // jsdom n'implémente ni `matchMedia` ni `vibrate` ni `scrollIntoView`.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        get matches() {
          return media.has(query)
        },
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  })

  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    writable: true,
    value: (pattern: number | number[]) => {
      buzzes.push(...(Array.isArray(pattern) ? pattern : [pattern]))
      return true
    },
  })

  Element.prototype.scrollIntoView ??= function scrollIntoView() {}
}

/**
 * Tout ce qu'un test d'écran veut trouver en arrivant : un DOM vide, un
 * stockage vide, des minuteries en main, et le français — les libellés
 * attendus passent par `t()`, mais une langue qui changerait d'un fichier à
 * l'autre rendrait les échecs illisibles.
 *
 * S'installe elle-même dans `beforeEach`/`afterEach` : un harnais qu'il faut
 * penser à appeler est un harnais qu'on oubliera.
 */
export function setupDom(): void {
  beforeEach(() => {
    installGlobals()
    media.clear()
    buzzes = []
    localStorage.clear()
    setLang('fr')
    document.body.replaceChildren()
    document.documentElement.removeAttribute('data-theme')
    history.replaceState(null, '', '/')
    rooms.length = 0
    vi.useFakeTimers()
  })

  afterEach(() => {
    // D'abord : les minuteries en vol (bots, battements, animations) ne doivent
    // pas retomber dans le test suivant, sur un écran démonté.
    vi.clearAllTimers()
    vi.useRealTimers()
    document.body.replaceChildren()
    localStorage.clear()
  })
}

// ─────────────────────────── monter l'app ───────────────────────────

export type Ui = {
  app: App
  root: HTMLElement
  /** Le texte visible de l'écran, espaces normalisés. */
  screen(): string
  find(selector: string): HTMLElement | null
  all(selector: string): HTMLElement[]
  /** Le premier élément cliquable dont le texte est exactement celui-là. */
  byText(label: string): HTMLElement
  /** Y a-t-il un bouton portant ce texte ? — sans faire échouer le test. */
  hasText(label: string): boolean
  byLabel(label: string): HTMLElement
  click(label: string): void
  clickLabel(ariaLabel: string): void
  /** Saisit dans un champ repéré par son `aria-label`, comme un doigt le ferait. */
  type(ariaLabel: string, value: string): HTMLInputElement
  /** Pousse les minuteries ET les promesses qui en dépendent. */
  advance(ms: number): Promise<void>
}

/*
 * Seulement les blancs ASCII : l'interface écrit « Alan gagne ! » avec une
 * espace fine insécable, et l'écraser en espace ordinaire rendrait impossible
 * de comparer avec ce que `t()` rend.
 */
const clean = (text: string): string => text.replace(/[ \t\n\r\f\v]+/g, ' ').trim()

/**
 * Le texte d'un élément, sans celui de ses enfants interactifs.
 *
 * `textContent` d'un `<div class="screen">` colle bout à bout les libellés de
 * tous ses boutons : chercher « Lancer la partie » y trouverait n'importe quel
 * ancêtre. On ne compare donc qu'avec des éléments qui n'en contiennent pas
 * d'autres — un bouton, un titre, une ligne.
 */
const leafish = (el: Element): boolean => el.querySelector('button, input, a') === null

/**
 * Une app neuve dans un DOM neuf.
 *
 * On peut en monter plusieurs dans le même test : c'est même la seule façon de
 * vérifier ce qui ne se montre qu'une fois **par appareil** — la deuxième app
 * relit le même `localStorage`, exactement comme la deuxième partie relirait
 * celui de la première.
 */
export function mountApp(): Ui {
  // Le calque d'une app précédente vit dans `body`, pas dans sa racine : sans
  // ce coup de balai, le podium de la partie d'avant compterait pour la suivante.
  document.body.replaceChildren()
  const root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)
  // Le transport en carton passe par la porte prévue pour lui : `App` prend sa
  // fabrique de salon en second argument. Il n'y a plus de `vi.mock` à poser sur
  // `room.ts` — remplacer un module entier pour un seul appel faisait dépendre
  // le banc d'essai du chemin d'import du jeu, et obligeait chaque fichier de
  // test à recopier la même incantation.
  const app = new App(root, fakeJoinGameRoom)
  app.start()

  const all = (selector: string): HTMLElement[] => [
    ...document.querySelectorAll<HTMLElement>(selector),
  ]

  const matches = (label: string): HTMLElement[] =>
    all('button, a, h1, h2, h3, strong, span, p, label, li').filter(
      (el) => leafish(el) && clean(el.textContent ?? '') === label,
    )

  const byText = (label: string): HTMLElement => {
    const found = matches(label)
    const clickable = found.find((el) => el.tagName === 'BUTTON' || el.tagName === 'A')
    const el = clickable ?? found[0]
    expect(el, `aucun élément « ${label} » à l'écran :\n${clean(root.textContent ?? '')}`).toBeTruthy()
    return el!
  }

  const byLabel = (label: string): HTMLElement => {
    const el = document.querySelector<HTMLElement>(`[aria-label="${label}"]`)
    expect(el, `aucun élément d'étiquette « ${label} »`).toBeTruthy()
    return el!
  }

  return {
    app,
    root,
    // `body` et non la racine : les calques — feuille de match, guidage, chat,
    // catalogue — se posent à côté d'elle, et c'est bien le même écran.
    screen: () => clean(document.body.textContent ?? ''),
    find: (selector) => document.querySelector<HTMLElement>(selector),
    all,
    byText,
    hasText: (label) => matches(label).length > 0,
    byLabel,
    click: (label) => byText(label).click(),
    clickLabel: (label) => byLabel(label).click(),
    type: (ariaLabel, value) => {
      const input = byLabel(ariaLabel) as HTMLInputElement
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return input
    },
    advance: async (ms) => {
      await vi.advanceTimersByTimeAsync(ms)
    },
  }
}

// ─────────────────────────── le transport, en double ───────────────────────────

/*
 * Il vit dans `test-room.ts`, et pas ici : c'est un reste de l'époque du
 * `vi.mock`, dont la fabrique s'exécutait pendant la résolution de `room.ts` et
 * ne pouvait donc rien importer qui tire `app.ts`. La contrainte a disparu avec
 * le mock ; la séparation reste, parce qu'un transport en carton n'a rien à
 * faire dans le même fichier que le montage des écrans. Réexporté pour que les
 * tests n'aient qu'une porte d'entrée.
 */
export { fakeJoinGameRoom, lastRoom, rooms, type FakeChannel, type Sent } from './test-room.ts'

// ─────────────────────────── des états tout faits ───────────────────────────

export const seatOf = (
  over: Partial<LobbyPlayer> & Pick<LobbyPlayer, 'seat' | 'clientId'>,
): LobbyPlayer => ({
  name: `J${over.seat + 1}`,
  peerId: null,
  kind: 'human',
  connected: true,
  botFill: false,
  face: 0,
  ...over,
})

export const lobbyOf = (over: Partial<Lobby> = {}): Lobby => ({
  code: 'ABCDEFGH',
  hostClientId: 'hote',
  epoch: 0,
  round: 0,
  variantId: 'petits-chevaux',
  players: [],
  started: false,
  ...over,
})

/** Une partie fraîche, celle que l'hôte aurait fabriquée au lancement. */
export function gameOf(lobby: Lobby, self: string): GameState {
  return createGame({
    players: lobby.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      kind: p.kind === 'bot' ? 'bot' : p.clientId === self ? 'local' : 'remote',
      peerId: p.peerId,
      connected: p.connected,
    })),
    variant: tableVariant(lobby),
    seed: 42,
  })
}

export const stateOf = (lobby: Lobby, game: GameState): StateMessage => ({
  from: lobby.hostClientId,
  epoch: lobby.epoch,
  round: lobby.round,
  game,
})

/**
 * Une partie gagnée, sans la jouer.
 *
 * Une vraie manche de petits chevaux, c'est deux cents tours : la jouer pour
 * voir un podium coûterait plus cher que tout le reste du fichier réuni, et ne
 * prouverait rien de plus. On pose donc l'état final — le podium ne lit que
 * `phase`, `ranking` et les chevaux.
 */
export function finish(game: GameState, winner: Seat): GameState {
  return { ...game, phase: 'finished', ranking: [winner], dice: null, seq: game.seq + 1 }
}
