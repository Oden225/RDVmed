-- RDVmed : à coller dans Supabase > SQL Editor > Run
-- Le script peut être relancé sans risque : il ne recrée que ce qui manque.
-- Accès réservé aux membres de l'équipe connectés ET validés par un médecin.

/* ---------- Équipe ----------
   Une ligne par personne connectée (compte Supabase Auth, code par e-mail).
   Créée par l'application à la première connexion, en attente (valide = false)
   jusqu'à validation par un médecin. */
create table if not exists membres (
  id uuid primary key references auth.users (id) on delete cascade,
  email text default (auth.jwt() ->> 'email'),
  nom text not null check (length(trim(nom)) between 1 and 60),
  poste text not null check (poste in ('medecin', 'secretaire', 'gerant')),
  valide boolean not null default false,
  created_at timestamptz default now()
);
alter table membres enable row level security;

create or replace function est_membre() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from membres where id = auth.uid() and valide)
$$;
create or replace function est_medecin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from membres where id = auth.uid() and valide and poste = 'medecin')
$$;

drop policy if exists "membres_lecture" on membres;
drop policy if exists "membres_inscription" on membres;
drop policy if exists "membres_nom" on membres;
drop policy if exists "membres_retrait" on membres;
create policy "membres_lecture" on membres for select
  using (id = auth.uid() or est_membre());
create policy "membres_inscription" on membres for insert
  with check (id = auth.uid() and valide = false and email is not distinct from (auth.jwt() ->> 'email'));
create policy "membres_nom" on membres for update
  using (id = auth.uid()) with check (id = auth.uid());
create policy "membres_retrait" on membres for delete
  using (est_medecin() and id <> auth.uid());
-- Chacun ne peut modifier que son nom ; poste et validation passent par gerer_membre().
revoke all on membres from anon, authenticated;
grant select, insert, delete on membres to authenticated;
grant update (nom) on membres to authenticated;

create or replace function gerer_membre(p_id uuid, p_poste text, p_valide boolean) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not est_medecin() then
    raise exception 'Réservé au médecin';
  end if;
  if p_id = auth.uid() and (not p_valide or p_poste <> 'medecin') then
    raise exception 'Vous ne pouvez pas retirer vos propres droits de médecin';
  end if;
  update membres set poste = p_poste, valide = p_valide where id = p_id;
end $$;
revoke execute on function gerer_membre(uuid, text, boolean) from public, anon;
grant execute on function gerer_membre(uuid, text, boolean) to authenticated;

/* ---------- Identité du cabinet ----------
   Une seule ligne, lue par tous les membres (signature et numéro de rappel
   des messages aux patients), modifiable par le médecin uniquement. */
create table if not exists cabinet (
  id int primary key default 1 check (id = 1),
  nom text not null default 'Groupe médical Al Nouf' check (length(trim(nom)) between 1 and 80),
  tel text not null default '21 50 03 65 62' check (length(tel) <= 30),
  adresse text not null default 'San Pedro, Bardot 2' check (length(adresse) <= 120),
  updated_at timestamptz default now()
);
insert into cabinet (id) values (1) on conflict (id) do nothing;
alter table cabinet enable row level security;
drop policy if exists "cabinet_lecture" on cabinet;
drop policy if exists "cabinet_modif" on cabinet;
create policy "cabinet_lecture" on cabinet for select using (est_membre());
create policy "cabinet_modif" on cabinet for update using (est_medecin()) with check (est_medecin());
revoke all on cabinet from anon, authenticated;
grant select on cabinet to authenticated;
grant update (nom, tel, adresse, updated_at) on cabinet to authenticated;

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
alter table rdv add column if not exists created_by_id uuid;
create index if not exists rdv_updated on rdv (updated_at);
alter table rdv enable row level security;

drop policy if exists "acces_partage" on rdv;
drop policy if exists "rdv_lecture" on rdv;
drop policy if exists "rdv_ajout" on rdv;
drop policy if exists "rdv_modif" on rdv;
create policy "rdv_lecture" on rdv for select using (est_membre());
create policy "rdv_ajout" on rdv for insert with check (est_membre());
create policy "rdv_modif" on rdv for update using (est_membre()) with check (est_membre());
-- Pas de suppression physique : une fiche supprimée est marquée deleted = 1.
revoke all on rdv from anon, authenticated;
grant select, insert, update on rdv to authenticated;

create or replace function rdv_avant_ecriture() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- L'auteur est celui du compte connecté, pas ce que l'appareil déclare.
    if auth.uid() is not null then
      new.created_by_id := auth.uid();
      new.created_by := coalesce((select nom from membres where id = auth.uid()), new.created_by);
    end if;
    return new;
  end if;

  -- Une version plus ancienne n'écrase jamais une plus récente (postes restés hors ligne).
  if coalesce(new.updated_at, '') < coalesce(old.updated_at, '') then
    return null;
  end if;
  new.created_by := old.created_by;
  new.created_by_id := old.created_by_id;
  new.created_at := old.created_at;

  -- Seul un médecin peut supprimer : sinon la fiche est conservée, et datée
  -- de maintenant pour que l'appareil la récupère à la synchronisation suivante.
  if auth.uid() is not null and new.deleted = 1 and coalesce(old.deleted, 0) = 0 and not est_medecin() then
    new.deleted := 0;
    new.updated_at := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  end if;
  return new;
end $$;
drop trigger if exists rdv_avant_ecriture on rdv;
create trigger rdv_avant_ecriture before insert or update on rdv
  for each row execute function rdv_avant_ecriture();

/* ---------- Abonnements aux notifications push ----------
   Une ligne par téléphone/navigateur. Remplie par push-client.js
   (bouton « Activer les notifications » des Réglages), lue par les
   fonctions notify-new et rappel-quotidien. */
create table if not exists push_subscriptions (
  endpoint text primary key,
  subscription jsonb not null,
  utilisateur text default '',
  membre_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz default now()
);
alter table push_subscriptions add column if not exists membre_id uuid references auth.users (id) on delete cascade;
alter table push_subscriptions enable row level security;
revoke all on push_subscriptions from anon, authenticated;
grant select, insert, update, delete on push_subscriptions to authenticated;
drop policy if exists "abonnement_partage" on push_subscriptions;
drop policy if exists "abonnement_membres" on push_subscriptions;
create policy "abonnement_membres" on push_subscriptions for all
  using (est_membre()) with check (est_membre() and membre_id = auth.uid());
