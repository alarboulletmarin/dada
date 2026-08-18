/**
 * Les adresses du projet, en un seul endroit.
 *
 * Ici et non dans un module de site : l'AGPL demande que le programme offre sa
 * source **depuis son interface**, donc c'est l'app elle-même qui doit porter le
 * lien — l'écran « à propos » le fait.
 */

export const REPO = 'https://github.com/alarboulletmarin/jeu-dada'

/** Le fichier livré avec le programme, pas le texte canonique de la FSF.
 *
 *  C'est celui-là qui fait foi : l'AGPL demande qu'une copie de la licence
 *  accompagne le logiciel, et « or later » veut dire que le fichier du dépôt
 *  peut dire une chose que la page d'une version précise ne dit pas. Le lien
 *  atterrit dans le même dépôt que la source — qui veut vérifier ses droits
 *  trouve le texte et le code au même endroit. */
export const LICENCE_URL = `${REPO}/blob/main/LICENSE`

/** Les notices des composants tiers, servies avec l'app et précachées avec
 *  elle : les fontes qu'elles couvrent partent hors ligne, leur licence aussi. */
export const THIRD_PARTY_URL = `${import.meta.env.BASE_URL}licences-tierces.txt`
