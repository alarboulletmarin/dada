import { describe, expect, it } from 'vitest'
import { avatarUri } from './avatar.ts'

/**
 * Ce qui compte ici n'est pas le dessin — c'est qu'il soit LE MÊME partout.
 *
 * L'état du salon ne transporte aucun portrait : chaque téléphone dessine le
 * sien à partir du nom (voir l'en-tête d'`avatar.ts`). Si deux appareils
 * tiraient deux visages pour « Léa », personne ne s'en apercevrait au
 * débogage — chacun verrait un écran parfaitement cohérent, et une table de
 * quatre amis jouerait avec quatre galeries différentes.
 */
describe('portraits', () => {
  it('rend le même visage pour le même nom', () => {
    expect(avatarUri('Léa')).toBe(avatarUri('Léa'))
  })

  it('rend des visages différents pour des noms différents', () => {
    const names = ['Léa', 'Tom', 'Nino', 'Alexandre', 'Ordinateur 2', 'Bot 3']
    expect(new Set(names.map(avatarUri)).size).toBe(names.length)
  })

  it('ignore la casse et les espaces autour du nom', () => {
    // Le nom voyage tel qu'il a été tapé, et le salon ne le normalise pas : un
    // «  Léa » recopié d'ailleurs ne doit pas changer de tête en route.
    expect(avatarUri('  Léa ')).toBe(avatarUri('léa'))
  })

  it('accepte un nom vide sans rien casser', () => {
    // Un siège en cours de renommage passe par la chaîne vide : le champ se
    // vide avant d'être retapé, et l'écran se redessine entre les deux.
    expect(avatarUri('')).toMatch(/^data:image\/svg\+xml/)
  })
})
