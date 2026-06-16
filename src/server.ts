import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import katex from 'katex';
import { AI_SOURCE, CONFIG } from './config';
import { repo } from './db';
import { ClassroomError, sendMessage, startSession } from './engine/classroom';
import { GroupClassError, openClass, submitAssignment, submitClasswork } from './engine/groupClass';
import * as cbt from './supabase/cbt';
import { ALL_SUBJECT_KEYS, POSTUTME_DEPT, TRACKS, inferTrack, lessonDept, subjectLabel } from './subjects';

// ── Server-side LaTeX rendering ───────────────────────────────────────────────
function _esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function renderMath(text: string): string {
  const parts: string[] = [];
  let last = 0;
  const re = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(_esc(text.slice(last, m.index)));
    const display = m[1].startsWith('$$');
    const latex = display ? m[1].slice(2, -2).trim() : m[1].slice(1, -1).trim();
    try {
      parts.push(katex.renderToString(latex, { displayMode: display, throwOnError: false, output: 'html' }));
    } catch { parts.push(_esc(m[1])); }
    last = m.index + m[1].length;
  }
  if (last < text.length) parts.push(_esc(text.slice(last)));
  return parts.join('');
}
function enrichLesson(lesson: any) {
  if (!lesson) return null;
  const raw = lesson.lesson_content ?? '';
  // If the DB content already has rendered KaTeX HTML (e.g. Claude output it directly),
  // skip renderMath so we don't double-encode the <span> tags via _esc().
  const html = raw.includes('class="katex"') ? raw : renderMath(raw);
  return { ...lesson, lesson_content_html: html };
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '20mb' }));

// Rate limiting — 120 requests per minute per IP
const limiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use('/api/', limiter);

// Small helper so async route errors land in the error middleware.
const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

// Optional "time-travel" for demoing missed-class detection without waiting days.
function resolveNow(value: unknown): Date {
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

async function progressView(studentId: string, subject: string) {
  const p = await repo.getProgress(studentId, subject);
  if (!p) return null;
  return {
    current_day_level: p.current_day_level,
    missed_days_count: p.missed_days_count,
    latest_assignment_score: p.latest_assignment_score,
    last_login_timestamp: p.last_login_timestamp,
  };
}

// ── API ──────────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    tutor: AI_SOURCE,
    model: AI_SOURCE === 'gemini' ? CONFIG.geminiModel : CONFIG.model,
    store: CONFIG.tutorStore,
  });
});

app.get(
  '/api/students',
  wrap(async (_req, res) => {
    res.json(await repo.listStudents());
  }),
);

app.post(
  '/api/students',
  wrap(async (req, res) => {
    const { full_name, department } = req.body ?? {};
    if (!full_name || !department) {
      res.status(400).json({ error: 'full_name and department are required.' });
      return;
    }
    res.status(201).json(await repo.createStudent({ full_name, department }));
  }),
);

app.get(
  '/api/students/:id',
  wrap(async (req, res) => {
    const student = await repo.getStudent(req.params.id);
    if (!student) {
      res.status(404).json({ error: 'Student not found.' });
      return;
    }
    const subjectNames = await repo.listSubjects(student.department);
    const subjects = await Promise.all(
      subjectNames.map(async (subject) => ({
        subject,
        days: await repo.maxCurriculumDay(student.department, subject),
        progress: await progressView(student.id, subject),
      })),
    );
    res.json({ student, subjects });
  }),
);

app.get(
  '/api/curriculum',
  wrap(async (req, res) => {
    const department = String(req.query.department ?? '');
    const subject = String(req.query.subject ?? '');
    res.json(await repo.listCurriculum(department, subject));
  }),
);

app.get(
  '/api/announcement',
  wrap(async (_req, res) => {
    res.json(await repo.getActiveAnnouncement());
  }),
);

app.post(
  '/api/announcement',
  wrap(async (req, res) => {
    const message = String(req.body?.message ?? '').trim();
    const link = req.body?.link ? String(req.body.link).trim() : null;
    if (!message) {
      res.status(400).json({ error: 'message is required.' });
      return;
    }
    res.status(201).json(await repo.setAnnouncement(message, link));
  }),
);

