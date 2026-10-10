fn main() {
    // Force tauri-build à régénérer la liste des assets frontend à chaque
    // nouvelle sortie de `npm run build` (le cache cargo ne surveille pas le
    // contenu de `dist` : sans ça, un build release peut embarquer un dist
    // vide/ancien et afficher "impossible d'accéder à la page" dans WebView).
    println!("cargo:rerun-if-changed=../dist/index.html");
    tauri_build::build();
}
