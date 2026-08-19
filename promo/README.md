# Visuels Instagram

Six affiches **1080 × 1920** (9:16) dans `out/`, dessinées avec la direction
artistique du jeu — papier crème, contours d'encre, ombres franches, Baloo 2 et
Nunito — et non retouchées à la main. La source est du HTML : `posters.html`.

| Fichier | À quoi ça sert |
|---|---|
| `p1-lancement.png` | L'affiche de lancement : logo, promesse, le plateau. |
| `p2-plateau.png` | Le plateau en grand, titre à gauche. Bon pour un carrousel. |
| `p3-promesses.png` | Sans compte, sans pub, sans serveur — l'argument. |
| `p4-code.png` | Le code à cinq lettres : comment on joue à plusieurs. |
| `p5-nuit.png` | La même chose en thème sombre, pour un post du soir. |
| `p6-regles.png` | Les trois jeux de règles. |

## Refabriquer les affiches

```bash
npm run promo          # relit posters.html, réécrit out/*.png
```

Playwright n'est pas une dépendance du jeu — il n'a rien à faire dans le bundle
que téléchargent les joueurs. Il faut donc l'avoir sous la main :

```bash
npx playwright install chromium     # une fois
npm run promo
```

S'il est installé ailleurs (globalement, par exemple), on le lui dit :

```bash
PLAYWRIGHT_PATH=/chemin/vers/playwright CHROME_PATH=/chemin/vers/chrome npm run promo
```

## Refaire les captures

`shots/` contient des captures d'écran réelles, prises sur un téléphone de
390 × 844 en densité 3 (soit 1170 × 2532), en français, dans les deux thèmes.
Ce ne sont pas des maquettes : c'est le jeu qui tourne, une partie « Rapide » à
quatre jouée jusqu'à ce que le plateau soit vivant.

Les gabarits recadrent ces images au pixel près (`margin-top` négatif, hauteur
fixe du cadre) : si vous les remplacez, il faudra rerégler ces deux valeurs
dans `posters.html`.

## Ce qui est repris du jeu, et pourquoi

Les jetons de `src/styles.css` sont recopiés en tête de `posters.html`, à
l'échelle d'une affiche. C'est une copie assumée : une affiche n'a pas de thème
clair/sombre à suivre ni d'écran à ne pas faire défiler, et la faire dépendre de
la feuille de style du jeu la casserait au premier ajustement d'interface. En
échange, quand la palette du jeu bouge, ces quelques lignes sont à recopier.
