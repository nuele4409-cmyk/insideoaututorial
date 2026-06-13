// Storage selector. The rest of the app imports { repo } from here and awaits
// every call, so the embedded JSON store and the Supabase store are
// interchangeable. Default is local; set TUTOR_STORE=supabase to switch.
import { CONFIG } from '../config';
import * as local from './repository';
import * as supabase from './supabaseRepo';

export const repo = CONFIG.tutorStore === 'supabase' ? supabase : local;

console.log(`[tutor] data store: ${CONFIG.tutorStore}`);