app.get(
  '/api/history',
  wrap(async (req, res) => {
    const studentId = await requireStudent(req);
    if (!studentId) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const subject = String(req.query.subject ?? '');
    const history = await repo.getVisibleHistory(studentId, subject);
    const messages = history.map((m) => ({
      role: m.role,
      content: m.content,
      score: m.score,
      day_level: m.day_level,
      created_at: m.created_at,
    }));
    res.json({ messages, progress: await progressView(studentId, subject) });
  }),
);

app.post(
  '/api/sessions/start',
  wrap(async (req, res) => {
    const studentId = await requireStudent(req);
    if (!studentId) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const { subject } = req.body ?? {};
    if (!subject) { res.status(400).json({ error: 'subject is required.' }); return; }
    const result = await startSession({ studentId, subject, now: new Date() });
    res.json({ ...result, progress: await progressView(studentId, subject) });
  }),
);

app.post(
  '/api/sessions/message',
  wrap(async (req, res) => {
    const studentId = await requireStudent(req);
    if (!studentId) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const { subject, text } = req.body ?? {};
    if (!subject || !text) { res.status(400).json({ error: 'subject and text are required.' }); return; }
    const result = await sendMessage({ studentId, subject, text, now: new Date() });
    res.json({ ...result, progress: await progressView(studentId, subject) });
  }),
);

// ── Inside OAU! integration: account login + scheduled-mock events ───────────

/** Shared: build the login/restore response payload from a verified profile + token. */
async function buildSessionPayload(userId: string, token: string) {
  const profile = await cbt.getProfile(userId);
  if (!profile) throw Object.assign(new Error('No Post-UTME profile found for this account.'), { status: 403 });
  if (!profile.has_post_utme_access && !profile.is_admin)
    throw Object.assign(new Error('Access denied — your Post-UTME portal access is not active.'), { status: 403 });

  const studentId = profile.student_id || `IOAU-${userId.slice(0, 8)}`;
  let student = await repo.getStudent(studentId);
  if (!student) {
    student = await repo.createStudent({
      id: studentId,
      full_name: profile.full_name || 'Student',
      department: POSTUTME_DEPT,
    });
  }

  const chosen = Array.isArray(profile.post_utme_subjects)
    ? (profile.post_utme_subjects as string[])
    : [];
  const keys = chosen.length ? chosen : ALL_SUBJECT_KEYS;
  const track = inferTrack(keys);
  const subjects = await Promise.all(
    keys.map(async (key) => ({
      key,
      label: subjectLabel(key),
      days: await repo.maxCurriculumDay(POSTUTME_DEPT, key),
      department: lessonDept(key, track),
    })),
  );

  return {
    token,
    studentId,
    full_name: student.full_name,
    isAdmin: !!profile.is_admin,
    university: profile.selected_university ?? null,
    track,
    subjects,
  };
}

app.post(
  '/api/auth/login',
  wrap(async (req, res) => {
    const email = String(req.body?.email ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    let auth;
    try {
      auth = await cbt.login(email, password);
    } catch {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    try {
      const payload = await buildSessionPayload(auth.userId, auth.token);
      res.json(payload);
    } catch (e: any) {
      res.status(e.status ?? 403).json({ error: e.message });
    }
  }),
);

// Restore a saved session — verifies the stored token and returns fresh profile data.
app.get(
  '/api/auth/restore',
  wrap(async (req, res) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token.' });
      return;
    }
    const verified = await cbt.verifyToken(header.slice(7));
    if (!verified) {
      res.status(401).json({ error: 'Session expired. Please log in again.' });
      return;
    }
    try {
      const payload = await buildSessionPayload(verified.userId, header.slice(7));
      res.json(payload);
    } catch (e: any) {
      res.status(e.status ?? 403).json({ error: e.message });
    }
  }),
);

// Admin-only: verify the caller's Supabase token belongs to an admin profile.
async function requireAdmin(req: Request): Promise<boolean> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return false;
  const v = await cbt.verifyToken(header.slice(7));
  if (!v) return false;
  const profile = await cbt.getProfile(v.userId);
  return !!profile?.is_admin;
}

