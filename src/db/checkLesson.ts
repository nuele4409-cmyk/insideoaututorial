import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../config';
const sb = createClient(CONFIG.cbt.url, CONFIG.cbt.serviceRoleKey, { auth: { persistSession: false } });
const { data, error } = await sb.from('tutor_daily_lessons').select('*').order('generated_at', { ascending: false }).limit(1);
if (error) console.error(error);
else console.log(JSON.stringify(data, null, 2));
