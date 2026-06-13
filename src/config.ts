import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const CONFIG = {
  port: Number(process.env.PORT ?? 3000),

  // Claude
  anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() ?? '',
  model: process.env.ANTHROPIC_MODEL?.trim() || 'claude-opus-4-8',
  maxTokens: 1500,

  // Gemini (free tier alternative)
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() ?? '',
  geminiModel: process.env.GEMINI_MODEL?.trim() || 'gemini-2.0-flash',

  // Memory window — inject only the last N interactions (user+assistant pairs)
  // to save token costs, as required by the brief.
  historyTurns: 5,

  // West Africa Time (Africa/Lagos) is a fixed UTC+1 with no daylight saving,
  // so a constant offset is exact. The "missed class" engine reckons calendar
  // days in this timezone.
  timezoneOffsetHours: 1,

  // Embedded store location.
  dataFile: path.join(projectRoot, 'data', 'tutor.json'),

  // Static web client served by the Express app.
  publicDir: path.join(projectRoot, 'public'),

  // Inside OAU! CBT / Post-UTME app (insideoau.vercel.app) — students log in with
  // this account; only those with active Post-UTME access get in, and the
  // classroom's "upcoming events" are the admin-scheduled mocks from this project.
  // These are the app's PUBLIC client values (already shipped in the CBT PWA), so
  // they are safe defaults; override via env if the project moves.
  cbt: {
    url: process.env.CBT_SUPABASE_URL?.trim() || 'https://zrkkurxfadlilwezqnxf.supabase.co',
    anonKey:
      process.env.CBT_SUPABASE_ANON_KEY?.trim() ||
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpya2t1cnhmYWRsaWx3ZXpxbnhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4OTA4MDMsImV4cCI6MjA5MjQ2NjgwM30.yiR5EqMVp_SAefEuaxN8yVlP-hwfz6NJWU_TGFb7sfY',
    appUrl: process.env.CBT_APP_URL?.trim() || 'https://insideoau.vercel.app',
    // Server-side only — used by the tutor's Supabase data store (TUTOR_STORE=supabase).
    serviceRoleKey: process.env.CBT_SERVICE_ROLE_KEY?.trim() || '',
  },

  // Where the tutor's OWN data (curriculum, progress, chat) lives:
  //   'local'    — embedded JSON store (default; zero setup)
  //   'supabase' — tutor_* tables in the CBT project (run tutor_supabase.sql and
  //                set CBT_SERVICE_ROLE_KEY)
  tutorStore: (process.env.TUTOR_STORE?.trim() === 'supabase' ? 'supabase' : 'local') as
    | 'local'
    | 'supabase',
} as const;

export const HAS_LIVE_CLAUDE = CONFIG.anthropicApiKey.length > 0;
export const HAS_LIVE_GEMINI = CONFIG.geminiApiKey.length > 0;
export const AI_SOURCE: 'claude' | 'gemini' | 'offline-stub' = HAS_LIVE_CLAUDE
  ? 'claude'
  : HAS_LIVE_GEMINI
  ? 'gemini'
  : 'offline-stub';
