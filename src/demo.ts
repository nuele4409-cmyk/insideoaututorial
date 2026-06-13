// Scripted, narrated multi-day scenario that proves the engine end-to-end —
// missed-class detection, day progression, grading & score persistence — without
// a browser. Runs against the offline stub when ANTHROPIC_API_KEY is unset, or
// the real Claude tutor when it is set.
//
//   npm run demo
//
import { HAS_LIVE_CLAUDE, CONFIG } from './config';
import * as repo from './db/repository';
import { sendMessage, startSession } from './engine/classroom';

const STUDENT = 'stu_demo';
const SUBJECT = 'Physics';

function at(date: string): Date {
  return new Date(`${date}T09:00:00+01:00`); // 9am WAT
}

function rule(label: string): void {
  console.log(`\n${'─'.repeat(70)}\n  ${label}\n${'─'.repeat(70)}`);
}

function tutor(text: string, source: string, score: number | null): void {
  console.log(`\n  TUTOR${source === 'offline-stub' ? ' [offline stub]' : ''}:`);
  text.split(/\n{2,}|\n/).forEach((l) => l.trim() && console.log(`    ${l.trim()}`));
  if (score !== null) console.log(`    >> [grade captured by backend: ${score}/10]`);
}

function student(text: string): void {
  console.log(`\n  ${repo.getStudent(STUDENT)?.full_name ?? 'Student'}:`);
  console.log(`    ${text}`);
}

async function main(): Promise<void> {
  repo.reseed(); // deterministic starting point

  console.log(`\n  OAU AI Tutor — scripted demo`);
  console.log(`  Mode: ${HAS_LIVE_CLAUDE ? `LIVE Claude (${CONFIG.model})` : 'OFFLINE STUB'}`);

  // ── Day 1: first class (no reprimand, nothing to grade) ──
  rule('Mon 12 Jun 2026 — Day 1 (first class)');
  let s = await startSession({ studentId: STUDENT, subject: SUBJECT, now: at('2026-06-12') });
  tutor(s.reply, s.source, s.score);

  // ── Day 2: on time → recap + grade yesterday's assignment + teach ──
  rule('Tue 13 Jun 2026 — Day 2 (on time)');
  s = await startSession({ studentId: STUDENT, subject: SUBJECT, now: at('2026-06-13') });
  tutor(s.reply, s.source, s.score);

  const answer =
    'Assignment: A car accelerates uniformly from rest at 3 m/s^2 for 8 s. ' +
    'Using v = u + at, v = 0 + 3*8 = 24 m/s. Distance s = ut + 0.5*a*t^2 = 0 + 0.5*3*64 = 96 m.';
  student(answer);
  let m = await sendMessage({ studentId: STUDENT, subject: SUBJECT, text: answer, now: at('2026-06-13') });
  tutor(m.reply, m.source, m.score);

  // ── Skip ahead: misses Wed + Thu, returns Fri → reprimand ──
  rule('Fri 16 Jun 2026 — returns after missing 2 days');
  s = await startSession({ studentId: STUDENT, subject: SUBJECT, now: at('2026-06-16') });
  console.log(
    `\n  [attendance engine] missedClass=${s.attendance.missedClass} ` +
      `daysMissed=${s.attendance.daysMissed} dayLevel=${s.attendance.dayLevel}`,
  );
  tutor(s.reply, s.source, s.score);

  // ── Final persisted state ──
  const p = repo.getProgress(STUDENT, SUBJECT)!;
  rule('Persisted progress (the student\'s journey)');
  console.log(`    current_day_level       : ${p.current_day_level}`);
  console.log(`    missed_days_count        : ${p.missed_days_count}`);
  console.log(`    latest_assignment_score  : ${p.latest_assignment_score ?? '—'}`);
  console.log(`    last_login_timestamp     : ${p.last_login_timestamp}`);
  console.log('');
}

main().catch((err) => {
  console.error('\nDemo failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
