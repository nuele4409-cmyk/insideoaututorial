// The Post-UTME subject catalogue, mirrored from the CBT app's PUTME_SUBJECTS.
// Students pick a subset (profiles.post_utme_subjects); the tutor teaches those.

export interface PutmeSubject {
  id: string;
  label: string;
}

export const PUTME_SUBJECTS: PutmeSubject[] = [
  { id: 'english', label: 'Use of English' },
  { id: 'mathematics', label: 'Mathematics' },
  { id: 'physics', label: 'Physics' },
  { id: 'chemistry', label: 'Chemistry' },
  { id: 'biology', label: 'Biology' },
  { id: 'economics', label: 'Economics' },
  { id: 'government', label: 'Government' },
  { id: 'literature', label: 'Literature' },
  { id: 'commerce', label: 'Commerce' },
  { id: 'accounting', label: 'Accounting' },
  { id: 'geography', label: 'Geography' },
  { id: 'history', label: 'History' },
  { id: 'agric', label: 'Agricultural Sci.' },
  { id: 'further_maths', label: 'Further Maths' },
  { id: 'irs', label: 'Islamic R.S.' },
  { id: 'crs', label: 'Christian R.S.' },
];

// All Post-UTME curriculum lives under one bucket — subjects, not departments,
// are the organising key now.
export const POSTUTME_DEPT = 'postutme';

const LABELS = new Map(PUTME_SUBJECTS.map((s) => [s.id, s.label]));

export function subjectLabel(id: string): string {
  return LABELS.get(id) ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export const ALL_SUBJECT_KEYS = PUTME_SUBJECTS.map((s) => s.id);

// ── Tracks (departments for lesson grouping) ──────────────────────────────────

export type TrackKey = 'general' | 'science' | 'arts_commercial';

export interface Track {
  key: TrackKey;
  label: string;
  subjects: string[];
}

// Mathematics appears in both science and arts_commercial — each track tracks
// its own day-number progression independently.
export const TRACKS: Track[] = [
  {
    key: 'general',
    label: 'General',
    subjects: ['english'],
  },
  {
    key: 'science',
    label: 'Track A — Sciences',
    subjects: ['chemistry', 'physics', 'biology', 'mathematics'],
  },
  {
    key: 'arts_commercial',
    label: 'Track B — Arts & Commercial',
    subjects: ['economics', 'government', 'literature', 'commerce', 'accounting', 'crs', 'irs', 'mathematics'],
  },
];

// Infer a student's primary track from their chosen subjects
export function inferTrack(subjects: string[]): TrackKey {
  const sciMarkers = ['physics', 'chemistry', 'biology', 'further_maths'];
  const artsMarkers = ['government', 'economics', 'literature', 'commerce', 'accounting', 'crs', 'irs', 'history', 'agric'];
  const sci = subjects.filter((s) => sciMarkers.includes(s)).length;
  const arts = subjects.filter((s) => artsMarkers.includes(s)).length;
  return arts > sci ? 'arts_commercial' : 'science';
}

// For a subject key and the student's track, return which lesson department to fetch
export function lessonDept(subject: string, track: TrackKey): TrackKey {
  if (subject === 'english') return 'general';
  if (['physics', 'chemistry', 'biology', 'further_maths'].includes(subject)) return 'science';
  if (['government', 'economics', 'literature', 'commerce', 'accounting', 'crs', 'irs', 'history', 'agric'].includes(subject)) return 'arts_commercial';
  // mathematics — belongs to whichever track the student is in
  return track;
}
