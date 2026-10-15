// RDVmed — rappel-quotidien, version en un seul fichier pour l'éditeur Supabase
/* RDVmed — envoi des notifications push à tous les postes abonnés.
   Partagé par les fonctions notify-new et rappel-quotidien. */
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function env(nom: string): string {
  const v = Deno.env.get(nom);
  if (!v) throw new Error("Secret manquant : " + nom);
  return v;
}

export function base() {
  // SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement.
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

export type Message = { title: string; body: string; tag?: string; id?: string | null; url?: string };

/* Envoie le message à chaque abonnement, sauf le téléphone `sauf` (son endpoint) :
   un même compte ouvert sur deux téléphones est donc prévenu sur l'autre.
   Priorité haute : sinon Android retarde la notification tant que l'écran est éteint.
   Les abonnements expirés (404/410) sont supprimés au passage. */
export async function envoyerATous(msg: Message, sauf = "") {
  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") || "mailto:contact@example.com",
    env("VAPID_PUBLIC_KEY"),
    env("VAPID_PRIVATE_KEY"),
  );
  const db = base();
  const { data: subs, error } = await db.from("push_subscriptions").select("endpoint, subscription, utilisateur, membre_id");
  if (error) throw error;

  const payload = JSON.stringify({ url: "./", ...msg });
  let envoyes = 0, echecs = 0;
  const expires: string[] = [];
  await Promise.all((subs || []).map(async (s) => {
    if (sauf && s.endpoint === sauf) return;
    try {
      await webpush.sendNotification(s.subscription, payload, { TTL: 60 * 60 * 12, urgency: "high" });
      envoyes++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) expires.push(s.endpoint);
      else {
        echecs++;
        console.error("Échec push", s.utilisateur, code ?? "", (e as Error).message);
      }
    }
  }));
  if (expires.length) await db.from("push_subscriptions").delete().in("endpoint", expires);
  return { envoyes, echecs, supprimes: expires.length };
}

/* Membre validé à l'origine de l'appel (jeton de session de l'application), ou null. */
export async function membreAppelant(req: Request) {
  const jeton = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jeton) return null;
  const db = base();
  const { data } = await db.auth.getUser(jeton);
  if (!data?.user) return null;
  const { data: m } = await db.from("membres").select("id, nom, valide").eq("id", data.user.id).maybeSingle();
  return m?.valide ? m as { id: string; nom: string } : null;
}

export const NOMTYPE: Record<string, string> = {
  specialiste: "RDV spécialiste",
  posthosp: "Post-hospitalisation",
  controle: "Contrôle",
};

/* Date du jour (AAAA-MM-JJ) dans le fuseau du cabinet, décalée de `off` jours. */
export function jour(off = 0): string {
  const tz = Deno.env.get("RDVMED_TZ") || "Africa/Abidjan";
  const d = new Date(Date.now() + off * 864e5);
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function fmtDate(s: string): string {
  return new Date(s + "T12:00:00Z").toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  });
}

/* RDVmed — envoi de SMS aux patients par l'API SMS d'Orange Côte d'Ivoire.
   Secrets Supabase nécessaires (sinon aucun SMS n'est envoyé) :
     ORANGE_CLIENT_ID, ORANGE_CLIENT_SECRET : application Orange Developer
     ORANGE_SENDER : numéro Orange qui a acheté le forfait SMS, ex. 2250707070707 */

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
  const exp = numeroCI(Deno.env.get("ORANGE_SENDER") || "");
  if (!exp) throw new Error("ORANGE_SENDER invalide (attendu : 225 suivi des 10 chiffres)");
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

/* RDVmed — rappel-quotidien
   Lancée chaque matin par pg_cron (voir README-notifications.md) :
   1. envoie à tous les postes un résumé des rendez-vous en retard, du jour et
      des prochains jours (RAPPEL_JOURS, 1 par défaut = demain) ;
   2. envoie un SMS de rappel aux patients dont le rendez-vous tombe dans
      RAPPEL_PATIENT_JOURS jours (1 par défaut = la veille), si Orange SMS est
      configuré et que la fiche n'a pas décoché le rappel automatique.
      Un rendez-vous ne reçoit qu'un SMS par date (même relancée plusieurs fois). */

type Rdv = { nom: string; date: string };
type RdvSms = { id: string; nom: string; tel: string; date: string; heure: string | null; rappel_sms_at: string | null };

