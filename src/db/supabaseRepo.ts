// Supabase-backed tutor store — same surface as repository.ts, but async and
// persisted in the CBT project's tutor_* tables. Activated by TUTOR_STORE=supabase.
// Uses the SERVICE ROLE key (server-side) so the tutor tables stay locked under RLS.
import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../config';
import { buildInitialDB } from './seed';
import type {
  Announcement,
  ChatMessage,
  CurriculumDay,
  DailyLesson,
  GradeResult,
  Progress,
  Student,
  Submission,
  TutorQuestion,
} from '../types';
import { POSTUTME_DEPT, TRACKS, subjectLabel } from '../subjects';

const key = CONFIG.cbt.serviceRoleKey || CONFIG.cbt.anonKey;
const sb = createClient(CONFIG.cbt.url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

if (CONFIG.tutorStore === 'supabase' && !CONFIG.cbt.serviceRoleKey) {
  console.warn(
    '[tutor] TUTOR_STORE=supabase but CBT_SERVICE_ROLE_KEY is unset — the locked-down ' +
      'tutor_* tables will reject reads/writes. Set the service role key in .env.',
  );
}

// Seed the curriculum into tutor_curriculum on first use (idempotent).
let seedPromise: Promise<void> | null = null;
function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      const { count, error } = await sb
        .from('tutor_curriculum')
        .select('id', { count: 'exact', head: true });
      if (error) throw error;
      if ((count ?? 0) === 0) {
        const rows = buildInitialDB().curriculum.map(({ id, ...rest }) => rest);
        const { error: insErr } = await sb.from('tutor_curriculum').insert(rows);
        if (insErr) throw insErr;
      }
    })();
  }
  return seedPromise;
}

// ── Students (mirrored from CBT profiles on login) ───────────────────────────

export async function getStudent(id: string): Promise<Student | null> {
  const { data } = await sb.from('tutor_students').select('*').eq('id', id).maybeSingle();
  return (data as Student) ?? null;
}

export async function listStudents(): Promise<Student[]> {
  const { data } = await sb.from('tutor_students').select('*');
  return (data as Student[]) ?? [];
}

export async function createStudent(input: {
  id?: string;
  full_name: string;
  department: string;
}): Promise<Student> {
  const row = {
    id: input.id ?? `IOAU-${globalThis.crypto.randomUUID().slice(0, 8)}`,
    full_name: input.full_name,
    department: input.department,
    created_at: new Date().toISOString(),
  };
  const { data, error } = await sb
    .from('tutor_students')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return data as Student;
}

// ── Curriculum ───────────────────────────────────────────────────────────────

export async function getCurriculumDay(
  department: string,
  subject: string,
  dayNumber: number,
): Promise<CurriculumDay | null> {
  await ensureSeeded();
  const { data, error } = await sb
    .from('tutor_curriculum')
    .select('*')
    .eq('department', department)
    .eq('subject', subject)
    .eq('day_number', dayNumber)
    .maybeSingle();
  if (error) throw new Error(`Curriculum lookup failed: ${error.message}`);
  return (data as CurriculumDay) ?? null;
}

export async function maxCurriculumDay(department: string, subject: string): Promise<number> {
  await ensureSeeded();
  const { data } = await sb
    .from('tutor_curriculum')
    .select('day_number')
    .eq('department', department)
    .eq('subject', subject)
    .order('day_number', { ascending: false })
    .limit(1);
  return data && data.length ? (data[0] as { day_number: number }).day_number : 0;
}

export async function listSubjects(department: string): Promise<string[]> {
  await ensureSeeded();
  const { data } = await sb.from('tutor_curriculum').select('subject').eq('department', department);
  return [...new Set((data ?? []).map((r) => (r as { subject: string }).subject))];
}

export async function listCurriculum(department: string, subject: string): Promise<CurriculumDay[]> {
  await ensureSeeded();
  const { data } = await sb
    .from('tutor_curriculum')
    .select('*')
    .eq('department', department)
    .eq('subject', subject)
    .order('day_number', { ascending: true });
  return (data as CurriculumDay[]) ?? [];
}

export async function upsertCurriculum(
  rows: { department: string; subject: string; day_number: number; topic: string; outline: string }[],
): Promise<number> {
  await ensureSeeded();
  const { error } = await sb
    .from('tutor_curriculum')
    .upsert(rows, { onConflict: 'department,subject,day_number' });
  if (error) throw error;
  return rows.length;
}

// ── Progress ─────────────────────────────────────────────────────────────────

export async function getProgress(studentId: string, subject: string): Promise<Progress | null> {
  const { data } = await sb
    .from('tutor_progress')
    .select('*')
    .eq('student_id', studentId)
    .eq('subject', subject)
    .maybeSingle();
  return (data as Progress) ?? null;
}

