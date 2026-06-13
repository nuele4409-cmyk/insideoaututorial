-- Run this in Supabase SQL editor (project zrkkurxfadlilwezqnxf)
-- Adds department support and student questions table

-- 1. Add department column to lessons
ALTER TABLE tutor_daily_lessons
  ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT 'general';

-- 2. Replace old unique constraint with one that includes department
ALTER TABLE tutor_daily_lessons
  DROP CONSTRAINT IF EXISTS tutor_daily_lessons_subject_lesson_date_key;

ALTER TABLE tutor_daily_lessons
  ADD CONSTRAINT tutor_daily_lessons_subject_dept_date_key
  UNIQUE (subject, department, lesson_date);

-- 3. Clear old demo data (it has no department info and cannot be migrated)
TRUNCATE TABLE tutor_submissions;
TRUNCATE TABLE tutor_daily_lessons;

-- 4. Create student questions table
CREATE TABLE IF NOT EXISTS tutor_questions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    text        NOT NULL,
  subject       text        NOT NULL,
  department    text        NOT NULL DEFAULT 'general',
  lesson_date   date        NOT NULL,
  question_text text,
  question_file_url text,
  submitted_at  timestamptz DEFAULT now()
);

ALTER TABLE tutor_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON tutor_questions
  TO service_role USING (true) WITH CHECK (true);
