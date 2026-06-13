import Anthropic from '@anthropic-ai/sdk';
import { CONFIG, HAS_LIVE_CLAUDE } from '../config';
import type { CurriculumDay, GradeResult } from '../types';

const claudeClient = HAS_LIVE_CLAUDE ? new Anthropic({ apiKey: CONFIG.anthropicApiKey }) : null;

export interface GeneratedLesson {
  lessonContent: string;
  classworkPrompt: string;
  assignmentPrompt: string;
}

export async function generateLesson(
  subject: string,
  curriculum: CurriculumDay,
): Promise<GeneratedLesson> {
  if (!claudeClient) throw new Error('No Claude API key configured — set ANTHROPIC_API_KEY.');

  const prompt =
    `You are a warm, confident Nigerian lecturer taking a one-on-one tutorial session with a Post-UTME student.\n` +
    `Subject: ${subject.toUpperCase()}, Day ${curriculum.day_number}: "${curriculum.topic}"\n` +
    `Curriculum guide: ${curriculum.outline}\n\n` +
    `Write a complete interactive tutorial in exactly this structure. ` +
    `Use these exact markers on their own lines. Do not rename or skip any of them:\n\n` +
    `## SECTION 1\n` +
    `Write 4 detailed paragraphs. Open warmly, introduce the topic and build the foundation the student needs. ` +
    `Address the student as "you" throughout. This must feel like a personal one-on-one session. ` +
    `Use natural spoken transitions: "Now,", "Think about it this way,", "Here is something interesting,", "So,". ` +
    `Do not use asterisks, hyphens, bullet points, dashes, numbered lists, or any markdown. ` +
    `Use only commas, full stops, colons, and question marks.\n\n` +
    `## CHECK 1\n` +
    `One short question the student must think about before moving on. ` +
    `Should take 30 to 60 seconds to answer in their notebook. No markdown.\n\n` +
    `## SECTION 2\n` +
    `Write 4 detailed paragraphs going deeper into the core concept. ` +
    `Build directly on Section 1. Use a real-world or exam-style example to make the idea concrete and memorable. ` +
    `Keep the personal, direct voice. No markdown.\n\n` +
    `## CHECK 2\n` +
    `One question testing whether they understood the core concept from Section 2. ` +
    `Phrase it like a teacher checking in, not a formal exam question. No markdown.\n\n` +
    `## SECTION 3\n` +
    `Write 4 detailed paragraphs on application and common exam mistakes. ` +
    `Show the student exactly how this topic appears in Post-UTME exams. ` +
    `Name the specific mistakes most students make and explain precisely how to avoid them. ` +
    `Be specific, practical, and direct. No markdown.\n\n` +
    `## CHECK 3\n` +
    `One question connecting what they learned to exam performance. ` +
    `Make them think about how they would approach a real exam question on this topic. No markdown.\n\n` +
    `## SECTION 4\n` +
    `Write 3 paragraphs closing the lesson. Tie together the key ideas from all three sections. ` +
    `Begin the final paragraph with "Key takeaway:" and state the single most important point to remember. ` +
    `End with an encouraging sentence that makes the student feel prepared and confident. No markdown.\n\n` +
    `## CLASSWORK\n` +
    `One in-class exercise. Tests basic understanding of today's topic. ` +
    `A student should answer it in 5 to 10 minutes using what they just learned in this session. ` +
    `No bullet points or markdown. ` +
    `End with: [Rubric: what a complete classwork answer must show]\n\n` +
    `## ASSIGNMENT\n` +
    `One take-home assignment. Harder than the classwork, requiring deeper thinking and application. ` +
    `A focused student should need 15 to 20 minutes to answer it fully. ` +
    `No bullet points or markdown. ` +
    `End with: [Rubric: what a complete assignment answer must show]`;

  const resp = await (claudeClient as any).messages.create({
    model: CONFIG.model,
    max_tokens: 4500,
    messages: [{ role: 'user', content: prompt }],
  });

  let text = '';
  for (const block of resp.content as any[]) {
    if (block.type === 'text') text += block.text;
  }

  const contentMatch = text.match(/(##\s*SECTION\s*1[\s\S]*?)(?=##\s*CLASSWORK|$)/i);
  const classworkMatch = text.match(/##\s*CLASSWORK\s*([\s\S]*?)(?=##\s*ASSIGNMENT|$)/i);
  const assignmentMatch = text.match(/##\s*ASSIGNMENT\s*([\s\S]*?)$/i);

  return {
    lessonContent: contentMatch ? contentMatch[1].trim() : text.trim(),
    classworkPrompt: classworkMatch ? classworkMatch[1].trim() : '',
    assignmentPrompt: assignmentMatch
      ? assignmentMatch[1].trim()
      : 'Explain the key concept from today\'s lesson in your own words.',
  };
}

export async function gradeSubmissions(
  subject: string,
  dayNumber: number,
  topic: string,
  assignmentPrompt: string,
  submissions: { student_id: string; submission_text: string }[],
): Promise<GradeResult[]> {
  if (!claudeClient) throw new Error('No Claude API key configured — set ANTHROPIC_API_KEY.');
  if (!submissions.length) return [];

  const studentList = submissions
    .map((s, i) => `${i + 1}. ID: ${s.student_id}\n${s.submission_text}`)
    .join('\n\n---\n\n');

  const prompt =
    `Grade these student assignment responses.\n` +
    `Subject: ${subject.toUpperCase()} — Day ${dayNumber}: "${topic}"\n` +
    `Assignment: "${assignmentPrompt}"\n\n` +
    `Score each 0–10. Be strict: 10 = exceptional, 7–8 = good, 5–6 = adequate, below 5 = weak.\n\n` +
    `Return ONLY a valid JSON array — no markdown fences, no extra text:\n` +
    `[{"student_id":"IOAU-xxxx","score":7,"feedback":"Direct 2-sentence feedback."}]\n\n` +
    `Student responses:\n${studentList}`;

  const resp = await (claudeClient as any).messages.create({
    model: CONFIG.model,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  let text = '';
  for (const block of resp.content as any[]) {
    if (block.type === 'text') text += block.text;
  }

  const clean = text.replace(/```json?\s*/gi, '').replace(/```\s*/gi, '').trim();
  try {
    const parsed = JSON.parse(clean);
    return (Array.isArray(parsed) ? parsed : []).map((r: any) => ({
      student_id: String(r.student_id ?? ''),
      score: Math.max(0, Math.min(10, Math.round(Number(r.score) || 0))),
      feedback: String(r.feedback ?? ''),
    }));
  } catch {
    return [];
  }
}
