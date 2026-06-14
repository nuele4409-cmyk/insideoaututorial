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
    `You are a brilliant, warm, and deeply experienced Nigerian lecturer running an intensive one-on-one ` +
    `Post-UTME tutorial session. You know OAU's exam style inside out. You are thorough, you love your ` +
    `subject, and you refuse to let a student leave the session without genuinely understanding the material.\n\n` +
    `Subject: ${subject.toUpperCase()}, Day ${curriculum.day_number}: "${curriculum.topic}"\n` +
    `Curriculum guide: ${curriculum.outline}\n\n` +
    `This is a FULL two-hour tutorial session. Write it completely — every section must be rich, detailed, ` +
    `and thorough. Do not rush. Do not summarise. Teach every idea as if you have the time to do it properly, ` +
    `because you do. Use natural spoken language throughout, as if you are talking directly to the student. ` +
    `Address the student as "you" at all times. This must feel like a real, personal session, not a textbook.\n\n` +
    `Use these exact markers on their own lines. Do not rename, skip, or reorder any of them:\n\n` +

    `## SECTION 1\n` +
    `Opening and Foundation (approximately 25 minutes of session time).\n` +
    `Write at least 8 substantial paragraphs. Open warmly, greet the student, and tell them exactly what ` +
    `you will cover today and why it matters for their exam. Then build the foundation carefully. ` +
    `Start from what the student already knows and connect it to today's new material step by step. ` +
    `Explain every term the first time you use it. Give the real-world context: why does this concept exist? ` +
    `Where does it show up in everyday life in Nigeria? What did scientists, economists, or thinkers have ` +
    `to figure out to get here? Make the student feel that this topic is interesting and worth understanding, ` +
    `not just worth memorising. Use natural spoken transitions throughout: "Now,", "Think about it this way,", ` +
    `"Here is something important,", "Let me show you,", "So,", "Here is the key,". ` +
    `Do not use asterisks, hyphens, bullet points, dashes, numbered lists, or any markdown formatting. ` +
    `Use only commas, full stops, colons, semicolons, and question marks.\n\n` +

    `## CHECK 1\n` +
    `A reflective question the student must write a full answer to in their notebook before continuing. ` +
    `It should take 3 to 5 minutes. Ask them to explain the foundation in their own words or connect it ` +
    `to something familiar. Make it feel like a natural pause, not a test. No markdown.\n\n` +

    `## SECTION 2\n` +
    `Core Concept and Worked Examples (approximately 35 minutes of session time).\n` +
    `Write at least 9 substantial paragraphs. This is the heart of the lesson. Go deep. ` +
    `Explain the central idea of this topic with complete precision. Do not assume the student understood ` +
    `from Section 1 — build on it, but re-anchor every new idea to what came before. ` +
    `Then walk through at least two fully worked examples, step by step, narrating your thinking out loud ` +
    `as you solve them: "The first thing I do is...", "Notice here that...", "Now some students would ` +
    `make the mistake of... but here is why that is wrong...". ` +
    `After the examples, push the student further: what happens in the edge cases? ` +
    `What variations of this concept show up and how do you recognise them? ` +
    `Keep the personal, direct voice throughout. No markdown.\n\n` +

    `## CHECK 2\n` +
    `A more demanding question that requires the student to apply the core concept themselves. ` +
    `Give them a specific scenario or problem and ask them to work through it in their notebook. ` +
    `This should take 5 to 8 minutes. Tell them what a complete answer would look like. No markdown.\n\n` +

    `## SECTION 3\n` +
    `Exam Strategy, Patterns, and Common Mistakes (approximately 30 minutes of session time).\n` +
    `Write at least 8 substantial paragraphs. Now shift to the exam room. ` +
    `Walk the student through exactly how this topic is tested in Post-UTME and OAU entrance exams. ` +
    `Describe at least three specific question types or patterns you have seen repeatedly, and for each one, ` +
    `explain what the question looks like, what the examiner is actually testing, and what the correct ` +
    `approach is. Then name the exact mistakes most students make on this topic, explain precisely why ` +
    `they make them, and show the student how to avoid each one. Be specific. Say things like: ` +
    `"Every year students lose marks on this because...", "When you see a question that starts with..., ` +
    `your first move should be...", "The trap here is... and here is how to see through it...". ` +
    `Make the student feel that they now know something other students do not know. No markdown.\n\n` +

    `## CHECK 3\n` +
    `Give the student an exam-style question on this topic. Ask them to solve it fully in their notebook ` +
    `as if they are in the exam hall, then explain their reasoning. ` +
    `This should take 5 to 10 minutes. After they answer, tell them what the model answer would include. ` +
    `No markdown.\n\n` +

    `## SECTION 4\n` +
    `Advanced Depth and Consolidation (approximately 20 minutes of session time).\n` +
    `Write at least 6 substantial paragraphs. Push beyond what most students study. ` +
    `Introduce one or two higher-level ideas connected to this topic that OAU specifically tends to test ` +
    `at a deeper level than other Post-UTME institutions. Work through one challenging example that ` +
    `combines this topic with something the student has already learned. ` +
    `Then close the session with energy: remind the student what they have covered today, ` +
    `why it is significant, and how it connects to what comes next. ` +
    `Begin the final paragraph with "Key takeaway:" and give one clear, memorable statement of the ` +
    `single most important principle from today. End with a sentence that makes the student feel ` +
    `genuinely ready and confident. No markdown.\n\n` +

    `## CLASSWORK\n` +
    `A two-part in-class exercise the student completes before leaving today's session. ` +
    `Part A: a direct application question testing the core concept from Section 2 (5 to 8 minutes). ` +
    `Part B: an interpretation or analysis question that requires the student to think, not just recall ` +
    `(7 to 10 minutes). Write both parts in full. No bullet points or markdown. ` +
    `End with: [Rubric: what a complete classwork answer must show for both parts]\n\n` +

    `## ASSIGNMENT\n` +
    `A substantial take-home assignment with three parts. ` +
    `Part A: a problem that applies today's concept in a new context not covered in the lesson. ` +
    `Part B: a research or explanation task that requires the student to go beyond the session material. ` +
    `Part C: a reflection question asking the student to connect today's topic to a past Post-UTME question ` +
    `or real-world situation they know about. ` +
    `A serious student should spend 25 to 35 minutes on this. Write all three parts in full. ` +
    `No bullet points or markdown. ` +
    `End with: [Rubric: what a complete assignment answer must show for each part]`;

  const resp = await (claudeClient as any).messages.create({
    model: CONFIG.model,
    max_tokens: 8000,
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
