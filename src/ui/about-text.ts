/**
 * Les textes de l'écran « à propos » : confidentialité, conditions, mentions.
 *
 * Dans leur propre module, et non dans `i18n.ts`. Ce n'est pas de la chaîne
 * d'interface : c'est un document, il porte une date de révision, il se relit
 * en entier quand la loi ou l'app change, et il n'a aucune raison de bouger au
 * rythme des libellés de boutons.
 *
 * Une exigence tient tout le reste : **ce qui est écrit ici doit être vrai de ce
 * jeu-là**. Les autres apps de la famille peuvent promettre « aucune requête
 * réseau » ; celle-ci ne le peut pas. Une partie en ligne cherche ses pairs par
 * des relais publics et peut passer par un relais TURN. Le dire est le seul
 * intérêt d'une page de confidentialité.
 */

/** Date de dernière révision des textes. Écrite ici, et nulle part ailleurs :
 *  une page datée du jour de la visite ne dirait rien de ce qu'on lit. */
export const UPDATED = '2026-08-18'

export interface Section {
  title: string
  body: string[]
}

export interface AboutText {
  title: string
  updated: string
  back: string
  headings: {
    privacy: string
    terms: string
    notice: string
    licences: string
  }
  privacy: Section[]
  terms: Section[]
  notice: Section[]
  source: string
  licence: string
  thirdParty: string
  reinstall: string
  reinstallHint: string
  reinstalling: string
  version: string
}

const fr: AboutText = {
  title: 'À propos',
  updated: 'à jour au {date}',
  back: 'Retour',
  headings: {
    privacy: 'Confidentialité',
    terms: "Conditions d'utilisation",
    notice: 'Mentions légales',
    licences: 'Licences',
  },
  privacy: [
    {
      title: 'En une phrase',
      body: [
        "Le Jeu du Dada n'a ni compte, ni traceur, ni mesure d'audience, ni publicité. Personne ne sait que vous jouez, et aucune partie n'est enregistrée ailleurs que sur les téléphones qui y participent.",
      ],
    },
    {
      title: 'Ce qui reste sur votre appareil',
      body: [
        "Votre prénom, la langue, le thème et la partie en cours sont écrits dans le stockage local de votre navigateur. Ce ne sont pas des cookies, rien n'en est transmis, et effacer les données du site les supprime définitivement.",
      ],
    },
    {
      title: 'Ce qui circule en partie en ligne',
      body: [
        "Le jeu n'a pas de serveur : les téléphones se parlent directement, par un lien WebRTC chiffré de bout en bout. Le contenu de la partie ne transite par aucun tiers.",
        "Pour se trouver, deux navigateurs doivent d'abord échanger quelques messages de mise en relation. Ils passent par des relais publics du réseau Nostr, qui voient le code de salon — éphémère, jeté à la fin de la partie — et les adresses réseau candidates de votre appareil. Ils ne voient ni votre prénom, ni les coups joués.",
        "Quand le lien direct échoue — cas fréquent en 4G/5G derrière un NAT symétrique —, un relais TURN tiers achemine le flux. Il le relaie chiffré : il voit passer des octets et les adresses des deux bouts, pas la partie.",
      ],
    },
    {
      title: 'Le mode « sur cet appareil »',
      body: [
        "Un seul téléphone qu'on se passe : aucune requête réseau, rien ne sort de l'appareil. Le jeu fonctionne entièrement hors ligne une fois installé.",
      ],
    },
    {
      title: "L'hébergeur",
      body: [
        "Le site est hébergé par Vercel Inc., qui conserve des journaux techniques de connexion (adresse IP, agent utilisateur) pour la fourniture du service. Ces journaux échappent au projet, qui n'y a pas accès.",
      ],
    },
    {
      title: 'Vos droits',
      body: [
        "Aucune donnée n'étant collectée, il n'y a rien à consulter, rectifier ou supprimer auprès du projet. Ce qui vous concerne est sur votre appareil, entre vos mains.",
      ],
    },
  ],
  terms: [
    {
      title: 'Le service',
      body: [
        "Le Jeu du Dada est une application web qui s'exécute entièrement dans votre navigateur. Il n'y a ni compte, ni inscription, ni abonnement, ni paiement. L'usage est libre et gratuit.",
      ],
    },
    {
      title: 'Ce qui dépend de tiers',
      body: [
        "La mise en relation passe par des relais publics, et le filet de secours par un relais TURN gratuit. Ni l'un ni l'autre n'est fourni par le projet, et aucun ne garantit sa disponibilité : une partie en ligne peut échouer à s'établir. Le mode « sur cet appareil », lui, fonctionne toujours.",
      ],
    },
    {
      title: 'Garantie',
      body: [
        "Le logiciel est fourni « en l'état », sans garantie d'aucune sorte. La perte d'une partie consécutive à un effacement du stockage du navigateur, à une coupure réseau, à une panne ou à une erreur du logiciel ne peut engager la responsabilité des auteurs.",
      ],
    },
    {
      title: 'Licence',
      body: [
        "Le code source est distribué sous licence AGPL-3.0-or-later. Le texte de la licence prévaut sur la présente page pour tout ce qui concerne vos droits sur le logiciel.",
      ],
    },
  ],
  notice: [
    {
      title: 'Éditeur',
      body: [
        "Le Jeu du Dada est un projet personnel de logiciel libre, sans structure commerciale, publié par Andréa Larboullet Marin.",
      ],
    },
    {
      title: 'Hébergeur',
      body: ['Vercel Inc., 340 S Lemon Ave #4133, Walnut, CA 91789, États-Unis — vercel.com.'],
    },
    {
      title: 'Propriété intellectuelle',
      body: [
        "Le code source est publié sous licence AGPL-3.0-or-later. Les fontes Baloo 2 et Nunito sont distribuées sous licence SIL Open Font License 1.1, et la bibliothèque Trystero sous licence MIT.",
      ],
    },
  ],
  source: 'Code source',
  licence: 'Licence AGPL-3.0-or-later',
  thirdParty: 'Licences des composants tiers',
  reinstall: "Réinstaller l'app",
  reinstallHint:
    "Vide le cache hors-ligne et retélécharge le jeu. À faire si l'app reste bloquée sur une version cassée. Ne touche ni à votre prénom, ni à la partie sauvegardée.",
  reinstalling: 'Réinstallation…',
  version: 'version {version}',
}

