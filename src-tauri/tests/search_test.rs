use yt_music_downloader_lib::youtube_search::{
    is_video_id, normalize, parse_entries, sanitize_query, search_args, urlencode,
};

#[test]
fn sanitize_query_normalise_et_borne() {
    assert_eq!(sanitize_query("  daft   punk  ").unwrap(), "daft punk");
    assert_eq!(sanitize_query("a\u{0}b\u{7}c").unwrap(), "abc");
    // Les espaces multiples (y compris les tabulations) sont réduits à un seul.
    assert_eq!(sanitize_query("cold\t \nplay").unwrap(), "cold play");
    // Requête trop courte refusée.
    assert!(sanitize_query("a").is_err());
    assert!(sanitize_query("   ").is_err());
    // Requête tronquée à 100 caractères.
    let long = "a".repeat(250);
    assert_eq!(sanitize_query(&long).unwrap().chars().count(), 100);
}

#[test]
fn normalize_produit_une_cle_de_cache_stable() {
    assert_eq!(normalize("Daft   PUNK"), "daft punk");
    assert_eq!(normalize("  Daft Punk  "), "daft punk");
    assert_eq!(normalize("Daft\tPunk"), "daft punk");
}

#[test]
fn urlencode_echappe_les_caracteres_speciaux() {
    assert_eq!(urlencode("daft punk"), "daft%20punk");
    assert_eq!(urlencode("a&b=c"), "a%26b%3Dc");
    assert_eq!(urlencode("azerty-_~1"), "azerty-_~1");
}

#[test]
fn identifiant_video_reconnu() {
    assert!(is_video_id("FGBhQbmPwH8"));
    assert!(is_video_id("xn_1hFdE-5g"));
    assert!(!is_video_id("PLZ60rAdTLVNuCAWD8W3dZTLBXbSPda-DX"));
    assert!(!is_video_id("UC_kRDKYrUlrbtrSiyu5Tflg"));
    assert!(!is_video_id("court"));
}

#[test]
fn arguments_de_recherche_isole_la_requete_apres_le_separateur() {
    let bin = std::path::PathBuf::from(".");
    let args = search_args(&bin, "daft punk", "video", 20);
    // La requête arrive après `--` : aucun mot de la requête ne peut être
    // interprété comme une option yt-dlp.
    let sep = args
        .iter()
        .position(|a| a == "--")
        .expect("séparateur absent");
    assert_eq!(
        sep + 1,
        args.len() - 1,
        "la cible doit être le dernier argument"
    );
    assert_eq!(args.last().unwrap(), "ytsearch20:daft punk");
    assert!(args.contains(&"--flat-playlist".to_string()));
    assert!(args.contains(&"--skip-download".to_string()));
    assert_eq!(
        args.iter().filter(|a| a.as_str() == "--").count(),
        1,
        "un seul séparateur"
    );

    let pl = search_args(&bin, "daft punk", "playlist", 12);
    let target = pl.last().unwrap();
    assert!(target.starts_with("https://www.youtube.com/results?search_query=daft%20punk"));
    assert!(target.contains("sp=EgIQAw%253D%253D"));
}

