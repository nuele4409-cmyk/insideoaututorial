import { CONFIG } from '../config';
import { generateTutorTurn } from '../anthropic/client';
import { buildSystemPrompt, KICKOFF } from '../anthropic/systemPrompt';
import { repo } from '../db';
import { computeAttendance } from './missedClass';
import type { ApiMessage, Attendance, Student, TutorContext } from '../types';

const FIRST_CLASS_SENTINEL = 'None — this is the first class.';

export class ClassroomError extends Error {}

// ── Context assembly ─────────────────────────────────────────────────────────

async function buildContext(
  student: Student,
  subject: string,
  dayLevel: number,
  attendance: { missedClass: boolean; daysMissed: number },
): Promise<TutorContext> {
  const dept = student.department;
  const today = await repo.getCurriculumDay(dept, subject, dayLevel);
  if (!today) {
    throw new ClassroomError(`No curriculum for ${dept} / ${subject} / day ${dayLevel}.`);
  }
  const yesterday = dayLevel > 1 ? await repo.getCurriculumDay(dept, subject, dayLevel - 1) : null;
  const announcement = await repo.getActiveAnnouncement();

  return {
    studentName: student.full_name,
    department: dept,
    subject,
    dayLevel,
    todayTopic: today.topic,
    todayOutline: today.outline,
    yesterdayTopic: yesterday ? yesterday.topic : FIRST_CLASS_SENTINEL,
    missedClass: attendance.missedClass,
    daysMissed: attendance.daysMissed,
    announcement: announcement?.message ?? 'No platform challenge is currently announced.',
  };
}

/** The last N interactions, ready for the Messages API (must start on a user turn). */
async function buildApiHistory(studentId: string, subject: string): Promise<ApiMessage[]> {
  const recent = await repo.getRecentMessages(studentId, subject, CONFIG.historyTurns * 2);
  const msgs: ApiMessage[] = recent.map((m) => ({ role: m.role, content: m.content }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface StartResult {
  reply: string;
  source: 'claude' | 'offline-stub';
  context: TutorContext;
  attendance: Attendance;
  score: number | null;
}

/**
 * Begin a class session (the Daily Operational Loop, Phase 1+). Runs missed-class
 * detection, then asks the tutor to open the class. State is committed only after
 * the tutor turn succeeds, so a failed API call never desyncs progress.
 */
export async function startSession(args: {
  studentId: string;
  subject: string;
  now?: Date;
}): Promise<StartResult> {
  const now = args.now ?? new Date();
  const student = await repo.getStudent(args.studentId);
  if (!student) throw new ClassroomError(`Unknown student: ${args.studentId}`);

  const maxDay = await repo.maxCurriculumDay(student.department, args.subject);
  if (maxDay === 0) {
    throw new ClassroomError(`No curriculum exists for ${student.department} / ${args.subject}.`);
  }

  let progress = await repo.getProgress(args.studentId, args.subject);
  if (!progress) {
    progress = await repo.createProgress({ student_id: args.studentId, subject: args.subject });
  }

  const attendance = computeAttendance({ progress, now, maxDay });

  const ctx = await buildContext(student, args.subject, attendance.dayLevel, attendance);
  const system = buildSystemPrompt(ctx);
  const history = await buildApiHistory(args.studentId, args.subject);
  const messages: ApiMessage[] = [...history, { role: 'user', content: KICKOFF }];

  const turn = await generateTutorTurn({ system, messages, ctx, lastUserText: KICKOFF });

  // ── Commit (only now that the turn succeeded) ──
  progress.current_day_level = attendance.dayLevel;
  if (attendance.missedClass) progress.missed_days_count += attendance.daysMissed;
  progress.last_login_timestamp = now.toISOString();
  if (turn.score !== null) progress.latest_assignment_score = turn.score;
  await repo.saveProgress(progress);

  await repo.addMessage({
    student_id: args.studentId,
    subject: args.subject,
    role: 'user',
    content: KICKOFF,
    day_level: attendance.dayLevel,
    visible: false,
  });
  await repo.addMessage({
    student_id: args.studentId,
    subject: args.subject,
    role: 'assistant',
    content: turn.text,
    day_level: attendance.dayLevel,
    score: turn.score,
    visible: true,
  });

  return { reply: turn.text, source: turn.source, context: ctx, attendance, score: turn.score };
}

export interface MessageResult {
  reply: string;
  source: 'claude' | 'offline-stub';
  score: number | null;
  dayLevel: number;
  topic: string;
}

/** Continue an in-progress class session with a student message. */
export async function sendMessage(args: {
  studentId: string;
  subject: string;
  text: string;
  now?: Date;
}): Promise<MessageResult> {
  const student = await repo.getStudent(args.studentId);
  if (!student) throw new ClassroomError(`Unknown student: ${args.studentId}`);

  const progress = await repo.getProgress(args.studentId, args.subject);
  if (!progress || !progress.last_login_timestamp) {
    throw new ClassroomError('No active class session — start a session first.');
  }

  const text = args.text.trim();
  if (!text) throw new ClassroomError('Message is empty.');

  const dayLevel = progress.current_day_level;
  const ctx = await buildContext(student, args.subject, dayLevel, { missedClass: false, daysMissed: 0 });
  const system = buildSystemPrompt(ctx);
  const history = await buildApiHistory(args.studentId, args.subject);
  const messages: ApiMessage[] = [...history, { role: 'user', content: text }];

  const turn = await generateTutorTurn({ system, messages, ctx, lastUserText: text });

  // ── Commit ──
  await repo.addMessage({
    student_id: args.studentId,
    subject: args.subject,
    role: 'user',
    content: text,
    day_level: dayLevel,
    visible: true,
  });
  await repo.addMessage({
    student_id: args.studentId,
    subject: args.subject,
    role: 'assistant',
    content: turn.text,
    day_level: dayLevel,
    score: turn.score,
    visible: true,
  });
  if (turn.score !== null) {
    progress.latest_assignment_score = turn.score;
    await repo.saveProgress(progress);
  }

  return { reply: turn.text, source: turn.source, score: turn.score, dayLevel, topic: ctx.todayTopic };
}
