import { Image } from "@tauri-apps/api/image";
import { currentWindow } from "./services/windowApi";

// Même logo que dans l'app : carré dégradé accent + note de musique.
// Le rendu sur canvas produit l'icône exacte appliquée à la fenêtre
// (barre des tâches Windows), sans fichier image séparé.
export async function setupWindowIcon(): Promise<void> {
  try {
    const S = 512;
    const canvas = document.createElement("canvas");
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rad = S * 0.24;
    ctx.beginPath();
    ctx.moveTo(rad, 0);
    ctx.arcTo(S, 0, S, rad, rad);
    ctx.arcTo(S, S, S - rad, S, rad);
    ctx.arcTo(0, S, 0, S - rad, rad);
    ctx.arcTo(0, 0, rad, 0, rad);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0, "#ff3b5c");
    grad.addColorStop(1, "#c2163b");
    ctx.fillStyle = grad;
    ctx.fill();

    const note = new Path2D(
      "M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4 4-4V7h4V3h-6z"
    );
    const scale = (S * 0.74) / 18;
    ctx.setTransform(scale, 0, 0, scale, (S - 10 * scale) / 2, (S - 18 * scale) / 2 - scale * 0.5);
    ctx.fillStyle = "#ffffff";
    ctx.fill(note);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const base64 = canvas.toDataURL("image/png").split(",")[1];
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const image = await Image.fromBytes(bytes);
    const appWindow = currentWindow();
    if (!appWindow) return; // hors application : aucune fenêtre à orner
    await appWindow.setIcon(image);
  } catch {
    // Silencieux : l'icône par défaut reste utilisée si le canvas échoue.
  }
}