/// Extrait d'une vraie sortie `yt-dlp -J --flat-playlist "ytsearch…"` (champ
/// `thumbnail` absent : seule la liste `thumbnails` est fournie).
const FIXTURE: &str = r#"{
  "_type": "playlist",
  "id": "daft punk",
  "title": "daft punk",
  "entries": [
    {
      "_type": "url", "ie_key": "Youtube", "id": "FGBhQbmPwH8",
      "url": "https://www.youtube.com/watch?v=FGBhQbmPwH8",
      "title": "Daft Punk - One More Time (Official Video)",
      "duration": 322, "channel": "Daft Punk", "uploader": "Daft Punk",
      "view_count": 618633292,
      "thumbnails": [
        {"url": "https://i.ytimg.com/vi/FGBhQbmPwH8/hq720.jpg?sqp=big", "width": 720, "height": 404},
        {"url": "https://i.ytimg.com/vi/FGBhQbmPwH8/hq720.jpg?sqp=small", "width": 360, "height": 202}
      ]
    },
    {
      "_type": "url", "ie_key": "Youtube", "id": "FGBhQbmPwH8",
      "url": "https://www.youtube.com/watch?v=FGBhQbmPwH8",
      "title": "Doublon (doit être ignoré)"
    },
    {
      "_type": "url", "ie_key": "YoutubeTab", "id": "UC_kRDKYrUlrbtrSiyu5Tflg",
      "url": "https://www.youtube.com/channel/UC_kRDKYrUlrbtrSiyu5Tflg",
      "title": "Chaîne (ignorée)", "channel": "Daft Punk"
    },
    {
      "_type": "url", "ie_key": "YoutubeTab", "id": "PLZ60rAdTLVNuCAWD8W3dZTLBXbSPda-DX",
      "url": "https://www.youtube.com/playlist?list=PLZ60rAdTLVNuCAWD8W3dZTLBXbSPda-DX",
      "title": "Daft Punk - Random Access Memories",
      "channel": "Daft Punk",
      "thumbnails": [
        {"url": "https://i.ytimg.com/vi/zKSsP2084nU/hq720.jpg?rs=720", "width": 720, "height": 404},
        {"url": "https://i.ytimg.com/vi/zKSsP2084nU/hq720.jpg?rs=360", "width": 360, "height": 202}
      ]
    },
    {
      "_type": "url", "ie_key": "Youtube", "id": "xn_1hFdE-5g",
      "title": "",
      "url": "",
      "channel": "   "
    }
  ]
}"#;

#[test]
fn analyse_des_entrees_nettoyee() {
    let items = parse_entries(FIXTURE.as_bytes(), 20).unwrap();
    assert_eq!(items.len(), 3, "doublon et chaîne doivent être écartés");

    // Vidéo : URL canonique, miniature 320x180, métadonnées conservées.
    let v = &items[0];
    assert_eq!(v.id, "FGBhQbmPwH8");
    assert_eq!(v.kind, "video");
    assert_eq!(v.url, "https://www.youtube.com/watch?v=FGBhQbmPwH8");
    assert_eq!(
        v.thumbnail,
        "https://i.ytimg.com/vi/FGBhQbmPwH8/mqdefault.jpg"
    );
    assert_eq!(v.channel, "Daft Punk");
    assert_eq!(v.duration, Some(322.0));
    assert_eq!(v.views, Some(618_633_292));
    assert_eq!(v.title, "Daft Punk - One More Time (Official Video)");

    // Playlist : URL conservée, miniature = plus légère proposée, pas de durée.
    let p = &items[1];
    assert_eq!(p.kind, "playlist");
    assert_eq!(
        p.url,
        "https://www.youtube.com/playlist?list=PLZ60rAdTLVNuCAWD8W3dZTLBXbSPda-DX"
    );
    assert_eq!(
        p.thumbnail,
        "https://i.ytimg.com/vi/zKSsP2084nU/hq720.jpg?rs=360"
    );
    assert_eq!(p.duration, None);
    assert_eq!(p.views, None);

    // Valeurs par défaut : URL reconstruit, chaîne « YouTube », titre = id.
    let d = &items[2];
    assert_eq!(d.url, "https://www.youtube.com/watch?v=xn_1hFdE-5g");
    assert_eq!(d.channel, "YouTube");
    assert_eq!(d.title, "xn_1hFdE-5g");
    assert_eq!(
        d.thumbnail,
        "https://i.ytimg.com/vi/xn_1hFdE-5g/mqdefault.jpg"
    );
}

#[test]
fn analyse_respecte_la_limite_demande() {
    assert_eq!(parse_entries(FIXTURE.as_bytes(), 1).unwrap().len(), 1);
    assert_eq!(parse_entries(FIXTURE.as_bytes(), 2).unwrap().len(), 2);
}

#[test]
fn analyse_signale_une_reponse_invalide() {
    assert!(parse_entries(b"pas du json", 20).is_err());
    assert!(parse_entries(br#"{"title":"x"}"#, 20).is_err());
    assert!(parse_entries(br#"{"entries":[]}"#, 20).unwrap().is_empty());
}
