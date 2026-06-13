import { CONFIG } from '../config';
import { generateLesson, gradeSubmissions } from '../anthropic/groupLesson';
import { repo } from '../db';
import { POSTUTME_DEPT } from '../subjects';
import type { DailyLesson, Submission } from '../types';

function todayWAT(): string {
  const offset = CONFIG.timezoneOffsetHours * 3_600_000;
  return new Date(Date.now() + offset).toISOString().slice(0, 10);
}

export class GroupClassError extends Error {}

export interface OpenClassResult {
  lesson: DailyLesson;
  isNew: boolean;
}

/** Admin: generate (or return cached) today's lesson for a subject + department. */
export async function openClass(subject: string, department: string): Promise<OpenClassResult> {
  const date = todayWAT();

  const existing = await repo.getTodayLesson(subject, department, date);
  if (existing) return { lesson: existing, isNew: false };

  const last = await repo.getLastLesson(subject, department);
  const dayNumber = last ? last.day_number + 1 : 1;

  const curriculum = await repo.getCurriculumDay(POSTUTME_DEPT, subject, dayNumber);
  if (!curriculum) {
    throw new GroupClassError(
      `No curriculum for ${subject} day ${dayNumber}. Upload an outline first.`,
    );
  }

  const { lessonContent, classworkPrompt, assignmentPrompt } = await generateLesson(subject, curriculum);

  const lesson = await repo.saveDailyLesson({
    subject,
    department,
    day_number: dayNumber,
    topic: curriculum.topic,
    lesson_content: lessonContent,
    classwork_prompt: classworkPrompt,
    assignment_prompt: assignmentPrompt,
    lesson_date: date,
  });

  return { lesson, isNew: true };
}

export interface SubmitResult {
  submission: Submission;
  score: number | null;
  feedback: string | null;
  graded: boolean;
}

/** Student: submit assignment answer and auto-grade all pending submissions in one batch call. */
export async function submitAssignment(
  studentId: string,
  subject: string,
  department: string,
  submissionText: string,
  fileUrl?: string | null,
): Promise<SubmitResult> {
  const date = todayWAT();
  const text = submissionText.trim();
  if (!text && !fileUrl) throw new GroupClassError('Submission cannot be empty.');

  const lesson = await repo.getTodayLesson(subject, department, date);
  if (!lesson) throw new GroupClassError("Today's class for this subject hasn't been opened yet.");

  await repo.saveSubmission({
    student_id: studentId,
    subject,
    day_number: lesson.day_number,
    lesson_date: date,
    submission_type: 'assignment',
    submission_text: text,
    submission_file_url: fileUrl ?? null,
  });

  const updated = await repo.getSubmission(studentId, subject, date, 'assignment');
  return {
    submission: updated!,
    score: updated?.score ?? null,
    feedback: updated?.feedback ?? null,
    graded: updated?.score !== null && updated?.score !== undefined,
  };
}

/** Student: submit classwork answer (graded manually by teacher). */
export async function submitClasswork(
  studentId: string,
  subject: string,
  department: string,
  submissionText: string,
  fileUrl?: string | null,
): Promise<SubmitResult> {
  const date = todayWAT();
  const text = submissionText.trim();
  if (!text && !fileUrl) throw new GroupClassError('Classwork submission cannot be empty.');

  const lesson = await repo.getTodayLesson(subject, department, date);
  if (!lesson) throw new GroupClassError("Today's class for this subject hasn't been opened yet.");

  await repo.saveSubmission({
    student_id: studentId,
    subject,
    day_number: lesson.day_number,
    lesson_date: date,
    submission_type: 'classwork',
    submission_text: text,
    submission_file_url: fileUrl ?? null,
  });

  const updated = await repo.getSubmission(studentId, subject, date, 'classwork');
  return {
    submission: updated!,
    score: updated?.score ?? null,
    feedback: updated?.feedback ?? null,
    graded: updated?.score !== null && updated?.score !== undefined,
  };
}
