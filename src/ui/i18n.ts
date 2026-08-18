/**
 * Français et anglais.
 *
 * Deux principes tiennent tout le reste :
 *
 * 1. Rien de traduit ne circule sur le réseau. Le moteur n'écrit dans le
 *    journal que des événements structurés — un nom d'événement et ses
 *    paramètres — et chaque appareil les rend dans SA langue. Deux amis peuvent
 *    donc jouer la même partie, l'un en français, l'autre en anglais.
 * 2. Une clé manquante retombe sur le français plutôt que d'afficher la clé :
 *    un texte dans la mauvaise langue reste lisible, `lobby.seats` non.
 */

const KEY = 'dada.lang'

export type Lang = 'fr' | 'en'

export const LANGS: Lang[] = ['fr', 'en']
export const LANG_LABEL: Record<Lang, string> = { fr: 'Français', en: 'English' }

const fr = {
  'app.title': 'Jeu du Dada',
  'app.tagline': 'le jeu des petits chevaux, entre amis',

  'common.back': 'Retour',
  'common.continue': 'Continuer',
  'common.retry': 'Réessayer',
  'common.forget': 'oublier',
  'common.you': 'vous',
  'common.player': 'Joueur {n}',
  'common.bot': 'Bot {n}',

  'home.create': 'Créer une partie',
  'home.join': 'Rejoindre avec un code',
  'home.local': 'Un seul téléphone',
  'home.rules': 'Comment on joue',
  'home.name': 'Vous êtes',
  'home.name.placeholder': 'Votre prénom',
  'home.footer': 'Sans compte · sans pub · sans serveur.<br>Trois secondes et le dé roule.',

  'save.resume': 'Reprendre la partie',
  'save.detail': '{variant} · {players} joueurs · {when}',
  'save.forget.label': 'Oublier la partie sauvegardée',
  'save.now': "à l'instant",
  'save.minutes': 'il y a {n} min',
  'save.hours': 'il y a {n} h',
  'save.yesterday': 'hier',
  'save.days': 'il y a {n} jours',

  'pick.title': 'On joue à quoi ?',
  'pick.hint': 'Les règles maison se règlent juste après, dans le salon.',

  'join.title': 'Rejoindre une partie',
  'join.hint': 'Tapez les {n} caractères que votre ami vous a envoyés.',
  'join.action': 'Rejoindre',
  'join.code.label': 'Code de partie',
  'join.footer': "Le code ouvre un lien direct entre vos téléphones. Rien n'est stocké nulle part.",
  'join.tooShort': 'Entrez le code que vos amis vous ont donné.',

  'lobby.title': 'Salon',
  'lobby.code': 'Code à partager',
  'lobby.code.pill': 'code',
  'lobby.code.hint': 'Vos amis tapent ce code, ou ouvrent le lien. Rien à installer.',
  'lobby.code.copy': 'Copier le lien de la partie',
  'lobby.code.aria': 'Code de partie {code} — copier le lien',
  'lobby.share': 'Partager',
  'lobby.copy': 'Copier',
  'lobby.copied': 'Lien copié.',
  'lobby.invite': 'Rejoins ma partie de petits chevaux — code {code}',
  'lobby.players': 'Joueurs · {n}/4',
  'lobby.free': 'place libre',
  'lobby.addPlayer': '+ Joueur',
  'lobby.addBot': '+ Bot',
  'lobby.host': 'hôte',
  'lobby.bot': 'bot',
  'lobby.offline': 'hors ligne',
  'lobby.remove': 'Retirer {name}',
  'lobby.rename': 'Nom du joueur {n}',
  'lobby.rules': 'Règles maison · {variant}',
  'lobby.change': 'Changer de jeu',
  'lobby.start': 'Lancer la partie',
  'lobby.needTwo': 'Il faut au moins 2 joueurs',
  'lobby.waitHost': "En attente du lancement par l'hôte…",
  'lobby.footer': 'Ordre tiré au sort · 4 chevaux chacun',
  'lobby.quit': 'Quitter la partie',

  'link.connecting': 'Connexion à la partie…',
  'link.connecting.hint':
    'Votre ami doit avoir la partie ouverte de son côté. Cela prend deux à trois secondes.',
  'link.lost': 'Personne ne répond',
  'link.lost.offline':
    "Aucun relais de mise en relation n'est joignable : vérifiez votre connexion internet.",
  'link.lost.hint':
    "Trois causes possibles : le code n'est pas le bon, votre ami n'a pas encore ouvert la partie, ou vos deux réseaux bloquent la connexion directe (fréquent en 4G).",
  'link.otherCode': 'Autre code',
  'link.failed': 'La connexion a échoué.',
  'link.blocked': 'Vos deux réseaux refusent la connexion directe.',

  'play.roll': 'Lancer le dé',
  'play.rolling': 'Le dé roule…',
  'play.boost.low': 'Petit nombre',
  'play.boost.high': 'Grand nombre',
  'play.boost.remaining': '{n} bonus restants',
  'play.yourTurn': 'À vous',
  'play.touchDie': 'touchez le dé',
  'play.turnOf': 'Tour {name}',
  'play.rolled': '{name} a fait {dice}',
  'play.youRolled': 'Vous avez fait {dice}',
  'play.pickOne': 'un seul coup : il se joue',
  'play.pickMany': 'choisissez un cheval cerclé',
  'play.nothing': 'Rien à jouer',
  'play.nothing.hint': 'on passe la main',
  'play.voided': 'Tour perdu',
  'play.voided.hint': "{n} six d'affilée",
  'play.over': 'Partie terminée',
  'play.stable': "à l'écurie",
  'play.running': '{n} en piste',
  'play.homed.one': '{n} rentré',
  'play.homed.other': '{n} rentrés',
  'play.place': '{n}e place',
  'play.place.first': '1re place',
  'play.pawn.move': 'Avancer le cheval {n}',
  'play.pawn.exit': 'Sortir le cheval {n}',
  'play.pawn.finish': 'Rentrer le cheval {n}',

  'win.title': '{name} gagne !',
  'win.detail': '{n}/4 chevaux rentrés · règles « {variant} »',
  'win.rematch': 'Revanche',
  'win.home': 'Accueil',
  'win.hostRematch': "L'hôte peut relancer une manche.",
  'win.nobody': 'Personne',

  'rules.title': 'Comment on joue',
  'rules.footer': 'Trois 6 de suite · tour perdu',
  'rules.1.title': "Sortir de l'écurie",
  'rules.1.body': 'Il faut un 6 pour poser un cheval sur sa case de départ.',
  'rules.2.title': 'Tourner',
  'rules.2.body': 'On avance du nombre de points, dans le sens des aiguilles.',
  'rules.3.title': 'Manger',
  'rules.3.body': 'Tomber pile sur un cheval adverse le renvoie chez lui. Les cases étoilées protègent.',
  'rules.4.title': 'Rentrer',
  'rules.4.body': 'Après le tour complet, le cheval prend son escalier. Compte exact pour arriver.',
  'rules.5.title': 'Gagner',
  'rules.5.body': 'Le premier à rentrer ses 4 chevaux remporte la partie.',

  'variant.petits-chevaux.name': 'Petits chevaux',
  'variant.petits-chevaux.desc': 'La règle française classique. Un 6 pour sortir, on rejoue sur un 6.',
  'variant.petits-chevaux.tag': 'FR',
  'variant.petits-chevaux.meta': '4 chevaux · 20–30 min',
  'variant.ludo.name': 'Ludo',
  'variant.ludo.desc': 'La règle internationale. Cases étoilées protégées, barrages, primes de capture.',
  'variant.ludo.tag': 'INT',
  'variant.ludo.meta': '4 pions · 15–25 min',
  'variant.rapide.name': 'Rapide',
  'variant.rapide.desc': 'Sortie sur 1 ou 6, arrivée sans compte exact. Pour une partie courte.',
  'variant.rapide.tag': 'EXPRESS',
  'variant.rapide.meta': 'sortie facile · 10 min',

  'chip.exit': '{rolls} pour sortir',
  'chip.six': '6 rejoue',
  'chip.capture': 'manger renvoie',
  'chip.star': 'cases étoile',
  'chip.exact': 'compte exact',
  'chip.blockade': 'barrages',
  'chip.bonus': 'prime de capture',
  'chip.or': ' ou ',

  'log.start': 'Partie lancée — règles « {variant} ».',
  'log.roll': 'lance le dé : {dice}.',
  'log.voided': "{n} six d'affilée — tour perdu.",
  'log.exit': 'sort son cheval {pawn}.',
  'log.finish': "amène son cheval {pawn} à l'arrivée !",
  'log.advance': 'avance son cheval {pawn} de {dice}.',
  'log.capture': 'mange le cheval {pawn} de {victim} !',
  'log.pass': 'ne peut rien jouer.',
  'log.win': 'gagne la partie !',
  'log.rank': 'termine {place}e.',

  'error.finished': 'La partie est terminée.',
  'error.notYourTurn': "Ce n'est pas votre tour.",
  'error.alreadyRolled': 'Le dé a déjà été lancé.',
  'error.rollFirst': "Lancez le dé d'abord.",
  'error.illegal': 'Ce coup est interdit.',
  'error.nothingToPass': 'Rien à passer.',
  'error.moveExists': 'Un coup est possible.',

  'theme.auto': 'Auto',
  'theme.light': 'Clair',
  'theme.dark': 'Sombre',
  'theme.change': 'Thème : {theme}. Changer.',
  'lang.change': 'Langue : {lang}. Changer.',
} as const

