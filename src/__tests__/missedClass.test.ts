import { describe, it, expect } from 'vitest';
import { watDateKey, calendarDayDiff, computeAttendance } from '../engine/missedClass';
import type { Progress, Attendance } from '../types';

// All tests use UTC+1 offset (WAT) unless specified.
const WAT = 1;

describe('watDateKey', () => {
  it('returns YYYY-MM-DD for a given date in WAT', () => {
    const d = new Date('2026-06-15T12:00:00Z');
    expect(watDateKey(d, WAT)).toBe('2026-06-15');
  });

  it('rolls over at midnight WAT (23:00 UTC)', () => {
    const d = new Date('2026-06-15T23:00:00Z');
    expect(watDateKey(d, WAT)).toBe('2026-06-16');
  });

  it('does not roll over at 22:59 UTC', () => {
    const d = new Date('2026-06-15T22:59:00Z');
    expect(watDateKey(d, WAT)).toBe('2026-06-15');
  });

  it('handles month boundary', () => {
    // Jan 31 23:30 UTC = Feb 1 00:30 WAT
    const d = new Date('2026-01-31T23:30:00Z');
    expect(watDateKey(d, WAT)).toBe('2026-02-01');
  });

  it('handles year boundary', () => {
    const d = new Date('2026-12-31T23:30:00Z');
    expect(watDateKey(d, WAT)).toBe('2027-01-01');
  });

  it('uses default offset from CONFIG when not provided', () => {
    // Just verify it doesn't throw and returns a string
    const d = new Date();
    const key = watDateKey(d);
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('calendarDayDiff', () => {
  it('returns 0 for same day', () => {
    expect(calendarDayDiff('2026-06-15T08:00:00Z', '2026-06-15T16:00:00Z', WAT)).toBe(0);
  });

  it('returns 1 for consecutive days', () => {
    expect(calendarDayDiff('2026-06-15T08:00:00Z', '2026-06-16T08:00:00Z', WAT)).toBe(1);
  });

  it('returns 2 for two-day gap', () => {
    expect(calendarDayDiff('2026-06-15T08:00:00Z', '2026-06-17T08:00:00Z', WAT)).toBe(2);
  });

  it('returns negative when b is before a', () => {
    expect(calendarDayDiff('2026-06-17T08:00:00Z', '2026-06-15T08:00:00Z', WAT)).toBe(-2);
  });

  it('accounts for WAT offset correctly near midnight', () => {
    // 2026-06-15 23:30 UTC = 2026-06-16 00:30 WAT
    // 2026-06-16 00:30 UTC = 2026-06-16 01:30 WAT
    expect(calendarDayDiff('2026-06-15T23:30:00Z', '2026-06-16T00:30:00Z', WAT)).toBe(0);
  });
});

describe('computeAttendance', () => {
  const maxDay = 5;

  it('first ever session: no advance, no reprimand, dayLevel=1', () => {
    const result = computeAttendance({ progress: null, now: new Date('2026-06-15T10:00:00Z'), maxDay });
    expect(result).toEqual<Attendance>({
      firstEver: true,
      missedClass: false,
      daysMissed: 0,
      advanced: false,
      dayLevel: 1,
      previousDayLevel: null,
    });
  });

  it('first ever session with null progress.last_login_timestamp', () => {
    const progress: Progress = {
      id: 1, student_id: 's1', subject: 'physics',
      current_day_level: 1, last_login_timestamp: null,
      missed_days_count: 0, latest_assignment_score: null,
    };
    const result = computeAttendance({ progress, now: new Date('2026-06-15T10:00:00Z'), maxDay });
    expect(result.firstEver).toBe(true);
    expect(result.advanced).toBe(false);
    expect(result.dayLevel).toBe(1);
  });

  it('same calendar day: no advance, continue current level', () => {
    const progress: Progress = {
      id: 1, student_id: 's1', subject: 'physics',
      current_day_level: 2, last_login_timestamp: '2026-06-15T08:00:00Z',
      missed_days_count: 0, latest_assignment_score: null,
    };
    const result = computeAttendance({ progress, now: new Date('2026-06-15T14:00:00Z'), maxDay });
    expect(result).toEqual<Attendance>({
      firstEver: false,
      missedClass: false,
      daysMissed: 0,
      advanced: false,
      dayLevel: 2,
      previousDayLevel: 1,
    });
  });

  it('next calendar day: advance one lesson, on schedule', () => {
    const progress: Progress = {
      id: 1, student_id: 's1', subject: 'physics',
      current_day_level: 2, last_login_timestamp: '2026-06-15T08:00:00Z',
      missed_days_count: 0, latest_assignment_score: null,
    };
    const result = computeAttendance({ progress, now: new Date('2026-06-16T10:00:00Z'), maxDay });
    expect(result).toEqual<Attendance>({
      firstEver: false,
      missedClass: false,
      daysMissed: 0,
      advanced: true,
      dayLevel: 3,
      previousDayLevel: 2,
    });
  });

  it('gap of 2+ days: advance one lesson AND flag missed class', () => {
    const progress: Progress = {
      id: 1, student_id: 's1', subject: 'physics',
      current_day_level: 2, last_login_timestamp: '2026-06-15T08:00:00Z',
      missed_days_count: 0, latest_assignment_score: null,
    };
    const result = computeAttendance({ progress, now: new Date('2026-06-18T10:00:00Z'), maxDay });
    expect(result.missedClass).toBe(true);
    expect(result.daysMissed).toBe(2); // gap=3, so daysMissed=gap-1=2
    expect(result.advanced).toBe(true);
    expect(result.dayLevel).toBe(3);
    expect(result.firstEver).toBe(false);
  });

  it('respects maxDay cap', () => {
    const progress: Progress = {
      id: 1, student_id: 's1', subject: 'physics',
      current_day_level: 5, last_login_timestamp: '2026-06-15T08:00:00Z',
      missed_days_count: 0, latest_assignment_score: null,
    };
    // If at max day, advancing should keep them at max
    const result = computeAttendance({ progress, now: new Date('2026-06-16T10:00:00Z'), maxDay: 5 });
    expect(result.dayLevel).toBe(5);
    expect(result.advanced).toBe(false); // can't advance past max
  });

  it('gap with maxDay cap still works', () => {
    const progress: Progress = {
      id: 1, student_id: 's1', subject: 'physics',
      current_day_level: 5, last_login_timestamp: '2026-06-15T08:00:00Z',
      missed_days_count: 0, latest_assignment_score: null,
    };
    const result = computeAttendance({ progress, now: new Date('2026-06-20T10:00:00Z'), maxDay: 5 });
    expect(result.dayLevel).toBe(5);
    expect(result.missedClass).toBe(true);
    expect(result.daysMissed).toBe(4);
    expect(result.advanced).toBe(false);
  });

  it('first level is never below 1', () => {
    const result = computeAttendance({ progress: null, now: new Date(), maxDay: 0 });
    expect(result.dayLevel).toBe(1);
  });
});
