/**
 * Lecture des réglages TURN fournis au build.
 *
 * Isolé dans son propre module, et non gardé dans `room.ts` : ces trois lignes
 * décident si une partie à distance est possible ou non, et elles méritent
 * d'être vérifiables sans réveiller tout le transport pair-à-pair.
 */

/**
 * Construit la liste de serveurs ICE à partir des trois variables de build.
 * Rend `undefined` s'il en manque une : sans relais, la partie se joue quand
 * même entre deux réseaux qui s'entendent, et l'app dit franchement le reste.
 *
 * Les trois valeurs arrivent d'un copier-coller dans l'interface d'un
 * hébergeur, où une espace de trop ou un retour à la ligne ne se voit pas. On
 * rogne donc les trois plutôt que les seules URLs :
 *
 * - une espace collée à l'identifiant ou au mot de passe fait répondre 401 au
 *   relais, et l'échec est alors mot pour mot celui d'une absence de TURN —
 *   impossible à distinguer depuis le téléphone qui attend ;
 * - une virgule finale dans la liste d'URLs laisse une chaîne vide derrière
 *   elle, et une chaîne vide dans `urls` fait lever `RTCPeerConnection` à la
 *   construction : c'est toute la mise en relation qui tombe, pour une virgule.
 */
export function turnServers(
  urls: string | undefined,
  username: string | undefined,
  credential: string | undefined,
): RTCIceServer[] | undefined {
  const list = (urls ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url !== '')
  const user = username?.trim()
  const pass = credential?.trim()
  if (list.length === 0 || !user || !pass) return undefined
  return [{ urls: list, username: user, credential: pass }]
}
