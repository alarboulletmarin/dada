# Composants tiers

Le code de Dada est publié sous licence **GNU AGPL-3.0-or-later** — voir
[LICENSE](LICENSE).

Ce fichier couvre ce que le site servi **redistribue** et qui porte ses propres
conditions. Les textes complets voyagent avec l'app, dans
[`public/licences-tierces.txt`](public/licences-tierces.txt) : la minification
efface tous les commentaires du bundle, et une licence qu'on ne pourrait lire
qu'en ligne n'accompagnerait pas vraiment des fontes qui, elles, partent hors
ligne avec le service worker.

| Composant | Rôle | Licence |
|---|---|---|
| [Trystero](https://github.com/dmotz/trystero) | Transport pair-à-pair : WebRTC, signaling par le réseau Nostr | MIT |
| [Baloo 2](https://github.com/EkType/Baloo2) — Ek Type | Fonte des titres, empaquetée via `@fontsource/baloo-2` | SIL OFL 1.1 |
| [Nunito](https://github.com/googlefonts/nunito) | Fonte de texte, empaquetée via `@fontsource/nunito` | SIL OFL 1.1 |
| [DiceBear](https://github.com/dicebear/dicebear) | Fabrique de portraits : compose l'avatar d'un joueur à partir de son nom | MIT |
| [Big Smile](https://www.figma.com/community/file/881358461963645496) — Ashley Seo | Le dessin des portraits (jeu de coupes, teints, bouches), servi par DiceBear | CC BY 4.0 |

Les fontes sont redistribuées **telles quelles** : `@fontsource` ne fait que les
découper par sous-ensemble et par graisse, aucun glyphe n'est modifié. L'OFL 1.1
interdit de vendre les fichiers seuls et impose que la notice les accompagne —
c'est ce que fait `licences-tierces.txt`.

Les portraits sont composés **à l'exécution**, sur l'appareil : le jeu embarque
le jeu de pièces d'Ashley Seo et le code qui les assemble, et rien n'est appelé
chez DiceBear — le jeu marche hors ligne, portraits compris. La CC BY 4.0
demande d'attribuer l'auteur et de signaler les modifications : aucune pièce
n'est retouchée, elles sont assemblées telles quelles selon le nom du joueur.

## Ce qui n'est pas redistribué

Le **relais TURN** configuré par défaut dans `src/net/room.ts` est un service
tiers appelé à l'exécution, pas du code embarqué : il ne relève d'aucune licence
de ce fichier. Voir `.env.example` pour le remplacer par le vôtre.

Le **réseau Nostr** qui sert de signaling n'est pas non plus embarqué : Trystero
s'y connecte à la demande.
