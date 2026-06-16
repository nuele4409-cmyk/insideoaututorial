import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, KICKOFF } from '../anthropic/systemPrompt';
import type { TutorContext } from '../types';

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
  announcement: 'Grand Mock CBT holds this Saturday.',
};

describe('KICKOFF', () => {
  it('is a non-empty string', () => {
    expect(typeof KICKOFF).toBe('string');
    expect(KICKOFF.length).toBeGreaterThan(0);
  });

  it('references entering class', () => {
    expect(KICKOFF.toLowerCase()).toContain('class');
  });
});

describe('buildSystemPrompt', () => {
  it('returns a string', () => {
    expect(typeof buildSystemPrompt(baseCtx)).toBe('string');
  });

  it('includes the student name', () => {
    const prompt = buildSystemPrompt(baseCtx);
    expect(prompt).toContain('Tunde Adebayo');
  });

  it('includes the subject', () => {
    const prompt = buildSystemPrompt(baseCtx);
    expect(prompt).toContain('physics');
  });

  it('includes today\'s topic', () => {
    const prompt = buildSystemPrompt(baseCtx);
    expect(prompt).toContain("Newton's Laws of Motion");
  });

  it('includes yesterday\'s topic for non-first class', () => {
    const prompt = buildSystemPrompt(baseCtx);
    expect(prompt).toContain('Kinematics');
  });

  it('shows Missed Class Flag when missedClass is true', () => {
    const ctx = { ...baseCtx, missedClass: true, daysMissed: 3 };
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('Missed Class Flag: True');
    expect(prompt).toContain('3 day(s) missed');
  });

  it('shows Missed Class Flag: False when not missed', () => {
    const prompt = buildSystemPrompt(baseCtx);
    expect(prompt).toContain('Missed Class Flag: False');
  });

  it('includes the announcement', () => {
    const prompt = buildSystemPrompt(baseCtx);
    expect(prompt).toContain('Grand Mock CBT');
  });

  it('handles first class (yesterdayTopic = sentinel)', () => {
    const ctx = {
      ...baseCtx,
      yesterdayTopic: 'None — this is the first class.',
      dayLevel: 1,
    };
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('None — this is the first class.');
    // Should also contain directive about skipping grading for first class
    expect(prompt).toContain('None — this is the first class');
  });

  it('includes the curriculum outline', () => {
    const prompt = buildSystemPrompt(baseCtx);
    expect(prompt).toContain('linear momentum and impulse');
  });

  it('includes all 7 directives', () => {
    const prompt = buildSystemPrompt(baseCtx);
    for (let i = 1; i <= 7; i++) {
      expect(prompt).toContain(`${i}.`);
    }
  });
});
