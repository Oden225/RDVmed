/* RDVmed — notify-new
   Appelée par l'app (push-client.js → RDVmedPush.notifierNouveau) juste après
   la création d'un rendez-vous : prévient tous les AUTRES postes abonnés. */
import { CORS, envoyerATous, fmtDate, json, NOMTYPE } from "../_shared/push.ts";

const court = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erreur: "POST attendu" }, 405);

  let rdv: Record<string, unknown> | undefined;
  try {
    rdv = (await req.json())?.rdv;
  } catch (_) { /* corps invalide */ }
  const nom = court(rdv?.nom, 80);
  const date = court(rdv?.date, 10);
  if (!rdv || !nom || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ erreur: "rdv invalide (nom et date requis)" }, 400);
  }

  const type = NOMTYPE[court(rdv.type, 20)] || court(rdv.type, 30);
  const auteur = court(rdv.created_by, 40);
  const msg = {
    title: "Nouveau rendez-vous",
    body: nom + " · " + fmtDate(date) + (type ? " · " + type : "") + (auteur ? "\nAjouté par " + auteur : ""),
    tag: "rdvmed-nouveau-" + court(rdv.id, 60),
    id: court(rdv.id, 60) || null,
  };

  try {
    return json(await envoyerATous(msg, auteur));
  } catch (e) {
    return json({ erreur: (e as Error).message }, 500);
  }
});
