/* RDVmed — rappel-quotidien
   Lancée chaque matin par pg_cron (voir README-notifications.md) :
   1. envoie à tous les postes un résumé des rendez-vous en retard, du jour et
      des prochains jours (RAPPEL_JOURS, 1 par défaut = demain) ;
   2. envoie un SMS de rappel aux patients dont le rendez-vous tombe dans
      RAPPEL_PATIENT_JOURS jours (1 par défaut = la veille), si Orange SMS est
      configuré et que la fiche n'a pas décoché le rappel automatique.
      Un rendez-vous ne reçoit qu'un SMS par date (même relancée plusieurs fois). */
import { base, CORS, envoyerATous, fmtDate, jour, json } from "../_shared/push.ts";
import { envoyerSMS, numeroCI, smsConfigure } from "../_shared/sms.ts";

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