// Student auth: verify token and return the caller's studentId — never trust client-supplied IDs.
async function requireStudent(req: Request): Promise<string | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const v = await cbt.verifyToken(header.slice(7));
  if (!v) return null;
  const profile = await cbt.getProfile(v.userId);
  if (!profile) return null;
  return profile.student_id || `IOAU-${v.userId.slice(0, 8)}`;
}

app.post(
  '/api/curriculum/import',
  wrap(async (req, res) => {
    if (!(await requireAdmin(req))) {
      res.status(403).json({ error: 'Admin only.' });
      return;
    }
    const rawRows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const rows = rawRows
      .map((r: Record<string, unknown>) => ({
        department: POSTUTME_DEPT,
        subject: String(r.subject ?? '').trim().toLowerCase(),
        day_number: Number(r.day ?? r.day_number),
        topic: String(r.topic ?? '').trim(),
        outline: String(r.outline ?? '').trim(),
      }))
      .filter(
        (r) =>
          r.subject && Number.isFinite(r.day_number) && r.day_number > 0 && r.topic && r.outline,
      );
    if (!rows.length) {
      res.status(400).json({
        error: 'No valid rows. Required columns: subject, day, topic, outline.',
      });
      return;
    }
    const imported = await repo.upsertCurriculum(rows);
    res.json({ imported, subjects: [...new Set(rows.map((r) => r.subject))] });
  }),
);

app.get(
  '/api/events',
  wrap(async (_req, res) => {
    let mocks: Awaited<ReturnType<typeof cbt.getUpcomingMocks>> = [];
    try {
      mocks = await cbt.getUpcomingMocks(5);
    } catch {
      mocks = [];
    }
    const events = mocks.map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      scheduled_at: m.scheduled_at,
      university: m.university,
      duration_minutes: m.duration_minutes,
      link: CONFIG.cbt.appUrl,
    }));
    res.json({ events });
  }),
);

// ── Group class: lesson generation + submissions ──────────────────────────────

function todayWAT(): string {
  const offset = CONFIG.timezoneOffsetHours * 3_600_000;
  return new Date(Date.now() + offset).toISOString().slice(0, 10);
}

// Admin: generate today's lesson for a subject + department (idempotent).
// Optional body field goes_live_at (ISO 8601) schedules it for a future time.
app.post(
  '/api/lessons/generate',
  wrap(async (req, res) => {
    if (!(await requireAdmin(req))) {
      res.status(403).json({ error: 'Admin only.' });
      return;
    }
    const subject = String(req.body?.subject ?? '').trim().toLowerCase();
    const department = String(req.body?.department ?? '').trim().toLowerCase();
    if (!subject || !department) {
      res.status(400).json({ error: 'subject and department are required.' });
      return;
    }

    let goesLiveAt: string | null = null;
    if (req.body?.goes_live_at) {
      const d = new Date(String(req.body.goes_live_at));
      if (Number.isNaN(d.getTime())) {
        res.status(400).json({ error: 'goes_live_at must be a valid ISO 8601 date-time.' });
        return;
      }
      goesLiveAt = d.toISOString();
    }

    const result = await openClass(subject, department, goesLiveAt);
    res.json({ lesson: result.lesson, isNew: result.isNew });
  }),
);

