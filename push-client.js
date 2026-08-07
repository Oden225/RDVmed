/* RDVmed — client d'abonnement aux notifications push.
   À charger dans index.html. Appeler RDVmedPush.activer() depuis le bouton
   « Activer les notifications » des Réglages.

   Pré-requis (voir README-notifications.md) :
   - VAPID_PUBLIC_KEY : clé publique générée avec web-push
   - SUPABASE_URL / SUPABASE_ANON_KEY : ceux déjà saisis dans les Réglages
*/
(function () {
  const VAPID_PUBLIC_KEY = 'BH1BpcTas1lqa5fSCaj_LUx0CH95hQIY6QKuzgx_BGmQylfbxkv14vziz8j-35pz4lfwDmhEGwFumX9yd2qPN2U';

  function urlB64ToUint8(base64) {
    const pad = '='.repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  async function activer(cfg) {
    cfg = cfg || {};
    const url = cfg.supabaseUrl, key = cfg.supabaseAnonKey, user = cfg.utilisateur || 'inconnu';
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      throw new Error('Push non supporté sur cet appareil/navigateur.');
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Autorisation refusée.');

    const reg = await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8(VAPID_PUBLIC_KEY),
      });
    }

    // Enregistre l'abonnement dans Supabase (table push_subscriptions)
    if (url && key) {
      await fetch(url.replace(/\/$/, '') + '/rest/v1/push_subscriptions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          Authorization: 'Bearer ' + key,
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          subscription: sub.toJSON(),
          utilisateur: user,
        }),
      });
    }
    return sub;
  }

  window.RDVmedPush = { activer };
})();
