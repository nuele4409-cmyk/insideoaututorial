import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AI_SOURCE, CONFIG, HAS_LIVE_CLAUDE, HAS_LIVE_GEMINI } from '../config';
import type { ApiMessage, TutorContext, TutorTurn } from '../types';
import { clampScore, GRADE_TOOL_NAME, gradeTool } from './gradeTool';
import { KICKOFF } from './systemPrompt';

const claudeClient = HAS_LIVE_CLAUDE ? new Anthropic({ apiKey: CONFIG.anthropicApiKey }) : null;
const geminiClient = HAS_LIVE_GEMINI ? new GoogleGenerativeAI(CONFIG.geminiApiKey) : null;

const FIRST_CLASS_SENTINEL = 'None — this is the first class.';

export interface GenerateInput {
  system: string;
  messages: ApiMessage[]; // already trimmed to the last N interactions
  ctx: TutorContext;
  lastUserText: string;
}

export async function generateTutorTurn(input: GenerateInput): Promise<TutorTurn> {
  if (AI_SOURCE === 'claude') return liveTurn(input);
  if (AI_SOURCE === 'gemini') return geminiTurn(input);
  return offlineTurn(input);
}

// ── Live Claude path ─────────────────────────────────────────────────────────
async function liveTurn({ system, messages }: GenerateInput): Promise<TutorTurn> {
  const convo: any[] = messages.map((m) => ({ role: m.role, content: m.content }));
  const parts: string[] = [];
  let score: number | null = null;
  let rationale: string | null = null;

  const MAX_STEPS = 4;
  for (let step = 0; step < MAX_STEPS; step++) {
    const resp = await claudeClient!.messages.create({
      model: CONFIG.model,
      max_tokens: CONFIG.maxTokens,
      thinking: { type: 'adaptive' },
      system,
      tools: [gradeTool as any],
      messages: convo,
    } as any);

    const stepText: string[] = [];
    for (const block of resp.content as any[]) {
      if (block.type === 'text') {
        stepText.push(block.text);
      } else if (block.type === 'tool_use' && block.name === GRADE_TOOL_NAME) {
        const s = clampScore(block.input?.score);
        if (s !== null) {
          score = s;
          rationale = block.input?.rationale ?? rationale;
        }
      }
    }
    const joined = stepText.join('').trim();
    if (joined) parts.push(joined);

    if (resp.stop_reason !== 'tool_use') break;

    convo.push({ role: 'assistant', content: resp.content });
    const toolResults = (resp.content as any[])
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({
        type: 'tool_result',
        tool_use_id: b.id,
        content: 'Recorded. Continue the class as instructed.',
      }));
    convo.push({ role: 'user', content: toolResults });
  }

  const text = parts.join('\n\n').trim() || '(The tutor went quiet — please try again.)';
  return { text, score, rationale, source: 'claude' };
}

// ── Live Gemini path ─────────────────────────────────────────────────────────
// Uses gemini-2.0-flash (free tier). Grades are extracted from a structured
// SCORE: N/10 line that the system prompt instructs the model to emit.
async function geminiTurn({ system, messages, lastUserText }: GenerateInput): Promise<TutorTurn> {
  const gradeInstruction =
    '\n\nGRADING INSTRUCTION: Whenever you grade or score a student assignment, ' +
    'include exactly this line somewhere in your response: SCORE: N/10 ' +
    '(replace N with the integer score 0–10). Do not include this line if you are not grading.';

  const model = geminiClient!.getGenerativeModel({
    model: CONFIG.geminiModel,
    systemInstruction: system + gradeInstruction,
  });

  // Convert message history to Gemini format (all but the last user message).
  // Gemini roles are 'user' | 'model' (not 'assistant').
  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const chat = model.startChat({ history });
  const lastMsg = messages[messages.length - 1]?.content ?? lastUserText;

  const result = await chat.sendMessage(lastMsg);
  const raw = result.response.text().trim();

  // Extract SCORE: N/10
  let score: number | null = null;
  const scoreMatch = raw.match(/SCORE:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
  if (scoreMatch) {
    const parsed = parseFloat(scoreMatch[1]);
    score = Math.max(0, Math.min(10, Math.round(parsed)));
  }

  // Remove the score line from the displayed text
  const text = raw.replace(/SCORE:\s*\d+(?:\.\d+)?\s*\/\s*10\s*\n?/gi, '').trim();

  return { text: text || raw, score, rationale: null, source: 'gemini' };
}

// ── Offline stub ─────────────────────────────────────────────────────────────
function offlineTurn({ messages, ctx, lastUserText }: GenerateInput): TutorTurn {
  const isOpening = lastUserText === KICKOFF;
  const hasYesterday = ctx.yesterdayTopic !== FIRST_CLASS_SENTINEL;

  if (isOpening) {
    if (ctx.missedClass) {
      return turn(
        `${ctx.studentName}. You vanished for ${ctx.daysMissed} day(s). Let me be plain: the ` +
          `standard is built on consistency, and consistency is exactly what you just threw away. ` +
          `That stops today.\n\nWe will not pretend the gap did not happen. Quickly — last we met, ` +
          `we covered "${ctx.yesterdayTopic}". Now show me the assignment I gave you from it. Paste ` +
          `your full working, not a summary.`,
      );
    }
    if (hasYesterday) {
      return turn(
        `Good to see you on time, ${ctx.studentName}. No wasting daylight — straight to work.\n\n` +
          `Yesterday we drilled "${ctx.yesterdayTopic}". Before we open today's topic, show me the ` +
          `assignment I set you on it. Paste your working in full so I can mark it properly.`,
      );
    }
    return turn(
      `Welcome, ${ctx.studentName}. I am your ${ctx.subject} tutor, and I do not run an easy class — ` +
        `I run an effective one. Today we begin "${ctx.todayTopic}".\n\n` +
        `${firstParagraph(ctx.todayOutline)}\n\nRapid-fire, no notes: in your own words, why does this ` +
        `topic sit at the foundation of everything else in ${ctx.subject}?`,
    );
  }

  const prevAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const askedForAssignment = !!prevAssistant && /assignment/i.test(prevAssistant.content);

  if (askedForAssignment && hasYesterday && lastUserText.trim().length > 20) {
    const score = Math.max(3, Math.min(8, 3 + Math.floor(lastUserText.trim().length / 45)));
    return {
      text:
        `Hmm. I have read it carefully.\n\nYou are not lost, but you are not sharp either — your ` +
        `working leans on recall where I wanted reasoning, and a real examiner would punish that. ` +
        `I am giving you ${score}/10. Respectable, not good enough.\n\nNow, today: "${ctx.todayTopic}". ` +
        `${firstParagraph(ctx.todayOutline)}\n\nQuick check — can you state the single most important ` +
        `idea there back to me in one sentence?`,
      score,
      rationale: `Partial grasp of ${ctx.yesterdayTopic}; reasoning shown but not rigorous.`,
      source: 'offline-stub',
    };
  }

  return turn(
    `Decent attempt — but let us go deeper on "${ctx.todayTopic}".\n\n` +
      `${firstParagraph(ctx.todayOutline)}\n\nNow think before you answer: what would change if one of ` +
      `those conditions were removed? Convince me, ${ctx.studentName}.`,
  );

  function turn(text: string): TutorTurn {
    return { text, score: null, rationale: null, source: 'offline-stub' };
  }
}

function firstParagraph(outline: string): string {
  const firstSentence = outline.split(';')[0]?.trim();
  return firstSentence ? `${firstSentence}.` : outline;
}