// Seed a hardcoded demo lesson (no AI call, no token cost). Admin only.
app.post(
  '/api/lessons/seed-demo',
  wrap(async (req, res) => {
    if (!(await requireAdmin(req))) {
      res.status(403).json({ error: 'Admin only.' });
      return;
    }
    const subject = String(req.body?.subject ?? '').trim().toLowerCase();
    const department = String(req.body?.department ?? '').trim().toLowerCase();
    if (!subject || !department) {
      res.status(400).json({ error: 'subject and department are required.' });
      return;
    }
    const date = todayWAT();
    const existing = await repo.getTodayLesson(subject, department, date);
    if (existing) { res.json({ lesson: existing, isNew: false }); return; }

    const last = await repo.getLastLesson(subject, department);
    const dayNumber = last ? last.day_number + 1 : 1;
    const curriculum = await repo.getCurriculumDay(POSTUTME_DEPT, subject, dayNumber);
    if (!curriculum) {
      res.status(400).json({
        error: `No curriculum found for ${subject} Day ${dayNumber}. Upload your outline CSV first via the 📚 Outlines panel.`,
      });
      return;
    }
    const topic = curriculum.topic;

    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const lessonContent =
      `## SECTION 1\n` +
      `Good day. Today you and I are going to work through ${topic}, and I need you to give this your full attention because what we cover in the next hour is exactly what separates students who pass Post-UTME from those who do not.\n\n` +
      `Now, before we go into the details, let me ask you something. When you hear the phrase "${topic}", what comes to mind? Most students immediately think about definitions and formulas, but that is not how I want you to approach this. Think about it this way: every concept in ${cap(subject)} exists to explain something that happens in the real world. Your job is not to memorise it but to understand it well enough to explain it to someone else.\n\n` +
      `Here is the foundation you need. ${topic} sits at the heart of ${cap(subject)} because it connects several ideas you have already encountered. If you have been following along since Day 1, you will notice that today's topic builds on what we established earlier in the term. That is not a coincidence. ${cap(subject)} is a subject where each idea depends on the one before it, which is why students who miss classes always struggle later.\n\n` +
      `So let us begin from the beginning and build this properly. By the time we finish today's session, you should be able to read any exam question on ${topic} and know exactly what to do.\n\n` +
      `## CHECK 1\n` +
      `In your own words, what do you already know about ${topic}? Write two or three sentences in your notebook before we continue. Do not worry about being perfect. Just write what you know right now.\n\n` +
      `## SECTION 2\n` +
      `Now that you have thought about what you already know, let us go deeper. The core idea behind ${topic} is this: everything in this topic follows a logic, and once you see that logic clearly, the rest becomes straightforward.\n\n` +
      `Think about it this way. When examiners set questions on ${topic}, they are testing whether you understand the principle, not whether you memorised the textbook. A student who understands the principle can answer a question they have never seen before. A student who only memorised will panic the moment the question is phrased differently.\n\n` +
      `Here is a practical example. Imagine you are sitting in the exam hall and you see a question on ${topic}. The first thing you do is not reach for a formula. The first thing you do is identify what the question is actually asking. Once you identify that, you apply what you understand, and the answer follows naturally. This approach works every single time.\n\n` +
      `For calculation-based topics, key relationships are expressed as proper equations in these lessons. For example, the quadratic formula $$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$ or a kinematic equation like $v^2 = u^2 + 2as$ will always render as formatted mathematics so you can read it clearly. This demo lesson is confirming that equation rendering is working correctly on your device.\n\n` +
      `Moving on, let us connect this to how ${cap(subject)} questions are typically structured in Post-UTME. You will often see this topic tested in two ways: either as a direct question where they define something and ask you to apply it, or as a scenario where they describe a situation and ask you to identify what is happening. Both types require the same understanding.\n\n` +
      `## CHECK 2\n` +
      `Based on what we just covered, how would you explain the core idea of ${topic} to a classmate who missed today's session? Write your explanation in your notebook. Aim for three to four sentences.\n\n` +
      `## SECTION 3\n` +
      `Now I want to talk about something very important: the mistakes that cost students marks every single year on this topic. I have seen these patterns repeatedly, and I do not want you to fall into them.\n\n` +
      `The first mistake is rushing. When you see a question on ${topic}, many students write the first thing that comes to mind. Do not do this. Read the question twice. The second reading almost always reveals something the first reading missed.\n\n` +
      `The second mistake is confusing related concepts. ${cap(subject)} has several ideas that sound similar but mean different things. When you are revising ${topic}, make sure you know how it is different from the concepts that are closest to it. Examiners deliberately use this to separate strong students from weak ones.\n\n` +
      `The third mistake is leaving questions blank. Even if you are not completely sure of an answer, write what you know. Partial understanding shown clearly on paper is worth something. Blank paper is worth nothing. Always attempt the question, always explain your thinking, and always write something.\n\n` +
      `## CHECK 3\n` +
      `Think about an exam question on ${topic} that could appear in Post-UTME. What would that question look like? Write one possible exam question in your notebook, then write a brief outline of how you would answer it.\n\n` +
      `## SECTION 4\n` +
      `We are coming to the end of today's session, and I want to bring everything together for you. We covered the foundation of ${topic}, we went deep into the core concept with examples, and we talked about the mistakes to avoid in the exam. That is a complete picture of this topic.\n\n` +
      `The thing about ${cap(subject)} is that it rewards students who think, not just students who study. Every hour you spend truly understanding a concept like this one is worth more than ten hours of reading without thinking. So I want you to go back over your notes from today, look at the check questions you answered, and ask yourself: do I understand this well enough to explain it? If the answer is yes, you are ready.\n\n` +
      `Key takeaway: ${topic} is not about memorisation. It is about understanding the principle well enough to apply it to any question, no matter how the examiner presents it. If you leave today with nothing else, leave with that.`;

    const classworkPrompt =
      `Based on what you learned in today's session, answer the following question as clearly and completely as you can. ` +
      `Explain the main concept behind ${topic} in your own words, and give one example that shows you understand how it works in practice. ` +
      `Your answer should reflect what you just learned, not what you already knew before class.\n` +
      `[Rubric: clear explanation of the concept in student's own words, one relevant example, evidence that the student understood today's session]`;

    const assignmentPrompt =
      `This is your take-home assignment for today's class on ${topic}. ` +
      `Go beyond what we covered in class: research one area of ${topic} that you find most interesting or challenging, ` +
      `explain it in detail in your own words, and connect it to at least one past Post-UTME question or exam scenario you know about. ` +
      `Your answer should show genuine depth of understanding. A strong answer will take you 15 to 20 minutes to write properly.\n` +
      `[Rubric: depth of explanation beyond class content, connection to exam context, evidence of independent thinking]`;

    const lesson = await repo.saveDailyLesson({
      subject, department, day_number: dayNumber, topic,
      lesson_content: '[DEMO]\n' + lessonContent,
      classwork_prompt: classworkPrompt,
      assignment_prompt: assignmentPrompt,
      lesson_date: date,
    });
    res.json({ lesson, isNew: true });
  }),
);

