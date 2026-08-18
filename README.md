# Jeu du Dada

Les petits chevaux entre amis. Pas de compte, pas de pub, pas de quête quotidienne —
et pas de serveur à payer : les téléphones se parlent directement.

## Démarrer

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 38 tests : géométrie du plateau + règles
npm run build    # vérification de types puis build de production
```

## Comment jouer

- **Sur cet appareil** — un seul téléphone qu'on se passe. Aucun réseau requis.
- **En ligne** — l'un crée une partie, les autres saisissent le code à 5 lettres
  (ou ouvrent le lien partagé). Jusqu'à 4 joueurs.
- **Ordinateurs** — l'hôte peut compléter la table quand on n'est que deux ou trois.

## Les trois jeux de règles

| Variante | Sortie | Particularités |
|---|---|---|
| **Petits chevaux** | 6 | Règle française. Seules les cases de départ protègent. |
| **Ludo** | 6 | Cases étoilées sûres, barrages à deux chevaux, rejeu sur capture et sur arrivée. |
| **Rapide** | 1 ou 6 | Arrivée sans compte exact. Parties courtes. |

Les règles sont des **données**, pas du code : voir `src/game/variants.ts`. Ajouter
la variante de votre famille tient en un objet de quinze lignes.

## Architecture

```
src/game/     moteur pur — (état, action) → état. Aucun DOM, aucun réseau.
  board.ts      géométrie : circuit de 56 cases, escaliers, écuries
  engine.ts     règles, coups légaux, enchaînement des tours
  variants.ts   les jeux de règles
  bot.ts        adversaire artificiel
  rng.ts        aléatoire déterministe (mulberry32)
src/net/      transport pair-à-pair et orchestration de la partie
src/ui/       écrans, plateau, animations
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
partie continue. Un joueur qui recharge sa page retrouve son siège : son
identité est stockée localement, pas déduite de sa connexion.

## Déployer

N'importe quel hébergeur statique convient. Le dossier `dist/` est autonome.

```bash
npm run build
# puis publier dist/ (GitHub Pages, Cloudflare Pages, Netlify…)
```

Pour un sous-chemin (GitHub Pages de projet) :

```bash
BASE_PATH=/jeu-dada/ npm run build
```

HTTPS est requis en production : le service worker et WebRTC ne fonctionnent pas
en HTTP sur un domaine distant.

## La limite à connaître

WebRTC a besoin d'un « signaling » pour que deux navigateurs se trouvent.
Trystero le fait passer par le réseau Nostr : rien à déployer, rien à payer.

Reste le cas du **NAT symétrique**, fréquent en 4G/5G, où deux téléphones
n'arrivent pas à établir de lien direct. Un relais TURN sert alors de filet.
Celui configuré par défaut dans `src/net/room.ts` est un service public gratuit,
**sans garantie de disponibilité**. Si des amis n'arrivent jamais à se connecter
en mobile, remplacez-le par vos propres identifiants — Cloudflare Calls offre un
quota gratuit largement suffisant pour des parties entre amis.

En attendant, le mode « sur cet appareil » fonctionne toujours, hors ligne inclus.
