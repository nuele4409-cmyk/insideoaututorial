import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { CONFIG } from '../config';
import * as repoModule from '../db/repository';

import path from 'node:path';
import fs from 'node:fs';

const TEST_DATA_DIR = path.resolve('/tmp/opencode/tutor-test-data');
const TEST_DATA_FILE = path.join(TEST_DATA_DIR, 'tutor.json');

const origDataFile = (CONFIG as any).dataFile;

async function setupTestRepo() {
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  (CONFIG as any).dataFile = TEST_DATA_FILE;
  await repoModule.reseed();
}

async function teardownTestRepo() {
  (CONFIG as any).dataFile = origDataFile;
}

describe('repository — students', () => {
  beforeEach(async () => {
    await setupTestRepo();
  });

  afterAll(() => {
    teardownTestRepo();
  });

  it('listStudents returns default demo student', async () => {
    const students = await repoModule.listStudents();
    expect(students.length).toBeGreaterThanOrEqual(1);
    expect(students.some((s) => s.id === 'stu_demo')).toBe(true);
  });

  it('createStudent adds a new student', async () => {
    const student = await repoModule.createStudent({ full_name: 'Chioma Okonkwo', department: 'science' });
    expect(student.full_name).toBe('Chioma Okonkwo');
    expect(student.department).toBe('science');
    expect(student.id).toBeTruthy();
    expect(student.created_at).toBeTruthy();
  });

  it('getStudent returns null for unknown id', async () => {
    const s = await repoModule.getStudent('nonexistent');
    expect(s).toBeNull();
  });

  it('getStudent returns the correct student', async () => {
    const created = await repoModule.createStudent({ full_name: 'Test User', department: 'arts' });
    const found = await repoModule.getStudent(created.id);
    expect(found).not.toBeNull();
    expect(found!.full_name).toBe('Test User');
  });
});

describe('repository — curriculum', () => {
  beforeEach(async () => {
    await setupTestRepo();
  });

  afterAll(() => {
    teardownTestRepo();
  });

  it('getCurriculumDay returns a known day', async () => {
    const day = await repoModule.getCurriculumDay('postutme', 'physics', 1);
    expect(day).not.toBeNull();
    expect(day!.topic).toBe('Measurements, Units & Dimensions');
    expect(day!.subject).toBe('physics');
  });

  it('getCurriculumDay returns null for unknown day', async () => {
    const day = await repoModule.getCurriculumDay('postutme', 'physics', 99);
    expect(day).toBeNull();
  });

  it('maxCurriculumDay returns correct count', async () => {
    const max = await repoModule.maxCurriculumDay('postutme', 'physics');
    expect(max).toBe(5);
  });

  it('maxCurriculumDay returns 0 for unknown subject', async () => {
    const max = await repoModule.maxCurriculumDay('postutme', 'biology');
    expect(max).toBe(0);
  });

  it('listSubjects returns unique subjects', async () => {
    const subjects = await repoModule.listSubjects('postutme');
    expect(subjects).toContain('physics');
    expect(subjects).toContain('chemistry');
    expect(subjects).toContain('economics');
  });

  it('listCurriculum returns sorted days', async () => {
    const days = await repoModule.listCurriculum('postutme', 'physics');
    expect(days.length).toBe(5);
    expect(days[0].day_number).toBe(1);
    expect(days[4].day_number).toBe(5);
  });

  it('upsertCurriculum adds new rows', async () => {
    const rows = [
      { department: 'postutme', subject: 'biology', day_number: 1, topic: 'Cells', outline: 'Cell structure and function.' },
    ];
    const count = await repoModule.upsertCurriculum(rows);
    expect(count).toBe(1);
    const day = await repoModule.getCurriculumDay('postutme', 'biology', 1);
    expect(day).not.toBeNull();
    expect(day!.topic).toBe('Cells');
  });

  it('upsertCurriculum updates existing rows', async () => {
    const rows = [
      { department: 'postutme', subject: 'physics', day_number: 1, topic: 'Updated Topic', outline: 'Updated outline.' },
    ];
    await repoModule.upsertCurriculum(rows);
    const day = await repoModule.getCurriculumDay('postutme', 'physics', 1);
    expect(day!.topic).toBe('Updated Topic');
    const all = await repoModule.listCurriculum('postutme', 'physics');
    expect(all.length).toBe(5);
  });
});

describe('repository — progress', () => {
  beforeEach(async () => {
    await setupTestRepo();
  });

  afterAll(() => {
    teardownTestRepo();
  });

  it('createProgress creates a new progress row at day 1', async () => {
    const p = await repoModule.createProgress({ student_id: 'stu_demo', subject: 'physics' });
    expect(p.current_day_level).toBe(1);
    expect(p.missed_days_count).toBe(0);
    expect(p.last_login_timestamp).toBeNull();
    expect(p.latest_assignment_score).toBeNull();
  });

  it('getProgress returns null for unknown combo', async () => {
    const p = await repoModule.getProgress('nonexistent', 'physics');
    expect(p).toBeNull();
  });

  it('getProgress returns created progress', async () => {
    const created = await repoModule.createProgress({ student_id: 'stu_demo', subject: 'chemistry' });
    const found = await repoModule.getProgress('stu_demo', 'chemistry');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
  });

  it('saveProgress updates fields correctly', async () => {
    const p = await repoModule.createProgress({ student_id: 'stu_demo', subject: 'economics' });
    p.current_day_level = 3;
    p.missed_days_count = 2;
    p.latest_assignment_score = 7;
    p.last_login_timestamp = new Date().toISOString();
    await repoModule.saveProgress(p);
    const found = await repoModule.getProgress('stu_demo', 'economics');
    expect(found!.current_day_level).toBe(3);
    expect(found!.missed_days_count).toBe(2);
    expect(found!.latest_assignment_score).toBe(7);
  });
});

