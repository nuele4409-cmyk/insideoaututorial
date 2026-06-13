import { CONFIG } from '../config';
import type { Attendance, Progress } from '../types';

// ── Calendar-day reckoning in West Africa Time (UTC+1, no DST) ────────────────

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' for the given instant, as seen on a clock in Lagos. */
export function watDateKey(d: Date, offsetHours: number = CONFIG.timezoneOffsetHours): string {
  const shifted = new Date(d.getTime() + offsetHours * 3_600_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Whole calendar days between two instants, reckoned in WAT. */
export function calendarDayDiff(
  aIso: string,
  bIso: string,
  offsetHours: number = CONFIG.timezoneOffsetHours,
): number {
  const a = Date.parse(`${watDateKey(new Date(aIso), offsetHours)}T00:00:00Z`);
  const b = Date.parse(`${watDateKey(new Date(bIso), offsetHours)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * The heart of the "Missed Class" detection system. Pure — it reads the progress
 * row and the current instant and returns what SHOULD happen; the caller commits
 * it only after a successful tutor turn (so a failed API call can't desync state).
 *
 * Rules:
 *   • first ever session            -> no advance, no reprimand (learn Day 1)
 *   • same calendar day             -> no advance (continuing today's class)
 *   • exactly the next calendar day -> advance one lesson, on schedule
 *   • a gap of 2+ calendar days     -> advance one lesson AND flag missed_class,
 *                                       days_missed = (gap - 1)
 */
export function computeAttendance(args: {
  progress: Progress | null;
  now: Date;
  maxDay: number;
  offsetHours?: number;
}): Attendance {
  const { progress, now, maxDay } = args;
  const offsetHours = args.offsetHours ?? CONFIG.timezoneOffsetHours;
  const currentLevel = progress?.current_day_level ?? 1;

  if (!progress || !progress.last_login_timestamp) {
    return {
      firstEver: true,
      missedClass: false,
      daysMissed: 0,
      advanced: false,
      dayLevel: Math.min(Math.max(currentLevel, 1), Math.max(maxDay, 1)),
      previousDayLevel: currentLevel > 1 ? currentLevel - 1 : null,
    };
  }

  const diff = calendarDayDiff(progress.last_login_timestamp, now.toISOString(), offsetHours);

  if (diff <= 0) {
    return {
      firstEver: false,
      missedClass: false,
      daysMissed: 0,
      advanced: false,
      dayLevel: currentLevel,
      previousDayLevel: currentLevel > 1 ? currentLevel - 1 : null,
    };
  }

  const newLevel = Math.min(currentLevel + 1, maxDay);
  const missed = diff >= 2;
  return {
    firstEver: false,
    missedClass: missed,
    daysMissed: missed ? diff - 1 : 0,
    advanced: newLevel !== currentLevel,
    dayLevel: newLevel,
    previousDayLevel: newLevel > 1 ? newLevel - 1 : null,
  };
}
