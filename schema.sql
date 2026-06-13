-- ─────────────────────────────────────────────────────────────────────────────
-- OAU AI Tutor — canonical relational schema (reference DDL)
--
-- This is the authoritative database design for the tutor's "perfect memory".
-- The bundled runtime ships a zero-dependency embedded store (src/db/repository.ts)
-- that implements EXACTLY these tables, so the project runs on any machine with no
-- native build and no database server. To go to production, point the Repository at
-- Postgres / Supabase / SQLite by running these statements (types are Postgres-
-- flavoured; adjust TIMESTAMPTZ -> TEXT and BIGSERIAL -> INTEGER for SQLite).
-- ─────────────────────────────────────────────────────────────────────────────

-- Who the student is (name + department drive the system prompt).
CREATE TABLE students (
  id          TEXT PRIMARY KEY,
  full_name   TEXT        NOT NULL,
  department  TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Syllabus / Curriculum — daily outlines separated by Department -> Subject -> Day.
CREATE TABLE curriculum (
  id          BIGSERIAL PRIMARY KEY,
  department  TEXT    NOT NULL,
  subject     TEXT    NOT NULL,
  day_number  INTEGER NOT NULL,
  topic       TEXT    NOT NULL,     -- short title, e.g. "Newton's Laws of Motion"
  outline     TEXT    NOT NULL,     -- the teaching spine the tutor lectures from
  UNIQUE (department, subject, day_number)
);

-- Student Progress — the stateful spine the "missed class" engine reads & writes.
CREATE TABLE student_progress (
  id                       BIGSERIAL PRIMARY KEY,
  student_id               TEXT    NOT NULL REFERENCES students(id),
  subject                  TEXT    NOT NULL,
  current_day_level        INTEGER NOT NULL DEFAULT 1,
  last_login_timestamp     TIMESTAMPTZ,            -- NULL until the first class
  missed_days_count        INTEGER NOT NULL DEFAULT 0,
  latest_assignment_score  INTEGER,               -- 0-10, captured from the AI
  UNIQUE (student_id, subject)
);

-- Context / Chat Memory — the full conversation log (the student's journey).
-- The API call injects only the last N interactions (see CONFIG.historyTurns).
CREATE TABLE chat_messages (
  id          BIGSERIAL   PRIMARY KEY,
  student_id  TEXT        NOT NULL REFERENCES students(id),
  subject     TEXT        NOT NULL,
  role        TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT        NOT NULL,
  day_level   INTEGER,                              -- which class day this belonged to
  score       INTEGER,                              -- set on graded assignment turns
  visible     BOOLEAN     NOT NULL DEFAULT TRUE,    -- FALSE = orchestration "kickoff" turn
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_student_subject ON chat_messages (student_id, subject, id);

-- Admin CBT Announcement — the "Upcoming Platform Challenge" the tutor plugs.
CREATE TABLE announcements (
  id          BIGSERIAL   PRIMARY KEY,
  message     TEXT        NOT NULL,
  link        TEXT,                                -- deep link to the event in the Post-UTME app
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