export type Key = keyof typeof fr

const en: Partial<Record<Key, string>> = {
  'app.title': 'Dada',
  'app.tagline': 'the game of little horses, among friends',

  'common.back': 'Back',
  'common.continue': 'Continue',
  'common.retry': 'Try again',
  'common.forget': 'forget',
  'common.you': 'you',
  'common.player': 'Player {n}',
  'common.bot': 'Bot {n}',

  'home.create': 'Create a game',
  'home.join': 'Join with a code',
  'home.local': 'One phone only',
  'home.rules': 'How to play',
  'home.name': 'You are',
  'home.name.placeholder': 'Your first name',
  'home.footer': 'No account · no ads · no server.<br>Three seconds and the die rolls.',

  'save.resume': 'Resume game',
  'save.detail': '{variant} · {players} players · {when}',
  'save.forget.label': 'Forget the saved game',
  'save.now': 'just now',
  'save.minutes': '{n} min ago',
  'save.hours': '{n} h ago',
  'save.yesterday': 'yesterday',
  'save.days': '{n} days ago',

  'pick.title': 'What are we playing?',
  'pick.hint': 'House rules come right after, in the lobby.',

  'join.title': 'Join a game',
  'join.hint': 'Type the {n} characters your friend sent you.',
  'join.action': 'Join',
  'join.code.label': 'Game code',
  'join.footer': 'The code opens a direct link between your phones. Nothing is stored anywhere.',
  'join.tooShort': 'Enter the code your friends gave you.',

  'lobby.title': 'Lobby',
  'lobby.code': 'Code to share',
  'lobby.code.pill': 'code',
  'lobby.code.hint': 'Your friends type this code, or open the link. Nothing to install.',
  'lobby.code.copy': 'Copy the game link',
  'lobby.code.aria': 'Game code {code} — copy the link',
  'lobby.share': 'Share',
  'lobby.copy': 'Copy',
  'lobby.copied': 'Link copied.',
  'lobby.invite': 'Join my game of little horses — code {code}',
  'lobby.players': 'Players · {n}/4',
  'lobby.free': 'free seat',
  'lobby.addPlayer': '+ Player',
  'lobby.addBot': '+ Bot',
  'lobby.host': 'host',
  'lobby.bot': 'bot',
  'lobby.offline': 'offline',
  'lobby.remove': 'Remove {name}',
  'lobby.rename': 'Name of player {n}',
  'lobby.rules': 'House rules · {variant}',
  'lobby.change': 'Change game',
  'lobby.start': 'Start the game',
  'lobby.needTwo': 'At least 2 players needed',
  'lobby.waitHost': 'Waiting for the host to start…',
  'lobby.footer': 'Random order · 4 horses each',
  'lobby.quit': 'Leave the game',

  'link.connecting': 'Connecting to the game…',
  'link.connecting.hint': 'Your friend must have the game open. It takes two or three seconds.',
  'link.lost': 'Nobody answers',
  'link.lost.offline': 'No signalling relay is reachable: check your internet connection.',
  'link.lost.hint':
    "Three possible causes: the code is wrong, your friend hasn't opened the game yet, or both networks block the direct connection (common on mobile data).",
  'link.otherCode': 'Another code',
  'link.failed': 'The connection failed.',
  'link.blocked': 'Both networks refuse a direct connection.',

  'play.roll': 'Roll the die',
  'play.rolling': 'The die is rolling…',
  'play.boost.low': 'Low number',
  'play.boost.high': 'High number',
  'play.boost.remaining': '{n} boosts left',
  'play.yourTurn': 'Your turn',
  'play.touchDie': 'tap the die',
  'play.turnOf': "{name}'s turn",
  'play.rolled': '{name} rolled {dice}',
  'play.youRolled': 'You rolled {dice}',
  'play.pickOne': 'only one move: playing it',
  'play.pickMany': 'pick a circled horse',
  'play.nothing': 'Nothing to play',
  'play.nothing.hint': 'passing the turn',
  'play.voided': 'Turn lost',
  'play.voided.hint': '{n} sixes in a row',
  'play.over': 'Game over',
  'play.stable': 'in the stable',
  'play.running': '{n} on track',
  'play.homed.one': '{n} home',
  'play.homed.other': '{n} home',
  'play.place': '{n}th place',
  'play.place.first': '1st place',
  'play.pawn.move': 'Move horse {n}',
  'play.pawn.exit': 'Bring out horse {n}',
  'play.pawn.finish': 'Bring horse {n} home',

  'win.title': '{name} wins!',
  'win.detail': '{n}/4 horses home · « {variant} » rules',
  'win.rematch': 'Rematch',
  'win.home': 'Home',
  'win.hostRematch': 'The host can start another round.',
  'win.nobody': 'Nobody',

  'rules.title': 'How to play',
  'rules.footer': 'Three 6s in a row · turn lost',
  'rules.1.title': 'Leave the stable',
  'rules.1.body': 'You need a 6 to put a horse on its starting square.',
  'rules.2.title': 'Go around',
  'rules.2.body': 'Move as many squares as the die shows, clockwise.',
  'rules.3.title': 'Capture',
  'rules.3.body': 'Landing exactly on a rival horse sends it home. Starred squares protect.',
  'rules.4.title': 'Come home',
  'rules.4.body': 'After a full lap, the horse takes its stairway. Exact count to arrive.',
  'rules.5.title': 'Win',
  'rules.5.body': 'First to bring all 4 horses home wins.',

  'variant.petits-chevaux.name': 'Little horses',
  'variant.petits-chevaux.desc': 'The classic French rules. A 6 to come out, roll again on a 6.',
  'variant.petits-chevaux.tag': 'FR',
  'variant.petits-chevaux.meta': '4 horses · 20–30 min',
  'variant.ludo.name': 'Ludo',
  'variant.ludo.desc': 'International rules. Safe star squares, blockades, capture bonus.',
  'variant.ludo.tag': 'INT',
  'variant.ludo.meta': '4 pawns · 15–25 min',
  'variant.rapide.name': 'Quick',
  'variant.rapide.desc': 'Come out on 1 or 6, arrive without an exact count. For a short game.',
  'variant.rapide.tag': 'EXPRESS',
  'variant.rapide.meta': 'easy start · 10 min',

  'chip.exit': '{rolls} to come out',
  'chip.six': '6 rolls again',
  'chip.capture': 'capture sends home',
  'chip.star': 'star squares',
  'chip.exact': 'exact count',
  'chip.blockade': 'blockades',
  'chip.bonus': 'capture bonus',
  'chip.or': ' or ',

  'log.start': 'Game started — « {variant} » rules.',
  'log.roll': 'rolls the die: {dice}.',
  'log.voided': '{n} sixes in a row — turn lost.',
  'log.exit': 'brings out horse {pawn}.',
  'log.finish': 'brings horse {pawn} home!',
  'log.advance': 'moves horse {pawn} by {dice}.',
  'log.capture': 'captures {victim}’s horse {pawn}!',
  'log.pass': 'has nothing to play.',
  'log.win': 'wins the game!',
  'log.rank': 'finishes {place}th.',

  'error.finished': 'The game is over.',
  'error.notYourTurn': "It's not your turn.",
  'error.alreadyRolled': 'The die has already been rolled.',
  'error.rollFirst': 'Roll the die first.',
  'error.illegal': 'That move is not allowed.',
  'error.nothingToPass': 'Nothing to pass.',
  'error.moveExists': 'A move is possible.',

  'theme.auto': 'Auto',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.change': 'Theme: {theme}. Change.',
  'lang.change': 'Language: {lang}. Change.',
}

