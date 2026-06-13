import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../config';

// Server-side client for the Inside OAU! Post-UTME project. No session is
// persisted here — we authenticate students on demand and read public data.
const client = createClient(CONFIG.cbt.url, CONFIG.cbt.anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export interface CbtProfile {
  id: string;
  student_id: string | null;
  full_name: string | null;
  email: string | null;
  has_post_utme_access: boolean;
  is_admin: boolean;
  selected_university: string | null;
  post_utme_subjects: unknown;
}

export interface ScheduledMock {
  id: string;
  title: string;
  description: string | null;
  university: string | null;
  scheduled_at: string;
  duration_minutes: number | null;
}

export class CbtAuthError extends Error {}

/** Verify a student's insideoau email/password. Returns their auth user + token. */
export async function login(
  email: string,
  password: string,
): Promise<{ token: string; userId: string; email: string | null }> {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    throw new CbtAuthError(error?.message ?? 'Invalid email or password.');
  }
  return { token: data.session.access_token, userId: data.user.id, email: data.user.email ?? null };
}

/** Verify a Supabase access token (from login) and return the user id. */
export async function verifyToken(token: string): Promise<{ userId: string } | null> {
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { userId: data.user.id };
}

/** Read a student's profile (access flag, student id, chosen subjects, etc.). */
export async function getProfile(userId: string): Promise<CbtProfile | null> {
  const { data, error } = await client
    .from('profiles')
    .select(
      'id, student_id, full_name, email, has_post_utme_access, is_admin, selected_university, post_utme_subjects',
    )
    .eq('id', userId)
    .single();
  if (error) return null;
  return data as CbtProfile;
}

/** Upcoming admin-scheduled mocks — the classroom's "upcoming events". */
export async function getUpcomingMocks(limit = 5): Promise<ScheduledMock[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await client
    .from('scheduled_mocks')
    .select('id, title, description, university, scheduled_at, duration_minutes')
    .gte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ScheduledMock[];
}
