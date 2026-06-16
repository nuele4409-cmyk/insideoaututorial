import { CONFIG } from '../config';
import { generateLesson } from '../anthropic/groupLesson';
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

/**
 * Admin: generate (or return cached) today's lesson for a subject + department.
 * Pass goesLiveAt (ISO string) to schedule the lesson for a future time — students
 * won't see it until that moment.  Pass null / omit to make it live immediately.
 */
export async function openClass(
  subject: string,
  department: string,
  goesLiveAt?: string | null,
): Promise<OpenClassResult> {
  const date = todayWAT();

  // getTodayLesson has no live filter, so it finds both live AND scheduled lessons.
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
    goes_live_at: goesLiveAt ?? null,
  });

  return { lesson, isNew: true };
}

export interface SubmitResult {
  submission: Submission;
  score: number | null;
  feedback: string | null;
  graded: boolean;
}

function lessonOpenTime(lesson: DailyLesson): Date {
  return new Date(lesson.goes_live_at ?? lesson.generated_at);
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

  const lesson = await repo.getActiveLesson(subject, department);
  if (!lesson) throw new GroupClassError("No class has been opened for this subject yet.");

  // Assignment deadline: 24 hours after class opened
  const openedAt = lessonOpenTime(lesson);
  const deadline = new Date(openedAt.getTime() + 24 * 60 * 60 * 1000);
  if (Date.now() > deadline.getTime()) {
    throw new GroupClassError(
      `Assignment deadline has passed. Submissions closed at ${deadline.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })} on ${deadline.toLocaleDateString('en-NG')}.`,
    );
  }

  await repo.saveSubmission({
    student_id: studentId,
    subject,
    day_number: lesson.day_number,
    lesson_date: lesson.lesson_date,
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
  const text = submissionText.trim();
  if (!text && !fileUrl) throw new GroupClassError('Classwork submission cannot be empty.');

  const lesson = await repo.getActiveLesson(subject, department);
  if (!lesson) throw new GroupClassError("No class has been opened for this subject yet.");

  // Classwork deadline: 2 hours after class opened
  const openedAt = lessonOpenTime(lesson);
  const classEnd = new Date(openedAt.getTime() + 2 * 60 * 60 * 1000);
  if (Date.now() > classEnd.getTime()) {
    throw new GroupClassError(
      `Classwork window has closed. Classwork was due by ${classEnd.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}. You can still submit the assignment (open for 24 hours).`,
    );
  }

  await repo.saveSubmission({
    student_id: studentId,
    subject,
    day_number: lesson.day_number,
    lesson_date: lesson.lesson_date,
    submission_type: 'classwork',
    submission_text: text,
    submission_file_url: fileUrl ?? null,
  });

  const updated = await repo.getSubmission(studentId, subject, lesson.lesson_date, 'classwork');
  return {
    submission: updated!,
    score: updated?.score ?? null,
    feedback: updated?.feedback ?? null,
    graded: updated?.score !== null && updated?.score !== undefined,
  };
}