export async function createProgress(input: {
  student_id: string;
  subject: string;
}): Promise<Progress> {
  const { data, error } = await sb
    .from('tutor_progress')
    .insert({
      student_id: input.student_id,
      subject: input.subject,
      current_day_level: 1,
      last_login_timestamp: null,
      missed_days_count: 0,
      latest_assignment_score: null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Progress;
}

export async function saveProgress(row: Progress): Promise<void> {
  const { id, ...rest } = row;
  const { error } = await sb.from('tutor_progress').update(rest).eq('id', id);
  if (error) throw error;
}

// ── Chat messages ────────────────────────────────────────────────────────────

export async function addMessage(input: {
  student_id: string;
  subject: string;
  role: 'user' | 'assistant';
  content: string;
  day_level: number | null;
  score?: number | null;
  visible?: boolean;
}): Promise<ChatMessage> {
  const { data, error } = await sb
    .from('tutor_messages')
    .insert({
      student_id: input.student_id,
      subject: input.subject,
      role: input.role,
      content: input.content,
      day_level: input.day_level,
      score: input.score ?? null,
      visible: input.visible ?? true,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ChatMessage;
}

export async function getRecentMessages(
  studentId: string,
  subject: string,
  limit: number,
): Promise<ChatMessage[]> {
  const { data } = await sb
    .from('tutor_messages')
    .select('*')
    .eq('student_id', studentId)
    .eq('subject', subject)
    .order('id', { ascending: false })
    .limit(limit);
  return ((data as ChatMessage[]) ?? []).reverse();
}

export async function getVisibleHistory(studentId: string, subject: string): Promise<ChatMessage[]> {
  const { data } = await sb
    .from('tutor_messages')
    .select('*')
    .eq('student_id', studentId)
    .eq('subject', subject)
    .eq('visible', true)
    .order('id', { ascending: true });
  return (data as ChatMessage[]) ?? [];
}

// ── Announcements — handled by the CBT app (scheduled_mocks) in supabase mode ─

export async function getActiveAnnouncement(): Promise<Announcement | null> {
  return null;
}

export async function setAnnouncement(): Promise<Announcement> {
  throw new Error('In supabase mode, events come from the CBT app (scheduled_mocks).');
}

export async function reseed(): Promise<void> {
  // Curriculum seeding is handled lazily by ensureSeeded().
}

// ── Group class: daily lessons ────────────────────────────────────────────────

export async function getTodayLesson(subject: string, department: string, date: string): Promise<DailyLesson | null> {
  const { data } = await sb
    .from('tutor_daily_lessons')
    .select('*')
    .eq('subject', subject)
    .eq('department', department)
    .eq('lesson_date', date)
    .maybeSingle();
  return (data as DailyLesson) ?? null;
}

export async function getLastLesson(subject: string, department: string): Promise<DailyLesson | null> {
  const { data } = await sb
    .from('tutor_daily_lessons')
    .select('*')
    .eq('subject', subject)
    .eq('department', department)
    .order('day_number', { ascending: false })
    .limit(1);
  return data && data.length ? (data[0] as DailyLesson) : null;
}

export async function saveDailyLesson(
  input: Omit<DailyLesson, 'id' | 'generated_at'>,
): Promise<DailyLesson> {
  const { data, error } = await sb
    .from('tutor_daily_lessons')
    .upsert(input, { onConflict: 'subject,department,lesson_date' })
    .select()
    .single();
  if (error) throw error;
  return data as DailyLesson;
}

export async function getLessonStatus(date: string) {
  const result = [];
  for (const track of TRACKS) {
    const trackSubjects = [];
    for (const subject of track.subjects) {
      // ── Today's lesson (if any) ──────────────────────────────────────
      const { data: lesson } = await sb
        .from('tutor_daily_lessons')
        .select('day_number, topic')
        .eq('subject', subject)
        .eq('department', track.key)
        .eq('lesson_date', date)
        .maybeSingle();

      // ── Next lesson preview from curriculum ──────────────────────────
      // Find the highest lesson day ever generated, then look up that next day in curriculum.
      const { data: lastRows } = await sb
        .from('tutor_daily_lessons')
        .select('day_number')
        .eq('subject', subject)
        .eq('department', track.key)
        .order('day_number', { ascending: false })
        .limit(1);
      const lastDayNum: number = (lastRows?.[0] as any)?.day_number ?? 0;
      const nextDayNum = lastDayNum + 1;
      const { data: nextCurr } = await sb
        .from('tutor_curriculum')
        .select('topic')
        .eq('department', POSTUTME_DEPT)
        .eq('subject', subject)
        .eq('day_number', nextDayNum)
        .maybeSingle();
      const nextTopic: string | null = (nextCurr as any)?.topic ?? null;

      if (!lesson) {
        trackSubjects.push({ subject, label: subjectLabel(subject), nextDay: nextDayNum, nextTopic });
        continue;
      }

      const { count: submitted } = await sb
        .from('tutor_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('subject', subject)
        .eq('lesson_date', date);

      const { count: graded } = await sb
        .from('tutor_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('subject', subject)
        .eq('lesson_date', date)
        .not('score', 'is', null);

      trackSubjects.push({
        subject,
        label: subjectLabel(subject),
        day_number: (lesson as any).day_number,
        topic: (lesson as any).topic,
        submitted: submitted ?? 0,
        graded: graded ?? 0,
        nextDay: nextDayNum,
        nextTopic,
      });
    }
    result.push({ key: track.key, label: track.label, subjects: trackSubjects });
  }
  return result;
}

export async function resetAllLessons(): Promise<number> {
  const { count, error: countErr } = await sb
    .from('tutor_daily_lessons')
    .select('id', { count: 'exact', head: true });
  if (countErr) throw new Error(countErr.message);
  const total = count ?? 0;
  if (total > 0) {
    const { error } = await sb
      .from('tutor_daily_lessons')
      .delete()
      .gt('day_number', 0);
    if (error) throw new Error(error.message);
  }
  return total;
}

export async function resetSubjectLessons(subject: string, department: string): Promise<number> {
  const { count, error: countErr } = await sb
    .from('tutor_daily_lessons')
    .select('id', { count: 'exact', head: true })
    .eq('subject', subject)
    .eq('department', department);
  if (countErr) throw new Error(countErr.message);
  const total = count ?? 0;
  if (total > 0) {
    const { error } = await sb
      .from('tutor_daily_lessons')
      .delete()
      .eq('subject', subject)
      .eq('department', department);
    if (error) throw new Error(error.message);
  }
  return total;
}

// ── Group class: submissions ──────────────────────────────────────────────────

export async function getSubmission(
  studentId: string,
  subject: string,
  date: string,
  type: 'classwork' | 'assignment' = 'assignment',
): Promise<Submission | null> {
  const { data } = await sb
    .from('tutor_submissions')
    .select('*')
    .eq('student_id', studentId)
    .eq('subject', subject)
    .eq('lesson_date', date)
    .eq('submission_type', type)
    .maybeSingle();
  return (data as Submission) ?? null;
}

export async function saveSubmission(
  input: Omit<Submission, 'id' | 'submitted_at' | 'graded_at' | 'score' | 'feedback'>,
): Promise<Submission> {
  const { data, error } = await sb
    .from('tutor_submissions')
    .upsert(
      { ...input, score: null, feedback: null },
      { onConflict: 'student_id,subject,lesson_date,submission_type' },
    )
    .select()
    .single();
  if (error) throw error;
  return data as Submission;
}

export async function getPendingSubmissions(
  subject: string,
  date: string,
  limit = 10,
): Promise<Submission[]> {
  const { data } = await sb
    .from('tutor_submissions')
    .select('*')
    .eq('subject', subject)
    .eq('lesson_date', date)
    .is('score', null)
    .limit(limit);
  return (data as Submission[]) ?? [];
}

export async function saveGradeResults(
  results: Array<{ id: string; score: number; feedback: string }>,
): Promise<void> {
  const now = new Date().toISOString();
  await Promise.all(
    results.map((r) =>
      sb
        .from('tutor_submissions')
        .update({ score: r.score, feedback: r.feedback, graded_at: now })
        .eq('id', r.id),
    ),
  );
}

export async function getAllSubmissions(
  subject: string,
  date: string,
  type: 'classwork' | 'assignment' = 'assignment',
): Promise<Submission[]> {
  const { data, error } = await sb
    .from('tutor_submissions')
    .select('*')
    .eq('subject', subject)
    .eq('lesson_date', date)
    .eq('submission_type', type)
    .order('submitted_at', { ascending: true });
  if (error) throw error;
  return (data as Submission[]) ?? [];
}

export async function saveManualGrade(
  submissionId: string,
  score: number,
  feedback: string,
): Promise<void> {
  const { error } = await sb
    .from('tutor_submissions')
    .update({ score, feedback, graded_at: new Date().toISOString() })
    .eq('id', submissionId);
  if (error) throw error;
}

export async function saveQuestion(
  input: Omit<TutorQuestion, 'id' | 'submitted_at'>,
): Promise<TutorQuestion> {
  const { data, error } = await sb
    .from('tutor_questions')
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as TutorQuestion;
}

export async function getAllQuestions(date: string, subject?: string): Promise<TutorQuestion[]> {
  let q = sb.from('tutor_questions').select('*').eq('lesson_date', date).order('submitted_at', { ascending: true });
  if (subject) q = (q as any).eq('subject', subject);
  const { data, error } = await q;
  if (error) throw error;
  return (data as TutorQuestion[]) ?? [];
}

export async function uploadSubmissionFile(
  path: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const { error } = await sb.storage
    .from('tutor-submissions')
    .upload(path, buffer, { contentType, upsert: true });
  if (error) throw error;
  return path;
}

export async function getSubmissionFileUrl(path: string): Promise<string> {
  const { data, error } = await sb.storage
    .from('tutor-submissions')
    .createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
