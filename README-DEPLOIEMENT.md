# RDVmed — Déploiement (5 min)

## 1. GitHub Pages
1. github.com → **New repository** → nom : `RDVmed` → Public → Create
2. **Add file → Upload files** → glisser les 7 fichiers : `index.html`, `sw.js`, `push-client.js`, `manifest.webmanifest`, `logo-mark.svg`, `icon-192.png`, `icon-512.png` → Commit
3. **Settings → Pages** → Branch : `main`, dossier `/ (root)` → Save
4. Après 1–2 min : **https://oden225.github.io/RDVmed**

## 2. Partage avec les secrétaires (Supabase — optionnel mais recommandé)
1. supabase.com → New project (gratuit)
2. **SQL Editor** → coller le contenu de `supabase.sql` → **Run**
3. **Settings → API** : copier **Project URL** et la clé **anon public**
4. Sur chaque téléphone (le vôtre + secrétaires) : ouvrir RDVmed → **Réglages** → coller URL + clé → **Synchroniser**
5. Chacun met son nom dans Réglages : les ajouts sont signés.

Sans Supabase, l'application fonctionne quand même, en local sur chaque appareil.

## 3. Notifications (optionnel)
Voir `README-notifications.md` (fonctions Supabase dans `supabase/functions/`).

## 4. APK (comme d'habitude)
pwabuilder.com → coller l'URL → Android → **Signing key → Use mine** avec votre keystore.

## Mises à jour
Modifier les fichiers → incrémenter le numéro de `CACHE` dans `sw.js` (actuellement `rdvmed-v4`) → re-uploader.
