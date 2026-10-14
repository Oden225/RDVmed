# RDVmed — Déploiement

RDVmed fonctionne avec un compte par personne (connexion par code reçu par e-mail).
Seuls les membres **validés par un médecin** voient les rendez-vous.

## 1. Supabase (une seule fois)
1. supabase.com → New project (gratuit)
2. **SQL Editor** → coller tout `supabase.sql` → **Run** (le script peut être relancé sans risque)
3. **Settings → API** : copier **Project URL** et la clé **anon public**, les coller dans `config.js` :
   ```js
   supabaseUrl: 'https://xxxx.supabase.co',
   supabaseAnonKey: 'eyJ…',
   ```

### Envoi des codes par e-mail (obligatoire)
L'expéditeur intégré de Supabase n'envoie qu'aux membres de votre organisation Supabase, et seulement quelques e-mails par heure : les secrétaires ne recevraient pas leur code.
1. Créer un compte gratuit chez un service d'envoi (ex. **Brevo** : 300 e-mails/jour) et récupérer ses identifiants SMTP.
2. Supabase → **Authentication → Emails → SMTP Settings** → activer **Custom SMTP** → coller hôte, port, identifiant, mot de passe, adresse d'expédition.
3. Supabase → **Authentication → Emails → Templates** : dans **Magic Link** *et* **Confirm signup**, remplacer le contenu par exemple par :
   ```html
   <h2>RDVmed — votre code de connexion</h2>
   <p>Saisissez ce code dans l'application : <strong style="font-size:24px">{{ .Token }}</strong></p>
   <p>Il expire dans une heure. Si vous n'avez rien demandé, ignorez ce message.</p>
   ```
4. **Authentication → URL Configuration** → Site URL : `https://oden225.github.io/RDVmed`

## 2. GitHub Pages
1. **Add file → Upload files** → glisser les 8 fichiers : `index.html`, `config.js`, `sw.js`, `push-client.js`, `manifest.webmanifest`, `logo-mark.svg`, `icon-192.png`, `icon-512.png` → Commit
2. **Settings → Pages** → Branch : `main`, dossier `/ (root)` → Save
3. Après 1–2 min : **https://oden225.github.io/RDVmed**

## 3. Première connexion de chaque membre
Ouvrir RDVmed → adresse e-mail → code reçu → **prénom, nom et poste** (Médecin, Secrétaire ou Gérant).
Ces informations sont demandées une seule fois : la session reste ouverte tant qu'on ne se déconnecte pas.
Le compte reste **en attente** jusqu'à sa validation par un médecin (Réglages → Équipe).

### Valider le premier médecin
Personne ne peut encore valider le tout premier compte : après vous être inscrit dans l'application, lancez une fois dans **SQL Editor** :
```sql
update membres set valide = true, poste = 'medecin' where email = 'votre@email';
```
Ensuite, tout se fait dans l'application : **Réglages → Équipe** → choisir le poste → **Valider** (ou refuser / retirer).

### Droits
| | Médecin | Secrétaire | Gérant |
|---|---|---|---|
| Voir, ajouter, marquer vu, reporter, annuler | ✅ | ✅ | ✅ |
| Supprimer une fiche | ✅ | — | — |
| Valider les comptes, attribuer les postes | ✅ | — | — |
| Modifier l'identité du cabinet (nom, numéro de rappel, adresse) | ✅ | — | — |

Ces règles sont appliquées par Supabase lui-même, pas seulement par l'affichage.
Un membre retiré perd l'accès immédiatement, et les fiches sont effacées de son téléphone à la prochaine ouverture.

## 4. Notifications (optionnel)
Voir `README-notifications.md` (fonctions Supabase dans `supabase/functions/`).

## 5. APK (comme d'habitude)
pwabuilder.com → coller l'URL → Android → **Signing key → Use mine** avec votre keystore.

## Mises à jour
Modifier les fichiers → incrémenter le numéro de `CACHE` dans `sw.js` (actuellement `rdvmed-v7`) → re-uploader.
