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

/* Envoie le message à chaque abonnement, sauf ceux du membre `sauf` (son id).
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
    if (sauf && s.membre_id === sauf) return;
    try {
      await webpush.sendNotification(s.subscription, payload, { TTL: 60 * 60 * 12 });
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
