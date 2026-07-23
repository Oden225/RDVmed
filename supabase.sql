-- RDVmed : à coller dans Supabase > SQL Editor > Run
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
create policy "acces_partage" on rdv for all using (true) with check (true);
