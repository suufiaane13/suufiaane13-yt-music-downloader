let permissionChecked = false;
let allowed = false;

async function ensurePermission(): Promise<boolean> {
  if (permissionChecked) return allowed;
  permissionChecked = true;
  try {
    const mod = await import("@tauri-apps/plugin-notification");
    allowed = await mod.isPermissionGranted();
    if (!allowed) {
      const perm = await mod.requestPermission();
      allowed = perm === "granted";
    }
  } catch {
    allowed = false;
  }
  return allowed;
}

/** Notification système (silencieuse si hors Tauri ou permission refusée). */
export async function notify(title: string, body?: string): Promise<void> {
  try {
    if (!(await ensurePermission())) return;
    const mod = await import("@tauri-apps/plugin-notification");
    mod.sendNotification({ title, body });
  } catch {
    /* ignore */
  }
}