// Student: get today's live lesson (respects goes_live_at — scheduled lessons are hidden).
app.get(
  '/api/lessons/today',
  wrap(async (req, res) => {
    const subject = String(req.query.subject ?? '').trim().toLowerCase();
    const department = String(req.query.department ?? 'general').trim().toLowerCase();
    if (!subject) {
      res.status(400).json({ error: 'subject query param is required.' });
      return;
    }
    const date = String(req.query.date ?? todayWAT());
    const lesson = await repo.getLiveTodayLesson(subject, department, date);
    res.json({ lesson: enrichLesson(lesson) });
  }),
);

// Student: get the next scheduled-but-not-yet-live lesson for a subject (for countdown display).
app.get(
  '/api/lessons/next-scheduled',
  wrap(async (req, res) => {
    const subject = String(req.query.subject ?? '').trim().toLowerCase();
    const department = String(req.query.department ?? 'general').trim().toLowerCase();
    if (!subject) {
      res.status(400).json({ error: 'subject query param is required.' });
      return;
    }
    const lesson = await repo.getNextScheduledLesson(subject, department);
    res.json({ lesson: lesson ?? null });
  }),
);

// Status of all subjects for today, grouped by track.
app.get(
  '/api/lessons/status',
  wrap(async (req, res) => {
    const date = String(req.query.date ?? todayWAT());
    const tracks = await repo.getLessonStatus(date);
    res.json({ date, tracks });
  }),
);

// Student: submit a question from today's class (answered in WhatsApp group).
app.post(
  '/api/questions',
  wrap(async (req, res) => {
    const studentId = await requireStudent(req);
    if (!studentId) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const { subject, department, questionText, fileUrl } = req.body ?? {};
    if (!subject || !department || (!questionText && !fileUrl)) {
      res.status(400).json({ error: 'subject, department, and at least one of questionText or fileUrl are required.' });
      return;
    }
    const question = await repo.saveQuestion({
      student_id: studentId,
      subject,
      department,
      lesson_date: todayWAT(),
      question_text: questionText ?? null,
      question_file_url: fileUrl ?? null,
    });
    res.json({ question });
  }),
);

