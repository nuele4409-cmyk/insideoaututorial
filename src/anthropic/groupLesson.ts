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
    `PARAGRAPH COUNT REQUIREMENT: This lesson must contain exactly 75 teaching paragraphs in total across ` +
    `all four sections: Section 1 gets 18 paragraphs, Section 2 gets 22 paragraphs, Section 3 gets 18 ` +
    `paragraphs, Section 4 gets 17 paragraphs. Count them as you write. Each paragraph must be focused ` +
    `and concise, between 50 and 70 words. One idea per paragraph only. Do not pad, do not combine ` +
    `multiple ideas into one paragraph, and do not write long sentences. Every paragraph must be ` +
    `short enough to read aloud in about 20 seconds.\n\n` +
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
    `Write exactly 18 paragraphs. Opening and Foundation — approximately 30 minutes of session time.\n` +
    `Paragraph 1: Warm personal greeting. Tell the student what today's topic is and why it matters.\n` +
    `Paragraph 2: Connect today's topic to something the student already knows from real life in Nigeria.\n` +
    `Paragraph 3: Give the historical or scientific context — how did humans discover or develop this idea?\n` +
    `Paragraph 4: Define the topic precisely. Explain every key term clearly the first time you use it.\n` +
    `Paragraph 5: Explain the first foundational idea within this topic in full.\n` +
    `Paragraph 6: Deepen that first idea — what follows from it? What does it mean in practice?\n` +
    `Paragraph 7: Introduce the second foundational idea and explain it fully.\n` +
    `Paragraph 8: Connect the first and second foundational ideas to each other explicitly.\n` +
    `Paragraph 9: Give a real-world or Nigerian example that makes both foundational ideas vivid and memorable.\n` +
    `Paragraph 10: Address the most common confusion students have at this stage. Resolve it clearly.\n` +
    `Paragraph 11: Explain why understanding this foundation properly makes the rest of the topic easy.\n` +
    `Paragraph 12: Give a second Nigerian example — different context from paragraph 9 — that further cements the idea.\n` +
    `Paragraph 13: Anticipate the question the student is probably thinking right now. Answer it directly.\n` +
    `Paragraph 14: Introduce a third foundational idea if the topic has one, or deepen the second foundational idea further.\n` +
    `Paragraph 15: Explain what happens when students skip understanding this foundation — what goes wrong in the exam.\n` +
    `Paragraph 16: Tell the student how many marks this topic typically carries in Post-UTME and why it is worth mastering.\n` +
    `Paragraph 17: Distinguish what must be memorised versus what must be understood for this topic.\n` +
    `Paragraph 18: Summarise the foundation in a way that sets up Section 2. Build anticipation.\n\n` +

    `## CHECK 1\n` +
    `One reflective question the student writes a full answer to in their notebook (3 to 5 minutes). ` +
    `Ask them to explain the foundation in their own words and connect it to the Nigerian example you gave. ` +
    `No markdown.\n\n` +

    `## SECTION 2\n` +
    `Write exactly 22 paragraphs. Core Concept and Worked Examples — approximately 45 minutes.\n` +
    `Paragraph 1: Transition from Section 1. Tell the student you are now going into the core of the topic.\n` +
    `Paragraph 2: State the central concept of this topic precisely and completely.\n` +
    `Paragraph 3: Explain the logic behind the central concept — why does it work this way?\n` +
    `Paragraph 4: Show how the central concept connects back to the foundation from Section 1.\n` +
    `Paragraph 5: Introduce Worked Example 1. Set the scene and state the problem clearly.\n` +
    `Paragraph 6: Walk through the first steps of Worked Example 1, narrating your thinking aloud.\n` +
    `Paragraph 7: Complete Worked Example 1. Explain what the answer means and why it makes sense.\n` +
    `Paragraph 8: Name the mistake most students make on problems like Worked Example 1 and explain why it is wrong.\n` +
    `Paragraph 9: Introduce Worked Example 2 — a different variation of the same concept.\n` +
    `Paragraph 10: Walk through Worked Example 2 step by step, emphasising what is different from Example 1.\n` +
    `Paragraph 11: Complete Worked Example 2 and draw out the lesson from comparing both examples.\n` +
    `Paragraph 12: Introduce Worked Example 3 — a harder or combined problem that requires deeper thinking.\n` +
    `Paragraph 13: Walk through the first part of Worked Example 3, explaining the reasoning at each step.\n` +
    `Paragraph 14: Complete Worked Example 3. Identify what made it harder and how the student should recognise it.\n` +
    `Paragraph 15: Revisit the central concept now that the student has seen three worked examples.\n` +
    `Paragraph 16: Discuss the edge cases and variations of the central concept the student must know.\n` +
    `Paragraph 17: Explain what happens when the central concept is combined with other ideas the student knows.\n` +
    `Paragraph 18: Explain when the central concept does NOT apply or has limits — this prevents over-applying it.\n` +
    `Paragraph 19: Connect today's concept to at least one other subject the student is studying for Post-UTME.\n` +
    `Paragraph 20: Give one more brief self-test question and tell the student exactly what a correct answer looks like.\n` +
    `Paragraph 21: Address the second most common misconception students have about this central concept.\n` +
    `Paragraph 22: Consolidate Section 2. What are the three things the student must now have mastered?\n\n` +

    `## CHECK 2\n` +
    `One demanding question with a specific scenario or problem the student works through in their notebook ` +
    `(5 to 8 minutes). Tell them what a complete answer must include. No markdown.\n\n` +

    `## SECTION 3\n` +
    `Write exactly 18 paragraphs. Exam Strategy, Patterns, and Mistakes — approximately 35 minutes.\n` +
    `Paragraph 1: Shift tone. Tell the student you are now going to show them how Post-UTME institutions actually test this topic.\n` +
    `Paragraph 2: Describe Exam Pattern 1 — what the question looks like and what it is testing.\n` +
    `Paragraph 3: Show the exact approach to Exam Pattern 1, step by step.\n` +
    `Paragraph 4: Describe Exam Pattern 2 — a different question type on the same topic.\n` +
    `Paragraph 5: Show the exact approach to Exam Pattern 2 and how it differs from Pattern 1.\n` +
    `Paragraph 6: Describe Exam Pattern 3 — often a trick or combined question institutions love to set.\n` +
    `Paragraph 7: Show how to see through Exam Pattern 3 and approach it without panicking.\n` +
    `Paragraph 8: Describe Exam Pattern 4 — a data-interpretation or graph-reading variation if applicable, otherwise another common pattern.\n` +
    `Paragraph 9: Show the exact approach to Exam Pattern 4 and what to watch for.\n` +
    `Paragraph 10: Name Student Mistake 1 — the most common error on this topic. Explain exactly why students make it.\n` +
    `Paragraph 11: Show the student precisely how to avoid Mistake 1 with a corrected example.\n` +
    `Paragraph 12: Name Student Mistake 2 — the second most common error. Explain it with a concrete example.\n` +
    `Paragraph 13: Show how to avoid Mistake 2 and the habit of mind that prevents it.\n` +
    `Paragraph 14: Name Student Mistake 3 — a subtler error that only careful students avoid. Explain it fully.\n` +
    `Paragraph 15: Show how to avoid Mistake 3 and why this one separates high scorers from average scorers.\n` +
    `Paragraph 16: Teach the student how to check their answer on this type of question — what sanity checks work?\n` +
    `Paragraph 17: Walk through a time-management approach for this topic — how long should the student spend per question?\n` +
    `Paragraph 18: Give the student one clear mental strategy they can use in the exam room for this topic.\n\n` +

    `## CHECK 3\n` +
    `Give the student a real Post-UTME-style exam question on this topic. Ask them to solve it fully in their ` +
    `notebook under exam conditions (5 to 10 minutes), then explain their reasoning step by step. ` +
    `After they answer, tell them exactly what the model answer includes. No markdown.\n\n` +

    `## SECTION 4\n` +
    `Write exactly 17 paragraphs. Advanced Depth and Consolidation — approximately 30 minutes.\n` +
    `Paragraph 1: Tell the student you are now going beyond what most Post-UTME students study.\n` +
    `Paragraph 2: Introduce one advanced idea connected to today's topic that Post-UTME institutions test at a higher level.\n` +
    `Paragraph 3: Explain that advanced idea thoroughly and show why it is not as hard as it looks.\n` +
    `Paragraph 4: Connect the advanced idea back to the core concept from Section 2.\n` +
    `Paragraph 5: Give an intuitive reason why the advanced idea is true — help the student own it rather than memorise it.\n` +
    `Paragraph 6: Walk through one challenging combined example that tests deep understanding.\n` +
    `Paragraph 7: Break down the first part of the combined example step by step, narrating the reasoning.\n` +
    `Paragraph 8: Complete the combined example and explain what the result reveals about the topic.\n` +
    `Paragraph 9: Introduce a second advanced idea or important extension that only the strongest students know.\n` +
    `Paragraph 10: Explain this second advanced idea with at least one short illustrative example.\n` +
    `Paragraph 11: Connect today's topic explicitly to what the student has already learned in previous lessons.\n` +
    `Paragraph 12: Tell the student what topic comes next and exactly how today's lesson prepares them for it.\n` +
    `Paragraph 13: Give the student a specific revision tip — what to review tonight to reinforce today's session.\n` +
    `Paragraph 14: Share a memory trick, pattern, or mnemonic that helps lock in the most important formula or rule.\n` +
    `Paragraph 15: Summarise the entire session — what were the five biggest ideas covered today?\n` +
    `Paragraph 16: Begin with "Key takeaway:" — one precise, memorable statement of today's most important principle.\n` +
    `Paragraph 17: End with genuine encouragement. Make the student feel capable, prepared, and motivated.\n\n` +

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