describe('repository — messages', () => {
  beforeEach(async () => {
    await setupTestRepo();
  });

  afterAll(() => {
    teardownTestRepo();
  });

  it('addMessage stores and returns the message', async () => {
    const msg = await repoModule.addMessage({
      student_id: 'stu_demo',
      subject: 'physics',
      role: 'user',
      content: 'Hello tutor',
      day_level: 1,
      visible: true,
    });
    expect(msg.id).toBeGreaterThan(0);
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello tutor');
  });

  it('getRecentMessages respects limit', async () => {
    for (let i = 0; i < 10; i++) {
      await repoModule.addMessage({
        student_id: 'stu_demo',
        subject: 'physics',
        role: 'user',
        content: `Message ${i}`,
        day_level: 1,
      });
    }
    const recent = await repoModule.getRecentMessages('stu_demo', 'physics', 3);
    expect(recent.length).toBe(3);
    expect(recent[0].content).toBe('Message 7');
    expect(recent[2].content).toBe('Message 9');
  });

  it('getVisibleHistory excludes invisible messages', async () => {
    await repoModule.addMessage({
      student_id: 'stu_demo', subject: 'physics', role: 'user',
      content: 'visible 1', day_level: 1, visible: true,
    });
    await repoModule.addMessage({
      student_id: 'stu_demo', subject: 'physics', role: 'assistant',
      content: 'invisible', day_level: 1, visible: false,
    });
    await repoModule.addMessage({
      student_id: 'stu_demo', subject: 'physics', role: 'user',
      content: 'visible 2', day_level: 1, visible: true,
    });
    const history = await repoModule.getVisibleHistory('stu_demo', 'physics');
    expect(history.length).toBe(2);
    expect(history.every((m) => m.visible)).toBe(true);
  });
});

describe('repository — announcements', () => {
  beforeEach(async () => {
    await setupTestRepo();
  });

  afterAll(() => {
    teardownTestRepo();
  });

  it('getActiveAnnouncement returns seed announcement', async () => {
    const a = await repoModule.getActiveAnnouncement();
    expect(a).not.toBeNull();
    expect(a!.active).toBe(true);
    expect(a!.message).toContain('Grand Mock CBT');
  });

  it('setAnnouncement deactivates old and creates new', async () => {
    const first = await repoModule.getActiveAnnouncement();
    expect(first).not.toBeNull();

    const second = await repoModule.setAnnouncement('New announcement', 'https://example.com');
    expect(second.message).toBe('New announcement');
    expect(second.link).toBe('https://example.com');
    expect(second.active).toBe(true);

    // Old announcement should now be inactive
    // (We can't query by id directly, but getActiveAnnouncement should return the new one)
    const active = await repoModule.getActiveAnnouncement();
    expect(active!.id).toBe(second.id);
  });

  it('setAnnouncement works without a link', async () => {
    const a = await repoModule.setAnnouncement('Just a message');
    expect(a.message).toBe('Just a message');
    expect(a.link).toBeNull();
  });
});

describe('repository — group class stubs throw', () => {
  beforeEach(async () => {
    await setupTestRepo();
  });

  afterAll(() => {
    teardownTestRepo();
  });

  const groupClassMethods = [
    () => repoModule.getTodayLesson('physics', 'science', '2026-06-15'),
    () => repoModule.getLastLesson('physics', 'science'),
    () => repoModule.saveDailyLesson({} as any),
    () => repoModule.getLessonStatus('2026-06-15'),
    () => repoModule.saveQuestion({} as any),
    () => repoModule.resetAllLessons(),
    () => repoModule.resetSubjectLessons('physics', 'science'),
  ] as const;

  for (const method of groupClassMethods) {
    it(`throws for group class method`, async () => {
      await expect(method()).rejects.toThrow('Group class requires TUTOR_STORE=supabase');
    });
  }
});

describe('repository — reseed', () => {
  beforeEach(async () => {
    await setupTestRepo();
  });

  afterAll(() => {
    teardownTestRepo();
  });

  it('reseed resets the database', async () => {
    await repoModule.createStudent({ full_name: 'Should disappear', department: 'science' });
    const before = await repoModule.listStudents();
    expect(before.length).toBeGreaterThan(1);

    await repoModule.reseed();
    const after = await repoModule.listStudents();
    expect(after.length).toBe(1); // only the demo student
    expect(after[0].id).toBe('stu_demo');
  });
});
