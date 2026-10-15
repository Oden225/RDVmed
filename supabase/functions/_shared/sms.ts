/* RDVmed — envoi de SMS aux patients par l'API SMS d'Orange Côte d'Ivoire.
   Secrets Supabase nécessaires (sinon aucun SMS n'est envoyé) :
     ORANGE_CLIENT_ID, ORANGE_CLIENT_SECRET : application Orange Developer
     ORANGE_SENDER : numéro d'expéditeur indiqué par Orange, ex. 2250000 */

const API = () => (Deno.env.get("ORANGE_API") || "https://api.orange.com").replace(/\/$/, "");

export function smsConfigure(): boolean {
  return !!(Deno.env.get("ORANGE_CLIENT_ID") && Deno.env.get("ORANGE_CLIENT_SECRET") && Deno.env.get("ORANGE_SENDER"));
}

/* Numéro ivoirien au format international sans « + » (225 + 10 chiffres), ou null. */
export function numeroCI(tel: string): string | null {
  let d = String(tel || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10) d = "225" + d;
  return /^225\d{10}$/.test(d) ? d : null;
}

let jetonCache: { valeur: string; expire: number } | null = null;
async function jeton(): Promise<string> {
  if (jetonCache && jetonCache.expire > Date.now() + 60_000) return jetonCache.valeur;
  const id = Deno.env.get("ORANGE_CLIENT_ID")!, secret = Deno.env.get("ORANGE_CLIENT_SECRET")!;
  const r = await fetch(API() + "/oauth/v3/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(id + ":" + secret),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error("Orange : connexion refusée (" + r.status + "). Vérifiez ORANGE_CLIENT_ID / ORANGE_CLIENT_SECRET.");
  jetonCache = { valeur: d.access_token, expire: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  return d.access_token;
}

/* Envoie un SMS ; lève une erreur lisible en cas de refus (forfait épuisé, numéro invalide…). */
export async function envoyerSMS(destinataire: string, message: string): Promise<void> {
  // Numéro d'expéditeur indiqué par Orange : court (2250000) ou ligne complète (225 + 10 chiffres).
  let exp = String(Deno.env.get("ORANGE_SENDER") || "").replace(/\D/g, "");
  if (exp.length === 10) exp = "225" + exp;
  if (!/^225\d{4,10}$/.test(exp)) throw new Error("ORANGE_SENDER invalide (ex. 2250000, ou 225 suivi des 10 chiffres)");
  const sender = encodeURIComponent("tel:+" + exp);
  const r = await fetch(API() + "/smsmessaging/v1/outbound/" + sender + "/requests", {
    method: "POST",
    headers: { Authorization: "Bearer " + await jeton(), "Content-Type": "application/json" },
    body: JSON.stringify({
      outboundSMSMessageRequest: {
        address: "tel:+" + destinataire,
        senderAddress: "tel:+" + exp,
        outboundSMSTextMessage: { message },
      },
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error("Orange : envoi refusé (" + r.status + ") " + t.slice(0, 200));
  }
}
