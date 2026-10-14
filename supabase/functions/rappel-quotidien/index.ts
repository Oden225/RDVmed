/* RDVmed — rappel-quotidien
   Lancée chaque matin par pg_cron (voir README-notifications.md) : envoie à
   tous les postes un résumé des rendez-vous en retard, du jour et des
   prochains jours (RAPPEL_JOURS, 1 par défaut = demain). Rien n'est envoyé
   s'il n'y a aucun rendez-vous à signaler. */
import { base, CORS, envoyerATous, jour, json } from "../_shared/push.ts";

type Rdv = { nom: string; date: string };

function liste(l: Rdv[], max = 4): string {
  const noms = l.slice(0, max).map((r) => r.nom);
  return noms.join(", ") + (l.length > max ? " +" + (l.length - max) : "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
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

    const retard = rdvs.filter((r) => r.date < auj);
    const ajd = rdvs.filter((r) => r.date === auj);
    const prochains = rdvs.filter((r) => r.date > auj);
    if (!rdvs.length) return json({ envoyes: 0, message: "Aucun rendez-vous à signaler." });

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
    return json({ ...res, aujourdhui: ajd.length, prochains: prochains.length, retard: retard.length });
  } catch (e) {
    return json({ erreur: (e as Error).message }, 500);
  }
});
