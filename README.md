# Dada

Les petits chevaux entre amis. Pas de compte, pas de pub, pas de quête quotidienne —
et pas de serveur à payer : les téléphones se parlent directement.

## Démarrer

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 353 tests : géométrie des 12 plateaux, règles, pouvoirs, dé, présence, pause
npm run build    # vérification de types puis build de production
```

## Comment jouer

- **Sur cet appareil** — un seul téléphone qu'on se passe. Aucun réseau requis.
- **En ligne** — l'un crée une partie, les autres saisissent le code à 8 caractères
  (ou ouvrent le lien partagé) ; l'hôte les accepte à sa table. Jusqu'à 4 joueurs.
- **Ordinateurs** — l'hôte peut compléter la table quand on n'est que deux ou trois.

Sur un seul téléphone, la partie se met **en pause** : le bot qui allait jouer, le
temps de réflexion et le dé s'arrêtent tous ensemble. Elle n'est pas proposée en
ligne — figer les bots et la pendule chez soi ne figerait rien chez les autres, et
le siège en pause finirait sauté par l'hôte au bout de son temps de réflexion.

Le règlement se consulte **pendant** une partie sans la déranger : les autres
continuent de jouer derrière, et l'écran ne se referme pas sous les yeux de qui le
lit (voir `DETOURS` dans `app.ts`).

## Les trois jeux de règles

| Variante | Plateau | Sortie | Particularités |
|---|---|---|---|
| **Petits chevaux** | 56 cases | 6 | Règle française. Une case, un cheval. Seules les cases de départ protègent. |
| **Ludo** | 52 cases | 6 | Règle internationale. Cases étoilées sûres, deux pions par case, rejeu sur capture et sur arrivée. |
| **Rapide** | 40 cases | 1 ou 6 | Arrivée sans compte exact. Parties courtes, deux chevaux. |

Les règles sont des **données**, pas du code : voir `src/game/variants.ts`. Ajouter
la variante de votre famille tient en un objet de vingt lignes.

### Les deux plateaux officiels

Ce ne sont pas deux réglages du même plateau : ce sont deux objets qui existent,
imprimés, avec un nombre de cases qu'on peut compter.

Le plateau **français des petits chevaux** compte **56 cases, 14 par quart**. Son
tracé passe par les quatre angles du carré central, ce qui le rend
orthogonalement continu — un cheval y avance toujours d'un côté de case à la
fois. Ses six marches d'escalier portent leur numéro, parce que la règle stricte
demande le chiffre exact de la marche visée.

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

**Aucun barrage**, nulle part. Le Ludo et la variante rapide laissent deux pions
d'une même couleur partager une case ; cela ne dresse aucun mur. On franchit une
pile, on peut s'arrêter dessus, et l'on y mange alors ce qui s'y trouvait.

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
| Bouclier | ×3 | main | Le cheval désigné encaisse la prochaine capture sans bouger. Le bouclier se brise à l'impact. |
| Galop | ×3 | main | Le cheval désigné avance de 3 cases. Jamais au-delà de l'arrivée : gagner par accident serait pire que rien. |
| Rejeu | ×2 | main | On relance le dé et on rejoue. La chaîne de 6 continue de compter. |
| Dé pipé | ×2 | main | Un bonus de dé de plus dans la réserve de la table. Armé, il s'encaisse dans le geste suivant : petit nombre ou grand nombre. |
| Faux pas | ×3 | — | Le cheval recule de 3 cases, sans jamais repasser par l'écurie. |
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

**Les nouvelles s'empilent, elles ne se chassent pas.** Trois au plus, et de
quatre à six secondes et demie selon ce qu'elles annoncent : un malus reste plus
longtemps qu'un bonus, parce qu'un malus qu'on n'a pas eu le temps de lire se
lit comme un bug le tour suivant, quand son effet se manifeste. Un tour de bot
qui joue une carte, lance, avance et mange produisait quatre annonces dont on ne
lisait aucune.

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
  session.ts    salon, arbitrage, minuterie de tour, relève des absents
  presence.ts   les délais : dix secondes pour jouer, quand un bot prend la main
src/ui/       écrans, plateau, animations
  rules-text.ts le règlement complet — un document, pas des libellés
```

**Un seul arbitre.** L'appareil hôte détient l'état et applique les coups ; les
autres envoient des intentions et affichent ce qu'ils reçoivent. Sans arbitre,
deux joueurs pourraient lancer le dé au même instant et voir la partie diverger.

**Position des chevaux.** Un seul entier par cheval, compté depuis son propre
départ : `-1` à l'écurie, `0..55` sur le circuit, `56..61` dans l'escalier.
Avancer, c'est additionner. La conversion vers une case du plateau vit dans
`board.ts` et nulle part ailleurs.

**Reprise après déconnexion.** Chaque appareil garde une copie complète de la
partie. Si l'hôte s'en va, un nouveau est désigné de façon déterministe et la
partie continue — les sièges que l'ancien hôte tenait pour d'autres (bots,
joueurs sur son téléphone) passent au nouvel arbitre. Un joueur qui recharge sa
page retrouve son siège : son identité est stockée localement, pas déduite de sa
connexion. Quitter n'y change rien : le code de la partie reste sur l'appareil,
et l'accueil propose d'y retourner tant qu'elle dure.

**Personne n'attend personne.** Un tour dure dix secondes ; passé le délai il
saute, et rien n'est joué à la place du joueur — ne pas jouer est toute la
peine. Trois tours sautés d'affilée, ou vingt secondes d'absence, et un bot
tient le siège en attendant. Le siège reste celui de son joueur : il porte
toujours son nom, et son retour — ou un appui sur « Reprendre » — le lui rend.
Les durées sont dans `presence.ts`, l'arbitrage dans `session.ts` : le moteur,
lui, ne connaît toujours pas l'horloge.

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
