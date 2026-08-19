/*
 * Dada — les petits chevaux entre amis, en pair-à-pair.
 * Copyright (C) 2026  Andréa Larboullet Marin
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * Code source : https://github.com/alarboulletmarin/dada
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Les fontes sont empaquetées avec l'app : la PWA doit garder son allure
// hors-ligne, sans dépendre d'un CDN de polices.
import '@fontsource/baloo-2/latin-700.css'
import '@fontsource/baloo-2/latin-800.css'
import '@fontsource/nunito/latin-600.css'
import '@fontsource/nunito/latin-700.css'
import '@fontsource/nunito/latin-800.css'
import './styles.css'
import { App } from './ui/app.ts'
import { applyTheme, readTheme, watchSystemTheme } from './ui/theme.ts'
import { clearAppCaches, mountUpdatePrompt } from './ui/update.ts'

if (import.meta.env.DEV && !__PWA_DEV__) {
  // En dev, un service worker laissé par un build précédent continue de servir
  // son cache sur le même hôte : la page s'ouvre sur l'ancienne version, voire
  // sur un écran vide. On le retire, et le cache avec, dès le chargement.
  // Sauf sous `PWA_DEV=1`, où c'est justement le worker qu'on vient regarder.
  void clearAppCaches()
} else {
  // Le jeu doit démarrer même sans réseau : le service worker sert toute l'app
  // depuis le cache. La nouvelle version, elle, attend le bandeau — recharger
  // au milieu d'une partie romprait le lien WebRTC de toute la table.
  mountUpdatePrompt()
}

// Avant tout rendu : sinon l'écran clignote en clair puis bascule.
applyTheme(readTheme())
watchSystemTheme()

const root = document.getElementById('app')
if (root) new App(root).start()
