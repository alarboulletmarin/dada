# Dada

Les petits chevaux entre amis. Pas de compte, pas de pub, pas de quête quotidienne —
et pas de serveur à payer : les téléphones se parlent directement.

## Démarrer

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 617 tests : géométrie des 12 plateaux, règles, pouvoirs, dé, présence, pause, QR, portraits
npm run build    # vérification de types puis build de production
```

`npm test` lance deux environnements d'un coup. Le gros de la suite tourne sous
`node`, sans DOM ; les **écrans** ont leurs propres tests, sous `jsdom`, dans les
fichiers `src/ui/*.dom.test.ts` — ils montent la vraie `App` dans un `document`
et suivent le parcours au doigt : accueil → salon → plateau, podium, feuille de
guidage, bandeau de lien. Le montage commun vit dans `src/ui/test-dom.ts`.

## Comment jouer

- **Sur cet appareil** — un seul téléphone qu'on se passe. Aucun réseau requis.
- **En ligne** — l'un crée une partie, les autres saisissent le code à 8 caractères,
  ouvrent le lien partagé, ou scannent le QR code que l'hôte affiche ; l'hôte les
  accepte à sa table. Jusqu'à 4 joueurs.
- **Ordinateurs** — l'hôte peut compléter la table quand on n'est que deux ou trois.

Chacun de ces trois boutons porte, sous son libellé, la phrase qui dit à qui il
s'adresse : « vous hébergez », « un ami a déjà créé la partie », « un seul
appareil qu'on se passe ». Trois libellés de la même taille décrivent trois
gestes et pas une seule situation — or personne n'arrive ici en se demandant
quel geste faire, on arrive avec un lien qu'un ami a envoyé, ou tout seul un
dimanche soir. L'aide vit **dans** le bouton, jamais dessous : une phrase posée
sous une cible tactile est un demi-doigt de texte inerte là où le pouce descend.

À la toute première ouverture — aucune partie jamais lancée sur cet appareil —
un encart s'ajoute au-dessus des boutons : ce qu'est ce jeu, et par où l'essayer
quand on est seul. Il n'a pas de bouton pour le fermer et disparaît au premier
lancement de partie, pas à sa lecture : on ne demande à personne d'accuser
réception avant de jouer. Sa mémoire est celle du guidage des pouvoirs
(`guide.ts`, entrée `welcome`).

Sur un seul téléphone, la partie se met **en pause** : le bot qui allait jouer, le
temps de réflexion et le dé s'arrêtent tous ensemble. Elle n'est pas proposée en
ligne — figer les bots et la pendule chez soi ne figerait rien chez les autres, et
le siège en pause finirait sauté par l'hôte au bout de son temps de réflexion.

Le règlement se consulte **pendant** une partie sans la déranger : les autres
continuent de jouer derrière, et l'écran ne se referme pas sous les yeux de qui le
lit (voir `DETOURS` dans `app.ts`).

## Les quatre jeux de règles

| Variante | Plateau | Sortie | Particularités |
|---|---|---|---|
| **Petits chevaux** | 56 cases | 6 | Règle française. Une case, un cheval. Seules les cases de départ protègent. |
| **Ludo** | 52 cases | 6 | Règle internationale. Cases étoilées sûres, plusieurs pions peuvent partager une case, rejeu sur capture et sur arrivée. |
| **Rapide** | 40 cases | 1 ou 6 | Arrivée sans compte exact. Parties courtes, deux chevaux. |
| **Équipes** | 52 cases | 6 | Le Ludo à deux contre deux, sièges opposés. Exactement quatre joueurs. |

Les règles sont des **données**, pas du code : voir `src/game/variants.ts`. Ajouter
la variante de votre famille tient en un objet de vingt lignes.

### Équipes — deux contre deux

Les sièges **0 et 2** contre les sièges **1 et 3** : les places qui se font face,
comme à la belote. La table doit être complète — une équipe de un contre une
équipe de deux ne serait pas une variante mais un handicap, et le moteur refuse
la partie plutôt que de la commencer bancale.

Tout le reste découle d'une seule idée : **le partenaire n'est pas un
adversaire**. On ne le mange pas, ni au dé ni au galop ; on ne brise pas son
bouclier ; on partage sa case au lieu d'en être bloqué, exactement comme un
cheval de sa propre couleur au Ludo. Le camp d'en face est le seul contre lequel
on joue, et c'est aussi le seul que peuvent viser les malus — qui, de toute
façon, tombent sur le cheval qui a ramassé la carte, jamais sur un cheval choisi.

**Un joueur qui a rentré ses quatre chevaux ne s'assied pas pour regarder.** À
son tour, il lance le dé et déplace les chevaux de **son partenaire** : les coups
qu'on lui propose sont ceux d'en face, et ses cartes peuvent désigner un cheval
qui n'est pas le sien. Sa main, elle, reste la sienne — on prête ses tours, pas
ses cartes. C'est ce qui empêche une partie en équipes de se terminer sur un
joueur qui n'a plus rien à faire pendant que l'autre finit seul.

**On gagne à deux.** L'équipe dont les huit chevaux sont rentrés l'emporte, et la
partie s'arrête là : il n'y a pas de deuxième place à disputer entre deux camps.
Le classement final porte les quatre sièges, l'équipe gagnante devant, chaque
paire rangée par ordre d'arrivée. Le malus « tour sauté », lui, reste
personnel : il punit le joueur, pas son camp.

Côté moteur, la variante tient dans deux fonctions — `areAllies`, qui décide si
un cheval est une proie ou un allié, et `activeSeatFor`, qui dit de qui l'on joue
les chevaux. Partout où le code lisait « le siège dont c'est le tour » pour
désigner des chevaux, il lit la seconde ; partout où il comparait deux
propriétaires, il appelle la première. `teams.test.ts` fixe les cas limites.

### Les deux plateaux officiels

Ce ne sont pas deux réglages du même plateau : ce sont deux objets qui existent,
imprimés, avec un nombre de cases qu'on peut compter.

Le plateau **français des petits chevaux** compte **56 cases, 14 par quart**. Son
tracé passe par les quatre angles du carré central, ce qui le rend
orthogonalement continu — un cheval y avance toujours d'un côté de case à la
fois. Ses six marches d'escalier portent leur numéro, comme sur le carton
imprimé — c'est **du dessin, pas une règle** : on n'y monte pas marche par
marche en tirant son chiffre, on y avance du nombre de cases indiqué par le dé,
comme partout ailleurs. Seule l'arrivée demande le compte exact.

Le plateau **international du Ludo** compte **52 cases, 13 par quart**. Il coupe
ces quatre angles : le pion y tourne en diagonale, exactement comme sur un
plateau imprimé. Son couloir d'arrivée est une bande de couleur sans numéros, et
ses cases abritées tombent huit crans après chaque départ.

Même grille de 15×15, mêmes écuries, mêmes escaliers de six marches : quatre
cases d'écart, et deux jeux différents. `board.test.ts` fixe les deux, coordonnée
par coordonnée, pour qu'un remaniement de géométrie ne les fasse pas dériver.

### Une case, un cheval — et rien qui barre la route

**Une case, un cheval** (français). « Deux chevaux ne peuvent pas occuper la même
case ; s'il s'agit de vos propres chevaux, l'un reste derrière l'autre. » Un coup
qui amènerait un cheval sur une case tenue par un cheval qu'il ne peut pas manger
— le sien, ou un adversaire sur sa case de départ — n'est tout simplement pas
jouable. L'arrivée fait exception : c'est là que les quatre se rejoignent.

La règle vaut pour **tout ce qui déplace un cheval**, dé ou carte. Un galop qui
tomberait sur une case tenue n'est pas jouable ; un faux pas qui reculerait
dessus s'arrête avant. La seule case partagée, en règle française, est celle d'un
cheval au bouclier : l'attaquant s'y arrête le temps d'un tour. Sans cette
exception, le bouclier cesserait d'être « une capture encaissée » pour devenir un
mur — et un mur que rien ne pourrait plus briser, puisque la charge qui le brise
n'aurait jamais lieu.

**Aucun barrage**, nulle part. Le Ludo et la variante rapide laissent plusieurs
pions d'une même couleur partager une case — deux, trois, quatre s'il le faut ;
cela ne dresse aucun mur. On franchit une pile, on peut s'arrêter dessus, et l'on
y mange alors ce qui s'y trouvait.

La règle internationale des barrages a existé ici, et elle a été retirée : deux
pions qu'on ne peut ni manger ni contourner arrêtent la table entière, et une
partie arrêtée n'est pas une partie difficile. `engine.test.ts` garde le cas —
franchir *et* s'arrêter — pour qu'elle ne revienne pas par accident.

## La forme du plateau

Croix, carré, rond ou serpent — réglé dans le salon, par l'hôte.

C'est **du décor, et rien d'autre**. Les quatre formes partagent le même circuit,
les mêmes distances, les mêmes cases protégées et les mêmes cases pouvoir : seule
change la façon de les poser sur l'écran. Deux cents parties simulées le
vérifient — à graine égale, une partie sur le rond et la même sur la croix se
déroulent coup pour coup à l'identique.

C'est ce qui permet d'offrir quatre décors sans ré-équilibrer quatre jeux. La
séparation est portée par le code : une *forme* reçoit la longueur d'un bras et
rend un dessin ; les index (départs, étoiles, pouvoirs) sont calculés après, à
partir de la longueur du circuit, et ne la consultent jamais.

Une seule forme corrige les nombres qu'on lui donne : le **carré** exige un bras
pair, son escalier partant du milieu d'un côté. Un bras impair y est arrondi au
pair supérieur — le Ludo joué sur un carré tourne donc sur 56 cases et non 52.

Les cases se posent en **pourcentage** et non en cellules de grille CSS, et leurs
coordonnées sont flottantes. Sans cela, ni le rond ni le serpent ne seraient
dessinables. Le serpent, d'ailleurs, répartit ses cases à **longueur d'arc
constante** et non à angle constant : sur une courbe qui ondule, l'angle
constant les écarte sur les bosses et les entasse dans les creux, et le plateau
se lit alors comme un défaut d'impression.

## Les cases pouvoir

Optionnelles, activées dans le salon. Huit cases marquées sur le circuit ;
s'arrêter dessus fait piocher une carte — bonus ou malus — comme une case
« Chance » au Monopoly.

**Un paquet, pas un dé.** Tirer chaque pouvoir indépendamment serait injuste à
l'échelle d'une partie : sur douze cases ramassées, il n'est pas rare qu'un
joueur n'ait vu que des malus et un autre que des bonus. Les pouvoirs sont donc
un paquet de seize cartes — dix bonus, six malus — mélangé une fois avec la
graine de la partie, partagé par toute la table, consommé par le haut et
remélangé quand il est vide. Le hasard décide de l'ordre, jamais des proportions.

**Des cases symétriques.** Elles sont posées à un décalage fixe du départ de
*chaque* siège. Le motif se répète donc à l'identique tous les quarts de tour :
chaque joueur croise le même nombre de cases, aux mêmes distances de chez lui.
Personne n'a « le bon coin du plateau ». L'équité est dans la géométrie ; elle
n'a pas à être corrigée coup par coup.

**Les bonus se gardent, les malus se subissent.** C'est la règle entière, et
elle se retient. Un malus s'applique à l'instant ; un bonus rejoint la main, et
c'est le joueur qui choisit son moment. Un bouclier posé juste avant que
l'adversaire n'arrive à portée, c'est un coup joué, pas un lot de tombola. Aucun
bonus ne part tout seul : les quatre se gardent, le dé pipé compris.

| Carte | | Garde | Effet |
|---|---|---|---|
| Bouclier | ×3 | main | Le cheval désigné encaisse la prochaine capture sans bouger. Le bouclier se brise à l'impact. Il se pose sur un cheval **en piste** : à l'écurie comme dans l'escalier, rien ne peut l'atteindre, et la carte serait dépensée pour rien. Il ne protège pas du « Retour à l'écurie », qui n'est pas une capture. |
| Galop | ×3 | main | Le cheval désigné avance de 3 cases, et il **arrive comme un coup de dé** : il mange ce qu'il rattrape, brise les boucliers, et renonce à la case que la règle lui refuse. Jamais au-delà de l'arrivée : gagner par accident serait pire que rien. Manger au galop ne fait pas rejouer, même au Ludo : une carte se joue dans le tour qu'on tient, elle n'en ouvre pas un second. |
| Rejeu | ×2 | main | On relance le dé et on rejoue. La chaîne de 6 continue de compter. |
| Dé pipé | ×2 | main | Un bonus de dé de plus dans la réserve de la table. Armé, il s'encaisse dans le geste suivant : petit nombre ou grand nombre. |
| Faux pas | ×3 | — | Le cheval recule de 3 cases, sans jamais repasser par l'écurie. **On ne mange jamais en reculant** — un malus qui offrirait une capture serait un bonus. En règle française, si la case visée est tenue, le cheval s'arrête à la première case libre en deçà ; s'il n'y en a aucune, il reste où il est. |
| Tour sauté | ×2 | — | Le prochain tour saute. Un seul. |
| Retour à l'écurie | ×1 | — | Le cheval rentre. La carte la plus dure, et la seule de son espèce. |

La main tient **trois cartes**, pas davantage. Sans plafond elle devient un
magasin : on ramasse sans jamais dépenser, et la fin de partie se joue en vidant
un stock que personne n'a vu venir. À trois, ramasser une quatrième carte oblige
à en jouer une — c'est là qu'est la décision. Une carte ramassée main pleine est
perdue, et l'annonce le dit — à son propriétaire seul.

**Une main est secrète.** L'état de la partie circule d'un téléphone à l'autre,
cartes comprises : un jeu pair-à-pair sans serveur n'a pas d'endroit où les
cacher. Mais l'écran, lui, ne montre que la sienne. De celle des autres il ne dit
que le nombre, sur la pastille de leur carte de joueur. Un bouclier qu'on sait
posé n'en est plus un, et une main qu'on lit fait des tours prévisibles.

**Le dé valide la carte.** On ouvre sa main, on touche une carte : elle s'arme,
le tiroir se referme, et elle attend sans partir. Si elle demande un cheval, on
le désigne sur le plateau — il se cercle de vert. Puis on lance le dé, et c'est
le lancer qui la joue. Le dé pipé fait bande à part : ce sont ses deux boutons —
petit nombre, grand nombre — qui le lancent et le dépensent, et c'est là que le
halo vert se pose ; un lancer nu le gaspillerait, et l'écran le refuse. Un seul
geste, un seul ordre possible : la carte d'abord, le dé ensuite. Un bouclier posé
après le lancer arriverait trop tard pour la relance qu'il couvre, et un dé pipé
rangé après coup ne pencherait plus rien — les deux voyagent donc dans une seule
action du moteur (`{ type: 'roll', power, pawnId }`), et non dans deux intentions
qui pourraient arriver en désordre chez l'hôte.

Jouer une carte ne consomme pas le tour : le bouclier posé avant le lancer
protège dès ce lancer, et le rejeu se joue sur un dé déjà sur la table — on
touche la carte, puis on retouche le dé. Un second appui sur la carte armée, dans
le tiroir, la range. Tant que le dé n'a pas bougé, rien n'est joué.

**Un pouvoir peut durer.** Un bouclier tient sur son cheval aussi longtemps que
personne ne vient le manger — une partie entière, s'il le faut ; un tour sauté
attend son tour. Ce qui dure se voit : l'anneau doublé sur le cheval, et sur la
carte du joueur une pastille par effet en attente. Un effet qui dure sans se voir
se lit comme un bug le jour où il se manifeste.

**Un bouclier brisé n'est pas une capture.** Le cheval reste sur sa case, son
propriétaire ne perd rien, aucun compteur ne bouge — et l'attaquant ne gagne donc
pas le tour de rejeu que le Ludo accorde à qui mange. Une charge qui casse un
bouclier est un tour dépensé pour ouvrir la voie, pas un coup gagnant.

Un pouvoir qui déplace ne redéclenche pas la case où il amène le cheval : sans
cette règle, deux cases voisines pourraient se renvoyer la balle sans fin.

Le catalogue entier se lit **avant** la partie, depuis le salon, exemplaires
compris. Un bonus qu'on découvre en le ramassant est une surprise ; un malus
qu'on découvre en le ramassant est une injustice.

**Et il se relit pendant.** L'annonce du ramassage passe et ne revient pas ;
trois tours plus tard, il ne reste qu'une figure, et « Faux pas » ne dit pas de
combien on recule. La main s'ouvre donc en tiroir : chaque carte y donne son
nom, son effet, l'état où elle est — jouable maintenant, ou pas — et un ⓘ qui
rouvre le catalogue sur elle. Les annonces du haut de l'écran ont le même ⓘ : la
question qu'une nouvelle laisse derrière elle a besoin d'un endroit où se poser,
et le malus qu'on vient de subir n'est, lui, jamais passé par la main.

**La main est un bouton, pas une rangée.** Elle a tenu un temps sur une ligne à
hauteur fixe sous la ligne de tour, gardée même vide pour que rien ne saute à
l'arrivée de la première carte. Le remède coûtait plus cher que le mal :
quarante-cinq pixels pris au plateau pendant les trois quarts d'une partie, pour
un rang qui ne montrait rien — et le plateau se dimensionne sur ce qui reste.
Rendue à la ligne de tour, qui avait de la largeur à revendre et pas une ligne à
donner, la main coûte zéro et le plateau gagne 12 à 14 % de côté, soit un bon
quart de surface.

Le bouton ne porte que les figures des cartes gardées : à cette taille un dessin
se reconnaît, un mot ne se lit pas. Il se cercle d'encre et bat quand une carte
est jouable, comme le dé prêt à partir ; il devient plein quand une carte est
armée. Le tiroir, lui, se referme dès qu'on choisit — le geste suivant est sur
le plateau ou sur le dé, et un panneau resté ouvert les cacherait tous les deux.

**Rien ne se subit.** Une annonce, un message, une bulle de chat s'en vont
d'eux-mêmes au bout de quelques secondes — et ces secondes sont exactement le
problème : on a lu, on a compris, et il faut attendre que ça veuille bien
partir. Attendre quelque chose qu'on a fini de lire est la forme la plus bête
d'attente qu'une interface puisse imposer. Un appui suffit donc, ou un geste
vers le haut ou vers le bas : le flottant suit le doigt, pâlit à mesure qu'il
s'en va, et part au relâchement — ou revient se poser si le geste était trop
court. Les seuils vivent dans `swipe.ts`, avec leurs tests : quarante-quatre
pixels, ou une chiquenaude sèche de vingt, parce que ne garder que la distance
exclut la moitié des gens.

Les feuilles se poussent de la même façon, mais par leur poignée seulement — la
barrette qui les coiffe. Leur corps défile, et un doigt qui descend dedans doit
faire défiler, pas emporter la feuille au premier geste de lecture.

**Une feuille se ferme par sa croix.** En haut à droite, au même endroit quel
que soit l'endroit où l'on a défilé : c'est le corps de la feuille qui défile,
pas la feuille. Un bouton « Fermer » posé sous le contenu demandait un écran et
demi de défilement pour refermer un catalogue qu'on était venu lire trois
secondes.

## Ce que l'écran dit, et quand il le dit

Le moteur est juste ; c'est l'affichage qui décide si la table le croit.

**Rien avant l'heure.** Les chevaux étaient posés à leur position finale avant
que celui qui avance n'ait fait un pas : la victime rentrait à son écurie
pendant que son bourreau était encore à quatre cases de là, et l'on savait
qu'on allait se faire manger une seconde avant de l'être. Le cheval mangé reste
donc en place jusqu'à l'impact, et les nouvelles du haut d'écran attendent que
le plateau ait fini de bouger — une annonce qui devance ce qu'elle raconte
gâche les deux.

**Et un coup peut avoir deux temps.** Un cheval qui s'arrête sur une case
pouvoir peut en repartir aussitôt : le faux pas le recule de trois, le retour à
l'écurie le renvoie chez lui. L'état ne garde que sa position finale, si bien
qu'un six suivi d'un faux pas se dessinait comme un tranquille déplacement de
trois cases — et un retour à l'écurie ne se dessinait pas du tout, le cheval
reparaissant chez lui sans avoir bougé. On perdait les deux moitiés de ce qui
venait d'arriver, et il ne restait qu'un résultat inexplicable.

L'état note donc l'étape intermédiaire — la case où le dé avait posé le cheval
(`hop` dans `types.ts`) — et l'écran raconte le coup en trois battements : la
marche du dé, l'arrivée qu'on laisse voir un instant, puis ce que la carte en
fait. C'est du **dessin, pas de la règle** : le moteur pose ce champ et ne le
lit jamais, et `powers.test.ts` fixe les deux cas où il est écrit comme celui
où il doit rester vide.

**Et en équipes, l'écran dit de qui l'on joue les chevaux.** Un joueur qui a
rentré ses quatre chevaux continue de lancer le dé, mais ce sont ceux de son
partenaire qui se cerclent de vert — le plateau ne peut pas montrer ça, et sans
un mot on le lit comme une panne. La ligne de tour porte donc la phrase entière
(« À vous — vous jouez pour Sami », ou « Alan joue pour Sami »), et le moment du
basculement s'annonce en haut de l'écran (« Alan a fini — il joue maintenant
pour Sami »). Le moteur n'émet aucun événement pour cela : il allonge
`finishers`, et c'est l'écart entre deux états que l'écran raconte, exactement
comme `announced` fait celui du journal.

**Les nouvelles s'empilent, elles ne se chassent pas.** Trois au plus, et de
quatre à six secondes et demie selon ce qu'elles annoncent : un malus reste plus
longtemps qu'un bonus, parce qu'un malus qu'on n'a pas eu le temps de lire se
lit comme un bug le tour suivant, quand son effet se manifeste. Un tour de bot
qui joue une carte, lance, avance et mange produisait quatre annonces dont on ne
lisait aucune.

**Une réaction se donne d'un doigt, sinon elle n'a pas lieu.** Le chat existe
depuis le début, et il reste vide toute la partie : écrire demande d'ouvrir une
feuille, de quitter le plateau des yeux, de viser un champ, de composer, de
valider — cinq gestes pour dire « 😂 », pendant que le tour passe. Il y a donc
six emoji au bout d'un éventail, dans la barre du haut, à côté du chat : un
appui l'ouvre, un appui envoie, et trois secondes sans choix le referment. Rien
ne s'interrompt, le dé ne bouge pas, la feuille de conversation ne s'ouvre
jamais. La réaction reste malgré tout un message de chat — même canal, même
auteur, même ligne dans l'historique (« Camille 😂 ») : deux canaux auraient
donné deux ordres d'arrivée possibles pour deux choses qui vivent dans la même
conversation, et un pair resté sur une version d'avant la reçoit simplement
comme le message d'un seul emoji qu'elle est.

**Et elle surgit sur la carte de son auteur, pas au milieu de l'écran.** Une
réaction dit autant *qui* que *quoi* : quatre 😂 sortis du même endroit ne
seraient qu'un brouhaha, et le centre de l'écran est justement la seule chose
qu'on ne peut pas couvrir — c'est le plateau. La bulle rebondit, grandit et
s'estompe en une seconde huit, vers le plateau, et s'empile si plusieurs
arrivent. Deux freins la tiennent : sept dixièmes de seconde entre deux envois
chez l'émetteur — un appui unique se répète très vite — et trois bulles
simultanées au plus par siège chez le récepteur, parce que le premier frein vit
chez quelqu'un d'autre. Ce qui dépasse n'est ni montré ni archivé : le ranger
reviendrait à le déplacer.

**Après une capture, la table propose.** Se faire manger, c'est regarder son
cheval repartir de zéro pendant que le tour continue sans nous : c'est le seul
moment du jeu où l'on a quelque chose à dire tout de suite, et le seul où l'on
n'a pas une seconde pour aller le chercher. L'éventail s'ouvre donc seul deux
secondes, 😱 entouré et battant ; plus sobrement, 🎉 entouré quand c'est nous
qui mangeons. Un appui et c'est parti, sinon il se referme — une proposition,
jamais une interruption. Une seule par capture, et **jamais pendant son propre
tour** : faire pousser six boutons à côté du dé au moment précis où on le vise,
c'est déplacer la cible. La décision tient dans une fonction pure
(`ui/react.ts`) parce qu'elle dépend de quatre choses dont trois ne se voient
nulle part — mon siège, mon nom dans le journal, à qui est la main.

**Dix secondes, et on doit les voir passer.** Le temps de réflexion se lisait
sur le contour de la carte du joueur actif : deux pixels et demi à 45 %
d'opacité, en haut de l'écran, sur une carte qu'on ne regarde pas. Personne ne
le voyait — on regarde le dé, c'est lui qu'on va toucher. Chacun a donc sa
mesure : **un anneau autour du dé pour celui qui doit jouer**, encre puis jaune
à mi-parcours puis rouge sur la fin, avec les secondes écrites à côté du tour
sous les cinq dernières et une courte vibration sous les trois — une seule par
tour, et rien quand l'écran est éteint. Et **le contour de carte pour les
autres**, qui dit seulement de qui l'on attend quelque chose : leur temps n'est
pas le nôtre, et un compte à rebours au-dessus du tour des voisins ferait de la
partie une épreuve chronométrée pour tout le monde à la fois. L'anneau se peint
à chaque image depuis la même variable que le contour, jamais par une animation
déclarée — une animation repartirait de zéro à chaque bulle de chat. Qui a
demandé moins de mouvement garde l'anneau et perd le battement : c'est de
l'information, pas du décor.

**Un bot prend son temps.** Il ne réfléchit pas, et le tour d'un bot ne compte
pas dans le temps de réflexion : son délai n'existe que pour ceux qui regardent.
À sept dixièmes de seconde, ses trois gestes se confondaient en un clignement et
une table de bots devenait un défilé.

**Un coup sans choix se joue tout seul.** Un seul coup possible, ou aucun, et le
tour part de lui-même après un temps de lecture. Une carte jouable en main
allonge ce délai — de huit dixièmes à trois secondes deux — mais ne le supprime
plus : elle le supprimait, et il suffisait d'un bonus ramassé pour que chaque
tour à coup unique redemande une confirmation jusqu'à la fin de la partie. Le
cas qui fixe la durée est « rien à jouer, mais un rejeu en main » : il faut lire
la ligne, comprendre qu'on peut relancer, et atteindre la carte.

**On explique là où le concept apparaît, une fois par appareil.** Tout ce que le
jeu savait dire des pouvoirs était de la référence : le catalogue au salon, le ⓘ
des annonces, le règlement. On y va quand on a déjà une question ; personne n'y
va pour apprendre qu'il y a quelque chose à savoir — et les cases marquées, la
main-bouton, le geste carte-puis-dé ne s'expliquaient donc à personne. Un
tutoriel réglerait le problème dans le mauvais sens : il se place avant la
partie, quand rien n'a encore de nom, et il fait payer à tous les joueurs
suivants le prix du premier. Il y a donc quatre feuilles courtes — les huit
cases à l'ouverture du plateau, le premier bonus ramassé, le premier malus subi,
la première carte perdue main pleine — chacune montrée au moment où la chose
arrive, chacune une seule fois, retenues par une clé versionnée du stockage
local comme le thème (`guide.ts`). La feuille du bonus allume le bouton de la
main pendant qu'elle en parle : « en bas de l'écran » est une indication qu'on
suit du doigt, pas une qu'on lit. Elles se ferment d'un appui, ne s'empilent jamais sur une autre
feuille ni sur un détour par le règlement, et le catalogue des cartes porte un
bouton pour les faire toutes revenir, le jour où l'on prête son téléphone. Et
aucune ne coûte le tour qu'elle explique : sur un seul téléphone la partie se
suspend le temps qu'on lise — sans le dire, ce n'est pas une pause —, tandis
qu'en ligne, où la table n'attend personne, c'est la feuille qui attend que le
tour ne soit plus le nôtre. Elle arrive à la seconde d'après : ramasser une case
termine un coup. Le salon, lui,
ajoute une ligne sous l'interrupteur : une première table gagne à faire une
manche sans pouvoirs. C'est un conseil, pas un défaut — les pouvoirs restent où
l'hôte les a mis.

**Une carte tirée se voit, et chez tout le monde.** Un tirage est un événement
de table, comme le dé qui roule : c'est le moment où le plateau donne quelque
chose à quelqu'un, et il vaut d'être vu par ceux à qui il ne donne rien. Sans
image il ne restait qu'une ligne de texte en haut de l'écran, et la case marchée
n'avait l'air d'avoir rien fait. Une carte se soulève donc de la case, se
retourne en trois dimensions — dos au losange d'encre, face au glyphe et au nom
—, tient neuf dixièmes de seconde, puis file : vers le bouton de la main pour un
bonus gardé, vers la carte du joueur si la main n'est pas la nôtre, sur le cheval
pour un malus qui le pousse, et contre la main puis par terre pour une carte
refusée faute de place. Deux règles la tiennent. La première : **une main reste
secrète**, donc la carte gardée d'un autre voyage dos visible et ne se retourne
jamais — on voit qu'une carte est partie chez lui, pas laquelle, exactement ce
que l'annonce dit déjà. La seconde : **la cause avant la conséquence**. Le moteur
a déjà reculé le cheval de trois cases quand l'écran commence à raconter ;
l'animation se glisse donc dans le temps d'arrêt que le plateau marquait déjà sur
la case pouvoir (`onPowerHold` dans `board-view.ts`), et le cheval n'est poussé
qu'une fois la carte posée sur lui. Deux secondes au plus, en `transform` seul,
sur un calque à part qui ne prend aucun appui ; les tirages qui s'enchaînent se
suivent au lieu de se superposer ; et sous `prefers-reduced-motion` rien ne se
crée du tout — il ne reste que l'annonce écrite.

### Une tête par joueur

Quatre lignes de texte, c'est un formulaire ; quatre visages, c'est une table.
Chaque joueur — humain, bot, ami qui frappe à la porte — a donc un portrait à
côté de son nom, dans le salon, sur sa carte pendant la partie, au tableau
d'arrivée et devant ce qu'il dit dans le chat.

Le pion garde sa couleur et sa forme : c'est lui qu'on retrouve sur le plateau,
et une tête de trois millimètres au coin d'une case ne serait la tête de
personne. Le portrait dit **qui**, le pion dit **lesquels sont à lui**.

Le portrait est **tiré au sort** à la création du siège : une nouvelle partie
donne une nouvelle table de têtes. Et il se **relance** — dans le salon, le
portrait est lui-même le bouton qui le change, avec une pastille au coin pour le
dire. On tape jusqu'à en trouver une qui plaît, la sienne ou n'importe laquelle
si l'on est l'hôte.

**Ce qui voyage n'est pas le dessin, c'est le numéro du tirage** — un entier de
seize bits par siège, dans le salon, à côté du nom. Chaque téléphone recompose
le portrait de son côté et retombe forcément sur le même. Un dessin transmis
pèserait deux kilo-octets par joueur et par publication du salon, pour une image
que tout le monde sait refaire.

Le nom entre dans le calcul avec le tirage, et il y sert : à tirage égal, Léa a
la même tête, et se renommer suffit à en changer. Sans lui, deux sièges créés
dans la même milliseconde ne se distingueraient que par un nombre.

Le tirage sort d'un `Math.random()`, seul endroit du jeu qui s'y autorise — la
règle de la graine déterministe vaut pour l'état de la **partie**, qui doit se
rejouer à l'identique ; un portrait n'entre dans aucune décision de règle et ne
se rejoue jamais. Le champ est optionnel : un ami resté sur la version d'avant
envoie un salon qui n'en porte pas, et les portraits retombent alors sur le nom
seul plutôt que de disparaître.

Les dessins viennent de **DiceBear** (jeu *Big Smile* d'Ashley Seo) et sont
empaquetés avec le jeu : rien n'est appelé en ligne, les portraits marchent dans
le métro comme le reste. Voir `src/ui/avatar.ts` et `THIRD-PARTY.md`.

## La feuille de match

L'écran de fin ne dit pas seulement qui a gagné : il donne, par joueur, les
cases parcourues, la moyenne au dé, les chevaux mangés et perdus, les 6 obtenus
et les cartes ramassées. « 4,1 de moyenne et perdu quand même » est la phrase
qui fait relancer une manche, et elle ne se reconstitue pas depuis l'état final
— elle se compte pendant la partie, dans le moteur.

Ces compteurs n'entrent dans **aucune** décision de règle. Une colonne qui
n'apprend rien à cette table-là ne s'affiche pas : celle des cartes sur une
partie sans pouvoirs serait une colonne de zéros, et une colonne de zéros se lit
comme une panne.

## Deux écrans de règles, et pourquoi deux

`rules.*` dans `i18n.ts` sert l'écran **« Comment on joue »** : neuf étapes pour
lancer sa première partie. Il ne dit pas si l'on peut poser deux chevaux sur la
même case, ni ce qui se passe quand on tombe sur un bouclier.

`rules-text.ts` est le **règlement complet** : un document, comme les textes de
la page « à propos », et pas de la chaîne d'interface. Chaque règle y dit aussi
ce qui est *interdit* — c'est ce qu'on vient y chercher — et porte l'étiquette
des variantes auxquelles elle s'applique, une règle sans étiquette valant pour
les trois. Allonger le premier écran de quarante paragraphes lui ferait rater
son travail ; on vient au second plus tard, avec une question précise, souvent
au milieu d'une dispute.

### Sortir de l'écurie sans y passer la soirée

Attendre un 6 est une loi de probabilité, pas une épreuve d'adresse. Avec un dé
franc, une partie sur cinq laisse un joueur à l'écurie plus de huit tours, et
une sur vingt plus de seize — pendant que la table fait le tour du plateau. Ce
n'est pas une impression : c'est mesuré, et c'est le pire moment du jeu.

Le dé reste donc franc au premier essai, puis penche d'un cran par tour passé
enfermé ; au sixième, la sortie est certaine. L'attente moyenne tombe de six
tours à trois, la longue traîne disparaît, et le joueur concerné le lit
au-dessus du dé — un dé qui aide sans le dire serait un dé truqué. Le seuil est
une donnée de variante (`mercyExit`) : « Rapide », qui sort déjà sur 1 ou 6,
garde un dé entièrement franc.

## Architecture

```
src/game/     moteur pur — (état, action) → état. Aucun DOM, aucun réseau.
  board.ts      géométrie : les nombres du circuit, et les quatre formes
  engine.ts     règles, coups légaux, enchaînement des tours
  variants.ts   les jeux de règles
  powers.ts     le paquet de bonus et de malus
  bot.ts        adversaire artificiel
  rng.ts        aléatoire déterministe (mulberry32), mélange compris
src/net/      transport pair-à-pair et orchestration de la partie
  room.ts       canaux WebRTC, code de partie, identité de l'appareil
  admission.ts  qui entre dans le salon, et à quelles conditions
  session.ts    salon, arbitrage, battement de cœur, minuterie, relève des absents
  presence.ts   les délais : dix secondes pour jouer, quarante-cinq d'absence
                avant qu'un bot n'entre, et le battement qui dit qui est là
src/ui/       écrans, plateau, animations
  rules-text.ts le règlement complet — un document, pas des libellés
  qr.ts         le carré du salon : un encodeur QR entier, sans dépendance
  avatar.ts     le portrait d'un joueur, tiré de son nom
```

**Un seul arbitre.** L'appareil hôte détient l'état et applique les coups ; les
autres envoient des intentions et affichent ce qu'ils reçoivent. Sans arbitre,
deux joueurs pourraient lancer le dé au même instant et voir la partie diverger.

**Position des chevaux.** Un seul entier par cheval, compté depuis son propre
départ : `-1` à l'écurie, `0..55` sur le circuit, `56..61` dans l'escalier.
Avancer, c'est additionner. La conversion vers une case du plateau vit dans
`board.ts` et nulle part ailleurs.

**Qui est encore là.** L'hôte bat la mesure : un `tick` toutes les deux
secondes, un `pong` en retour, et la présence se mesure sur ces messages-là. Le
transport, lui, ne donne qu'un avis — il déclare un pair perdu après cinq
secondes de silence, puis ne dit plus rien, ni qu'il est revenu ni qu'il ne
l'est pas. **N'importe quel message rend son siège** à qui revient, sans
attendre de présentation en bonne et due forme. Et l'invité qui n'entend plus
l'hôte le voit écrit en travers de la partie, avec un bouton pour rebrancher :
avant, il tapait le dé dans le vide pendant qu'on comptait ses tours sautés.

**Reprise après déconnexion.** Chaque appareil garde une copie complète de la
partie. Si l'hôte s'en va, un nouveau est désigné de façon déterministe — mais
**pas tout de suite, et pas par n'importe qui**. Pas tout de suite : perdre le
lien de l'hôte, c'est peut-être être soi-même isolé, et le nouvel hôte est
attendu quarante-cinq secondes, le temps d'une vraie reconnexion. Pas par
n'importe qui : seul un candidat qui voit encore la moitié de la table s'élit,
sans quoi c'est l'isolé qui se proclame arbitre.

Chaque règne porte un numéro, et c'est lui qui empêche la table d'avoir deux
arbitres : le règne le plus récent l'emporte, à égalité le plus petit
identifiant, et l'hôte battu redevient invité **sans perdre son siège**. Sans ce
numéro, deux appareils coupés l'un de l'autre s'ignoraient à jamais — et chacun
mettait un bot sur le siège de l'autre.

Un joueur qui recharge sa page retrouve son siège : son identité est stockée
localement, pas déduite de sa connexion. Quitter n'y change rien : le code de la
partie reste sur l'appareil, et l'accueil propose d'y retourner tant qu'elle
dure.

**Personne n'attend personne.** Un tour dure dix secondes ; passé le délai il
saute, et rien n'est joué à la place du joueur — ne pas jouer est toute la
peine. Trois tours sautés d'affilée, et un bot tient le siège. Une absence, elle,
ne coûte le siège qu'au bout de quarante-cinq secondes **et seulement quand c'est
son tour** : tant qu'un autre joue, un joueur parti ne gêne personne, et le
remplacer d'avance ne serait que le remplacer pour rien.

**Un coup joué à temps compte, même arrivé tard.** Chaque coup part avec le
numéro de l'état sur lequel le joueur a décidé, et un jeton qui permet de le
réémettre sans risque de le jouer deux fois ; l'hôte en accuse réception, et
c'est chez celui qui a joué — non chez l'arbitre — que s'affiche un éventuel
refus. Si le coup arrive après le couperet, le tour est perdu mais **la série de
tours sautés repart de zéro** — à condition que le coup fût bien en vol quand le
couperet est tombé : jouer tard prouve la présence, jouer une minute après ne
prouve plus rien. La marge que l'hôte s'accorde suit d'ailleurs l'aller-retour
mesuré avec ce joueur-là, entre une seconde et demie et quatre secondes et
demie : une valeur fixe supposait un réseau qui ne l'est pas et sanctionnait le
plus lent — c'est-à-dire celui qui avait le plus besoin qu'on l'attende — tandis
qu'une marge sans plafond aurait suffi à un téléphone endormi pour suspendre la
partie de tout le monde.

Le siège reste celui de son joueur : il porte toujours son nom, et son retour —
ou un appui sur « Reprendre » — le lui rend. Les durées sont dans `presence.ts`,
l'arbitrage dans `session.ts` : le moteur, lui, ne connaît toujours pas
l'horloge.

## Déployer

N'importe quel hébergeur statique convient. Le dossier `dist/` est autonome.

```bash
npm run build
# puis publier dist/ (GitHub Pages, Cloudflare Pages, Netlify…)
```

Pour un sous-chemin (GitHub Pages de projet) :

```bash
BASE_PATH=/dada/ npm run build
```

HTTPS est requis en production : le service worker et WebRTC ne fonctionnent pas
en HTTP sur un domaine distant.

### Les en-têtes qui décident si la mise à jour arrive

Une seule règle, et c'est la plus facile à oublier : **`sw.js`, `index.html` et
`manifest.webmanifest` ne doivent pas être mis en cache par le navigateur.**
Le navigateur ne compare le service worker qu'en le retéléchargeant ; si
l'hébergeur lui répond « tu l'as déjà », la nouvelle version n'existe pas, et
recharger la page n'y change rien — c'est exactement le symptôme d'une PWA qui
« ne se rafraîchit jamais ». Les fichiers de `assets/`, eux, portent un hachage
dans leur nom : ils peuvent être immuables pour un an.

```
/sw.js                 Cache-Control: public, max-age=0, must-revalidate
/index.html            Cache-Control: public, max-age=0, must-revalidate
/manifest.webmanifest  Cache-Control: public, max-age=0, must-revalidate
/assets/*              Cache-Control: public, max-age=31536000, immutable
```

Sur Vercel ou Netlify, cela se déclare dans `vercel.json` / `_headers`. **GitHub
Pages ne permet pas de fixer ces en-têtes** et sert tout avec un `max-age` de
dix minutes : la mise à jour arrive, avec dix minutes de retard. C'est vivable,
mais Cloudflare Pages ou Netlify sont préférables si le jeu est mis à jour
souvent.

### Regarder le service worker en développement

Il est éteint en dev — sinon il resservirait du code figé à chaque
rechargement, et `main.ts` va jusqu'à désenregistrer ceux qu'un build précédent
aurait laissés sur le même hôte.

```bash
PWA_DEV=1 npm run dev   # allume le worker et le bandeau de mise à jour
```

## La limite à connaître

WebRTC a besoin d'un « signaling » pour que deux navigateurs se trouvent.
Trystero le fait passer par le réseau Nostr : rien à déployer, rien à payer.

Reste le cas du **NAT symétrique**, fréquent en 4G/5G, où deux téléphones
n'arrivent pas à établir de lien direct. Un relais TURN sert alors de filet, et
**il n'y en a aucun par défaut** : c'est le seul endroit où ce montage aurait
besoin d'un vrai serveur, et il n'en a pas. Renseignez `VITE_TURN_URLS`,
`VITE_TURN_USER` et `VITE_TURN_PASS` au build pour en brancher un (voir
`.env.example`) ; prenez un fournisseur à identifiants statiques, ceux à jetons
éphémères demandent un serveur pour les signer. Sans TURN, deux amis en données
mobiles peuvent très bien ne jamais réussir à se joindre — l'app le dit alors
franchement plutôt que de tourner dans le vide.

En attendant, le mode « sur cet appareil » fonctionne toujours, hors ligne inclus.

## Le code, le lien, le carré

Trois portes vers le même salon, parce qu'inviter n'est pas toujours la même
chose. Le **code** se dicte au téléphone à qui est loin. Le **lien** s'envoie
dans la conversation où l'on se donne rendez-vous. Le **QR code**, lui, est pour
ceux qui sont déjà là : on tend l'écran, ils visent, ils sont dedans. Rien à
dicter, rien à retaper, aucune faute de frappe sur un code à huit caractères.

**Il ne s'affiche pas tout seul.** Le carré prend un écran entier, et l'hôte qui
tient la table a autre chose à y regarder — les demandes qui arrivent, les
sièges qui se remplissent. C'est donc un bouton, comme le code est un bouton :
on le montre pendant les dix secondes où les autres cherchent leur appareil
photo, puis on le referme d'un geste vers le bas.

**Encodé ici, pas importé.** `qr.ts` est un encodeur complet — mode octet,
correction M, versions 1 à 9 — pour quatre cents lignes, commentaires compris. La
moindre bibliothèque du genre en sert quarante versions et huit modes, pèse
davantage, et coûterait une dépendance de plus dans un projet qui n'en a qu'une.
Un témoin figé dans `qr.test.ts` fixe le symbole d'un lien d'invitation module
par module : il a été vérifié contre un encodeur du commerce, qui rend
exactement cette grille, et relu par un lecteur, qui y retrouve le lien.

**Noir sur blanc, même la nuit.** Ce carré n'est pas un élément de décor, c'est
une cible d'appareil photo : un QR clair sur fond sombre est lu par certains
lecteurs et par d'autres non, et l'on ne saurait pas lesquels. La plaque reste
donc blanche quel que soit le thème — et l'écran ne s'éteint pas tant qu'elle
est ouverte, sinon la veille tomberait exactement au moment où trois personnes
sont en train de viser.

**Pas de lecteur dans le jeu.** Scanner un QR est un geste que l'appareil photo
de tous les téléphones sait faire depuis l'écran d'accueil, sans rien ouvrir.
Le faire nous-mêmes demanderait la permission caméra, ne marcherait que sur les
navigateurs qui connaissent `BarcodeDetector` — Chrome, en somme — et
remplacerait un geste que les gens ont déjà par un geste qu'il faudrait leur
apprendre.

## Qui entre dans le salon

Le code de partie servait deux rôles à la fois : désigner le point de rendez-vous
sur les relais publics, **et** tenir lieu de mot de passe. C'est une casquette de
trop pour un seul objet. L'identifiant d'app est public — le dépôt est libre —
donc qui veut peut calculer le sujet correspondant à chaque code possible,
repérer les salons ouverts et entrer.

Deux mesures, qui ne se remplacent pas l'une l'autre :

**Le code fait huit caractères** sur un alphabet de 32, soit 32⁸ ≈ 10¹²
possibilités au lieu des 33 millions d'un code à cinq. Précalculer les sujets
n'en vaut plus la peine. Trois caractères de plus à dicter au téléphone, contre
un espace de recherche trente mille fois plus grand.

**L'hôte accepte ou refuse.** C'est le vrai verrou, et le seul qui ne dépende
d'aucun calcul : le code amène jusqu'à la porte, l'hôte l'ouvre. Un code deviné
ne donne plus une place, seulement une demande à refuser d'un doigt. Un appareil
refusé est retenu — sans quoi il se representerait à chaque publication du salon,
et l'hôte passerait sa soirée à refuser le même.

**Ce qui ne demande jamais d'accord**, en revanche : un joueur qui a déjà un
siège. Rechargement de page, tunnel, batterie — il revient chez lui, et son
identité d'appareil survit précisément pour ça. Redemander l'accord de l'hôte au
milieu d'une partie serait une porte qui claque dans le dos. La règle vit dans
`admission.ts`, à part et pure : une règle de sécurité qu'on ne peut pas tester
est une règle qu'on espère.

Ce que cela ne protège pas, et qu'il vaut mieux savoir : le **P2P expose les
adresses IP** entre joueurs — c'est vrai de tout WebRTC sans relais forcé — et
**l'hôte arbitre**, donc un hôte au client modifié pourrait tricher. Modèle « on
se fait confiance entre amis », assumé. Le contenu des parties, lui, ne passe
jamais par les relais : WebRTC chiffre de bout en bout, obligatoirement.

## Licence

**GNU AGPL-3.0-or-later** — voir [LICENSE](LICENSE).

Copyleft : une variante ajoutée pour votre famille reste libre, et un site qui
sert ce code doit en offrir la source. Le bundle produit porte lui-même sa
notice, parce que la minification efface tous les commentaires du source et
qu'un JavaScript servi sans notice est un JavaScript anonyme.

Les composants tiers redistribués — Trystero (MIT), Baloo 2 et Nunito
(SIL OFL 1.1) — sont détaillés dans [THIRD-PARTY.md](THIRD-PARTY.md) ; leurs
textes complets voyagent avec l'app, dans `public/licences-tierces.txt`.
