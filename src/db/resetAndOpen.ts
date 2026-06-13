import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../config';
import { openClass } from '../engine/groupClass';

const sb = createClient(CONFIG.cbt.url, CONFIG.cbt.serviceRoleKey, { auth: { persistSession: false } });

// Delete today's empty maths lesson so openClass will regenerate it
const today = new Date(Date.now() + CONFIG.timezoneOffsetHours * 3600000).toISOString().slice(0, 10);
await sb.from('tutor_daily_lessons').delete().eq('subject', 'mathematics').eq('lesson_date', today);
console.log('Cleared old empty lesson. Regenerating…');

const { lesson } = await openClass('mathematics');
console.log(`✅ Day ${lesson.day_number}: ${lesson.topic}`);
console.log('\n── LESSON ──');
console.log(lesson.lesson_content.slice(0, 500) + '…');
console.log('\n── ASSIGNMENT ──');
console.log(lesson.assignment_prompt.slice(0, 300) + '…');
