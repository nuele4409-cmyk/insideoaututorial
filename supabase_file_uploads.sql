-- Run this in your Supabase SQL editor (project zrkkurxfadlilwezqnxf)
-- Adds file upload support to student submissions

-- 1. Add the file URL column
ALTER TABLE tutor_submissions
  ADD COLUMN IF NOT EXISTS submission_file_url TEXT;

-- 2. Create the storage bucket for submission files
INSERT INTO storage.buckets (id, name, public)
VALUES ('tutor-submissions', 'tutor-submissions', false)
ON CONFLICT (id) DO NOTHING;

-- 3. Allow the service role (server) to upload and read files
CREATE POLICY "Service role can upload submission files"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'tutor-submissions');

CREATE POLICY "Service role can read submission files"
  ON storage.objects FOR SELECT
  TO service_role
  USING (bucket_id = 'tutor-submissions');
