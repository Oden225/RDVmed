-- RDVmed : à coller dans Supabase > SQL Editor > Run
-- Le script peut être relancé sans risque : il ne recrée que ce qui manque.

/* ---------- Rendez-vous partagés ---------- */
create table if not exists rdv (
  id text primary key,
  nom text not null,
  tel text default '',
  type text default 'controle',
  spec text default '',
  date text not null,
  note text default '',
  statut text default 'attente',
  vu_at text,
  created_by text default '',
  deleted int default 0,
  created_at text,
  updated_at text
);
create index if not exists rdv_updated on rdv (updated_at);
alter table rdv enable row level security;
drop policy if exists "acces_partage" on rdv;
create policy "acces_partage" on rdv for all using (true) with check (true);

/* ---------- Abonnements aux notifications push ----------
   Une ligne par téléphone/navigateur. Remplie par push-client.js
   (bouton « Activer les notifications » des Réglages), lue par les
   fonctions notify-new et rappel-quotidien. */
create table if not exists push_subscriptions (
  endpoint text primary key,
  subscription jsonb not null,
  utilisateur text default '',
  created_at timestamptz default now()
);
alter table push_subscriptions enable row level security;
drop policy if exists "abonnement_partage" on push_subscriptions;
create policy "abonnement_partage" on push_subscriptions for all using (true) with check (true);
