-- Run this in Supabase SQL editor (project zrkkurxfadlilwezqnxf)
-- Adds classwork support: classwork_prompt column + submission_type column

-- 1. Add classwork_prompt to lessons table
ALTER TABLE tutor_daily_lessons
  ADD COLUMN IF NOT EXISTS classwork_prompt TEXT;

-- 2. Add submission_type to submissions so classwork and assignment are separate rows
ALTER TABLE tutor_submissions
  ADD COLUMN IF NOT EXISTS submission_type TEXT NOT NULL DEFAULT 'assignment';

-- 3. Drop the old unique constraint (student can now have 2 rows: classwork + assignment)
ALTER TABLE tutor_submissions
  DROP CONSTRAINT IF EXISTS tutor_submissions_student_id_subject_lesson_date_key;

-- 4. New unique constraint includes submission_type
ALTER TABLE tutor_submissions
  ADD CONSTRAINT tutor_submissions_student_subject_date_type_key
  UNIQUE (student_id, subject, lesson_date, submission_type);
