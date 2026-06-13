import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../config';
const sb = createClient(CONFIG.cbt.url, CONFIG.cbt.serviceRoleKey, { auth: { persistSession: false } });
const today = new Date(Date.now() + CONFIG.timezoneOffsetHours * 3600000).toISOString().slice(0, 10);
const { data, error } = await sb
  .from('tutor_submissions')
  .select('*')
  .eq('subject', 'mathematics')
  .eq('lesson_date', today);
if (error) console.error(error.message);
else console.log(JSON.stringify(data, null, 2));
