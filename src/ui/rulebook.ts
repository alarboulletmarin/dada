/**
 * L'écran du règlement complet.
 *
 * Séparé de `app.ts` pour la même raison que « à propos » : il ne lit rien de
 * l'état de la partie, il affiche un document. Son seul point d'attache est le
 * bouton qui l'ouvre, depuis l'écran « Comment on joue ».
 *
 * Les chapitres sont dépliables et fermés d'office. Tout ouvrir ferait un mur
 * de texte qu'on referme sans lire ; on vient ici avec une question précise —
 * « est-ce qu'on peut se poser sur son propre cheval ? » — et les titres de
 * chapitre doivent suffire à y mener.
 */

import { fill, h } from './dom.ts'
import { icon } from './icons.ts'
import { lang } from './i18n.ts'
import { RULES_TEXT, type Rule, type RuleTag, type RulesText } from './rules-text.ts'

/**
 * L'étiquette de variante d'une règle.
 *
 * Une règle sans étiquette vaut pour les trois jeux, et n'en porte donc aucune :
 * marquer « FR · INT · EXPRESS » sur les deux tiers des règles noierait les
 * étiquettes qui comptent vraiment.
 */
function tags(rule: Rule, text: RulesText): HTMLElement | null {
  if (!rule.only || rule.only.length === 0) return null
  return h(
    'span',
    { class: 'rulebook__tags' },
    ...rule.only.map((tag: RuleTag) =>
      h('span', { class: `rulebook__tag tag-${tag}`, text: text.legend[tag] }),
    ),
  )
}

function chapter(heading: string, rules: Rule[], text: RulesText): HTMLElement {
  return h(
    'details',
    { class: 'about__block' },
    h('summary', { text: heading }),
    ...rules.map((rule) =>
      h(
        'div',
        { class: 'about__section rulebook__rule' },
        h('h3', { text: rule.title }, tags(rule, text)),
        ...rule.body.map((paragraph) => h('p', { text: paragraph })),
      ),
    ),
  )
}

/** Rend l'écran dans `root`. `back` est le retour, à la charge de l'appelant. */
export function renderRulebook(root: HTMLElement, back: () => void): void {
  const text = RULES_TEXT[lang()]

  fill(
    root,
    h(
      'div',
      { class: 'screen about rulebook' },
      h(
        'div',
        { class: 'topbar' },
        h(
          'button',
          { class: 'icon-btn', attrs: { 'aria-label': text.back }, on: { click: back } },
          icon('back'),
        ),
        h('h2', { text: text.title }),
      ),
      h('p', { class: 'hint', text: text.intro }),
      ...text.chapters.map((c) => chapter(c.heading, c.rules, text)),
    ),
  )
}
