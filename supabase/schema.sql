create table if not exists public.grain_farmers (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.grain_master (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.grain_purchases (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.grain_payments (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.grain_settings (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.grain_sync_deletions (
  user_id uuid not null references auth.users (id) on delete cascade,
  entity text not null check (entity in ('farmers', 'grains', 'purchases', 'payments', 'settings')),
  record_id text not null,
  deleted_at timestamptz not null default now(),
  primary key (user_id, entity, record_id)
);

alter table public.grain_farmers enable row level security;
alter table public.grain_master enable row level security;
alter table public.grain_purchases enable row level security;
alter table public.grain_payments enable row level security;
alter table public.grain_settings enable row level security;
alter table public.grain_sync_deletions enable row level security;

drop policy if exists "Users manage their own farmers" on public.grain_farmers;
create policy "Users manage their own farmers" on public.grain_farmers
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "Users manage their own grains" on public.grain_master;
create policy "Users manage their own grains" on public.grain_master
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "Users manage their own purchases" on public.grain_purchases;
create policy "Users manage their own purchases" on public.grain_purchases
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "Users manage their own payments" on public.grain_payments;
create policy "Users manage their own payments" on public.grain_payments
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "Users manage their own settings" on public.grain_settings;
create policy "Users manage their own settings" on public.grain_settings
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "Users manage their own sync deletions" on public.grain_sync_deletions;
create policy "Users manage their own sync deletions" on public.grain_sync_deletions
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.grain_farmers to authenticated;
grant select, insert, update, delete on public.grain_master to authenticated;
grant select, insert, update, delete on public.grain_purchases to authenticated;
grant select, insert, update, delete on public.grain_payments to authenticated;
grant select, insert, update, delete on public.grain_settings to authenticated;
grant select, insert, update, delete on public.grain_sync_deletions to authenticated;
