import { describe, it, expect } from 'vitest';
import { clampScore, gradeTool, GRADE_TOOL_NAME } from '../anthropic/gradeTool';

describe('GRADE_TOOL_NAME', () => {
  it('has the correct name', () => {
    expect(GRADE_TOOL_NAME).toBe('record_assignment_grade');
  });
});

describe('gradeTool definition', () => {
  it('has name, description and input_schema', () => {
    expect(gradeTool.name).toBe(GRADE_TOOL_NAME);
    expect(gradeTool.description).toBeTruthy();
    expect(gradeTool.input_schema).toBeDefined();
  });

  it('requires score and rationale', () => {
    expect(gradeTool.input_schema.required).toContain('score');
    expect(gradeTool.input_schema.required).toContain('rationale');
  });

  it('score is an integer', () => {
    expect(gradeTool.input_schema.properties.score.type).toBe('integer');
  });

  it('rationale is a string', () => {
    expect(gradeTool.input_schema.properties.rationale.type).toBe('string');
  });
});

describe('clampScore', () => {
  it('returns null for non-finite values', () => {
    expect(clampScore(NaN)).toBeNull();
    expect(clampScore(Infinity)).toBeNull();
    expect(clampScore(-Infinity)).toBeNull();
  });

  it('returns null for unparseable strings and NaN', () => {
    expect(clampScore(NaN)).toBeNull();
    expect(clampScore(Infinity)).toBeNull();
    expect(clampScore(-Infinity)).toBeNull();
    expect(clampScore('abc')).toBeNull();
    expect(clampScore(undefined)).toBeNull();
    expect(clampScore({})).toBeNull();
  });

  it('returns 0 for null, empty string, and similar coercible values', () => {
    // Number(null) = 0, Number('') = 0, Number([]) = 0,
    // so these are validly clamped to 0 by the function's design.
    expect(clampScore(null)).toBe(0);
    expect(clampScore('')).toBe(0);
    expect(clampScore([])).toBe(0);
    expect(clampScore(false)).toBe(0);
  });

  it('clamps values below 0 to 0', () => {
    expect(clampScore(-5)).toBe(0);
    expect(clampScore(-1)).toBe(0);
    expect(clampScore(-100)).toBe(0);
  });

  it('clamps values above 10 to 10', () => {
    expect(clampScore(15)).toBe(10);
    expect(clampScore(100)).toBe(10);
    expect(clampScore(11)).toBe(10);
  });

  it('rounds to nearest integer', () => {
    expect(clampScore(4.2)).toBe(4);
    expect(clampScore(4.8)).toBe(5);
    expect(clampScore(7.5)).toBe(8);
  });

  it('accepts valid scores within 0-10', () => {
    expect(clampScore(0)).toBe(0);
    expect(clampScore(5)).toBe(5);
    expect(clampScore(10)).toBe(10);
    expect(clampScore(3)).toBe(3);
    expect(clampScore(7)).toBe(7);
  });

  it('parses numeric strings', () => {
    expect(clampScore('7')).toBe(7);
    expect(clampScore('3.5')).toBe(4);
    expect(clampScore('0')).toBe(0);
  });


});
