/* RDVmed — notify-new
   Appelée par l'app (push-client.js → RDVmedPush.notifierNouveau) juste après
   la création d'un rendez-vous : prévient tous les AUTRES téléphones abonnés.
   Réservée aux membres connectés et validés. */
import { CORS, envoyerATous, fmtDate, json, membreAppelant, NOMTYPE } from "../_shared/push.ts";

const court = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erreur: "POST attendu" }, 405);

  let auteur;
  try {
    auteur = await membreAppelant(req);
  } catch (e) {
    return json({ erreur: (e as Error).message }, 500);
  }
  if (!auteur) return json({ erreur: "Connexion requise (membre validé)" }, 401);

  let rdv: Record<string, unknown> | undefined, appareil = "";
  try {
    const corps = await req.json();
    rdv = corps?.rdv;
    appareil = court(corps?.endpoint, 1000); // le téléphone qui a créé le rendez-vous
  } catch (_) { /* corps invalide */ }
  const nom = court(rdv?.nom, 80);
  const date = court(rdv?.date, 10);
  if (!rdv || !nom || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ erreur: "rdv invalide (nom et date requis)" }, 400);
  }

  const type = NOMTYPE[court(rdv.type, 20)] || court(rdv.type, 30);
  const heure = court(rdv.heure, 5);
  const quand = fmtDate(date) + (/^\d{2}:\d{2}$/.test(heure) ? " à " + heure.replace(":", " h ") : "");
  const msg = {
    title: "Nouveau rendez-vous",
    body: nom + " · " + quand + (type ? " · " + type : "") + (auteur.nom ? "\nAjouté par " + court(auteur.nom, 60) : ""),
    tag: "rdvmed-nouveau-" + court(rdv.id, 60),
    id: court(rdv.id, 60) || null,
  };

  try {
    return json(await envoyerATous(msg, appareil));
  } catch (e) {
    return json({ erreur: (e as Error).message }, 500);
  }
});
