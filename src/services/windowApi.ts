import { getCurrentWindow, type Window as TauriWindow } from "@tauri-apps/api/window";

/**
 * Fenêtre Tauri courante, ou `null` lorsqu'on n'est pas dans l'application.
 *
 * `getCurrentWindow()` lit directement
 * `__TAURI_INTERNALS__.metadata.currentWindow.label` sans garde-fou : hors
 * Tauri (ouverture de `dist/` dans un navigateur, rendu pour test, page
 * chargée sans le shell), la TypeError remonte jusqu'à React et fait tomber
 * toute la barre de titre.
 */
export function currentWindow(): TauriWindow | null {
  const internals = (globalThis as { __TAURI_INTERNALS__?: { metadata?: unknown } })
    .__TAURI_INTERNALS__;
  const label = (
    internals?.metadata as { currentWindow?: { label?: string } } | undefined
  )?.currentWindow?.label;
  if (!label) return null;
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}