const DICT: Record<Lang, Partial<Record<Key, string>>> = { fr, en }

let current: Lang = read()

function read(): Lang {
  const saved = localStorage.getItem(KEY)
  if (LANGS.includes(saved as Lang)) return saved as Lang
  return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

export function lang(): Lang {
  return current
}

export function setLang(next: Lang): void {
  current = next
  localStorage.setItem(KEY, next)
  document.documentElement.lang = next
}

export function nextLang(): Lang {
  return LANGS[(LANGS.indexOf(current) + 1) % LANGS.length]!
}

/** Applique la langue retenue, avant le premier rendu. */
export function applyLang(): void {
  document.documentElement.lang = current
}

/** Traduit une clé, en remplaçant les `{marqueurs}` par les valeurs données. */
export function t(key: Key, params?: Record<string, string | number>): string {
  const text = DICT[current][key] ?? fr[key]
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  )
}

/** « il y a 3 min », dans la langue courante. */
export function since(at: number): string {
  const min = Math.round((Date.now() - at) / 60000)
  if (min < 1) return t('save.now')
  if (min < 60) return t('save.minutes', { n: min })
  const hours = Math.round(min / 60)
  if (hours < 24) return t('save.hours', { n: hours })
  const days = Math.round(hours / 24)
  return days === 1 ? t('save.yesterday') : t('save.days', { n: days })
}
