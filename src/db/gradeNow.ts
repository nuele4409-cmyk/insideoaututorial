import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../config';
import { gradeSubmissions } from '../anthropic/groupLesson';

const sb = createClient(CONFIG.cbt.url, CONFIG.cbt.serviceRoleKey, { auth: { persistSession: false } });
const today = new Date(Date.now() + CONFIG.timezoneOffsetHours * 3600000).toISOString().slice(0, 10);

// 1. Get today's lesson
const { data: lesson, error: le } = await sb
  .from('tutor_daily_lessons')
  .select('*')
  .eq('subject', 'mathematics')
  .eq('lesson_date', today)
  .single();
if (le || !lesson) { console.error('No lesson found:', le?.message); process.exit(1); }
console.log(`Lesson: Day ${lesson.day_number} — ${lesson.topic}`);

// 2. Get ungraded submissions
const { data: subs, error: se } = await sb
  .from('tutor_submissions')
  .select('*')
  .eq('subject', 'mathematics')
  .eq('lesson_date', today)
  .is('score', null);
if (se) { console.error('Error fetching submissions:', se.message); process.exit(1); }
console.log(`Ungraded submissions: ${subs?.length ?? 0}`);
if (!subs?.length) { console.log('Nothing to grade.'); process.exit(0); }

// 3. Grade them
console.log('Calling Claude to grade…');
const results = await gradeSubmissions(
  'mathematics',
  lesson.day_number,
  lesson.topic,
  lesson.assignment_prompt,
  subs.map(s => ({ student_id: s.student_id, submission_text: s.submission_text })),
);
console.log('Grade results:', JSON.stringify(results, null, 2));

// 4. Save results
const now = new Date().toISOString();
for (const r of results) {
  const { error: ue } = await sb
    .from('tutor_submissions')
    .update({ score: r.score, feedback: r.feedback, graded_at: now })
    .eq('student_id', r.student_id)
    .eq('subject', 'mathematics')
    .eq('lesson_date', today);
  if (ue) console.error(`Failed to save grade for ${r.student_id}:`, ue.message);
  else console.log(`✅ ${r.student_id} → ${r.score}/10`);
}
