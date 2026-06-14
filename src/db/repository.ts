import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import type {
  Announcement,
  ChatMessage,
  CurriculumDay,
  DailyLesson,
  Progress,
  Role,
  Student,
  Submission,
} from '../types';
import { buildInitialDB } from './seed';

// ── Embedded store shape ─────────────────────────────────────────────────────
// A plain object persisted as one JSON file. It implements schema.sql exactly.
// Functions are async to share one interface with the Supabase store (src/db).

export interface TutorDB {
  students: Student[];
  curriculum: CurriculumDay[];
  progress: Progress[];
  messages: ChatMessage[];
  announcements: Announcement[];
  _seq: { curriculum: number; progress: number; messages: number; announcements: number };
}

let db: TutorDB | null = null;

function load(): TutorDB {
  if (db) return db;
  try {
    const raw = fs.readFileSync(CONFIG.dataFile, 'utf8');
    db = JSON.parse(raw) as TutorDB;
  } catch {
    db = buildInitialDB();
    persist();
  }
  return db;
}

function persist(): void {
  if (!db) return;
  fs.mkdirSync(path.dirname(CONFIG.dataFile), { recursive: true });
  // Atomic write: tmp file then rename, so a crash mid-write can't corrupt the DB.
  const tmp = `${CONFIG.dataFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, CONFIG.dataFile);
}

function nextId(kind: keyof TutorDB['_seq']): number {
  const d = load();
  d._seq[kind] += 1;
  return d._seq[kind];
}

/** Force a fresh seed (used by `npm run seed`). */
export async function reseed(): Promise<void> {
  db = buildInitialDB();
  persist();
}

// ── Students ─────────────────────────────────────────────────────────────────

export async function getStudent(id: string): Promise<Student | null> {
  return load().students.find((s) => s.id === id) ?? null;
}

export async function listStudents(): Promise<Student[]> {
  return [...load().students];
}

export async function createStudent(input: {
  id?: string;
  full_name: string;
  department: string;
}): Promise<Student> {
  const d = load();
  const student: Student = {
    id: input.id ?? `stu_${globalThis.crypto.randomUUID().slice(0, 8)}`,
    full_name: input.full_name,
    department: input.department,
    created_at: new Date().toISOString(),
  };
  d.students.push(student);
  persist();
  return student;
}

// ── Curriculum ───────────────────────────────────────────────────────────────

export async function getCurriculumDay(
  department: string,
  subject: string,
  dayNumber: number,
): Promise<CurriculumDay | null> {
  return (
    load().curriculum.find(
      (c) => c.department === department && c.subject === subject && c.day_number === dayNumber,
    ) ?? null
  );
}

export async function maxCurriculumDay(department: string, subject: string): Promise<number> {
  return load()
    .curriculum.filter((c) => c.department === department && c.subject === subject)
    .reduce((max, c) => Math.max(max, c.day_number), 0);
}

export async function listSubjects(department: string): Promise<string[]> {
  const set = new Set(
    load()
      .curriculum.filter((c) => c.department === department)
      .map((c) => c.subject),
  );
  return [...set];
}

export async function listCurriculum(department: string, subject: string): Promise<CurriculumDay[]> {
  return load()
    .curriculum.filter((c) => c.department === department && c.subject === subject)
    .sort((a, b) => a.day_number - b.day_number);
}

export async function upsertCurriculum(
  rows: { department: string; subject: string; day_number: number; topic: string; outline: string }[],
): Promise<number> {
  const d = load();
  for (const r of rows) {
    const idx = d.curriculum.findIndex(
      (c) => c.department === r.department && c.subject === r.subject && c.day_number === r.day_number,
    );
    if (idx >= 0) d.curriculum[idx] = { ...d.curriculum[idx], topic: r.topic, outline: r.outline };
    else d.curriculum.push({ id: nextId('curriculum'), ...r });
  }
  persist();
  return rows.length;
}

// ── Progress ─────────────────────────────────────────────────────────────────

export async function getProgress(studentId: string, subject: string): Promise<Progress | null> {
  return load().progress.find((p) => p.student_id === studentId && p.subject === subject) ?? null;
}

export async function createProgress(input: {
  student_id: string;
  subject: string;
}): Promise<Progress> {
  const d = load();
  const row: Progress = {
    id: nextId('progress'),
    student_id: input.student_id,
    subject: input.subject,
    current_day_level: 1,
    last_login_timestamp: null,
    missed_days_count: 0,
    latest_assignment_score: null,
  };
  d.progress.push(row);
  persist();
  return row;
}

/** Persist mutations made to a Progress row obtained from getProgress/createProgress. */
export async function saveProgress(row: Progress): Promise<void> {
  const d = load();
  const idx = d.progress.findIndex((p) => p.id === row.id);
  if (idx === -1) d.progress.push(row);
  else d.progress[idx] = row;
  persist();
}

// ── Chat messages ────────────────────────────────────────────────────────────

export async function addMessage(input: {
  student_id: string;
  subject: string;
  role: Role;
  content: string;
  day_level: number | null;
  score?: number | null;
  visible?: boolean;
}): Promise<ChatMessage> {
  const d = load();
  const msg: ChatMessage = {
    id: nextId('messages'),
    student_id: input.student_id,
    subject: input.subject,
    role: input.role,
    content: input.content,
    day_level: input.day_level,
    score: input.score ?? null,
    visible: input.visible ?? true,
    created_at: new Date().toISOString(),
  };
  d.messages.push(msg);
  persist();
  return msg;
}

/** Last `limit` messages (any visibility) for a track, ascending by id. */
export async function getRecentMessages(
  studentId: string,
  subject: string,
  limit: number,
): Promise<ChatMessage[]> {
  return load()
    .messages.filter((m) => m.student_id === studentId && m.subject === subject)
    .sort((a, b) => a.id - b.id)
    .slice(-limit);
}

/** The student-facing transcript (orchestration kickoffs filtered out). */
export async function getVisibleHistory(studentId: string, subject: string): Promise<ChatMessage[]> {
  return load()
    .messages.filter((m) => m.student_id === studentId && m.subject === subject && m.visible)
    .sort((a, b) => a.id - b.id);
}

// ── Announcements ────────────────────────────────────────────────────────────

export async function getActiveAnnouncement(): Promise<Announcement | null> {
  return (
    load()
      .announcements.filter((a) => a.active)
      .sort((a, b) => b.id - a.id)[0] ?? null
  );
}

// ── Group class stubs (local mode does not support group class) ──────────────

const GROUP_CLASS_ERR = 'Group class requires TUTOR_STORE=supabase.';

export async function getTodayLesson(_subject: string, _department: string, _date: string): Promise<DailyLesson | null> {
  throw new Error(GROUP_CLASS_ERR);
}
export async function getLastLesson(_subject: string, _department: string): Promise<DailyLesson | null> {
  throw new Error(GROUP_CLASS_ERR);
}
export async function saveDailyLesson(_input: Omit<DailyLesson, 'id' | 'generated_at'>): Promise<DailyLesson> {
  throw new Error(GROUP_CLASS_ERR);
}
export async function getLessonStatus(_date: string): Promise<any[]> {
  throw new Error(GROUP_CLASS_ERR);
}
export async function saveQuestion(_input: any): Promise<any> {
  throw new Error(GROUP_CLASS_ERR);
}
export async function getAllQuestions(_date: string, _subject?: string): Promise<any[]> {
  throw new Error(GROUP_CLASS_ERR);
}
export async function getSubmission(_studentId: string, _subject: string, _date: string, _type?: string): Promise<Submission | null> {
  throw new Error(GROUP_CLASS_ERR);
}
export async function saveSubmission(_input: Omit<Submission, 'id' | 'submitted_at' | 'graded_at' | 'score' | 'feedback'>): Promise<Submission> {
  throw new Error(GROUP_CLASS_ERR);
}
export async function getPendingSubmissions(_subject: string, _date: string, _limit?: number): Promise<Submission[]> {
  throw new Error(GROUP_CLASS_ERR);
}
export async function saveGradeResults(_results: Array<{ id: string; score: number; feedback: string }>): Promise<void> {
  throw new Error(GROUP_CLASS_ERR);
}
export async function getAllSubmissions(_subject: string, _date: string, _type?: string): Promise<Submission[]> {
  throw new Error(GROUP_CLASS_ERR);
}
export async function saveManualGrade(_submissionId: string, _score: number, _feedback: string): Promise<void> {
  throw new Error(GROUP_CLASS_ERR);
}
export async function uploadSubmissionFile(_path: string, _buffer: Buffer, _contentType: string): Promise<string> {
  throw new Error(GROUP_CLASS_ERR);
}
export async function getSubmissionFileUrl(_path: string): Promise<string> {
  throw new Error(GROUP_CLASS_ERR);
}
export async function resetAllLessons(): Promise<number> {
  throw new Error(GROUP_CLASS_ERR);
}
export async function resetSubjectLessons(_subject: string, _department: string): Promise<number> {
  throw new Error(GROUP_CLASS_ERR);
}

// ── Announcements ────────────────────────────────────────────────────────────

export async function setAnnouncement(message: string, link: string | null = null): Promise<Announcement> {
  const d = load();
  d.announcements.forEach((a) => {
    a.active = false;
  });
  const row: Announcement = {
    id: nextId('announcements'),
    message,
    link,
    active: true,
    created_at: new Date().toISOString(),
  };
  d.announcements.push(row);
  persist();
  return row;
}
