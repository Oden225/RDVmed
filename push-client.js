/* RDVmed — client d'abonnement aux notifications push.
   À charger dans index.html. Appeler RDVmedPush.activer() depuis le bouton
   « Activer les notifications » des Réglages.

   Pré-requis (voir README-notifications.md) :
   - VAPID_PUBLIC_KEY : clé publique générée avec web-push (la privée va
     dans les secrets Supabase, jamais dans ce fichier)
   - SUPABASE_URL / SUPABASE_ANON_KEY : ceux de config.js
   - token / membreId : session du membre connecté (les règles Supabase
     refusent les appels anonymes)
*/
(function () {
  const VAPID_PUBLIC_KEY = 'BDRStu99xft7KYklV9gPK-ITYt2TuCL92c0m6nXwZ4CI0yBhfumrwiHOXww61tvGtw1wpcHBeB20nTUKt_IL9eQ';

  function urlB64ToUint8(base64) {
    const pad = '='.repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  function memeCle(sub, cle) {
    const k = sub.options && sub.options.applicationServerKey;
    if (!k) return true; // navigateur qui ne l'expose pas : on garde l'abonnement
    const a = new Uint8Array(k), b = urlB64ToUint8(cle);
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  async function activer(cfg) {
    cfg = cfg || {};
    const url = cfg.supabaseUrl, key = cfg.supabaseAnonKey, user = cfg.utilisateur || 'inconnu';
    const jeton = cfg.token || key;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      throw new Error('Push non supporté sur cet appareil/navigateur.');
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Autorisation refusée.');

    const reg = await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();
    // Abonnement créé avec une ancienne clé VAPID : on le remplace.
    if (sub && !memeCle(sub, VAPID_PUBLIC_KEY)) {
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8(VAPID_PUBLIC_KEY),
      });
    }

    // Enregistre l'abonnement dans Supabase (table push_subscriptions)
    if (url && key) {
      const r = await fetch(url.replace(/\/$/, '') + '/rest/v1/push_subscriptions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          Authorization: 'Bearer ' + jeton,
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          subscription: sub.toJSON(),
          utilisateur: user,
          membre_id: cfg.membreId || null,
        }),
      });
      if (!r.ok) throw new Error('Enregistrement de l\u2019abonnement refusé (' + r.status + '). Table push_subscriptions créée ?');
    }
    return sub;
  }

  // Alerte tous les autres postes qu'un rendez-vous vient d'être créé.
  async function notifierNouveau(cfg, rdv) {
    cfg = cfg || {};
    const url = cfg.supabaseUrl, key = cfg.supabaseAnonKey;
    if (!url || !key || !rdv) return null;
    const jeton = cfg.token || key;
    let endpoint = '';
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      endpoint = (sub && sub.endpoint) || '';
    } catch (e) { /* pas abonné : tous les téléphones sont prévenus */ }
    try {
      const r = await fetch(url.replace(/\/$/, '') + '/functions/v1/notify-new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          Authorization: 'Bearer ' + jeton,
        },
        body: JSON.stringify({ rdv: rdv, endpoint: endpoint }),
      });
      return await r.json();
    } catch (e) {
      return null; // hors ligne : le rappel quotidien prendra le relais
    }
  }

  // À la déconnexion : ce téléphone ne doit plus recevoir de noms de patients.
  // L'abonnement résilié est purgé côté serveur au prochain envoi (410).
  async function desactiver() {
    try {
      if (!('serviceWorker' in navigator)) return;
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch (e) { /* rien à faire */ }
  }

  window.RDVmedPush = { activer, notifierNouveau, desactiver };
})();
