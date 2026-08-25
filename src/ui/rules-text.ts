/**
 * Le règlement complet, en français et en anglais.
 *
 * Dans son propre module, et non dans `i18n.ts`, pour la même raison que les
 * textes de la page « à propos » : ce n'est pas de la chaîne d'interface, c'est
 * un document. Il se relit en entier quand une règle change, il n'a aucune
 * raison de bouger au rythme des libellés de boutons, et le mélanger aux clés
 * d'écran rendrait les deux illisibles.
 *
 * ## Ce que ce document doit être
 *
 * **Vrai de ce jeu-là.** Pas des petits chevaux en général : de celui-ci, avec
 * ses trois variantes et ses réglages de table. Une règle écrite ici et pas
 * appliquée par `engine.ts` est un bug — dans le texte ou dans le code, mais un
 * bug.
 *
 * **Utile aux moments de dispute.** L'écran « Comment on joue » explique en neuf
 * étapes comment lancer sa première partie ; il ne dit pas si l'on peut poser
 * deux chevaux sur la même case, ni ce qui se passe quand on tombe sur un
 * bouclier. Ce document-ci répond à ces questions-là, et c'est son seul travail.
 * Chaque section dit donc aussi ce qui est **interdit** : c'est ce qu'on vient
 * y chercher.
 *
 * **Marqué par variante.** Les trois jeux ne partagent pas toutes leurs règles,
 * et une règle sans étiquette laisserait croire qu'elle vaut partout. Les
 * étiquettes sont celles des cartes de l'écran de choix : FR, INT, EXPRESS.
 */

import type { Lang } from './i18n.ts'

/**
 * Les variantes auxquelles une règle s'applique. Vide = toutes.
 *
 * `teams` marque les règles qui n'existent que dans la variante deux contre
 * deux : un partenaire qu'on ne mange pas, un tour qu'on prête, une victoire à
 * deux. Sans étiquette, elles se liraient comme des règles générales — et l'on
 * chercherait son coéquipier dans une partie qui n'en a pas.
 */
export type RuleTag = 'fr' | 'int' | 'express' | 'teams'

export type Rule = {
  title: string
  body: string[]
  /** Vide : la règle vaut pour les trois jeux. */
  only?: RuleTag[]
}

export type RuleChapter = {
  heading: string
  rules: Rule[]
}

export type RulesText = {
  title: string
  back: string
  intro: string
  legend: Record<RuleTag, string>
  all: string
  chapters: RuleChapter[]
}

