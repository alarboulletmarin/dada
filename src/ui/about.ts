/**
 * L'écran « à propos » : confidentialité, conditions, mentions, licences.
 *
 * Un écran, et non un site à côté du jeu. L'accueil du Dada *est* déjà sa page
 * de présentation — titre, promesse, trois boutons — et poser une plaquette
 * devant ajouterait un clic entre le visiteur et le dé, pour un jeu dont
 * l'argument tient en « trois secondes et le dé roule ». Ce qu'un site aurait
 * apporté de vraiment utile, c'est un toit pour les textes légaux et pour le
 * lien vers la source que l'AGPL demande à l'app d'offrir. Les voici.
 *
 * Un module à part plutôt qu'une méthode de plus dans `App` : il ne lit rien de
 * l'état de la partie, il ne fait qu'afficher un document. Le seul point
 * d'attache est le bouton qui l'ouvre.
 */

import { ABOUT_TEXT, UPDATED, type Section } from './about-text.ts'
import { fill, h } from './dom.ts'
import { lang } from './i18n.ts'
import { LICENCE_URL, REPO, THIRD_PARTY_URL } from './links.ts'
import { canClearAppCaches, clearAppCaches } from './update.ts'

function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(iso))
}

/** Un bloc dépliable. Les textes légaux sont longs et se consultent par section :
 *  tout déplier d'office ferait un mur qu'on referme sans lire. */
function block(heading: string, sections: Section[]): HTMLElement {
  return h(
    'details',
    { class: 'about__block' },
    h('summary', { text: heading }),
    ...sections.map((section) =>
      h(
        'div',
        { class: 'about__section' },
        h('h3', { text: section.title }),
        ...section.body.map((paragraph) => h('p', { text: paragraph })),
      ),
    ),
  )
}

/** Rend l'écran dans `root`. `back` est le retour, à la charge de l'appelant :
 *  on arrive ici depuis l'accueil, mais rien n'y oblige. */
export function renderAbout(root: HTMLElement, back: () => void): void {
  const text = ABOUT_TEXT[lang()]

  fill(
    root,
    h(
      'div',
      { class: 'screen about' },
      h(
        'div',
        { class: 'topbar' },
        h('button', {
          class: 'icon-btn',
          text: '←',
          attrs: { 'aria-label': text.back },
          on: { click: back },
        }),
        h('h2', { text: text.title }),
      ),
      h('p', {
        class: 'hint',
        text: text.updated.replace('{date}', formatDate(UPDATED, lang())),
      }),

      block(text.headings.privacy, text.privacy),
      block(text.headings.terms, text.terms),
      block(text.headings.notice, text.notice),

      h(
        'div',
        { class: 'about__links' },
        h('span', { class: 'label', text: text.headings.licences }),
        // `rel="license"` n'est pas décoratif : c'est la relation que lisent les
        // robots et les agrégateurs pour savoir sous quelles conditions le code
        // est publié.
        h('a', {
          text: text.licence,
          href: LICENCE_URL,
          attrs: { rel: 'license noreferrer noopener', target: '_blank' },
        }),
        h('a', {
          text: text.thirdParty,
          href: THIRD_PARTY_URL,
          attrs: { rel: 'noreferrer noopener', target: '_blank' },
        }),
        // Le lien que l'article 13 de l'AGPL demande : un programme accessible
        // par le réseau doit offrir sa source depuis son interface.
        h('a', {
          text: text.source,
          href: REPO,
          attrs: { rel: 'noreferrer noopener', target: '_blank' },
        }),
      ),

      ...reinstall(text),

      h('p', {
        class: 'hint center push',
        text: text.version.replace('{version}', __APP_VERSION__),
      }),
    ),
  )
}

/** La sortie de secours. Sans service worker il n'y a rien à réinstaller — et
 *  rien à proposer : un bouton qui ne peut rien faire inquiète pour rien. */
function reinstall(text: (typeof ABOUT_TEXT)['fr']): HTMLElement[] {
  if (!canClearAppCaches()) return []

  const button = h('button', { class: 'btn small', text: text.reinstall })
  button.addEventListener('click', () => {
    button.disabled = true
    button.textContent = text.reinstalling
    void clearAppCaches().then(() => {
      window.location.reload()
    })
  })

  return [
    h('div', { class: 'about__reinstall' }, button, h('p', { class: 'hint', text: text.reinstallHint })),
  ]
}

/** Le libellé du bouton qui ouvre cet écran, dans la langue courante.
 *  Exporté pour que `app.ts` n'ait pas à connaître le dictionnaire. */
export function aboutLabel(): string {
  return ABOUT_TEXT[lang()].title
}