// Admin: get all student questions for a date.
app.get(
  '/api/admin/questions',
  wrap(async (req, res) => {
    if (!(await requireAdmin(req))) {
      res.status(403).json({ error: 'Admin only.' });
      return;
    }
    const date = String(req.query.date ?? todayWAT());
    const subject = req.query.subject ? String(req.query.subject).toLowerCase() : undefined;
    const questions = await repo.getAllQuestions(date, subject);
    res.json({ questions });
  }),
);

// Student: upload a submission file (image or PDF) → returns storage path.
app.post(
  '/api/submissions/upload-file',
  wrap(async (req, res) => {
    const { dataUrl, filename } = req.body ?? {};
    if (!dataUrl || !filename) {
      res.status(400).json({ error: 'dataUrl and filename are required.' });
      return;
    }
    const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      res.status(400).json({ error: 'Invalid data URL — expected data:<mime>;base64,<data>.' });
      return;
    }
    const contentType = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    const ext = String(filename).split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const safeName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const path = `submissions/${safeName}`;
    await repo.uploadSubmissionFile(path, buffer, contentType);
    res.json({ filePath: path });
  }),
);

// Admin: get a short-lived signed URL to view a submission file.
app.get(
  '/api/admin/file-url',
  wrap(async (req, res) => {
    if (!(await requireAdmin(req))) {
      res.status(403).json({ error: 'Admin only.' });
      return;
    }
    const path = String(req.query.path ?? '').trim();
    if (!path) {
      res.status(400).json({ error: 'path is required.' });
      return;
    }
    const url = await repo.getSubmissionFileUrl(path);
    res.json({ url });
  }),
);

// Student: submit assignment answer (auto-triggers batch grade).
app.post(
  '/api/submissions',
  wrap(async (req, res) => {
    const studentId = await requireStudent(req);
    if (!studentId) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const { subject, department, text, fileUrl } = req.body ?? {};
    if (!subject || (!text && !fileUrl)) {
      res.status(400).json({ error: 'subject, and at least one of text or fileUrl are required.' });
      return;
    }
    const dept = String(department ?? lessonDept(subject, inferTrack([subject]))).toLowerCase();
    const result = await submitAssignment(studentId, subject, dept, String(text ?? ''), fileUrl ?? null);
    res.json(result);
  }),
);

// Student: submit classwork answer (graded manually by teacher).
app.post(
  '/api/classwork',
  wrap(async (req, res) => {
    const studentId = await requireStudent(req);
    if (!studentId) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const { subject, department, text, fileUrl } = req.body ?? {};
    if (!subject || (!text && !fileUrl)) {
      res.status(400).json({ error: 'subject, and at least one of text or fileUrl are required.' });
      return;
    }
    const dept = String(department ?? lessonDept(subject, inferTrack([subject]))).toLowerCase();
    const result = await submitClasswork(studentId, subject, dept, String(text ?? ''), fileUrl ?? null);
    res.json(result);
  }),
);

// Student: get their own classwork submission + grade for today.
app.get(
  '/api/classwork/mine',
  wrap(async (req, res) => {
    const studentId = await requireStudent(req);
    if (!studentId) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const subject = String(req.query.subject ?? '').toLowerCase();
    const date = String(req.query.date ?? todayWAT());
    if (!subject) { res.status(400).json({ error: 'subject is required.' }); return; }
    const submission = await repo.getSubmission(studentId, subject, date, 'classwork');
    res.json({ submission: submission ?? null });
  }),
);

// Admin: list all submissions for a subject across all dates (supports ?type=classwork|assignment).
app.get(
  '/api/admin/submissions',
  wrap(async (req, res) => {
    if (!(await requireAdmin(req))) {
      res.status(403).json({ error: 'Admin only.' });
      return;
    }
    const subject = String(req.query.subject ?? '').toLowerCase();
    const type = req.query.type === 'classwork' ? 'classwork' : 'assignment';
    if (!subject) {
      res.status(400).json({ error: 'subject is required.' });
      return;
    }
    const submissions = await repo.getAllSubmissionsAllDates(subject, type);
    res.json({ submissions });
  }),
);