const fr: RulesText = {
  title: 'Le règlement',
  back: 'Retour',
  intro:
    "Ce qui est permis, ce qui ne l'est pas, et ce qui change d'un jeu à l'autre. Les règles marquées d'une étiquette ne valent que pour le jeu correspondant.",
  legend: { fr: 'Petits chevaux', int: 'Ludo', express: 'Rapide', teams: 'Équipes' },
  all: 'les quatre jeux',
  chapters: [
    {
      heading: 'Le plateau',
      rules: [
        {
          title: 'Deux plateaux, et non un seul',
          body: [
            "Les petits chevaux se jouent sur le plateau français : 56 cases, 14 par quart de tour. Son tracé passe par les quatre angles du carré central, si bien qu'un cheval avance toujours d'un côté de case à la fois.",
            "Le Ludo se joue sur le plateau international : 52 cases, 13 par quart. Il coupe ces quatre angles, et le pion y tourne en diagonale — exactement comme sur un plateau imprimé.",
            "La variante rapide se joue sur un plateau réduit de 40 cases, avec deux chevaux par joueur au lieu de quatre.",
          ],
        },
        {
          title: 'La forme ne change rien au jeu',
          body: [
            "L'hôte choisit dans le salon la forme du plateau : croix, carré, rond ou serpent. C'est du décor. Les quatre formes ont le même circuit, les mêmes distances, les mêmes cases protégées et les mêmes cases pouvoir : une partie sur le rond se déroule exactement comme la même partie sur la croix.",
            "Une seule exception, et elle est visible : le carré demande un nombre de cases pair par quart. Le Ludo joué sur un plateau carré tourne donc sur 56 cases et non 52.",
          ],
        },
        {
          title: "L'escalier et son décompte",
          body: [
            "Chaque camp a son escalier privé, qui mène au cœur du plateau. Il compte 6 marches sur les deux grands plateaux, 4 sur le plateau réduit. Aucun cheval ne peut entrer dans l'escalier d'un autre camp, ni même le traverser.",
            "Sur le plateau français, les marches portent leur numéro : c'est un plateau où la règle stricte demande le chiffre exact de la marche visée. Le couloir du Ludo est une bande de couleur, sans numéros.",
          ],
        },
      ],
    },
    {
      heading: "Sortir de l'écurie",
      rules: [
        {
          title: 'Il faut un 6',
          body: [
            "Un cheval à l'écurie ne peut en sortir que sur un 6, et il se pose alors sur la case de départ de sa couleur. Aucune autre valeur ne le fait sortir, et aucun cheval ne peut être déplacé tant qu'il est à l'écurie.",
          ],
          only: ['fr', 'int'],
        },
        {
          title: 'Un 1 suffit aussi',
          body: ["Dans la variante rapide, un cheval sort de l'écurie sur un 1 comme sur un 6."],
          only: ['express'],
        },
        {
          title: 'Le dé finit par pencher',
          body: [
            "Attendre un 6 est une loi de probabilité, pas une épreuve d'adresse : une partie sur cinq laisserait un joueur enfermé plus de huit tours. Le dé reste donc franc au premier essai, puis penche d'un cran par tour passé sans pouvoir sortir. Au sixième, la sortie est certaine.",
            "Le joueur concerné le lit au-dessus du dé — « le dé penche vers la sortie », puis « ce lancer vous sort ». Un dé qui aiderait sans le dire serait un dé truqué. Le compteur retombe à zéro dès qu'un cheval est dehors.",
            "La variante rapide, qui sort déjà sur deux faces, garde un dé entièrement franc.",
          ],
        },
        {
          title: 'La case de départ peut être bloquée',
          body: [
            "Si l'un de vos chevaux occupe déjà votre case de départ, vous ne pouvez pas en sortir un second : une case ne porte qu'un cheval. Il faut d'abord dégager celui qui est là.",
          ],
          only: ['fr'],
        },
      ],
    },
    {
      heading: 'Avancer',
      rules: [
        {
          title: 'Du nombre de points, dans le sens des aiguilles',
          body: [
            "On avance un seul cheval du nombre indiqué par le dé. On ne partage jamais un résultat entre deux chevaux.",
            "Si aucun coup n'est possible, la main passe. Ce n'est pas une punition : c'est simplement qu'il n'y avait rien à jouer.",
          ],
        },
        {
          title: 'Une case, un cheval',
          body: [
            "Deux chevaux ne peuvent pas occuper la même case. S'il s'agit de vos propres chevaux, l'un reste derrière l'autre : le coup qui les superposerait n'existe pas, et il ne vous est pas proposé.",
            "Un coup qui amènerait votre cheval sur un adversaire que vous ne pouvez pas manger — parce qu'il est sur sa case de départ — est refusé pour la même raison.",
            "L'arrivée fait exception : c'est là que tous les chevaux se rejoignent.",
          ],
          only: ['fr'],
        },
        {
          title: 'Personne ne barre la route',
          body: [
            "Deux pions d'une même couleur peuvent partager une case : ils y tiennent à deux, et cela ne dresse aucun mur.",
            "Aucune pile de pions n'arrête qui que ce soit. On la franchit, et on peut s'arrêter dessus — auquel cas on mange tout ce qui s'y trouvait, si la case n'est pas protégée.",
            "Il y a eu ici une règle de barrage ; elle a été retirée. Une table qui n'avance plus n'est pas une partie difficile, c'est une partie arrêtée.",
          ],
          only: ['int', 'express'],
        },
      ],
    },
    {
      heading: 'Manger',
      rules: [
        {
          title: 'Tomber pile renvoie à l’écurie',
          body: [
            "Arriver exactement sur une case occupée par un cheval adverse le renvoie à son écurie. Il devra ressortir sur un 6. Passer par-dessus ne fait rien : seule la case d'arrivée compte.",
            "On ne mange jamais dans un escalier : ils sont privés, et aucun adversaire n'y entre.",
          ],
        },
        {
          title: 'Les cases de départ protègent',
          body: [
            "Un cheval posé sur sa propre case de départ ne peut pas être mangé. C'est la seule protection de la règle française.",
          ],
          only: ['fr'],
        },
        {
          title: 'Les cases étoilées protègent aussi',
          body: [
            "Outre les quatre cases de départ, quatre cases étoilées sont abritées — une par camp, huit crans après son départ. Un pion qui s'y trouve ne peut pas être mangé, et deux couleurs peuvent y cohabiter.",
          ],
          only: ['int', 'express'],
        },
      ],
    },
    {
      heading: 'Rentrer et gagner',
      rules: [
        {
          title: 'Le compte exact',
          body: [
            "Après le tour complet du circuit, le cheval prend son escalier. Il faut le compte exact pour atteindre l'arrivée : un résultat trop grand ne se joue pas, et ce cheval-là reste où il est.",
          ],
          only: ['fr', 'int'],
        },
        {
          title: 'Sans compte exact',
          body: [
            "Dans la variante rapide, un résultat trop grand amène quand même le cheval à l'arrivée. Les parties finissent bien plus vite.",
          ],
          only: ['express'],
        },
        {
          title: 'La partie continue après le premier',
          body: [
            "Le premier joueur qui a rentré tous ses chevaux gagne, mais la partie ne s'arrête pas là : les autres continuent de jouer pour la deuxième et la troisième place. Elle s'achève quand il ne reste plus qu'un joueur en piste.",
          ],
        },
      ],
    },
    {
      heading: 'Rejouer, et perdre son tour',
      rules: [
        {
          title: 'Un 6 rejoue',
          body: [
            "Un 6 donne droit à un second lancer, même si l'on n'a rien pu jouer avec.",
            "Trois 6 d'affilée annulent le tour : le troisième ne se joue pas, et la main passe. Sans cette règle, une bonne série n'aurait pas de fin.",
          ],
        },
        {
          title: 'Manger et rentrer rejouent aussi',
          body: [
            "Au Ludo et en rapide, manger un pion adverse ou amener un pion à l'arrivée donne également droit à un second lancer. La règle française ne l'accorde qu'au 6.",
          ],
          only: ['int', 'express'],
        },
        {
          title: 'Dix secondes pour jouer',
          body: [
            "Chaque tour est minuté, et le contour de la carte du joueur se vide. Passé le délai, le tour saute — rien n'est joué à sa place, ne pas jouer est toute la peine.",
            "Trois tours sautés d'affilée, ou vingt secondes d'absence, et un bot tient le siège en attendant. Le siège reste celui de son joueur : il porte toujours son nom, et son retour — ou un appui sur « Reprendre » — le lui rend.",
          ],
        },
      ],
    },
    {
      heading: 'Le bonus de dé',
      rules: [
        {
          title: 'Trois fois par partie, chacun les siens',
          body: [
            "Avant de lancer, on peut demander un petit nombre (1 à 3) ou un grand nombre (4 à 6). Le dé penche alors nettement du côté choisi, sans jamais y être forcé.",
            "Chacun a ses trois bonus pour la partie, et ne dépense que les siens. La réserve fut un temps commune à la table : le premier à jouer la vidait, et les trois autres n'avaient plus rien à demander.",
          ],
        },
      ],
    },
    {
      heading: 'Équipes — deux contre deux',
      rules: [
        {
          title: 'Les sièges qui se font face jouent ensemble',
          body: [
            "Les sièges 0 et 2 contre les sièges 1 et 3 : les places qui se font face, comme à la belote. La table doit être complète — quatre joueurs, humains ou ordinateurs, ni plus ni moins.",
            "Une équipe de un contre une équipe de deux ne serait pas une variante mais un handicap : le jeu refuse de commencer plutôt que de commencer bancal.",
          ],
          only: ['teams'],
        },
        {
          title: "Le partenaire n'est pas un adversaire",
          body: [
            "On ne mange pas son coéquipier, ni au dé ni au galop, et l'on ne brise pas son bouclier. Tomber pile sur sa case n'y change rien : on la partage, exactement comme deux chevaux de sa propre couleur au Ludo.",
            "Le camp d'en face est le seul contre lequel on joue, et c'est aussi le seul que les cartes peuvent viser. Les malus, eux, tombent de toute façon sur le cheval qui a ramassé la carte — jamais sur un cheval choisi.",
          ],
          only: ['teams'],
        },
        {
          title: 'Qui a fini joue pour son partenaire',
          body: [
            "Un joueur qui a rentré ses quatre chevaux ne s'assied pas pour regarder. À son tour, il lance le dé et déplace les chevaux de son partenaire : les coups qu'on lui propose sont ceux d'en face, et ses cartes peuvent désigner un cheval qui n'est pas le sien.",
            "Sa main, elle, reste la sienne : on prête ses tours, pas ses cartes. C'est ce qui empêche une partie en équipes de finir sur un joueur qui n'a plus rien à faire pendant que l'autre termine seul.",
            "L'écran le dit sur la ligne de tour — « vous jouez pour Sami » — et les chevaux cerclés sont bien ceux du partenaire.",
          ],
          only: ['teams'],
        },
        {
          title: 'On gagne à deux',
          body: [
            "L'équipe dont les huit chevaux sont rentrés l'emporte, et la partie s'arrête là : il n'y a pas de deuxième place à disputer entre deux camps.",
            "La feuille de match porte les quatre joueurs, rangés par camp, l'équipe gagnante devant et chaque paire par ordre d'arrivée.",
            "Le malus « tour sauté » reste personnel : il punit le joueur, pas son camp.",
          ],
          only: ['teams'],
        },
      ],
    },
    {
      heading: 'Les cases pouvoir',
      rules: [
        {
          title: 'Facultatives, et décidées ensemble',
          body: [
            "L'hôte les active dans le salon, avant le lancement. Sans elles, le jeu est exactement celui décrit plus haut.",
            "Activées, elles posent huit cases marquées sur le circuit — deux par camp, aux mêmes distances du départ de chacun. Le motif se répète à l'identique tous les quarts de tour : personne n'a le bon coin du plateau.",
          ],
        },
        {
          title: 'S’arrêter dessus fait piocher',
          body: [
            "Il faut s'arrêter exactement sur la case : la traverser ne fait rien.",
            "La pioche est un paquet de seize cartes — dix bonus, six malus — mélangé au début de la partie et partagé par toute la table. Il se consomme par le haut et se remélange quand il est vide. Le hasard décide de l'ordre, jamais des proportions : au bout du paquet, tout le monde a vu la même chose.",
            "Un pouvoir qui déplace un cheval ne redéclenche pas la case sur laquelle il l'amène.",
          ],
        },
        {
          title: 'Les bonus se gardent, les malus se subissent',
          body: [
            "Un malus s'applique immédiatement. Un bonus rejoint votre main, et c'est vous qui choisissez son moment — aucun bonus ne se joue tout seul.",
            "On garde trois cartes au plus. Une carte ramassée alors que la main est pleine est perdue — c'est ce qui pousse à dépenser plutôt qu'à thésauriser.",
            "Votre main n'est qu'à vous : la table voit combien de cartes vous gardez, jamais lesquelles.",
            "Un pouvoir peut durer : un bouclier tient sur son cheval aussi longtemps que personne ne vient le manger, une partie entière s'il le faut.",
          ],
        },
        {
          title: 'Le dé valide la carte',
          body: [
            "On touche la carte : elle s'arme devant soi, elle ne part pas. Si elle demande un cheval, on le désigne sur le plateau — il se cercle de vert.",
            "Puis on lance le dé : c'est lui qui joue la carte. Un seul geste, et l'ordre est toujours le même — la carte d'abord, le dé ensuite.",
            "Toucher la carte une seconde fois la range. Rien n'est joué tant que le dé n'a pas bougé.",
            "Jouer une carte ne consomme pas le tour : le bouclier posé avant le lancer protège dès ce lancer, et le rejeu se joue sur un dé déjà sur la table — on le touche, puis on retouche le dé.",
          ],
        },
        {
          title: 'Ce que fait chaque carte',
          body: [
            "Bouclier — le cheval désigné encaisse la prochaine capture sans bouger, et le bouclier se brise. Il se pose sur un cheval en piste : à l'écurie, rien ne peut le manger.",
            "Galop — le cheval désigné avance de trois cases de plus. Il ne dépasse jamais l'arrivée : gagner par accident serait pire que rien.",
            "Rejeu — on relance le dé et on rejoue. Une chaîne de 6 continue de compter : relancer n'efface pas les 6 déjà posés.",
            "Dé pipé — un bonus de dé de plus dans sa propre réserve. Il se garde en main comme les autres bonus : armez-le, puis demandez votre petit ou votre grand nombre — le même geste range la carte et penche le dé.",
            "Faux pas — votre cheval recule de trois cases. Il ne repasse jamais par l'écurie, et reculer ne mange personne.",
            "Tour sauté — votre prochain tour saute. Un seul.",
            "Retour à l'écurie — votre cheval rentre, bouclier compris. La carte la plus dure, et la seule de son espèce dans le paquet.",
          ],
        },
      ],
    },
  ],
}

