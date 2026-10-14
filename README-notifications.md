# RDVmed — Notifications push (≈ 15 min, une seule fois)

Les notifications arrivent même quand l'application est fermée :
- **Nouveau rendez-vous** : quand quelqu'un ajoute un rendez-vous, les autres postes sont prévenus (fonction `notify-new`).
- **Rappel du jour** : chaque matin, un résumé des rendez-vous du jour, du lendemain et des retards (fonction `rappel-quotidien`).

Pré-requis : le partage Supabase est déjà en place (voir `README-DEPLOIEMENT.md`).

## 1. Tables
Supabase → **SQL Editor** → coller tout `supabase.sql` → **Run**.
Le script peut être relancé : il ajoute la table `push_subscriptions` sans toucher aux rendez-vous.

## 2. Clés VAPID
La clé **publique** est déjà dans `push-client.js` (`VAPID_PUBLIC_KEY`). Il faut la clé **privée** qui va avec.
Si vous ne l'avez plus, générez une nouvelle paire et remplacez la clé publique dans `push-client.js` :
```
npx web-push generate-vapid-keys
```
(chaque téléphone devra ensuite réactiver les notifications.)

## 3. Déployer les fonctions
Sur un ordinateur avec Node.js, dans le dossier du dépôt :
```
npx supabase login
npx supabase link --project-ref VOTRE_REF        # la partie xxxx de https://xxxx.supabase.co
npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:votre@email
npx supabase functions deploy notify-new
npx supabase functions deploy rappel-quotidien
```
Réglages facultatifs (même commande `secrets set`) :
- `RAPPEL_JOURS=3` : le rappel du matin couvre les 3 prochains jours au lieu de demain seulement.
- `RDVMED_TZ=Africa/Abidjan` : fuseau horaire du cabinet (valeur par défaut).

> Si votre clé Supabase commence par `sb_publishable_` (nouveau format), ajoutez `--no-verify-jwt` aux deux commandes `deploy`.

## 4. Programmer le rappel du matin
Supabase → **Database → Extensions** : activer `pg_cron` et `pg_net`.
Puis **SQL Editor** (remplacer `VOTRE_REF` et `VOTRE_CLE_ANON`) :
```sql
select cron.schedule(
  'rdvmed-rappel-quotidien',
  '0 7 * * *',               -- tous les jours à 7h00 UTC (= 7h00 à Abidjan)
  $$ select net.http_post(
       url := 'https://VOTRE_REF.supabase.co/functions/v1/rappel-quotidien',
       headers := jsonb_build_object('Content-Type','application/json',
                                     'Authorization','Bearer VOTRE_CLE_ANON'),
       body := '{}'::jsonb) $$
);
```
Pour l'arrêter : `select cron.unschedule('rdvmed-rappel-quotidien');`

## 5. Sur chaque téléphone
RDVmed → **Réglages** → vérifier URL + clé Supabase et votre nom → **Activer les notifications** → Autoriser.

## Vérifier
- Ajoutez un rendez-vous sur un téléphone : les autres reçoivent « Nouveau rendez-vous ».
- Supabase → **Edge Functions → rappel-quotidien → Invoke** (ou attendre 7h) : le résumé arrive si au moins un rendez-vous est à signaler.
- Les téléphones désinstallés sont retirés automatiquement de `push_subscriptions`.

Sur iPhone, les notifications ne fonctionnent que si RDVmed a été **ajoutée à l'écran d'accueil** (iOS 16.4 ou plus).
