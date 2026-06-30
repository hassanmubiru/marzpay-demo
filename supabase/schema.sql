-- StreetJS + MarzPay demo — Supabase schema (append-only payment events).
--
-- Run this in your Supabase project's SQL editor BEFORE deploying. PostgREST
-- (which @streetjs/plugin-supabase talks to) cannot run DDL, so the table is
-- created here once.
--
-- Model: the plugin supports only select + insert, so payment state changes are
-- recorded as immutable events. The "current" payment for a reference is derived
-- in code by reducing its events (latest event wins; earliest supplies the
-- creation time). See src/db/supabase-store.ts.

create table if not exists public.payment_events (
  id          bigint generated always as identity primary key,
  reference   text        not null,
  amount      numeric     not null,
  currency    text        not null,
  status      text        not null,
  created_at  timestamptz not null default now()
);

-- Fast lookups of all events for a reference.
create index if not exists payment_events_reference_idx
  on public.payment_events (reference);

-- Row Level Security: the demo's server uses the key you configure in Vercel.
-- If you use the SERVICE ROLE key (server-side only), RLS is bypassed and no
-- policies are required. If instead you use the ANON key, enable RLS and add
-- explicit policies. The block below is COMMENTED OUT by default; uncomment and
-- adapt only if you deploy with the anon key.
--
-- alter table public.payment_events enable row level security;
--
-- create policy "service can read payment_events"
--   on public.payment_events for select
--   using (true);
--
-- create policy "service can insert payment_events"
--   on public.payment_events for insert
--   with check (true);