const en: RulesText = {
  title: 'The rulebook',
  back: 'Back',
  intro:
    'What is allowed, what is not, and what changes from one game to another. Rules carrying a tag apply only to that game.',
  legend: { fr: 'Little horses', int: 'Ludo', express: 'Quick', teams: 'Teams' },
  all: 'all four games',
  chapters: [
    {
      heading: 'The board',
      rules: [
        {
          title: 'Two boards, not one',
          body: [
            'Little horses is played on the French board: 56 squares, 14 per quarter. Its path runs through the four corners of the central square, so a horse always moves one square-edge at a time.',
            'Ludo is played on the international board: 52 squares, 13 per quarter. It cuts those four corners, and the pawn turns diagonally there — exactly as on a printed board.',
            'The quick variant uses a reduced 40-square board, with two horses per player instead of four.',
          ],
        },
        {
          title: 'The shape changes nothing',
          body: [
            'The host picks the board shape in the lobby: cross, square, round or snake. It is decoration. All four share the same track, the same distances, the same protected squares and the same power squares: a game on the round board plays exactly like the same game on the cross.',
            'One visible exception: the square needs an even number of squares per quarter. Ludo played on a square board therefore runs on 56 squares, not 52.',
          ],
        },
        {
          title: 'The home lane and its count',
          body: [
            "Each colour has a private home lane leading to the centre. It has 6 steps on both large boards, 4 on the reduced one. No horse may enter another colour's lane, or even cross it.",
            'On the French board the steps carry their number: it is a board whose strict rule asks for the exact number of the step you aim at. The Ludo lane is a plain colour band, without numbers.',
          ],
        },
      ],
    },
    {
      heading: 'Leaving the stable',
      rules: [
        {
          title: 'You need a 6',
          body: [
            'A horse in the stable comes out only on a 6, landing on its colour’s starting square. No other value brings it out, and a horse in the stable cannot be moved.',
          ],
          only: ['fr', 'int'],
        },
        {
          title: 'A 1 works too',
          body: ['In the quick variant a horse comes out on a 1 as well as on a 6.'],
          only: ['express'],
        },
        {
          title: 'The die eventually leans',
          body: [
            'Waiting for a 6 is a law of probability, not a test of skill: one game in five would leave a player penned for more than eight turns. The die stays fair on the first try, then leans one notch per turn spent stuck. On the sixth, coming out is certain.',
            'The player concerned reads it above the die — “the die leans towards the exit”, then “this roll gets you out”. A die that helped without saying so would be a loaded die. The counter resets the moment a horse is out.',
            'The quick variant, which already comes out on two faces, keeps a completely fair die.',
          ],
        },
        {
          title: 'The starting square can be blocked',
          body: [
            'If one of your horses already stands on your starting square, you cannot bring a second one out: a square holds one horse. Clear the first one out of the way.',
          ],
          only: ['fr'],
        },
      ],
    },
    {
      heading: 'Moving',
      rules: [
        {
          title: 'By the number rolled, clockwise',
          body: [
            'You move a single horse by the number shown. A roll is never split between two horses.',
            'If no move is possible, the turn passes. That is not a punishment: there was simply nothing to play.',
          ],
        },
        {
          title: 'One horse per square',
          body: [
            'Two horses cannot occupy the same square. If they are both yours, one stays behind the other: the move that would stack them does not exist, and is not offered to you.',
            'A move that would bring your horse onto an opponent you cannot eat — because it stands on its starting square — is refused for the same reason.',
            'The finish is the exception: that is where every horse gathers.',
          ],
          only: ['fr'],
        },
        {
          title: 'Nobody blocks the road',
          body: [
            'Two pawns of the same colour may share a square: both fit, and it builds no wall.',
            'No stack of pawns ever stops anyone. You pass it, and you may land on it — eating whatever stood there, if the square is not a safe one.',
            'There used to be a blockade rule here; it has been removed. A table that cannot advance is not a hard game, it is a stopped one.',
          ],
          only: ['int', 'express'],
        },
      ],
    },
    {
      heading: 'Eating',
      rules: [
        {
          title: 'Landing exactly sends it home',
          body: [
            'Landing exactly on a square held by an opposing horse sends it back to its stable, to come out again on a 6. Passing over it does nothing: only the landing square counts.',
            'You never eat inside a home lane: they are private, and no opponent enters them.',
          ],
        },
        {
          title: 'Starting squares protect',
          body: [
            'A horse standing on its own starting square cannot be eaten. It is the only protection in the French rules.',
          ],
          only: ['fr'],
        },
        {
          title: 'Star squares protect too',
          body: [
            'Besides the four starting squares, four star squares are safe — one per colour, eight steps after its start. A pawn there cannot be eaten, and two colours may share it.',
          ],
          only: ['int', 'express'],
        },
      ],
    },
    {
      heading: 'Coming home and winning',
      rules: [
        {
          title: 'The exact count',
          body: [
            'After a full lap the horse takes its home lane. The exact count is needed to reach the finish: too large a roll cannot be played, and that horse stays where it is.',
          ],
          only: ['fr', 'int'],
        },
        {
          title: 'Without an exact count',
          body: [
            'In the quick variant, too large a roll still brings the horse home. Games end far sooner.',
          ],
          only: ['express'],
        },
        {
          title: 'The game continues after the first',
          body: [
            'The first player to bring every horse home wins, but the game does not stop there: the others keep playing for second and third place. It ends when only one player is left running.',
          ],
        },
      ],
    },
    {
      heading: 'Rolling again, and losing a turn',
      rules: [
        {
          title: 'A 6 rolls again',
          body: [
            'A 6 grants a second roll, even when nothing could be played with it.',
            'Three 6s in a row void the turn: the third is not played, and the turn passes. Without that rule a good streak would have no end.',
          ],
        },
        {
          title: 'Eating and coming home roll again too',
          body: [
            'In Ludo and Quick, eating an opposing pawn or bringing one home also grants a second roll. The French rules grant it only on a 6.',
          ],
          only: ['int', 'express'],
        },
        {
          title: 'Ten seconds to play',
          body: [
            'Every turn is timed, and the outline of the player’s card empties. Past the deadline the turn is skipped — nothing is played on their behalf; not playing is the whole penalty.',
            'Three skipped turns in a row, or twenty seconds away, and a bot holds the seat meanwhile. The seat stays theirs: it still carries their name, and their return — or a tap on “Take back” — gives it to them.',
          ],
        },
      ],
    },
    {
      heading: 'The die bonus',
      rules: [
        {
          title: 'Three times a game, each their own',
          body: [
            'Before rolling you may ask for a low number (1 to 3) or a high one (4 to 6). The die then leans clearly that way, without ever being forced.',
            'Everyone gets three bonuses for the game, and spends only their own. The reserve was once shared by the table: the first to play emptied it, and the other three had nothing left to ask for.',
          ],
        },
      ],
    },
    {
      heading: 'Teams — two against two',
      rules: [
        {
          title: 'Seats facing each other play together',
          body: [
            'Seats 0 and 2 against seats 1 and 3: the places that face each other, as in a game of belote. The table must be full — four players, human or computer, no more and no fewer.',
            'A team of one against a team of two would not be a variant but a handicap: the game refuses to start rather than start lopsided.',
          ],
          only: ['teams'],
        },
        {
          title: 'Your partner is not an opponent',
          body: [
            "You never eat your teammate, neither by the die nor by a gallop, and you never break their shield. Landing exactly on their square changes nothing: you share it, exactly like two pawns of your own colour in Ludo.",
            'The other camp is the only one you play against, and the only one your cards can aim at. Penalties, in any case, land on the horse that picked up the card — never on a chosen one.',
          ],
          only: ['teams'],
        },
        {
          title: 'Whoever is done plays for their partner',
          body: [
            "A player who has brought all four horses home does not sit back and watch. On their turn they roll the die and move their partner's horses: the moves offered are the ones across the table, and their cards may target a horse that is not theirs.",
            'Their hand, though, stays their own: you lend your turns, not your cards. That is what stops a team game from ending on a player with nothing left to do while the other finishes alone.',
            "The turn line says so — “you are playing for Sami” — and the circled horses really are the partner's.",
          ],
          only: ['teams'],
        },
        {
          title: 'You win together',
          body: [
            'The team whose eight horses are all home wins, and the game stops there: there is no second place to fight over between two camps.',
            'The score sheet lists all four players, grouped by camp, the winning team first and each pair in order of arrival.',
            'The “skip a turn” penalty stays personal: it punishes the player, not the camp.',
          ],
          only: ['teams'],
        },
      ],
    },
    {
      heading: 'Power squares',
      rules: [
        {
          title: 'Optional, and decided together',
          body: [
            'The host turns them on in the lobby, before the start. Without them the game is exactly the one described above.',
            'Turned on, they place eight marked squares on the track — two per colour, at the same distances from everyone’s start. The pattern repeats identically every quarter lap: nobody has the good corner of the board.',
          ],
        },
        {
          title: 'Stopping on one draws a card',
          body: [
            'You must stop exactly on the square: crossing it does nothing.',
            'The draw is a sixteen-card deck — ten bonuses, six penalties — shuffled at the start and shared by the whole table. It is consumed from the top and reshuffled when empty. Chance decides the order, never the proportions: by the end of the deck everyone has seen the same thing.',
            'A power that moves a horse does not re-trigger the square it lands it on.',
          ],
        },
        {
          title: 'Bonuses are kept, penalties are suffered',
          body: [
            'A penalty applies at once. A bonus joins your hand, and you choose its moment — no bonus ever plays itself.',
            'You hold three cards at most. A card drawn with a full hand is lost — that is what pushes you to spend rather than hoard.',
            'Your hand is yours alone: the table sees how many cards you hold, never which ones.',
            'A power can last: a shield stays on its horse as long as nobody comes to eat it — a whole game, if it comes to that.',
          ],
        },
        {
          title: 'The die validates the card',
          body: [
            'Tap the card: it is armed in front of you, it does not go off. If it needs a horse, pick one on the board — it gets a green ring.',
            'Then roll the die: the roll is what plays the card. One gesture, and always the same order — card first, die second.',
            'Tapping the card again puts it away. Nothing is played until the die moves.',
            'Playing a card does not use up your turn: a shield laid before the roll protects from that very roll, and Replay is played on a die already on the table — tap the card, then tap the die again.',
          ],
        },
        {
          title: 'What each card does',
          body: [
            'Shield — the chosen horse takes the next capture without moving, and the shield breaks. It goes on a horse out on the track: in the stable, nothing can eat it.',
            'Gallop — the chosen horse moves three more squares. It never overshoots the finish: winning by accident would be worse than nothing.',
            'Replay — you roll again and play on. A streak of 6s keeps counting: rerolling does not erase the 6s already rolled.',
            'Loaded die — one more die bonus in your own reserve. It is kept in hand like the other bonuses: arm it, then ask for your low or high number — the same gesture puts the card away and tilts the die.',
            'Stumble — your horse goes back three squares. It never falls back into the stable, and moving back eats nobody.',
            'Lost turn — your next turn is skipped. Just one.',
            'Back to the stable — your horse goes home, shield included. The harshest card, and the only one of its kind in the deck.',
          ],
        },
      ],
    },
  ],
}

export const RULES_TEXT: Record<Lang, RulesText> = { fr, en }