// Admin: reopen classwork window for the most recent lesson of a subject (resets goes_live_at to now).
app.post(
  '/api/admin/reopen-classwork',
  wrap(async (req, res) => {
    if (!(await requireAdmin(req))) { res.status(403).json({ error: 'Admin only.' }); return; }
    const { subject, department } = req.body ?? {};
    if (!subject || !department) { res.status(400).json({ error: 'subject and department are required.' }); return; }
    const ok = await repo.reopenClassworkDeadline(subject.toLowerCase(), department.toLowerCase());
    if (!ok) { res.status(404).json({ error: 'No lesson found for this subject.' }); return; }
    res.json({ ok: true, message: 'Classwork window reopened for 2 hours from now.' });
  }),
);

// Admin: save a manual grade for a submission.
app.patch(
  '/api/admin/grade',
  wrap(async (req, res) => {
    if (!(await requireAdmin(req))) {
      res.status(403).json({ error: 'Admin only.' });
      return;
    }
    const { submissionId, score, feedback } = req.body ?? {};
    if (!submissionId || score === undefined || score === null) {
      res.status(400).json({ error: 'submissionId and score are required.' });
      return;
    }
    const s = Math.max(0, Math.min(10, Math.round(Number(score))));
    await repo.saveManualGrade(submissionId, s, String(feedback ?? ''));
    res.json({ ok: true, score: s });
  }),
);

// Student: get their own submission + grade for today.
app.get(
  '/api/submissions/mine',
  wrap(async (req, res) => {
    const studentId = await requireStudent(req);
    if (!studentId) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const subject = String(req.query.subject ?? '').toLowerCase();
    const date = String(req.query.date ?? todayWAT());
    if (!subject) { res.status(400).json({ error: 'subject is required.' }); return; }
    const submission = await repo.getSubmission(studentId, subject, date, 'assignment');
    res.json({ submission: submission ?? null });
  }),
);

// Student: get all their own submissions (both types) for a subject across all days.
app.get(
  '/api/submissions/history',
  wrap(async (req, res) => {
    const studentId = await requireStudent(req);
    if (!studentId) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const subject = String(req.query.subject ?? '').trim().toLowerCase();
    if (!subject) { res.status(400).json({ error: 'subject is required.' }); return; }
    const submissions = await repo.getStudentSubmissions(studentId, subject);
    res.json({ submissions });
  }),
);

// Admin: set a new password for any student account.
app.post(
  '/api/admin/set-password',
  wrap(async (req, res) => {
    if (!(await requireAdmin(req))) {
      res.status(403).json({ error: 'Admin only.' });
      return;
    }
    const email = String(req.body?.email ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required.' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters.' });
      return;
    }
    await cbt.setUserPassword(email, password);
    res.json({ ok: true });
  }),
);

// Student: get list of all past lessons for a subject (for Past Classes panel).
app.get(
  '/api/lessons/archive',
  wrap(async (req, res) => {
    const subject = String(req.query.subject ?? '').trim().toLowerCase();
    const department = String(req.query.department ?? 'general').trim().toLowerCase();
    const day = req.query.day ? Number(req.query.day) : null;
    if (!subject) { res.status(400).json({ error: 'subject is required.' }); return; }
    if (day !== null) {
      const lesson = await repo.getLessonByDay(subject, department, day);
      res.json({ lesson: enrichLesson(lesson) });
    } else {
      const lessons = await repo.getLessonArchive(subject, department);
      res.json({ lessons });
    }
  }),
);

// Student: progress overview — all subjects, days attended, avg score.
app.get(
  '/api/progress/overview',
  wrap(async (req, res) => {
    const studentId = await requireStudent(req);
    if (!studentId) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const student = await repo.getStudent(studentId);
    if (!student) { res.status(404).json({ error: 'Student not found.' }); return; }
    const subjectKeys = await repo.listSubjects(student.department);
    const overview = await Promise.all(
      subjectKeys.map(async (subject) => {
        const { inferTrack, lessonDept, subjectLabel } = await import('./subjects');
        const track = inferTrack([subject]);
        const dept = lessonDept(subject, track);
        const [archive, attendance] = await Promise.all([
          repo.getLessonArchive(subject, dept),
          repo.getStudentAttendance(studentId, subject),
        ]);
        const scores = attendance.map((a) => a.score).filter((s): s is number => s !== null);
        return {
          subject,
          label: subjectLabel(subject),
          totalClassDays: archive.length,
          daysAttended: attendance.length,
          avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10 : null,
          lastDayAttended: attendance.length ? attendance[attendance.length - 1].day_number : null,
        };
      }),
    );
    res.json({ overview });
  }),
);

