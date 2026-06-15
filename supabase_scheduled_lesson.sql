-- ─────────────────────────────────────────────────────────────────────────────
-- AI Tutor — Scheduled Class feature
-- Run once in: Supabase Dashboard → SQL Editor
--
-- Adds a goes_live_at column to tutor_daily_lessons.
-- NULL = lesson is live immediately (existing behaviour, no breaking change).
-- A future TIMESTAMPTZ = lesson was generated but students can't see it yet;
--   it becomes visible the moment the current time passes goes_live_at.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.tutor_daily_lessons
  add column if not exists goes_live_at timestamptz default null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Done.  No index needed — the column is only filtered on the student
-- "today" endpoint which is already filtered to a single row by
-- (subject, department, lesson_date).
-- ─────────────────────────────────────────────────────────────────────────────
