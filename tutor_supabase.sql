-- ─────────────────────────────────────────────────────────────────────────────
-- Virtual Tutor — tables for the Inside OAU! Post-UTME project (zrkkurxfadlilwezqnxf)
--
-- Run in: Supabase Dashboard → SQL Editor (the SAME project the CBT app uses).
-- The tutor backend reads/writes these with the SERVICE ROLE key (server-side
-- only — never shipped to the browser), so RLS is enabled with NO client policies:
-- anon/authenticated get nothing, service_role bypasses RLS. The server seeds the
-- curriculum automatically on first boot, so you only need to create the tables.
--
-- After running this:
--   1. Supabase → Project Settings → API → copy the `service_role` key.
--   2. In oau-ai-tutor\.env set:
--        CBT_SERVICE_ROLE_KEY=<that key>
--        TUTOR_STORE=supabase
--   3. Restart the tutor (npm run server).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.tutor_students (
  id          text primary key,                   -- the IOAU-#### id from profiles
  full_name   text not null,
  department  text not null default 'Science',
  created_at  timestamptz not null default now()
);

create table if not exists public.tutor_curriculum (
  id          bigint generated always as identity primary key,
  department  text not null,
  subject     text not null,
  day_number  int  not null,
  topic       text not null,
  outline     text not null,
  unique (department, subject, day_number)
);

create table if not exists public.tutor_progress (
  id                       bigint generated always as identity primary key,
  student_id               text not null,          -- the IOAU-#### id from profiles
  subject                  text not null,
  current_day_level        int  not null default 1,
  last_login_timestamp     timestamptz,
  missed_days_count        int  not null default 0,
  latest_assignment_score  int,
  unique (student_id, subject)
);

create table if not exists public.tutor_messages (
  id          bigint generated always as identity primary key,
  student_id  text not null,
  subject     text not null,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  day_level   int,
  score       int,
  visible     boolean not null default true,       -- false = orchestration kickoff turn
  created_at  timestamptz not null default now()
);
create index if not exists idx_tutor_messages_lookup
  on public.tutor_messages (student_id, subject, id);

-- Lock down: RLS on, no client policies. Only the server's service_role touches these.
alter table public.tutor_students   enable row level security;
alter table public.tutor_curriculum enable row level security;
alter table public.tutor_progress   enable row level security;
alter table public.tutor_messages   enable row level security;