const en: AboutText = {
  title: 'About',
  updated: 'last revised {date}',
  back: 'Back',
  headings: {
    privacy: 'Privacy',
    terms: 'Terms of use',
    notice: 'Legal notice',
    licences: 'Licences',
  },
  privacy: [
    {
      title: 'In one sentence',
      body: [
        'Jeu du Dada has no account, no tracker, no analytics and no advertising. Nobody knows you are playing, and no game is stored anywhere but on the phones taking part in it.',
      ],
    },
    {
      title: 'What stays on your device',
      body: [
        'Your first name, the language, the theme and the game in progress are written to your browser local storage. These are not cookies, nothing is transmitted, and clearing the site data deletes them for good.',
      ],
    },
    {
      title: 'What travels during an online game',
      body: [
        'The game has no server: phones talk to each other directly, over an end-to-end encrypted WebRTC link. Game content passes through no third party.',
        'To find each other, two browsers must first exchange a few matchmaking messages. Those go through public relays on the Nostr network, which see the room code — ephemeral, discarded when the game ends — and your device candidate network addresses. They see neither your name nor the moves played.',
        'When the direct link fails — common on mobile networks behind a symmetric NAT — a third-party TURN relay carries the stream. It relays it encrypted: it sees bytes and the addresses of both ends, not the game.',
      ],
    },
    {
      title: 'The “on this device” mode',
      body: [
        'One phone passed around: no network request, nothing leaves the device. Once installed, the game works entirely offline.',
      ],
    },
    {
      title: 'The host',
      body: [
        'The site is hosted by Vercel Inc., which keeps technical connection logs (IP address, user agent) to provide the service. Those logs are outside the project, which has no access to them.',
      ],
    },
    {
      title: 'Your rights',
      body: [
        'Since no data is collected, there is nothing to access, correct or delete from the project. What concerns you is on your device, in your hands.',
      ],
    },
  ],
  terms: [
    {
      title: 'The service',
      body: [
        'Jeu du Dada is a web app that runs entirely in your browser. There is no account, no sign-up, no subscription and no payment. Use is free and unrestricted.',
      ],
    },
    {
      title: 'What depends on third parties',
      body: [
        'Matchmaking goes through public relays, and the fallback through a free TURN relay. Neither is provided by the project, and neither guarantees availability: an online game may fail to connect. The “on this device” mode always works.',
      ],
    },
    {
      title: 'Warranty',
      body: [
        'The software is provided “as is”, without warranty of any kind. Losing a game to cleared browser storage, a dropped connection, a failure or a bug in the software cannot engage the authors liability.',
      ],
    },
    {
      title: 'Licence',
      body: [
        'The source code is distributed under the AGPL-3.0-or-later licence. The licence text prevails over this page for everything concerning your rights over the software.',
      ],
    },
  ],
  notice: [
    {
      title: 'Publisher',
      body: [
        'Jeu du Dada is a personal free-software project, with no commercial entity behind it, published by Andréa Larboullet Marin.',
      ],
    },
    {
      title: 'Host',
      body: ['Vercel Inc., 340 S Lemon Ave #4133, Walnut, CA 91789, United States — vercel.com.'],
    },
    {
      title: 'Intellectual property',
      body: [
        'The source code is published under the AGPL-3.0-or-later licence. The Baloo 2 and Nunito typefaces are distributed under the SIL Open Font License 1.1, and the Trystero library under the MIT licence.',
      ],
    },
  ],
  source: 'Source code',
  licence: 'AGPL-3.0-or-later licence',
  thirdParty: 'Third-party licences',
  reinstall: 'Reinstall the app',
  reinstallHint:
    'Clears the offline cache and downloads the game again. Use it if the app is stuck on a broken version. Touches neither your name nor the saved game.',
  reinstalling: 'Reinstalling…',
  version: 'version {version}',
}

export const ABOUT_TEXT: Record<'fr' | 'en', AboutText> = { fr, en }
