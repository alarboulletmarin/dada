/**
 * Le stockage local, posé avant que quoi que ce soit ne l'appelle.
 *
 * `i18n.ts` et `theme.ts` lisent `localStorage` **au chargement du module** —
 * c'est voulu : la langue et le thème doivent être connus avant le premier
 * rendu, sinon l'écran clignote. Un `beforeEach` arrive donc trop tard, et le
 * fichier de test entier échoue à l'import.
 *
 * Or ni Node ni jsdom n'en fournissent un ici : Node 26 déclare bien un
 * `localStorage` global, mais il vaut `undefined` sans `--localstorage-file`,
 * et il masque celui de jsdom. D'où ce fichier, branché en `setupFiles` : il
 * s'exécute avant l'import du fichier de test.
 *
 * **Il ne fait rien hors du DOM.** Les tests `node` — moteur, réseau, présence —
 * gardent leur propre stockage en mémoire et ne voient pas passer ce fichier :
 * la garde `typeof window` les laisse exactement où ils étaient.
 */

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const store = (): Storage => {
    const map = new Map<string, string>()
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, String(v)),
      removeItem: (k) => void map.delete(k),
      clear: () => map.clear(),
      key: (i) => [...map.keys()][i] ?? null,
      get length() {
        return map.size
      },
    } as Storage
  }

  for (const name of ['localStorage', 'sessionStorage'] as const) {
    if (globalThis[name]) continue
    Object.defineProperty(globalThis, name, { value: store(), configurable: true, writable: true })
  }
}
