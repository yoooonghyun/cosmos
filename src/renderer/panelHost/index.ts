/**
 * panelHost — the live-panel reparenting-portal host seam (cosmos-favorite-live-panel-portal-v1).
 * Barrel export.
 */
export { PanelHostProvider, usePanelHost } from './PanelHostProvider'
export {
  hostFor,
  panelVisible,
  isGenerativePanelId,
  GENERATIVE_PANEL_IDS,
  type GenerativePanelId,
  type PanelHost,
  type ActiveFavoriteSource
} from './panelHostLogic'
