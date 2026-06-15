// ── Persisted entities (mirror schema.sql) ──────────────────────────────────

export interface Student {
  id: string;
  full_name: string;
  department: string;
  created_at: string;
}

export interface CurriculumDay {
  id: number;
  department: string;
  subject: string;
  day_number: number;
  topic: string;
  outline: string;
}

export interface Progress {
  id: number;
  student_id: string;
  subject: string;
  current_day_level: number;
  last_login_timestamp: string | null;
  missed_days_count: number;
  latest_assignment_score: number | null;
}

export type Role = 'user' | 'assistant';

export interface ChatMessage {
  id: number;
  student_id: string;
  subject: string;
  role: Role;
  content: string;
  day_level: number | null;
  score: number | null;
  visible: boolean;
  created_at: string;
}

export interface Announcement {
  id: number;
  message: string;
  link: string | null; // deep link to the event in the Post-UTME app
  active: boolean;
  created_at: string;
}

// ── Runtime DTOs ─────────────────────────────────────────────────────────────

/** Everything that flows into the stateful system prompt for a single turn. */
export interface TutorContext {
  studentName: string;
  department: string;
  subject: string;
  dayLevel: number;
  todayTopic: string;
  todayOutline: string;
  yesterdayTopic: string;
  missedClass: boolean;
  daysMissed: number;
  announcement: string;
}

/** The outcome of the missed-class / progression check at session start. */
export interface Attendance {
  firstEver: boolean;
  missedClass: boolean;
  daysMissed: number;
  advanced: boolean;
  dayLevel: number;
  previousDayLevel: number | null;
}

/** A single message in the shape the Claude Messages API expects. */
export interface ApiMessage {
  role: Role;
  content: string;
}

/** What the tutor generator returns for one turn. */
export interface TutorTurn {
  text: string;
  score: number | null;
  rationale: string | null;
  source: 'claude' | 'offline-stub';
}

// ── Group class entities ──────────────────────────────────────────────────────

/** A shared daily lesson generated once per subject+department per WAT day. */
export interface DailyLesson {
  id: string;
  subject: string;
  department: string;
  day_number: number;
  topic: string;
  lesson_content: string;       // Structured with ## SECTION / ## CHECK markers
  classwork_prompt: string;     // In-class exercise (graded by teacher)
  assignment_prompt: string;    // Take-home assignment (graded by teacher)
  lesson_date: string; // YYYY-MM-DD
  generated_at: string;
  goes_live_at?: string | null; // NULL = live immediately; future ISO timestamp = scheduled
}

/** A question a student submits after class, to be answered in the WhatsApp group. */
export interface TutorQuestion {
  id: string;
  student_id: string;
  subject: string;
  department: string;
  lesson_date: string;
  question_text: string | null;
  question_file_url: string | null;
  submitted_at: string;
}

/** A single student's submission — either classwork or assignment. */
export interface Submission {
  id: string;
  student_id: string;
  subject: string;
  day_number: number;
  lesson_date: string;
  submission_type: 'classwork' | 'assignment';
  submission_text: string;
  submission_file_url: string | null;
  score: number | null;
  feedback: string | null;
  submitted_at: string;
  graded_at: string | null;
}

/** One result from the batch grading AI call. */
export interface GradeResult {
  student_id: string;
  score: number;
  feedback: string;
}
