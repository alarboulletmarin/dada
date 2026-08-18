# Composants tiers

Le code du Jeu du Dada est publié sous licence **GNU AGPL-3.0-or-later** — voir
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

Les fontes sont redistribuées **telles quelles** : `@fontsource` ne fait que les
découper par sous-ensemble et par graisse, aucun glyphe n'est modifié. L'OFL 1.1
interdit de vendre les fichiers seuls et impose que la notice les accompagne —
c'est ce que fait `licences-tierces.txt`.

## Ce qui n'est pas redistribué

Le **relais TURN** configuré par défaut dans `src/net/room.ts` est un service
tiers appelé à l'exécution, pas du code embarqué : il ne relève d'aucune licence
de ce fichier. Voir `.env.example` pour le remplacer par le vôtre.

Le **réseau Nostr** qui sert de signaling n'est pas non plus embarqué : Trystero
s'y connecte à la demande.
