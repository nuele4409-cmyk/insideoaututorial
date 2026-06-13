-- ── Group Class tables for Virtual Tutor ─────────────────────────────────────
-- Run this in the Supabase SQL editor for the CBT project (zrkkurxfadlilwezqnxf)
-- Adds two tables: daily lessons (shared) and per-student submissions.

-- Daily lessons — generated once per subject per WAT calendar day by the admin.
-- All students in a subject see the same lesson content.
CREATE TABLE IF NOT EXISTS tutor_daily_lessons (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject           text        NOT NULL,
  day_number        integer     NOT NULL,
  topic             text        NOT NULL,
  lesson_content    text        NOT NULL,
  assignment_prompt text        NOT NULL,
  lesson_date       date        NOT NULL DEFAULT CURRENT_DATE,
  generated_at      timestamptz DEFAULT now(),
  UNIQUE(subject, lesson_date)
);

ALTER TABLE tutor_daily_lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON tutor_daily_lessons USING (false) WITH CHECK (false);

-- Student submissions — each student submits their assignment answer once per lesson.
CREATE TABLE IF NOT EXISTS tutor_submissions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      text        NOT NULL,
  subject         text        NOT NULL,
  day_number      integer     NOT NULL,
  lesson_date     date        NOT NULL,
  submission_text text        NOT NULL,
  score           integer,
  feedback        text,
  submitted_at    timestamptz DEFAULT now(),
  graded_at       timestamptz,
  UNIQUE(student_id, subject, lesson_date)
);

ALTER TABLE tutor_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON tutor_submissions USING (false) WITH CHECK (false);

-- Index for fast pending-submission lookups (used by batch grader)
CREATE INDEX IF NOT EXISTS idx_submissions_pending
  ON tutor_submissions(subject, lesson_date)
  WHERE score IS NULL;
