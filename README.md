# Dada

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
n'arrivent pas à établir de lien direct. Un relais TURN sert alors de filet.
Celui configuré par défaut dans `src/net/room.ts` est un service public gratuit,
**sans garantie de disponibilité**. Si des amis n'arrivent jamais à se connecter
en mobile, remplacez-le par vos propres identifiants — Cloudflare Calls offre un
quota gratuit largement suffisant pour des parties entre amis.

En attendant, le mode « sur cet appareil » fonctionne toujours, hors ligne inclus.

## Licence

**GNU AGPL-3.0-or-later** — voir [LICENSE](LICENSE).

Copyleft : une variante ajoutée pour votre famille reste libre, et un site qui
sert ce code doit en offrir la source. Le bundle produit porte lui-même sa
notice, parce que la minification efface tous les commentaires du source et
qu'un JavaScript servi sans notice est un JavaScript anonyme.

Les composants tiers redistribués — Trystero (MIT), Baloo 2 et Nunito
(SIL OFL 1.1) — sont détaillés dans [THIRD-PARTY.md](THIRD-PARTY.md) ; leurs
textes complets voyagent avec l'app, dans `public/licences-tierces.txt`.