function liste(l: Rdv[], max = 4): string {
  const noms = l.slice(0, max).map((r) => r.nom);
  return noms.join(", ") + (l.length > max ? " +" + (l.length - max) : "");
}

async function resumeEquipe() {
  const n = Math.max(1, Math.min(14, Number(Deno.env.get("RAPPEL_JOURS")) || 1));
  const auj = jour(0), fin = jour(n);
  const { data, error } = await base().from("rdv")
    .select("nom, date")
    .eq("statut", "attente")
    .eq("deleted", 0)
    .lte("date", fin)
    .order("date");
  if (error) throw error;
  const rdvs = (data || []) as Rdv[];
  if (!rdvs.length) return { envoyes: 0, message: "Aucun rendez-vous à signaler." };

  const retard = rdvs.filter((r) => r.date < auj);
  const ajd = rdvs.filter((r) => r.date === auj);
  const prochains = rdvs.filter((r) => r.date > auj);
  const lignes: string[] = [];
  if (ajd.length) lignes.push("Aujourd'hui (" + ajd.length + ") : " + liste(ajd));
  if (prochains.length) {
    lignes.push((n === 1 ? "Demain" : "Dans les " + n + " jours") + " (" + prochains.length + ") : " + liste(prochains));
  }
  if (retard.length) lignes.push("En retard (" + retard.length + ") : " + liste(retard));

  const res = await envoyerATous({
    title: "RDVmed — rappel du jour",
    body: lignes.join("\n"),
    tag: "rdvmed-rappel-" + auj,
  });
  return { ...res, aujourdhui: ajd.length, prochains: prochains.length, retard: retard.length };
}

async function smsPatients() {
  if (!smsConfigure()) return { sms: "non configuré (secrets ORANGE_* absents)" };
  const j = Math.max(0, Math.min(7, Number(Deno.env.get("RAPPEL_PATIENT_JOURS") ?? 1) || 0));
  const cible = jour(j);
  const db = base();
  const { data: cab } = await db.from("cabinet").select("nom, tel").eq("id", 1).maybeSingle();
  const { data, error } = await db.from("rdv")
    .select("id, nom, tel, date, heure, rappel_sms_at")
    .eq("statut", "attente")
    .eq("deleted", 0)
    .eq("sms_auto", true)
    .eq("date", cible);
  if (error) throw error;

  const quand = j === 0 ? "aujourd'hui" : j === 1 ? "demain" : "le " + fmtDate(cible);
  let envoyes = 0, deja = 0, sansNumero = 0;
  const erreurs: string[] = [];
  for (const r of (data || []) as RdvSms[]) {
    if (r.rappel_sms_at === r.date) { deja++; continue; }
    const num = numeroCI(r.tel);
    if (!num) { sansNumero++; continue; }
    const heure = /^\d{2}:\d{2}$/.test(r.heure || "") ? " à " + r.heure!.replace(":", "h") : "";
    const message = "Bonjour " + r.nom + ", rappel de votre rendez-vous " + quand + heure +
      " au " + (cab?.nom || "cabinet") + "." + (cab?.tel ? " Pour toute question, appelez le " + cab.tel + "." : "");
    try {
      await envoyerSMS(num, message);
      envoyes++;
      const t = new Date().toISOString();
      await db.from("rdv").update({
        rappel_sms_at: r.date, relance_at: t, relance_by: "Rappel automatique", relance_canal: "sms", updated_at: t,
      }).eq("id", r.id);
    } catch (e) {
      erreurs.push(r.nom + " : " + (e as Error).message);
      if (/connexion refusée|ORANGE_SENDER/.test((e as Error).message)) break; // inutile d'insister
    }
  }
  return { sms_envoyes: envoyes, sms_deja_envoyes: deja, sms_sans_numero: sansNumero, sms_echecs: erreurs.length,
    ...(erreurs.length ? { sms_erreurs: erreurs.slice(0, 5) } : {}) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  // Les deux envois sont indépendants : une panne de l'un n'empêche pas l'autre.
  const [equipe, patients] = await Promise.all([
    resumeEquipe().catch((e) => ({ erreur: (e as Error).message })),
    smsPatients().catch((e) => ({ sms_erreur: (e as Error).message })),
  ]);
  const ko = "erreur" in equipe && "sms_erreur" in patients;
  return json({ ...equipe, ...patients }, ko ? 500 : 200);
});
