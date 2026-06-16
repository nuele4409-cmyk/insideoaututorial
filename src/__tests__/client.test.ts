import { describe, it, expect, beforeAll } from 'vitest';
import type { ApiMessage, TutorContext } from '../types';
import { KICKOFF } from '../anthropic/systemPrompt';

// The offline stub is the default when no API key is set.
// We test it by importing generateTutorTurn in an environment without API keys.
// Since config reads env at module import time, we set env before importing.

const FIRST_CLASS_SENTINEL = 'None — this is the first class.';

const baseCtx: TutorContext = {
  studentName: 'Tunde Adebayo',
  department: 'science',
  subject: 'physics',
  dayLevel: 3,
  todayTopic: "Newton's Laws of Motion",
  todayOutline: 'The three laws stated precisely; inertia and inertial mass; linear momentum and impulse.',
  yesterdayTopic: 'Kinematics',
  missedClass: false,
  daysMissed: 0,
  announcement: 'Grand Mock CBT this Saturday.',
};

const firstClassCtx: TutorContext = {
  ...baseCtx,
  yesterdayTopic: FIRST_CLASS_SENTINEL,
  dayLevel: 1,
};

describe('offline stub — session opening', () => {
  let generateTutorTurn: (input: any) => Promise<any>;

  beforeAll(async () => {
    // Ensure no API keys are set so AI_SOURCE falls back to 'offline-stub'
    process.env.ANTHROPIC_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    // Re-import to pick up env
    const mod = await import('../anthropic/client');
    generateTutorTurn = mod.generateTutorTurn;
  });

  it('first class: welcomes the student and starts teaching', async () => {
    const result = await generateTutorTurn({
      system: '',
      messages: [{ role: 'user' as const, content: KICKOFF }],
      ctx: firstClassCtx,
      lastUserText: KICKOFF,
    });
    expect(result.source).toBe('offline-stub');
    expect(result.text).toContain('Tunde Adebayo');
    expect(result.text).toContain("Newton's Laws of Motion");
    expect(result.score).toBeNull();
  });

  it('missed class: reprimands the student', async () => {
    const missedCtx = { ...baseCtx, missedClass: true, daysMissed: 3 };
    const result = await generateTutorTurn({
      system: '',
      messages: [{ role: 'user' as const, content: KICKOFF }],
      ctx: missedCtx,
      lastUserText: KICKOFF,
    });
    expect(result.source).toBe('offline-stub');
    expect(result.text).toContain('vanished for 3 day(s)');
    expect(result.text).toContain('Tunde Adebayo');
    expect(result.score).toBeNull();
  });

  it('returning student (has yesterday): asks for assignment', async () => {
    const result = await generateTutorTurn({
      system: '',
      messages: [{ role: 'user' as const, content: KICKOFF }],
      ctx: baseCtx,
      lastUserText: KICKOFF,
    });
    expect(result.source).toBe('offline-stub');
    expect(result.text).toContain('Kinematics');
    expect(result.text).toMatch(/assignment/i);
    expect(result.score).toBeNull();
  });
});

describe('offline stub — grading', () => {
  let generateTutorTurn: (input: any) => Promise<any>;

  beforeAll(async () => {
    process.env.ANTHROPIC_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    const mod = await import('../anthropic/client');
    generateTutorTurn = mod.generateTutorTurn;
  });

  it('grades a long assignment submission', async () => {
    const messages: ApiMessage[] = [
      { role: 'assistant', content: 'Show me your assignment from yesterday on Kinematics.' },
      { role: 'user', content: 'Here is my assignment. I worked through all the problems step by step. ' + 'A '.repeat(100) },
    ];
    const result = await generateTutorTurn({
      system: '',
      messages,
      ctx: baseCtx,
      lastUserText: 'A '.repeat(100),
    });
    expect(result.source).toBe('offline-stub');
    expect(result.score).toBeGreaterThanOrEqual(3);
    expect(result.score).toBeLessThanOrEqual(8);
    expect(result.text).toContain('/10');
    expect(result.rationale).toBeTruthy();
  });

  it('short submission gets score=3 (minimum)', async () => {
    // Text must be >20 chars to trigger grading, but <45 to floor at score 3
    const shortWork = 'Here is my short assignment answer.';
    expect(shortWork.length).toBeGreaterThan(20);
    const messages: ApiMessage[] = [
      { role: 'assistant', content: 'Show me your assignment from yesterday.' },
      { role: 'user', content: shortWork },
    ];
    const result = await generateTutorTurn({
      system: '',
      messages,
      ctx: baseCtx,
      lastUserText: shortWork,
    });
    expect(result.score).toBe(3);
  });

  it('non-assignment follow-up: continues teaching without grading', async () => {
    const messages: ApiMessage[] = [
      { role: 'assistant', content: "Today we're covering Newton's Laws." },
      { role: 'user', content: 'Can you explain inertia more?' },
    ];
    const result = await generateTutorTurn({
      system: '',
      messages,
      ctx: baseCtx,
      lastUserText: 'Can you explain inertia more?',
    });
    expect(result.source).toBe('offline-stub');
    expect(result.score).toBeNull();
    expect(result.text).toContain("Newton's Laws of Motion");
  });
});