// Admin: get students who missed class (no classwork submission) for a date+subject.
app.get(
  '/api/admin/absent',
  wrap(async (req, res) => {
    if (!(await requireAdmin(req))) { res.status(403).json({ error: 'Admin only.' }); return; }
    const date = String(req.query.date ?? todayWAT());
    const subject = String(req.query.subject ?? '').trim().toLowerCase();
    const department = String(req.query.department ?? '').trim().toLowerCase();
    if (!subject || !department) { res.status(400).json({ error: 'subject and department are required.' }); return; }
    const absent = await repo.getAbsentStudents(date, subject, department);
    res.json({ date, subject, absent });
  }),
);

// Admin: delete all lesson records so next generate starts from Day 1.
app.delete(
  '/api/admin/reset-lessons',
  wrap(async (req, res) => {
    if (!(await requireAdmin(req))) {
      res.status(403).json({ error: 'Admin only.' });
      return;
    }
    const deleted = await repo.resetAllLessons();
    res.json({ deleted });
  }),
);

// Admin: delete today's lesson for a subject — only if it is a demo (not a live AI lesson).
app.delete(
  '/api/admin/reset-demo',
  wrap(async (req, res) => {
    if (!(await requireAdmin(req))) {
      res.status(403).json({ error: 'Admin only.' });
      return;
    }
    const subject = String(req.body?.subject ?? '').trim().toLowerCase();
    const department = String(req.body?.department ?? '').trim().toLowerCase();
    if (!subject || !department) {
      res.status(400).json({ error: 'subject and department are required.' });
      return;
    }
    const date = todayWAT();
    const lesson = await repo.getTodayLesson(subject, department, date);
    if (!lesson) {
      res.status(404).json({ error: 'No lesson for this subject today.' });
      return;
    }
    if (!lesson.lesson_content.startsWith('[DEMO]')) {
      res.status(400).json({
        error: 'Today\'s lesson is a live AI lesson — use 🗑 to fully reset this subject.',
      });
      return;
    }
    await repo.resetTodayLesson(subject, department, date);
    res.json({ ok: true });
  }),
);

// Admin: delete all lesson records for ONE subject so next generate starts from Day 1.
app.delete(
  '/api/admin/reset-subject',
  wrap(async (req, res) => {
    if (!(await requireAdmin(req))) {
      res.status(403).json({ error: 'Admin only.' });
      return;
    }
    const subject = String(req.body?.subject ?? '').trim().toLowerCase();
    const department = String(req.body?.department ?? '').trim().toLowerCase();
    if (!subject || !department) {
      res.status(400).json({ error: 'subject and department are required.' });
      return;
    }
    const deleted = await repo.resetSubjectLessons(subject, department);
    res.json({ deleted });
  }),
);

// ── Static web client ────────────────────────────────────────────────────────

app.use(express.static(CONFIG.publicDir));

// ── Error handler ────────────────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ClassroomError || err instanceof GroupClassError) {
    res.status(400).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : 'Unexpected server error.';
  console.error('[tutor] request failed:', err);
  res.status(502).json({ error: message });
});

app.listen(CONFIG.port, () => {
  const mode =
    AI_SOURCE === 'claude'
      ? `LIVE Claude (${CONFIG.model})`
      : AI_SOURCE === 'gemini'
      ? `LIVE Gemini (${CONFIG.geminiModel})`
      : 'OFFLINE STUB — add GEMINI_API_KEY or ANTHROPIC_API_KEY to go live';
  console.log('');
  console.log('  🏫  Virtual Tutorial — live classroom');
  console.log(`  Web app : http://localhost:${CONFIG.port}`);
  console.log(`  Tutor   : ${mode}`);
  console.log('');
});
