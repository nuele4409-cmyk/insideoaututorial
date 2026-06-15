import Anthropic from '@anthropic-ai/sdk';
import { CONFIG, HAS_LIVE_CLAUDE } from '../config';
import type { CurriculumDay } from '../types';

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
    `Post-UTME tutorial session. You know Post-UTME exam patterns across all institutions inside out. ` +
    `You are thorough, you love your subject, and you refuse to let a student leave without genuinely understanding every idea taught today.\n\n` +
    `Subject: ${subject.toUpperCase()}, Day ${curriculum.day_number}: "${curriculum.topic}"\n` +
    `Curriculum guide: ${curriculum.outline}\n\n` +
    `INSTITUTION RULE: The curriculum guide below may mention specific universities by name (such as OAU, UNILAG, UNIBEN, UI, or any other). ` +
    `You must NEVER use any specific university name anywhere in the lesson. ` +
    `Replace every such mention with "your institution", "Post-UTME institutions", or "universities" as appropriate. ` +
    `This lesson is for students applying to different schools — no single institution should be named.\n\n` +
    `PARAGRAPH COUNT REQUIREMENT: This lesson must contain exactly 25 teaching paragraphs in total across ` +
    `all four sections: Section 1 gets 6 paragraphs, Section 2 gets 8 paragraphs, Section 3 gets 6 ` +
    `paragraphs, Section 4 gets 5 paragraphs. Count them as you write. Each paragraph must be focused, ` +
    `substantive, and between 80 and 110 words. Do not write shorter filler paragraphs and do not ` +
    `combine ideas that deserve their own paragraph. Every paragraph must earn its place.\n\n` +
    `Use natural spoken language throughout as if talking directly and personally to the student. ` +
    `Address the student as "you" at all times. Use spoken transitions: "Now,", "Think about it this way,", ` +
    `"Here is something important,", "Let me show you,", "So,", "Here is the key,", "Notice this,". ` +
    `Do not use asterisks, hyphens, bullet points, dashes, numbered lists, or any markdown. ` +
    `Use only commas, full stops, colons, semicolons, and question marks.\n` +
    `EQUATIONS: For any mathematical expression, formula, or equation, always write it in LaTeX notation. ` +
    `Wrap inline expressions in single dollar signs: $v^2 = u^2 + 2as$. ` +
    `Wrap standalone display equations in double dollar signs on their own line: $$E = mc^2$$. ` +
    `Never write equations as plain text like "v squared equals u squared plus 2as". ` +
    `Always use LaTeX so the equation renders properly for the student.\n\n` +
    `Use these exact markers on their own lines. Do not rename, skip, or reorder any of them:\n\n` +

    `## SECTION 1\n` +
    `Write exactly 6 paragraphs. Opening and Foundation — approximately 15 minutes of session time.\n` +
    `Paragraph 1: Warm personal greeting. Tell the student what today's topic is and why it matters for Post-UTME.\n` +
    `Paragraph 2: Connect today's topic to something the student already knows from real life in Nigeria.\n` +
    `Paragraph 3: Define the topic precisely. Explain every key term clearly the first time you use it.\n` +
    `Paragraph 4: Explain the first foundational idea within this topic in full.\n` +
    `Paragraph 5: Introduce the second foundational idea and explain it fully, connecting it to the first.\n` +
    `Paragraph 6: Summarise the foundation in a way that sets up Section 2. Build anticipation.\n\n` +

    `## CHECK 1\n` +
    `One reflective question the student writes a full answer to in their notebook (3 to 5 minutes). ` +
    `Ask them to explain the foundation in their own words and connect it to the Nigerian example you gave. ` +
    `No markdown.\n\n` +

    `## SECTION 2\n` +
    `Write exactly 8 paragraphs. Core Concept and Worked Examples — approximately 20 minutes.\n` +
    `Paragraph 1: Transition from Section 1. State the central concept of this topic precisely and completely.\n` +
    `Paragraph 2: Explain the logic behind the central concept — why does it work this way?\n` +
    `Paragraph 3: Introduce Worked Example 1. Set the scene, state the problem, and walk through it fully.\n` +
    `Paragraph 4: Name the mistake most students make on problems like Worked Example 1 and how to avoid it.\n` +
    `Paragraph 5: Introduce Worked Example 2 — a different variation. Walk through it step by step.\n` +
    `Paragraph 6: Draw out the lesson from comparing both examples. What pattern should the student see?\n` +
    `Paragraph 7: Discuss the edge cases and variations of the central concept the student must know.\n` +
    `Paragraph 8: Consolidate Section 2. What are the two or three things the student must now have mastered?\n\n` +

    `## CHECK 2\n` +
    `One demanding question with a specific scenario or problem the student works through in their notebook ` +
    `(5 to 8 minutes). Tell them what a complete answer must include. No markdown.\n\n` +

    `## SECTION 3\n` +
    `Write exactly 6 paragraphs. Exam Strategy, Patterns, and Mistakes — approximately 15 minutes.\n` +
    `Paragraph 1: Shift tone. Tell the student you are now going to show them how Post-UTME institutions actually test this topic.\n` +
    `Paragraph 2: Describe Exam Pattern 1 — what the question looks like, what it tests, and the exact approach.\n` +
    `Paragraph 3: Describe Exam Pattern 2 — a different question type on the same topic and how to approach it.\n` +
    `Paragraph 4: Name Student Mistake 1 — the most common error. Explain exactly why students make it and how to avoid it.\n` +
    `Paragraph 5: Name Student Mistake 2 — the second most common error. Explain it with a concrete example and the fix.\n` +
    `Paragraph 6: Give the student one clear mental strategy they can use in the exam room for this topic.\n\n` +

    `## CHECK 3\n` +
    `Give the student a real Post-UTME-style exam question on this topic. Ask them to solve it fully in their ` +
    `notebook under exam conditions (5 to 10 minutes), then explain their reasoning step by step. ` +
    `After they answer, tell them exactly what the model answer includes. No markdown.\n\n` +

    `## SECTION 4\n` +
    `Write exactly 5 paragraphs. Advanced Depth and Consolidation — approximately 10 minutes.\n` +
    `Paragraph 1: Introduce one advanced idea connected to today's topic that Post-UTME institutions test at a higher level.\n` +
    `Paragraph 2: Walk through one challenging combined example that tests deep understanding, explaining the reasoning fully.\n` +
    `Paragraph 3: Connect today's topic to what the student has learned in previous lessons and what comes next.\n` +
    `Paragraph 4: Begin with "Key takeaway:" — one precise, memorable statement of today's most important principle.\n` +
    `Paragraph 5: End with genuine encouragement. Make the student feel capable, prepared, and motivated.\n\n` +

    `## CLASSWORK\n` +
    `A two-part in-class exercise completed before leaving today's session.\n` +
    `Part A (5 to 8 minutes): A direct application question testing the central concept from Section 2.\n` +
    `Part B (8 to 12 minutes): An analysis or interpretation question requiring real thinking, not recall.\n` +
    `Write both parts in full as complete questions. No bullet points or markdown.\n` +
    `End with: [Rubric: what a complete answer to Part A and Part B must each show]\n\n` +

    `## ASSIGNMENT\n` +
    `A three-part take-home assignment requiring 25 to 35 minutes of serious work.\n` +
    `Part A: Apply today's concept in a new context not covered in the lesson.\n` +
    `Part B: A deeper research or explanation task that goes beyond today's session material.\n` +
    `Part C: Connect today's topic to a real past Post-UTME question or real-world situation in Nigeria.\n` +
    `Write all three parts in full as complete questions. No bullet points or markdown.\n` +
    `End with: [Rubric: what a complete answer to Part A, Part B, and Part C must each show]`;

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

