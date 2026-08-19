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
  'app.title': 'Dada',
  'app.tagline': 'le jeu des petits chevaux, entre amis',

  'common.back': 'Retour',
  'common.continue': 'Continuer',
  'common.retry': 'Réessayer',
  'common.forget': 'oublier',
  'common.you': 'vous',
  'common.player': 'Joueur {n}',
  'common.bot': 'Bot {n}',
  'common.close': 'Fermer',
  'common.cancel': 'Annuler',

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

  'invite.resume': 'Revenir dans la partie',
  'invite.detail': 'Partie en ligne · code {code} · {when}',
  'invite.forget.label': 'Oublier la partie en ligne quittée',

  'quit.title': 'Quitter la partie ?',
  'quit.confirm': 'Quitter',
  'quit.online':
    "Un bot tiendra vos chevaux en votre absence. Vous pourrez revenir dans la partie depuis l'accueil, tant qu'elle dure.",
  'quit.local': "La partie est sauvegardée. Vous pourrez la reprendre depuis l'accueil.",
  'quit.lobby': 'Les autres joueurs resteront dans le salon sans vous.',

  'pick.title': 'On joue à quoi ?',
  'pick.hint': 'Les règles maison se règlent juste après, dans le salon.',

  'join.title': 'Rejoindre une partie',
  'join.hint': 'Tapez les {n} caractères que votre ami vous a envoyés.',
  'join.action': 'Rejoindre',
  'join.code.label': 'Code de partie',
  'join.footer': "Le code ouvre un lien direct entre vos téléphones. Rien n'est stocké nulle part.",
  'join.tooShort': 'Entrez le code que vos amis vous ont donné.',
  'join.asking.one': 'Une demande',
  'join.asking': '{n} demandes',
  'join.admit': 'Accepter',
  'join.admit.label': 'Accepter {name} à la table',
  'join.refuse': 'Refuser',
  'join.refuse.label': 'Refuser {name}',
  'join.pending': 'Demande envoyée',
  'join.pending.hint':
    "L'hôte doit vous accepter à sa table. Le code amène jusqu'à la porte, c'est lui qui l'ouvre.",
  'join.denied': "L'hôte a refusé",
  'join.denied.hint': "Vous n'entrerez pas dans cette partie. Vérifiez le code, ou demandez-lui un nouveau lien.",

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
  'lobby.rules': 'Règles maison',
  'lobby.change': 'Changer de jeu',
  'lobby.start': 'Lancer la partie',
  'lobby.needTwo': 'Il faut au moins 2 joueurs',
  'lobby.waitHost': "En attente du lancement par l'hôte…",
  'lobby.footer': 'Ordre tiré au sort · {n} chevaux chacun',
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

  'chat.title': 'Chat',
  'chat.placeholder': 'Écrire un message…',
  'chat.send': 'Envoyer',
  'chat.empty': "Personne n'a encore rien dit.",
  'chat.reactions': 'Réactions',

  'play.roll': 'Lancer le dé',
  'play.rolling': 'Le dé roule…',
  'play.boost.low': 'Petit nombre',
  'play.boost.high': 'Grand nombre',
  'play.boost.remaining.one': '{n} bonus restant',
  'play.boost.remaining': '{n} bonus restants',
  'play.yourTurn': 'À vous',
  'play.touchDie': 'touchez le dé',
  'play.mercy': 'le dé penche vers la sortie',
  'play.mercy.sure': 'ce lancer vous sort',
  'play.cards': '{n} carte(s) en main',
  'play.willSkip': '{n} tour(s) à sauter',
  'play.turnOf': 'Tour {name}',
  'play.rolled': '{name} a fait {dice}',
  'play.youRolled': 'Vous avez fait {dice}',
  'play.pickOne': 'un seul coup : il se joue',
  'play.pickMany': 'choisissez un cheval cerclé',
  'play.nothing': 'Rien à jouer',
  'play.nothing.hint': 'on passe la main',
  'play.nothing.pass': 'touchez le dé pour passer',
  'play.pass': 'Passer la main',
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
  'play.seconds': '{n} s',
  'play.bot': 'tenu par un bot',
  'play.takeBack': 'Reprendre',
  'play.takeBack.label': 'Reprendre la main sur vos chevaux',
  'play.pause': 'Mettre la partie en pause',

  'pause.title': 'Partie en pause',
  'pause.body':
    'Le dé, les bots et le temps de réflexion attendent. Rien ne bouge tant que vous n’avez pas repris.',
  'pause.resume': 'Reprendre la partie',

  'stats.title': 'Feuille de match',
  'stats.distance': 'Cases',
  'stats.average': 'Dé moy.',
  'stats.captures': 'Mangés',
  'stats.losses': 'Perdus',
  'stats.sixes': 'Six',
  'stats.powers': 'Cartes',
  'win.title': '{name} gagne !',
  'win.detail': '{n}/{total} chevaux rentrés · règles « {variant} »',
  'win.rematch': 'Revanche',
  'win.home': 'Accueil',
  'win.hostRematch': "L'hôte peut relancer une manche.",
  'win.nobody': 'Personne',

  'rules.title': 'Comment on joue',
  'rules.full': 'Le règlement complet',
  'rules.footer': 'Dix secondes pour jouer · trois 6 de suite, tour perdu',
  'rules.1.title': "Sortir de l'écurie",
  'rules.1.body':
    "Il faut un 6 pour poser un cheval sur sa case de départ. Plus l'attente dure, plus le dé penche vers la sortie — au sixième tour bloqué, elle est certaine.",
  'rules.2.title': 'Tourner',
  'rules.2.body': 'On avance du nombre de points, dans le sens des aiguilles.',
  'rules.3.title': 'Manger',
  'rules.3.body': 'Tomber pile sur un cheval adverse le renvoie chez lui. Les cases étoilées protègent.',
  'rules.4.title': 'Rentrer',
  'rules.4.body': 'Après le tour complet, le cheval prend son escalier. Compte exact pour arriver.',
  'rules.5.title': 'Gagner',
  'rules.5.body': 'Le premier à rentrer ses 4 chevaux remporte la partie.',
  'rules.6.title': 'Bonus de dé',
  'rules.6.body':
    'Trois fois par partie, avant de lancer, on peut favoriser un petit nombre (1 à 3) ou un grand nombre (4 à 6). Les bonus sont communs à toute la table.',

  'rules.7.title': 'Dix secondes',
  'rules.7.body':
    "Chaque tour est minuté, et le contour de la carte du joueur se vide. Passé le délai, le tour saute — rien n'est joué à sa place. Trois tours sautés, ou un départ en cours de partie, et un bot tient les chevaux jusqu'au retour.",

  'rules.8.title': 'Le plateau',
  'rules.8.body':
    "L'hôte choisit sa forme dans le salon : croix, carré, rond ou serpent. Ce n'est que le décor — même circuit, mêmes distances, mêmes cases protégées.",
  'rules.9.title': 'Cases pouvoir',
  'rules.9.body':
    "Si la table les a activées : huit cases marquées, deux par camp, aux mêmes distances de chaque départ. S'arrêter dessus fait piocher un bonus ou un malus dans un paquet commun. Un malus s'abat aussitôt ; un bonus reste dans votre main, secret, jusqu'à ce que vous l'armiez et lanciez le dé.",
  'variant.petits-chevaux.name': 'Petits chevaux',
  'variant.petits-chevaux.desc':
    'La règle française classique, sur le plateau de 56 cases. Un 6 pour sortir, on rejoue sur un 6.',
  'variant.petits-chevaux.tag': 'FR',
  'variant.petits-chevaux.meta': '56 cases · 4 chevaux · 20–30 min',
  'variant.ludo.name': 'Ludo',
  'variant.ludo.desc':
    'La règle internationale, sur le plateau de 52 cases. Étoiles protégées, barrages, primes de capture.',
  'variant.ludo.tag': 'INT',
  'variant.ludo.meta': '52 cases · 4 pions · 15–25 min',
  'variant.rapide.name': 'Rapide',
  'variant.rapide.desc': 'Sortie sur 1 ou 6, arrivée sans compte exact. Pour une partie courte.',
  'variant.rapide.tag': 'EXPRESS',
  'variant.rapide.meta': '40 cases · sortie facile · 10 min',

  'chip.exit': '{rolls} pour sortir',
  'chip.six': '6 rejoue',
  'chip.capture': 'manger renvoie',
  'chip.star': 'cases étoile',
  'chip.exact': 'compte exact',
  'chip.single': 'une case, un cheval',
  'chip.blockade': 'barrages',
  'chip.bonus': 'prime de capture',
  'chip.or': ' ou ',

  'table.title': 'La table',
  'table.shape': 'Forme du plateau',
  'table.shape.hint':
    'Le décor seulement : même circuit, mêmes distances, mêmes cases protégées. Une partie sur un plateau rond se joue exactement comme sur la croix.',
  'shape.croix': 'Croix',
  'shape.croix.desc': 'Le plateau officiel, celui des boîtes.',
  'shape.carre': 'Carré',
  'shape.carre.desc': 'Le circuit fait le tour du plateau, écuries dans les coins.',
  'shape.rond': 'Rond',
  'shape.rond.desc': 'Un anneau de cases, escaliers en rayons.',
  'shape.serpent': 'Serpent',
  'shape.serpent.desc': 'Le rond, mais qui ondule. Huit ventres, un par demi-bras.',

  'table.powers': 'Cases pouvoir',
  'table.powers.on': 'Activées',
  'table.powers.off': 'Désactivées',
  'table.powers.hint':
    'Huit cases marquées sur le circuit — deux par camp, aux mêmes distances de chaque départ. S’arrêter dessus fait piocher.',
  'table.powers.see': 'Voir les {n} pouvoirs',
  'table.powers.fair':
    'Un paquet de {n} cartes, mélangé une fois et partagé par toute la table : {bonus} bonus pour {malus} malus. Au bout du paquet, chacun a vu la même chose.',

  'powers.title': 'Bonus et malus',
  'powers.bonus': 'Bonus',
  'powers.malus': 'Malus',
  'powers.copies': '×{n}',
  'power.bouclier': 'Bouclier',
  'power.bouclier.desc':
    'Le cheval encaisse la prochaine capture sans bouger. Le bouclier se brise à l’impact — une fois, et une seule.',
  'power.galop': 'Galop',
  'power.galop.desc': 'Le cheval avance de 3 cases de plus, tout de suite.',
  'power.rejeu': 'Rejeu',
  'power.rejeu.desc': 'Vous relancez le dé et rejouez dans la foulée.',
  'power.des': 'Dé pipé',
  'power.des.desc': 'Gardez-la, puis demandez votre petit ou grand nombre : un bonus de dé de plus.',
  'power.fauxpas': 'Faux pas',
  'power.fauxpas.desc': 'Le cheval recule de 3 cases. Il ne repasse jamais par l’écurie.',
  'power.saute': 'Tour sauté',
  'power.saute.desc': 'Votre prochain tour saute. Un seul.',
  'power.ecurie': 'Retour à l’écurie',
  'power.ecurie.desc': 'Le cheval rentre à l’écurie. La carte la plus dure, et la plus rare.',

  'toast.power': '{name} : {power} — {desc}',
  'toast.drew.title': 'Une carte gardée',
  'toast.shielded': 'Le bouclier du cheval {pawn} de {owner} a tenu !',
  'toast.skipped': '{name} saute son tour.',
  'hand.title': 'Vos cartes',
  'hand.count': '{n}/{max} carte(s) en main',
  'hand.aim': 'choisissez un cheval',
  'hand.aim.needed': 'Choisissez d’abord un cheval sur le plateau.',
  'hand.roll': 'lancez le dé pour jouer la carte',
  'hand.validate': 'Lancer le dé et jouer « {power} »',
  'hand.full': 'Main pleine — la carte est perdue',
  'log.played': 'joue « {power} ».',
  'log.handFull': 'a la main pleine : « {power} » est perdue.',
  'toast.played': '{name} joue {power}.',
  'toast.handFull': 'Main pleine — « {power} » est perdue.',
  'log.power': 'ramasse « {power} » avec son cheval {pawn}.',
  'log.shielded': 'se casse les dents sur le bouclier du cheval {pawn} de {owner} !',
  'log.skipped': 'saute son tour.',

  'play.shield': 'protégé',

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
  'error.noSuchPower': "Vous n'avez pas cette carte.",
  'error.powerNotNow': 'Cette carte ne peut pas être jouée maintenant.',

  'notice.hostTaken': "Vous êtes désormais l'hôte de la partie.",
  'notice.seatToBot': 'Un bot prend la place de {name}.',
  'notice.seatBack': '{name} reprend sa place.',

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
  'common.close': 'Close',
  'common.cancel': 'Cancel',

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

  'invite.resume': 'Back to the game',
  'invite.detail': 'Online game · code {code} · {when}',
  'invite.forget.label': 'Forget the game you left',

  'quit.title': 'Leave the game?',
  'quit.confirm': 'Leave',
  'quit.online':
    'A bot will hold your horses while you are away. You can come back to the game from the home screen, as long as it lasts.',
  'quit.local': 'The game is saved. You can resume it from the home screen.',
  'quit.lobby': 'The other players will stay in the lobby without you.',

  'pick.title': 'What are we playing?',
  'pick.hint': 'House rules come right after, in the lobby.',

  'join.title': 'Join a game',
  'join.hint': 'Type the {n} characters your friend sent you.',
  'join.action': 'Join',
  'join.code.label': 'Game code',
  'join.footer': 'The code opens a direct link between your phones. Nothing is stored anywhere.',
  'join.tooShort': 'Enter the code your friends gave you.',
  'join.asking.one': 'One request',
  'join.asking': '{n} requests',
  'join.admit': 'Let in',
  'join.admit.label': 'Let {name} join the table',
  'join.refuse': 'Turn away',
  'join.refuse.label': 'Turn {name} away',
  'join.pending': 'Request sent',
  'join.pending.hint':
    'The host has to let you in. The code takes you to the door; they open it.',
  'join.denied': 'The host said no',
  'join.denied.hint': 'You will not join this game. Check the code, or ask them for a fresh link.',

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
  'lobby.rules': 'House rules',
  'lobby.change': 'Change game',
  'lobby.start': 'Start the game',
  'lobby.needTwo': 'At least 2 players needed',
  'lobby.waitHost': 'Waiting for the host to start…',
  'lobby.footer': 'Random order · {n} horses each',
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

  'chat.title': 'Chat',
  'chat.placeholder': 'Type a message…',
  'chat.send': 'Send',
  'chat.empty': 'Nobody has said anything yet.',
  'chat.reactions': 'Reactions',

  'play.roll': 'Roll the die',
  'play.rolling': 'The die is rolling…',
  'play.boost.low': 'Low number',
  'play.boost.high': 'High number',
  'play.boost.remaining.one': '{n} boost left',
  'play.boost.remaining': '{n} boosts left',
  'play.yourTurn': 'Your turn',
  'play.touchDie': 'tap the die',
  'play.mercy': 'the die leans towards the gate',
  'play.mercy.sure': 'this roll gets you out',
  'play.cards': '{n} card(s) in hand',
  'play.willSkip': '{n} turn(s) to skip',
  'play.turnOf': "{name}'s turn",
  'play.rolled': '{name} rolled {dice}',
  'play.youRolled': 'You rolled {dice}',
  'play.pickOne': 'only one move: playing it',
  'play.pickMany': 'pick a circled horse',
  'play.nothing': 'Nothing to play',
  'play.nothing.hint': 'passing the turn',
  'play.nothing.pass': 'tap the die to pass',
  'play.pass': 'Pass the turn',
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
  'play.seconds': '{n}s',
  'play.bot': 'held by a bot',
  'play.takeBack': 'Take over',
  'play.takeBack.label': 'Take your horses back from the bot',
  'play.pause': 'Pause the game',

  'pause.title': 'Game paused',
  'pause.body': 'The die, the bots and the turn clock are all waiting. Nothing moves until you come back.',
  'pause.resume': 'Resume the game',

  'stats.title': 'Scoresheet',
  'stats.distance': 'Squares',
  'stats.average': 'Avg. die',
  'stats.captures': 'Eaten',
  'stats.losses': 'Lost',
  'stats.sixes': 'Sixes',
  'stats.powers': 'Cards',
  'win.title': '{name} wins!',
  'win.detail': '{n}/{total} horses home · « {variant} » rules',
  'win.rematch': 'Rematch',
  'win.home': 'Home',
  'win.hostRematch': 'The host can start another round.',
  'win.nobody': 'Nobody',

  'rules.title': 'How to play',
  'rules.full': 'The full rulebook',
  'rules.footer': 'Ten seconds to play · three 6s in a row, turn lost',
  'rules.1.title': 'Leave the stable',
  'rules.1.body':
    'You need a 6 to put a horse on its starting square. The longer you wait, the more the die leans towards the gate — by the sixth turn stuck, coming out is certain.',
  'rules.2.title': 'Go around',
  'rules.2.body': 'Move as many squares as the die shows, clockwise.',
  'rules.3.title': 'Capture',
  'rules.3.body': 'Landing exactly on a rival horse sends it home. Starred squares protect.',
  'rules.4.title': 'Come home',
  'rules.4.body': 'After a full lap, the horse takes its stairway. Exact count to arrive.',
  'rules.5.title': 'Win',
  'rules.5.body': 'First to bring all 4 horses home wins.',
  'rules.6.title': 'Dice bonus',
  'rules.6.body':
    'Three times a game, before rolling, you can favour a low number (1 to 3) or a high one (4 to 6). The bonuses are shared by the whole table.',

  'rules.7.title': 'Ten seconds',
  'rules.7.body':
    "Every turn is timed, and the outline of the player's card empties out. Once time is up the turn is skipped — nothing is played for them. Three skipped turns, or leaving mid-game, and a bot holds the horses until they come back.",

  'rules.8.title': 'The board',
  'rules.8.body':
    'The host picks its shape in the lobby: cross, square, round or snake. It is the look only — same track, same distances, same protected squares.',
  'rules.9.title': 'Power squares',
  'rules.9.body':
    'If the table turned them on: eight marked squares, two per colour, at the same distances from every start. Landing on one draws a bonus or a penalty from a shared deck. A penalty lands at once; a bonus stays in your hand, secret, until you arm it and roll the die.',
  'variant.petits-chevaux.name': 'Little horses',
  'variant.petits-chevaux.desc':
    'The classic French rules, on the 56-square board. A 6 to come out, roll again on a 6.',
  'variant.petits-chevaux.tag': 'FR',
  'variant.petits-chevaux.meta': '56 squares · 4 horses · 20–30 min',
  'variant.ludo.name': 'Ludo',
  'variant.ludo.desc':
    'International rules, on the 52-square board. Safe star squares, blockades, capture bonus.',
  'variant.ludo.tag': 'INT',
  'variant.ludo.meta': '52 squares · 4 pawns · 15–25 min',
  'variant.rapide.name': 'Quick',
  'variant.rapide.desc': 'Come out on 1 or 6, arrive without an exact count. For a short game.',
  'variant.rapide.tag': 'EXPRESS',
  'variant.rapide.meta': '40 squares · easy start · 10 min',

  'chip.exit': '{rolls} to come out',
  'chip.six': '6 rolls again',
  'chip.capture': 'capture sends home',
  'chip.star': 'star squares',
  'chip.exact': 'exact count',
  'chip.single': 'one horse per square',
  'chip.blockade': 'blockades',
  'chip.bonus': 'capture bonus',
  'chip.or': ' or ',

  'table.title': 'The table',
  'table.shape': 'Board shape',
  'table.shape.hint':
    'The look only: same track, same distances, same protected squares. A game on a round board plays exactly like the cross.',
  'shape.croix': 'Cross',
  'shape.croix.desc': 'The official board, the one in the box.',
  'shape.carre': 'Square',
  'shape.carre.desc': 'The track runs around the edge, stables in the corners.',
  'shape.rond': 'Round',
  'shape.rond.desc': 'A ring of squares, home lanes as spokes.',
  'shape.serpent': 'Snake',
  'shape.serpent.desc': 'The ring, but it waves. Eight coils, one per half-arm.',

  'table.powers': 'Power squares',
  'table.powers.on': 'On',
  'table.powers.off': 'Off',
  'table.powers.hint':
    'Eight marked squares on the track — two per colour, at the same distances from every start. Landing on one draws a card.',
  'table.powers.see': 'See the {n} powers',
  'table.powers.fair':
    'A {n}-card deck, shuffled once and shared by the whole table: {bonus} bonuses to {malus} penalties. By the end of the deck, everyone has seen the same thing.',

  'powers.title': 'Bonuses and penalties',
  'powers.bonus': 'Bonuses',
  'powers.malus': 'Penalties',
  'powers.copies': '×{n}',
  'power.bouclier': 'Shield',
  'power.bouclier.desc':
    'The horse takes the next capture without moving. The shield breaks on impact — once, and only once.',
  'power.galop': 'Gallop',
  'power.galop.desc': 'The horse moves 3 more squares, right away.',
  'power.rejeu': 'Replay',
  'power.rejeu.desc': 'You roll again and play on.',
  'power.des': 'Loaded die',
  'power.des.desc': 'Keep it, then ask for your low or high number: one more die bonus.',
  'power.fauxpas': 'Stumble',
  'power.fauxpas.desc': 'The horse goes back 3 squares. It never falls back into the stable.',
  'power.saute': 'Lost turn',
  'power.saute.desc': 'Your next turn is skipped. Just one.',
  'power.ecurie': 'Back to the stable',
  'power.ecurie.desc': 'The horse goes home. The harshest card, and the rarest.',

  'toast.power': '{name}: {power} — {desc}',
  'toast.drew.title': 'A card kept',
  'toast.shielded': 'The shield on {owner}’s horse {pawn} held!',
  'toast.skipped': '{name} skips a turn.',
  'hand.title': 'Your cards',
  'hand.count': '{n}/{max} card(s) in hand',
  'hand.aim': 'pick a horse',
  'hand.aim.needed': 'Pick a horse on the board first.',
  'hand.roll': 'roll the die to play the card',
  'hand.validate': 'Roll the die and play “{power}”',
  'hand.full': 'Hand full — the card is lost',
  'log.played': 'plays “{power}”.',
  'log.handFull': 'has a full hand: “{power}” is lost.',
  'toast.played': '{name} plays {power}.',
  'toast.handFull': 'Hand full — “{power}” is lost.',
  'log.power': 'picks up “{power}” with horse {pawn}.',
  'log.shielded': 'breaks against the shield on {owner}’s horse {pawn}!',
  'log.skipped': 'skips a turn.',

  'play.shield': 'shielded',

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
  'error.noSuchPower': 'You do not hold that card.',
  'error.powerNotNow': 'That card cannot be played right now.',

  'notice.hostTaken': 'You are now the host of the game.',
  'notice.seatToBot': 'A bot takes over for {name}.',
  'notice.seatBack': '{name} is back.',

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
