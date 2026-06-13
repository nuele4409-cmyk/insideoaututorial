export const GRADE_TOOL_NAME = 'record_assignment_grade';

/**
 * Dedicated tool so the backend can reliably *capture* the score the tutor
 * assigns (Phase 2), rather than scraping a number out of free prose. The model
 * speaks its critique in character AND calls this — see the system prompt.
 */
export const gradeTool = {
  name: GRADE_TOOL_NAME,
  description:
    "Record the integer grade (0-10) you assigned to the student's previous-day assignment so the " +
    'platform can persist it to their academic record. Call this in the SAME turn you deliver the ' +
    'verbal critique, every time you grade an assignment. Do NOT call it when there was no assignment ' +
    'to grade (e.g. the first class).',
  input_schema: {
    type: 'object',
    properties: {
      score: {
        type: 'integer',
        description: 'The grade out of 10. Whole number from 0 to 10.',
      },
      rationale: {
        type: 'string',
        description: 'One sentence justifying the score against the standard.',
      },
    },
    required: ['score', 'rationale'],
    additionalProperties: false,
  },
} as const;

/** Coerce a model-supplied score into a valid integer 0-10, or null if unusable. */
export function clampScore(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(10, Math.round(n)));
}
