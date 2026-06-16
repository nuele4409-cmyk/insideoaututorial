'use strict';

const $ = (id) => document.getElementById(id);

const state = {
  student: null,
  subjects: [],   // [{ subject, label, days, department }]
  subject: null,
  subjectDept: 'general',
  track: 'science',
  busy: false,
  token: null,
  isAdmin: false,
  gradeType: 'classwork',   // active tab in grade modal
};

const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

//  API helper 
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch(path, { headers, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

//  Session persistence 
const SESSION_KEY = 'oau_tutor_session';

function saveSession(data) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      token: data.token,
      studentId: data.studentId,
      full_name: data.full_name,
      isAdmin: !!data.isAdmin,
      university: data.university ?? null,
      track: data.track,
      subjects: data.subjects,
    }));
  } catch {}
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

function logout() {
  clearSession();
  location.reload();
}

//  Boot 
async function init() {
  try {
    const health = await api('/api/health');
    setMode(health.tutor, health.model);
  } catch {
    setMode(null);
  }
  wireEvents();

  // Try to restore a previously saved session
  let savedToken = null;
  try { savedToken = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}')?.token; } catch {}

  if (savedToken) {
    state.token = savedToken; // set so api() sends Authorization header
    try {
      const data = await api('/api/auth/restore');
      // Token still valid  enter without showing login
      $('loginOverlay').classList.add('hidden');
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      await enterAsStudent(data);
    } catch {
      // Expired or invalid  clear and stay on login screen
      state.token = null;
      clearSession();
    }
  }
}

function setMode(tutor, model) {
  const b = $('modeBadge');
  if (tutor === 'claude') {
    b.textContent = ` Claude  ${model}`;
    b.className = 'badge badge-live';
  } else if (tutor === 'gemini') {
    b.textContent = ` Gemini  ${model}`;
    b.className = 'badge badge-gemini';
  } else if (tutor === 'offline-stub') {
    b.textContent = ' Offline stub';
    b.className = 'badge badge-stub';
  } else {
    b.textContent = ' Server offline';
    b.className = 'badge badge-muted';
  }
}

//  Subject selection 
function renderSubjects() {
  const sel = $('subjectSelect');
  sel.innerHTML = '';
  state.subjects.forEach((s) => {
    const o = document.createElement('option');
    o.value = s.subject;
    o.textContent = s.label;
    o.disabled = !s.days;
    sel.appendChild(o);
  });
  const ready = state.subjects.find((s) => s.days > 0) || state.subjects[0];
  if (ready) {
    state.subject = ready.subject;
    state.subjectDept = ready.department || 'general';
    sel.value = ready.subject;
  } else {
    state.subject = null;
    state.subjectDept = 'general';
  }
}

async function selectSubject(subject) {
  const meta = state.subjects.find((s) => s.subject === subject);
  state.subject = subject;
  state.subjectDept = meta?.department || 'general';
  // Clear all seen keys for this subject so switching back always re-checks
  for (let d = 0; d <= 365; d++) sessionStorage.removeItem(revealKey(d));
  await loadClassroom();
}

//  Reveal key for sessionStorage — keyed by day number so each new lesson always animates fresh
function revealKey(dayNumber) {
  return `lesson_seen_${state.subject}_day${dayNumber || 0}`;
}

//  Classroom loader 
async function loadClassroom() {
  if (!state.student || !state.subject) return;

  // Cancel any pending no-lesson poll so it doesn't re-trigger during animation
  if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null; }

  showClassroomBanner('Loading today\'s class', 'muted');
  $('noLesson').classList.add('hidden');
  $('lessonView').classList.add('hidden');

  try {
    const { lesson } = await api(
      `/api/lessons/today?subject=${encodeURIComponent(state.subject)}&department=${encodeURIComponent(state.subjectDept)}`,
    );

    if (!lesson) {
      // Check for a lesson that is scheduled but not yet live
      try {
        const { lesson: scheduled } = await api(
          `/api/lessons/next-scheduled?subject=${encodeURIComponent(state.subject)}&department=${encodeURIComponent(state.subjectDept)}`,
        );
        if (scheduled?.goes_live_at) {
          hideBanner();
          startScheduledCountdown(scheduled.goes_live_at, state.subject, state.subjectDept);
          return;
        }
      } catch {}
      hideBanner();
      showNoLesson();
      resetStatus();
      return;
    }

    updateStatus({ day: lesson.day_number, topic: lesson.topic });

    // Fetch both classwork and assignment submissions in parallel
    const [classworkRes, assignmentRes] = await Promise.all([
      api(`/api/classwork/mine?subject=${encodeURIComponent(state.subject)}`),
      api(`/api/submissions/mine?subject=${encodeURIComponent(state.subject)}`),
    ]);
    const classworkSub = classworkRes.submission ?? null;
    const assignmentSub = assignmentRes.submission ?? null;

    // If any submission exists, consider lesson already seen
    const alreadySeen = !!sessionStorage.getItem(revealKey(lesson.day_number)) || !!classworkSub || !!assignmentSub;

    hideBanner();
    $('lessonView').classList.remove('hidden');

    // Reset all section cards
    resetLessonCards();

    // Reveal lesson content
    await revealLesson(lesson, alreadySeen);

    // Classwork card
    await sleep(alreadySeen ? 0 : 1500);
    showClassworkCard(lesson);
    renderClassworkState(classworkSub);

    // Assignment card
    await sleep(alreadySeen ? 0 : 600);
    showAssignmentCard(lesson);
    renderAssignmentState(assignmentSub);

    showQuestionSection();

    if (assignmentSub?.score !== null && assignmentSub?.score !== undefined) {
      updateStatus({ score: assignmentSub.score, submitted: true });
    } else if (assignmentSub) {
      updateStatus({ submitted: true });
    }

  } catch (e) {
    showClassroomBanner(e.message, 'error');
    showNoLesson();
  }
}

function resetLessonCards() {
  [
    'classworkCard', 'classworkSubmitSection', 'classworkAwaitingSection', 'classworkGradeSection',
    'assignmentCard', 'submitSection', 'awaitingSection', 'gradeSection', 'questionSection',
  ].forEach((id) => $(id).classList.add('hidden'));
}

//  Section parser 
function parseSections(content) {
  const result = [];
  const parts = String(content).split(/(?=##\s+(?:SECTION|CHECK)\s+\d)/i);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const secMatch = trimmed.match(/^##\s+SECTION\s+(\d+)\s*([\s\S]*)/i);
    const chkMatch = trimmed.match(/^##\s+CHECK\s+(\d+)\s*([\s\S]*)/i);
    if (secMatch) {
      const num = parseInt(secMatch[1], 10);
      const paragraphs = secMatch[2].trim()
        .split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
      result.push({ type: 'section', num, paragraphs });
    } else if (chkMatch) {
      const num = parseInt(chkMatch[1], 10);
      result.push({ type: 'check', num, text: chkMatch[2].trim() });
    }
  }
  // Fallback: if no section markers found, treat entire content as one block
  if (!result.length) {
    const paragraphs = String(content).split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
    result.push({ type: 'section', num: 1, paragraphs });
  }
  return result;
}

//  Lesson reveal 
async function revealLesson(lesson, instant) {
  $('lessonDayTag').textContent = `Day ${lesson.day_number}`;
  $('lessonTopic').textContent = lesson.topic;

  const body = $('lessonBody');
  body.innerHTML = '';

  const blocks = parseSections(lesson.lesson_content_html || lesson.lesson_content);

  const classroom = body.closest('.classroom') || body.parentElement;

  if (instant) {
    for (const block of blocks) {
      if (block.type === 'section') {
        block.paragraphs.forEach((p) => appendPara(body, p, false));
      } else if (block.type === 'check') {
        appendCheckGate(body, block.text);
      }
    }
    return;
  }

  // Animated: mark as seen immediately so refresh  instant
  sessionStorage.setItem(revealKey(lesson.day_number), '1');

  for (const block of blocks) {
    if (block.type === 'section') {
      for (let i = 0; i < block.paragraphs.length; i++) {
        // First paragraph of first section gets a short intro delay; all others 25 seconds
        const delay = (block.num === 1 && i === 0) ? 1000 : 25000;
        await sleep(delay);
        appendPara(body, block.paragraphs[i], true);
        // Scroll the classroom container to the bottom to reveal new paragraph
        if (classroom) classroom.scrollTo({ top: classroom.scrollHeight, behavior: 'smooth' });
      }
    } else if (block.type === 'check') {
      await sleep(1500);
      await showCheckpointGate(body, block.text);
      await sleep(500);
    }
  }
}

//  Paragraph helpers 
function appendPara(container, text, animate) {
  const p = document.createElement('p');
  if (/^key takeaway:/i.test(text)) p.className = 'lesson-takeaway';
  if (animate) p.classList.add('para-reveal');
  p.innerHTML = text;
  container.appendChild(p);
}

//  Checkpoint gates 
function showCheckpointGate(container, question) {
  return new Promise((resolve) => {
    const gate = document.createElement('div');
    gate.className = 'checkpoint-gate card-reveal';
    gate.innerHTML =
      '<div class="checkpoint-icon"></div>' +
      '<div class="checkpoint-question">' + question + '</div>' +
      '<p class="checkpoint-hint">Write your answer in your notebook. Take your time  click when you are ready.</p>' +
      '<button class="btn btn-accent checkpoint-btn">I\'ve answered  continue</button>';
    const btn = gate.querySelector('.checkpoint-btn');
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = ' Answered';
      gate.classList.add('checkpoint-done');
      resolve();
    });
    container.appendChild(gate);
    gate.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

function appendCheckGate(container, question) {
  const gate = document.createElement('div');
  gate.className = 'checkpoint-gate checkpoint-done';
  gate.innerHTML =
    '<div class="checkpoint-icon"></div>' +
    '<div class="checkpoint-question">' + question + '</div>' +
    '<p class="checkpoint-hint">Write your answer in your notebook. Take your time  click when you are ready.</p>' +
    '<button class="btn btn-secondary checkpoint-btn" disabled> Answered</button>';
  container.appendChild(gate);
}

//  Classwork card 
function showClassworkCard(lesson) {
  const raw = lesson.classwork_prompt || '';
  const visible = raw.replace(/\[Rubric:[\s\S]*?\]/gi, '').trim();
  $('classworkText').textContent = visible || 'Answer the classwork question your teacher provides.';
  $('classworkCard').classList.remove('hidden');
  $('classworkCard').classList.add('card-reveal');
}

function renderClassworkState(sub) {
  if (!sub) {
    showClassworkSubmitForm();
    return;
  }
  if (sub.score !== null && sub.score !== undefined) {
    showClassworkGrade(sub.score, sub.feedback);
  } else {
    showClassworkAwaiting();
  }
}

function showClassworkSubmitForm() {
  setTimeout(() => {
    $('classworkSubmitSection').classList.remove('hidden');
    $('classworkSubmitSection').classList.add('card-reveal');
    $('classworkAwaitingSection').classList.add('hidden');
    $('classworkGradeSection').classList.add('hidden');
    $('classworkInput').value = '';
  }, 400);
}

function showClassworkAwaiting() {
  $('classworkSubmitSection').classList.add('hidden');
  $('classworkAwaitingSection').classList.remove('hidden');
  $('classworkGradeSection').classList.add('hidden');
}

function showClassworkGrade(score, feedback) {
  $('classworkSubmitSection').classList.add('hidden');
  $('classworkAwaitingSection').classList.add('hidden');
  $('classworkGradeSection').classList.remove('hidden');
  $('classworkGradeNumber').textContent = score;
  $('classworkGradeFeedback').textContent = feedback || '';
  const pct = Math.round((score / 10) * 100);
  const bar = $('classworkGradeBar');
  bar.style.width = pct + '%';
  bar.className = 'grade-bar ' + (score >= 7 ? 'grade-bar-good' : score >= 5 ? 'grade-bar-ok' : 'grade-bar-weak');
}

//  Assignment card 
function showAssignmentCard(lesson) {
  const raw = lesson.assignment_prompt || '';
  const visible = raw.replace(/\[Rubric:[\s\S]*?\]/gi, '').trim();
  $('assignmentText').textContent = visible || 'Complete the assignment your teacher has set.';
  $('assignmentCard').classList.remove('hidden');
  $('assignmentCard').classList.add('card-reveal');
}

function renderAssignmentState(sub) {
  if (!sub) {
    showSubmitForm();
    return;
  }
  if (sub.score !== null && sub.score !== undefined) {
    showGrade(sub.score, sub.feedback);
  } else {
    showAwaiting();
  }
}

function showSubmitForm() {
  setTimeout(() => {
    $('submitSection').classList.remove('hidden');
    $('submitSection').classList.add('card-reveal');
    $('awaitingSection').classList.add('hidden');
    $('gradeSection').classList.add('hidden');
    $('answerInput').value = '';
  }, 500);
}

function showAwaiting() {
  $('submitSection').classList.add('hidden');
  $('awaitingSection').classList.remove('hidden');
  $('gradeSection').classList.add('hidden');
  updateStatus({ submitted: true });
}

function showGrade(score, feedback) {
  $('submitSection').classList.add('hidden');
  $('awaitingSection').classList.add('hidden');
  $('gradeSection').classList.remove('hidden');
  $('gradeNumber').textContent = score;
  $('gradeFeedback').textContent = feedback || '';
  const pct = Math.round((score / 10) * 100);
  const bar = $('gradeBar');
  bar.style.width = pct + '%';
  bar.className = 'grade-bar ' + (score >= 7 ? 'grade-bar-good' : score >= 5 ? 'grade-bar-ok' : 'grade-bar-weak');
  updateStatus({ score, submitted: true });
}

function showQuestionSection() {
  setTimeout(() => {
    $('questionSection').classList.remove('hidden');
    $('questionSection').classList.add('card-reveal');
  }, 1000);
}

let _pollTimer = null;

function showNoLesson() {
  if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
  // Auto-poll every 45s so students see the class appear without refreshing
  if (_pollTimer) clearTimeout(_pollTimer);
  _pollTimer = setTimeout(() => { _pollTimer = null; if (state.subject && !_countdownTimer) loadClassroom(); }, 45_000);
  const p = $('noLesson').querySelector('p');
  if (p) p.textContent = `Today's ${cap(state.subject || 'class')} lesson hasn't been opened yet. Check back soon.`;
  $('noLesson').classList.remove('hidden');
  $('lessonView').classList.add('hidden');
}

//  Scheduled-class countdown
let _countdownTimer = null;

function startScheduledCountdown(goesLiveAt, subject, dept) {
  if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }

  const target = new Date(goesLiveAt).getTime();
  const noLessonEl = $('noLesson');
  const p = noLessonEl.querySelector('p');
  noLessonEl.classList.remove('hidden');
  $('lessonView').classList.add('hidden');

  function tick() {
    const diff = target - Date.now();
    if (diff <= 0) {
      clearInterval(_countdownTimer);
      _countdownTimer = null;
      if (p) p.textContent = `${cap(subject || 'class')} class is starting`;
      loadClassroom();
      return;
    }
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    const s = Math.floor((diff % 60_000) / 1_000);
    const parts = [];
    if (h) parts.push(`${h}h`);
    if (h || m) parts.push(`${m}m`);
    parts.push(`${s}s`);
    if (p) p.innerHTML =
      `${cap(subject || 'class')} class is coming up.<br>` +
      `<span style="font-size:1.8em;font-weight:700;color:var(--accent);letter-spacing:.04em">${parts.join(' ')}</span><br>` +
      `<small style="color:var(--muted)">The lesson will open automatically when the time arrives.</small>`;
  }

  tick();
  _countdownTimer = setInterval(tick, 1000);
}

//  File attachment  classwork 
let classworkAttachedFile = null;

function wireClassworkFile() {
  const input = $('classworkFile');
  if (!input) return;
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showClassroomBanner('File too large  maximum 10 MB.', 'warn');
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      classworkAttachedFile = { name: file.name, dataUrl: e.target.result };
      $('classworkAttachName').textContent = file.name;
      $('classworkAttachClear').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  });
  $('classworkAttachClear').addEventListener('click', () => {
    classworkAttachedFile = null;
    input.value = '';
    $('classworkAttachName').textContent = '';
    $('classworkAttachClear').classList.add('hidden');
  });
}

//  Submit classwork 
async function submitClasswork() {
  if (state.busy || !state.student || !state.subject) return;
  const text = $('classworkInput').value.trim();
  if (!text && !classworkAttachedFile) {
    showClassroomBanner('Write your classwork answer or attach a file before submitting.', 'warn');
    return;
  }

  const btn = $('classworkSubmitBtn');
  setBusy(true);
  btn.disabled = true;
  btn.textContent = 'Submitting';
  showClassroomBanner('Uploading', 'muted');

  try {
    let fileUrl = null;
    if (classworkAttachedFile) {
      showClassroomBanner('Uploading file', 'muted');
      const up = await api('/api/submissions/upload-file', {
        method: 'POST',
        body: JSON.stringify({ dataUrl: classworkAttachedFile.dataUrl, filename: classworkAttachedFile.name }),
      });
      fileUrl = up.filePath;
    }

    showClassroomBanner('Submitting classwork', 'muted');
    await api('/api/classwork', {
      method: 'POST',
      body: JSON.stringify({
        studentId: state.student.id,
        subject: state.subject,
        department: state.subjectDept,
        text,
        fileUrl,
      }),
    });

    classworkAttachedFile = null;
    if ($('classworkFile')) $('classworkFile').value = '';
    $('classworkAttachName').textContent = '';
    $('classworkAttachClear').classList.add('hidden');

    showClassworkAwaiting();
    showClassroomBanner('Classwork submitted! Your teacher will grade it soon.', 'success');
  } catch (e) {
    showClassroomBanner(e.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Submit Classwork';
  } finally {
    setBusy(false);
  }
}

async function refreshClassworkGrade() {
  if (!state.student || !state.subject) return;
  try {
    const { submission } = await api(
      `/api/classwork/mine?subject=${encodeURIComponent(state.subject)}`,
    );
    if (submission?.score !== null && submission?.score !== undefined) {
      showClassworkGrade(submission.score, submission.feedback);
      hideBanner();
    } else {
      showClassroomBanner('Not graded yet  check back soon.', 'muted');
    }
  } catch (e) {
    showClassroomBanner(e.message, 'error');
  }
}

//  File attachment  assignment 
let attachedFile = null;

function wireAnswerFile() {
  const input = $('answerFile');
  if (!input) return;
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showClassroomBanner('File too large  maximum 10 MB.', 'warn');
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      attachedFile = { name: file.name, dataUrl: e.target.result };
      $('attachName').textContent = file.name;
      $('attachClear').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  });
  $('attachClear').addEventListener('click', () => {
    attachedFile = null;
    input.value = '';
    $('attachName').textContent = '';
    $('attachClear').classList.add('hidden');
  });
}

//  Submit assignment 
async function submitAnswer() {
  if (state.busy || !state.student || !state.subject) return;
  const text = $('answerInput').value.trim();
  if (!text && !attachedFile) {
    showClassroomBanner('Write your answer or attach a file before submitting.', 'warn');
    return;
  }

  setBusy(true);
  showClassroomBanner('Uploading', 'muted');

  try {
    let fileUrl = null;
    if (attachedFile) {
      showClassroomBanner('Uploading file', 'muted');
      const up = await api('/api/submissions/upload-file', {
        method: 'POST',
        body: JSON.stringify({ dataUrl: attachedFile.dataUrl, filename: attachedFile.name }),
      });
      fileUrl = up.filePath;
    }

    showClassroomBanner('Submitting assignment', 'muted');
    const result = await api('/api/submissions', {
      method: 'POST',
      body: JSON.stringify({
        studentId: state.student.id,
        subject: state.subject,
        department: state.subjectDept,
        text,
        fileUrl,
      }),
    });

    attachedFile = null;
    if ($('answerFile')) $('answerFile').value = '';
    $('attachName').textContent = '';
    $('attachClear').classList.add('hidden');

    if (result.graded && result.score !== null) {
      showGrade(result.score, result.feedback);
      hideBanner();
    } else {
      showAwaiting();
      showClassroomBanner('Assignment submitted! Your teacher will grade it soon.', 'success');
    }
  } catch (e) {
    showClassroomBanner(e.message, 'error');
  } finally {
    setBusy(false);
  }
}

async function refreshGrade() {
  if (!state.student || !state.subject) return;
  try {
    const { submission } = await api(
      `/api/submissions/mine?subject=${encodeURIComponent(state.subject)}`,
    );
    if (submission?.score !== null && submission?.score !== undefined) {
      showGrade(submission.score, submission.feedback);
      hideBanner();
    } else {
      showClassroomBanner('Not graded yet  check back soon.', 'muted');
    }
  } catch (e) {
    showClassroomBanner(e.message, 'error');
  }
}

//  Question submission 
let questionFile = null;

function wireQuestionFile() {
  const input = $('questionFile');
  if (!input) return;
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showClassroomBanner('File too large  maximum 10 MB.', 'warn');
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      questionFile = { name: file.name, dataUrl: e.target.result };
      $('questionAttachName').textContent = file.name;
      $('questionAttachClear').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  });
  $('questionAttachClear').addEventListener('click', () => {
    questionFile = null;
    input.value = '';
    $('questionAttachName').textContent = '';
    $('questionAttachClear').classList.add('hidden');
  });
}

async function submitQuestion() {
  if (!state.student || !state.subject) return;
  const text = $('questionInput').value.trim();
  if (!text && !questionFile) {
    showClassroomBanner('Type your question or attach a file first.', 'warn');
    return;
  }

  const btn = $('submitQuestionBtn');
  btn.disabled = true;
  btn.textContent = 'Sending';

  try {
    let fileUrl = null;
    if (questionFile) {
      const up = await api('/api/submissions/upload-file', {
        method: 'POST',
        body: JSON.stringify({ dataUrl: questionFile.dataUrl, filename: questionFile.name }),
      });
      fileUrl = up.filePath;
    }

    await api('/api/questions', {
      method: 'POST',
      body: JSON.stringify({
        studentId: state.student.id,
        subject: state.subject,
        department: state.subjectDept,
        questionText: text,
        fileUrl,
      }),
    });

    $('questionInput').value = '';
    questionFile = null;
    if ($('questionFile')) $('questionFile').value = '';
    $('questionAttachName').textContent = '';
    $('questionAttachClear').classList.add('hidden');
    $('questionSubmittedMsg').classList.remove('hidden');
    btn.textContent = ' Sent';
  } catch (e) {
    showClassroomBanner(e.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Send Question';
  }
}

//  Status bar 
function updateStatus({ day, topic, score, submitted } = {}) {
  if (day !== undefined) $('statDay').textContent = String(day);
  if (topic !== undefined) $('statTopic').textContent = topic;
  if (score !== undefined && score !== null) $('statScore').textContent = `${score}/10`;
  if (submitted !== undefined) $('statSubmitted').textContent = submitted ? 'Yes ' : 'No';
}

function resetStatus() {
  $('statDay').textContent = '—';
  $('statTopic').textContent = '—';
  $('statScore').textContent = '—';
  $('statSubmitted').textContent = '—';
}

function setBusy(b) {
  state.busy = b;
  if ($('submitBtn')) $('submitBtn').disabled = b;
  if ($('classworkSubmitBtn')) $('classworkSubmitBtn').disabled = b;
}

//  Banner 
function showClassroomBanner(text, kind) {
  const b = $('classroomBanner');
  b.textContent = text;
  b.className = `banner banner-${kind || 'muted'}`;
}
function hideBanner() {
  $('classroomBanner').className = 'banner hidden';
}

//  Student load helpers 
async function loadStudents(selectId) {
  const students = await api('/api/students');
  const sel = $('studentSelect');
  sel.innerHTML = '';
  students.forEach((s) => {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = `${s.full_name}  ${s.department}`;
    sel.appendChild(o);
  });
  const chosenId = selectId || students[0]?.id;
  if (chosenId) {
    sel.value = chosenId;
    await selectDemoStudent(chosenId);
  }
}

async function selectDemoStudent(id) {
  const data = await api(`/api/students/${id}`);
  state.student = data.student;
  state.track = data.student.department === 'Commercial' ? 'arts_commercial' : 'science';
  state.subjects = data.subjects.map((s) => ({
    subject: s.subject,
    label: cap(s.subject),
    days: s.days,
    department: getDeptForSubject(s.subject, state.track),
  }));
  renderSubjects();
  await loadClassroom();
}

function getDeptForSubject(subject, track) {
  if (subject === 'english') return 'general';
  const sciOnly = ['physics', 'chemistry', 'biology', 'further_maths'];
  const artsOnly = ['government', 'economics', 'literature', 'commerce', 'accounting', 'crs', 'irs', 'history', 'agric'];
  if (sciOnly.includes(subject)) return 'science';
  if (artsOnly.includes(subject)) return 'arts_commercial';
  return track;
}

async function createStudent() {
  const name = $('newStudentName').value.trim();
  const dept = $('newStudentDept').value;
  if (!name) return;
  try {
    const s = await api('/api/students', {
      method: 'POST',
      body: JSON.stringify({ full_name: name, department: dept }),
    });
    $('newStudentName').value = '';
    $('newStudentForm').classList.add('hidden');
    await loadStudents(s.id);
  } catch (e) {
    showClassroomBanner(e.message, 'error');
  }
}

//  Login 
async function doLogin() {
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  const err = $('loginError');
  err.textContent = '';
  if (!email || !password) { err.textContent = 'Enter your email and password.'; return; }

  const btn = $('loginBtn');
  btn.disabled = true; btn.textContent = 'Signing in';
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    $('loginOverlay').classList.add('hidden');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    await enterAsStudent(data);
  } catch (e) {
    err.textContent = e.message || 'Sign in failed.';
  } finally {
    btn.disabled = false; btn.textContent = 'Sign in';
  }
}

async function enterAsStudent(data) {
  state.token = data.token || null;
  state.isAdmin = !!data.isAdmin;
  state.track = data.track || 'science';
  state.student = { id: data.studentId, full_name: data.full_name, department: state.track };

  // Persist session so next load skips login
  saveSession(data);

  const sel = $('studentSelect');
  sel.innerHTML = '';
  const o = document.createElement('option');
  o.value = data.studentId;
  o.textContent = `${data.studentId}  ${data.full_name}`;
  sel.appendChild(o);
  sel.value = data.studentId;
  const toggle = $('newStudentToggle');
  if (toggle) toggle.style.display = 'none';

  state.subjects = (data.subjects || []).map((s) => ({
    subject: s.key,
    label: s.label,
    days: s.days,
    department: s.department || getDeptForSubject(s.key, state.track),
  }));
  renderSubjects();

  if (state.isAdmin) {
    $('adminOutlinesBtn').hidden = false;
    $('adminClassBtn').hidden = false;
    $('adminGradeBtn').hidden = false;
    $('adminQuestionsBtn').hidden = false;
    $('adminPasswordBtn').hidden = false;
    $('adminResetBtn').hidden = false;
  }

  // Show logout button for all logged-in users
  $('logoutBtn').hidden = false;

  await loadClassroom();
  await loadEvents();
}


//  Upcoming events 
async function loadEvents() {
  const link = $('announceLink');
  try {
    const { events } = await api('/api/events');
    if (events && events.length) {
      const e = events[0];
      const when = new Date(e.scheduled_at);
      const dateStr = when.toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
      const uni = e.university && String(e.university).toUpperCase() !== 'ALL'
        ? '  ' + escapeHtml(e.university) : '';
      $('announceText').innerHTML =
        '<strong>' + escapeHtml(e.title) + '</strong><br>' + escapeHtml(dateStr) + uni +
        (e.description ? '<br><span style="color:var(--dim)">' + escapeHtml(e.description) + '</span>' : '');
      link.href = e.link;
      link.textContent = 'Join event ';
      link.hidden = false;
    } else {
      $('announceText').textContent = 'No upcoming mocks scheduled yet.';
      link.hidden = true;
    }
  } catch {
    $('announceText').textContent = 'Could not load events.';
    link.hidden = true;
  }
}

//  Admin: Open Class modal 
async function openClassModal() {
  $('classModalMsg').textContent = '';
  $('classSubjectList').innerHTML = '<p style="color:var(--muted)">Loading status</p>';
  $('classModal').classList.remove('hidden');

  try {
    const { tracks } = await api('/api/lessons/status');
    renderClassByTrack(tracks);
  } catch (e) {
    $('classSubjectList').innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
  }
}

function renderClassByTrack(tracks) {
  const list = $('classSubjectList');
  list.innerHTML = '';

  tracks.forEach((track) => {
    if (!track.subjects.length) return;

    const header = document.createElement('div');
    header.className = 'track-header';
    header.textContent = track.label;
    list.appendChild(header);

    track.subjects.forEach((s) => {
      const row = document.createElement('div');
      row.className = 'class-subject-row';

      const info = document.createElement('div');
      info.className = 'class-subject-info';

      const name = document.createElement('strong');
      name.textContent = s.label || cap(s.subject);
      info.appendChild(name);

      const meta = document.createElement('span');
      meta.className = 'class-subject-meta';
      if (s.day_number && s.goes_live_at && new Date(s.goes_live_at) > new Date()) {
        meta.textContent = `Day ${s.day_number}  ${s.topic}  Scheduled: ${new Date(s.goes_live_at).toLocaleString()}`;
      } else if (s.day_number) {
        meta.textContent = `Day ${s.day_number}  ${s.topic}  ${s.submitted ?? 0} submitted, ${s.graded ?? 0} graded`;
      } else {
        meta.textContent = 'No class yet today';
      }
      info.appendChild(meta);

      // Next lesson from curriculum (shows that CSV is loaded)
      if (s.nextTopic) {
        const next = document.createElement('span');
        next.className = 'class-subject-next';
        next.textContent = ` Next: Day ${s.nextDay}  ${s.nextTopic}`;
        info.appendChild(next);
      }

      const btnWrap = document.createElement('div');
      btnWrap.style.cssText = 'display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;';

      const btn = document.createElement('button');
      btn.className = s.day_number ? 'btn btn-secondary btn-sm' : 'btn btn-accent btn-sm';
      btn.textContent = s.day_number ? '⚡ Regenerate' : 'Generate';
      btn.addEventListener('click', () => generateLesson(s.subject, track.key, btn, meta));

      const demoBtn = document.createElement('button');
      demoBtn.className = 'btn btn-secondary btn-sm';
      demoBtn.textContent = '📅 Demo';
      demoBtn.title = 'Insert a demo lesson — no AI tokens used';
      demoBtn.addEventListener('click', () => seedDemoLesson(s.subject, track.key, demoBtn, meta));

      const clearDemoBtn = document.createElement('button');
      clearDemoBtn.className = 'btn btn-sm';
      clearDemoBtn.style.cssText = 'background:rgba(251,191,36,0.1);color:#fbbf24;border:1px solid rgba(251,191,36,0.25);';
      clearDemoBtn.textContent = '✕ Demo';
      clearDemoBtn.title = `Clear today's demo for ${s.label || s.subject} — safe, won't touch a real lesson`;
      clearDemoBtn.addEventListener('click', () => clearDemoLesson(s.subject, track.key, clearDemoBtn, meta, btn));

      const clearBtn = document.createElement('button');
      clearBtn.className = 'btn btn-sm';
      clearBtn.style.cssText = 'background:rgba(239,68,68,0.12);color:#f87171;border:1px solid rgba(239,68,68,0.25);';
      clearBtn.textContent = '🗑';
      clearBtn.title = `Clear ALL ${s.label || s.subject} lessons — resets to Day 1`;
      clearBtn.addEventListener('click', () => clearSubjectLessons(s.subject, track.key, clearBtn, meta, btn));

      const schedBtn = document.createElement('button');
      schedBtn.className = 'btn btn-secondary btn-sm';
      schedBtn.textContent = '🗓 Schedule';
      schedBtn.title = 'Generate lesson now, but set a future date/time for students to see it';
      schedBtn.addEventListener('click', () => openScheduleDialog(s.subject, track.key, meta, schedBtn));

      btnWrap.appendChild(btn);
      btnWrap.appendChild(schedBtn);
      btnWrap.appendChild(demoBtn);
      btnWrap.appendChild(clearDemoBtn);
      btnWrap.appendChild(clearBtn);
      row.appendChild(info);
      row.appendChild(btnWrap);
      list.appendChild(row);
    });
  });
}

async function generateLesson(subject, department, btn, metaEl) {
  btn.disabled = true;
  btn.textContent = 'Generating';
  $('classModalMsg').textContent = '';
  try {
    const { lesson, isNew } = await api('/api/lessons/generate', {
      method: 'POST',
      body: JSON.stringify({ subject, department }),
    });
    btn.textContent = ' Done';
    btn.className = 'btn btn-secondary btn-sm';
    metaEl.textContent = `Day ${lesson.day_number}  ${lesson.topic}  ${isNew ? 'just generated' : 'already open'}`;
    $('classModalMsg').textContent = ` "${lesson.topic}" is live for ${cap(subject)}.`;
    if (state.subject === subject && state.subjectDept === department) await loadClassroom();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Retry';
    $('classModalMsg').textContent = ' ' + e.message;
  }
}

async function seedDemoLesson(subject, department, btn, metaEl) {
  btn.disabled = true;
  btn.textContent = 'Seeding';
  $('classModalMsg').textContent = '';
  try {
    const { lesson } = await api('/api/lessons/seed-demo', {
      method: 'POST',
      body: JSON.stringify({ subject, department }),
    });
    btn.textContent = '✅ Done';
    metaEl.textContent = `Day ${lesson.day_number} — ${lesson.topic} — demo lesson`;
    $('classModalMsg').textContent = `📅 Demo lesson "${lesson.topic}" seeded for ${cap(subject)} — no tokens used.`;
    if (state.subject === subject && state.subjectDept === department) await loadClassroom();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '📅 Demo';
    $('classModalMsg').textContent = '⚠ ' + e.message;
  }
}

async function clearDemoLesson(subject, department, btn, metaEl, generateBtn) {
  btn.disabled = true;
  btn.textContent = '...';
  $('classModalMsg').textContent = '';
  try {
    await api('/api/admin/reset-demo', {
      method: 'DELETE',
      body: JSON.stringify({ subject, department }),
    });
    metaEl.textContent = 'No class yet today';
    generateBtn.className = 'btn btn-accent btn-sm';
    generateBtn.textContent = 'Generate';
    $('classModalMsg').textContent = `✅ Demo cleared for ${cap(subject)}. Click 📅 Demo or Generate to start fresh.`;
    if (state.subject === subject && state.subjectDept === department) await loadClassroom();
  } catch (e) {
    $('classModalMsg').textContent = '⚠ ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '✕ Demo';
  }
}

async function clearSubjectLessons(subject, department, clearBtn, metaEl, generateBtn) {
  const label = cap(subject);
  if (!confirm(`Clear all ${label} lessons?\n\nThis resets ${label} back to Day 1. The next Generate or Demo will start fresh.\n\nYour uploaded CSV outline is NOT affected.`)) return;
  clearBtn.disabled = true;
  clearBtn.textContent = '...';
  $('classModalMsg').textContent = '';
  try {
    const data = await api('/api/admin/reset-subject', {
      method: 'DELETE',
      body: JSON.stringify({ subject, department }),
    });
    metaEl.textContent = 'No class yet today';
    generateBtn.className = 'btn btn-accent btn-sm';
    generateBtn.textContent = 'Generate';
    $('classModalMsg').textContent = `✅ ${label} cleared (${data.deleted} lesson${data.deleted !== 1 ? 's' : ''} removed). Ready to start from Day 1.`;
    if (state.subject === subject && state.subjectDept === department) await loadClassroom();
  } catch (e) {
    $('classModalMsg').textContent = ' ' + e.message;
  } finally {
    clearBtn.disabled = false;
    clearBtn.textContent = '';
  }
}

function openScheduleDialog(subject, department, metaEl, schedBtn) {
  const msg = $('classModalMsg');
  const pad = (n) => String(n).padStart(2, '0');
  const def = new Date(Date.now() + 3_600_000);
  const defStr = `${def.getFullYear()}-${pad(def.getMonth()+1)}-${pad(def.getDate())}T${pad(def.getHours())}:${pad(def.getMinutes())}`;

  // Build form with DOM (no inline onclick)
  const wrap = document.createElement('div');
  wrap.style.cssText = 'background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.25);border-radius:8px;padding:12px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px;';

  const label = document.createElement('span');
  label.style.cssText = 'color:var(--muted);font-size:.85em;';
  label.textContent = 'Go live at (your local time):';

  const input = document.createElement('input');
  input.type = 'datetime-local';
  input.value = defStr;
  input.style.cssText = 'background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text);font-size:.9em;';

  const goBtn = document.createElement('button');
  goBtn.className = 'btn btn-accent btn-sm';
  goBtn.textContent = 'Generate & Schedule';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-sm';
  cancelBtn.style.color = 'var(--muted)';
  cancelBtn.textContent = 'Cancel';

  wrap.appendChild(label);
  wrap.appendChild(input);
  wrap.appendChild(goBtn);
  wrap.appendChild(cancelBtn);
  msg.innerHTML = '';
  msg.appendChild(wrap);

  cancelBtn.addEventListener('click', () => { msg.innerHTML = ''; });

  goBtn.addEventListener('click', async () => {
    if (!input.value) { msg.textContent = ' Please pick a date and time.'; return; }
    const goesLiveAt = new Date(input.value).toISOString();
    goBtn.disabled = true;
    cancelBtn.disabled = true;

    // Show elapsed time so the admin knows it's working (generation takes 1-3 min)
    const start = Date.now();
    let elapsedTimer = setInterval(() => {
      const secs = Math.floor((Date.now() - start) / 1000);
      const mm = String(Math.floor(secs / 60)).padStart(2, '0');
      const ss = String(secs % 60).padStart(2, '0');
      goBtn.textContent = `Generating ${mm}:${ss}`;
    }, 1000);
    goBtn.textContent = 'Generating 00:00';
    msg.textContent = ' Claude is writing the lesson  this takes 13 minutes. Please wait.';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 360_000); // 6-min hard limit

    try {
      const { lesson, isNew } = await api('/api/lessons/generate', {
        method: 'POST',
        body: JSON.stringify({ subject, department, goes_live_at: goesLiveAt }),
        signal: controller.signal,
      });
      const liveTimeStr = new Date(goesLiveAt).toLocaleString();
      if (isNew) {
        msg.textContent = ` "${lesson.topic}" scheduled  students will see it at ${liveTimeStr}.`;
        metaEl.textContent = `Day ${lesson.day_number}  ${lesson.topic}  Scheduled: ${liveTimeStr}`;
        if (schedBtn) { schedBtn.textContent = ' Rescheduled'; schedBtn.disabled = true; }
      } else {
        msg.textContent = ` A lesson already exists for today's ${cap(subject)} class. Remove it first if you want to reschedule.`;
        goBtn.disabled = false;
        cancelBtn.disabled = false;
        goBtn.textContent = 'Generate & Schedule';
      }
    } catch (e) {
      const errMsg = e.name === 'AbortError' ? 'Generation timed out  try again or check Railway logs.' : e.message;
      msg.textContent = ' ' + errMsg;
      goBtn.disabled = false;
      cancelBtn.disabled = false;
      goBtn.textContent = 'Generate & Schedule';
    } finally {
      clearInterval(elapsedTimer);
      clearTimeout(timeout);
    }
  });
}

//  Admin: Manual grading panel 
async function openGradeModal() {
  $('gradeModalMsg').textContent = '';
  $('gradeList').innerHTML = '<p style="color:var(--muted)">Loading subjects</p>';
  $('gradeModal').classList.remove('hidden');

  try {
    const { tracks } = await api('/api/lessons/status');
    const pick = $('gradeSubjectPick');
    pick.innerHTML = '';
    let added = 0;
    tracks.forEach((track) => {
      track.subjects.filter((s) => s.day_number).forEach((s) => {
        const o = document.createElement('option');
        o.value = s.subject;
        o.textContent = `${s.label || cap(s.subject)} (${track.label})  Day ${s.day_number}`;
        pick.appendChild(o);
        added++;
      });
    });
    if (!added) {
      $('gradeList').innerHTML = '<p style="color:var(--muted)">No classes open today.</p>';
      return;
    }
    $('gradeList').innerHTML = '<p style="color:var(--muted)">Select a subject and click Load.</p>';
  } catch (e) {
    $('gradeList').innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
  }
}

async function loadGradeSubmissions() {
  const subject = $('gradeSubjectPick').value;
  if (!subject) return;
  $('gradeList').innerHTML = '<p style="color:var(--muted)">Loading</p>';
  $('gradeModalMsg').textContent = '';
  try {
    const type = state.gradeType || 'classwork';
    const { submissions } = await api(
      `/api/admin/submissions?subject=${encodeURIComponent(subject)}&type=${type}`,
    );
    renderGradeList(submissions, type);
  } catch (e) {
    $('gradeList').innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
  }
}

function setGradeTab(type) {
  state.gradeType = type;
  $('gradeTabClasswork').className = 'grade-tab' + (type === 'classwork' ? ' grade-tab-active' : '');
  $('gradeTabAssignment').className = 'grade-tab' + (type === 'assignment' ? ' grade-tab-active' : '');
  $('gradeTabAbsent').className = 'grade-tab' + (type === 'absent' ? ' grade-tab-active' : '');
}

function renderGradeList(submissions, type) {
  const list = $('gradeList');
  list.innerHTML = '';
  if (!submissions.length) {
    const typeLabel = type === 'classwork' ? 'classwork' : 'assignment';
    list.innerHTML = `<p style="color:var(--muted)">No ${typeLabel} submissions yet for this subject.</p>`;
    return;
  }

  submissions.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'grade-row-card' + (s.score !== null ? ' grade-row-graded' : '');

    const header = document.createElement('div');
    header.className = 'grade-row-header';
    const badgeText = s.score !== null ? `${s.score}/10` : 'ungraded';
    const badgeClass = s.score !== null ? 'grade-row-badge' : 'grade-row-badge grade-row-badge-muted';
    const dayLabel = s.day_number ? `<span style="font-size:11px;color:var(--dim);margin-left:6px;">Day ${s.day_number} · ${s.lesson_date || ''}</span>` : '';
    header.innerHTML =
      `<span class="grade-row-id">${escapeHtml(s.student_id)}${dayLabel}</span>` +
      `<span class="${badgeClass}" data-badge>${badgeText}</span>`;

    const toggle = document.createElement('button');
    toggle.className = 'link-btn';
    toggle.textContent = s.submission_text ? ' View text answer' : '(No text  file only)';
    toggle.disabled = !s.submission_text;
    const answerBox = document.createElement('div');
    answerBox.className = 'grade-row-answer hidden';
    answerBox.textContent = s.submission_text;
    if (s.submission_text) {
      toggle.addEventListener('click', () => {
        const hidden = answerBox.classList.toggle('hidden');
        toggle.textContent = hidden ? ' View text answer' : ' Hide text answer';
      });
    }

    const inputs = document.createElement('div');
    inputs.className = 'grade-row-inputs';

    const scoreInput = document.createElement('input');
    scoreInput.type = 'number'; scoreInput.min = 0; scoreInput.max = 10; scoreInput.step = 1;
    scoreInput.className = 'input score-input'; scoreInput.placeholder = '010';
    if (s.score !== null) scoreInput.value = String(s.score);

    const feedbackInput = document.createElement('input');
    feedbackInput.type = 'text'; feedbackInput.className = 'input feedback-input';
    feedbackInput.placeholder = 'Brief feedback (optional)';
    feedbackInput.value = s.feedback || '';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-accent btn-sm';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
      const score = parseInt(scoreInput.value, 10);
      if (isNaN(score) || score < 0 || score > 10) {
        $('gradeModalMsg').textContent = ' Enter a score between 0 and 10.'; return;
      }
      saveBtn.disabled = true; saveBtn.textContent = 'Saving';
      try {
        await api('/api/admin/grade', {
          method: 'PATCH',
          body: JSON.stringify({ submissionId: s.id, score, feedback: feedbackInput.value.trim() }),
        });
        saveBtn.textContent = ' Saved';
        card.classList.add('grade-row-graded');
        const badge = header.querySelector('[data-badge]');
        if (badge) { badge.textContent = score + '/10'; badge.className = 'grade-row-badge'; }
        $('gradeModalMsg').textContent = ` Saved ${score}/10 for ${s.student_id}`;
      } catch (e) {
        saveBtn.disabled = false; saveBtn.textContent = 'Retry';
        $('gradeModalMsg').textContent = ' ' + e.message;
      }
    });

    inputs.appendChild(scoreInput);
    inputs.appendChild(feedbackInput);
    inputs.appendChild(saveBtn);

    card.appendChild(header);
    if (s.submission_file_url) {
      const fileBtn = document.createElement('button');
      fileBtn.className = 'link-btn attach-file-link';
      fileBtn.textContent = ' View attached file';
      fileBtn.addEventListener('click', async () => {
        fileBtn.textContent = 'Opening';
        try {
          const { url } = await api(`/api/admin/file-url?path=${encodeURIComponent(s.submission_file_url)}`);
          window.open(url, '_blank', 'noopener');
        } catch (e) {
          $('gradeModalMsg').textContent = ' ' + e.message;
        } finally { fileBtn.textContent = ' View attached file'; }
      });
      card.appendChild(fileBtn);
    }
    card.appendChild(toggle);
    card.appendChild(answerBox);
    card.appendChild(inputs);
    list.appendChild(card);
  });
}

//  Admin: Student questions panel 
let loadedQuestions = [];

async function openQuestionsModal() {
  $('questionsModalMsg').textContent = '';
  $('questionsList').innerHTML = '<p style="color:var(--muted)">Click Load to fetch today\'s questions.</p>';
  $('questionsModal').classList.remove('hidden');

  try {
    const { tracks } = await api('/api/lessons/status');
    const pick = $('questionsSubjectPick');
    while (pick.options.length > 1) pick.remove(1);
    tracks.forEach((track) => {
      track.subjects.filter((s) => s.day_number).forEach((s) => {
        const o = document.createElement('option');
        o.value = s.subject;
        o.textContent = s.label || cap(s.subject);
        pick.appendChild(o);
      });
    });
  } catch { /* non-fatal */ }
}

async function loadQuestions() {
  const subject = $('questionsSubjectPick').value;
  $('questionsList').innerHTML = '<p style="color:var(--muted)">Loading</p>';
  $('questionsModalMsg').textContent = '';
  try {
    const url = '/api/admin/questions' + (subject ? `?subject=${encodeURIComponent(subject)}` : '');
    const { questions } = await api(url);
    loadedQuestions = questions;
    renderQuestionsList(questions);
  } catch (e) {
    $('questionsList').innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
  }
}

function renderQuestionsList(questions) {
  const list = $('questionsList');
  list.innerHTML = '';
  if (!questions.length) {
    list.innerHTML = '<p style="color:var(--muted)">No questions submitted yet.</p>';
    return;
  }

  questions.forEach((q) => {
    const card = document.createElement('div');
    card.className = 'grade-row-card';

    const header = document.createElement('div');
    header.className = 'grade-row-header';
    const when = new Date(q.submitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    header.innerHTML =
      `<span class="grade-row-id">${escapeHtml(q.student_id)}</span>` +
      `<span class="grade-row-badge grade-row-badge-muted">${escapeHtml(cap(q.subject))}  ${when}</span>`;

    card.appendChild(header);

    if (q.question_text) {
      const body = document.createElement('div');
      body.className = 'grade-row-answer';
      body.style.maxHeight = '120px';
      body.textContent = q.question_text;
      card.appendChild(body);
    }

    if (q.question_file_url) {
      const fileBtn = document.createElement('button');
      fileBtn.className = 'link-btn attach-file-link';
      fileBtn.textContent = ' View attached file';
      fileBtn.addEventListener('click', async () => {
        fileBtn.textContent = 'Opening';
        try {
          const { url } = await api(`/api/admin/file-url?path=${encodeURIComponent(q.question_file_url)}`);
          window.open(url, '_blank', 'noopener');
        } catch (e) {
          $('questionsModalMsg').textContent = ' ' + e.message;
        } finally { fileBtn.textContent = ' View attached file'; }
      });
      card.appendChild(fileBtn);
    }

    list.appendChild(card);
  });
}

function downloadQuestions() {
  if (!loadedQuestions.length) {
    $('questionsModalMsg').textContent = ' Load questions first.';
    return;
  }
  const lines = loadedQuestions.map((q) => {
    const when = new Date(q.submitted_at).toLocaleString();
    const text = q.question_text ? `\n${q.question_text}` : '';
    const file = q.question_file_url ? `\n[Attached file: ${q.question_file_url.split('/').pop()}]` : '';
    return `Student: ${q.student_id}\nSubject: ${q.subject}\nTime: ${when}${text}${file}\n${''.repeat(50)}`;
  });
  const content = `Student Questions  ${new Date().toLocaleDateString()}\n${''.repeat(50)}\n\n` + lines.join('\n\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `questions_${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

//  Admin: Set student password 
function openPasswordModal() {
  $('passwordEmail').value = '';
  $('passwordNew').value = '';
  $('passwordMsg').textContent = '';
  $('passwordModal').classList.remove('hidden');
  $('passwordEmail').focus();
}

async function savePassword() {
  const email = $('passwordEmail').value.trim();
  const password = $('passwordNew').value;
  const msg = $('passwordMsg');
  msg.textContent = '';
  if (!email || !password) { msg.textContent = 'Enter both email and new password.'; return; }
  if (password.length < 6) { msg.textContent = 'Password must be at least 6 characters.'; return; }
  const btn = $('passwordSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving';
  try {
    await api('/api/admin/set-password', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    msg.style.color = 'var(--green, #4ade80)';
    msg.textContent = ` Password updated for ${email}.`;
    $('passwordEmail').value = '';
    $('passwordNew').value = '';
  } catch (e) {
    msg.style.color = '';
    msg.textContent = ' ' + e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Set Password';
  }
}

//  Admin: Outlines upload 
function openOutlines() {
  $('outlinesMsg').textContent = '';
  $('outlinesModal').classList.remove('hidden');
}
function closeOutlines() {
  $('outlinesModal').classList.add('hidden');
}
function uploadOutlines() {
  const file = $('outlinesFile').files[0];
  const msg = $('outlinesMsg');
  if (!file) { msg.textContent = 'Choose a CSV file first.'; return; }
  if (typeof Papa === 'undefined') { msg.textContent = 'CSV parser not loaded.'; return; }
  msg.textContent = 'Parsing';
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: async (results) => {
      const rows = (results.data || []).map((r) => ({
        subject: r.subject, day: r.day, topic: r.topic, outline: r.outline,
      }));
      try {
        const res = await fetch('/api/curriculum/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (state.token || '') },
          body: JSON.stringify({ rows }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
        msg.textContent = ` Imported ${data.imported} day(s) for: ${(data.subjects || []).join(', ')}.`;
      } catch (e) {
        msg.textContent = ' ' + e.message;
      }
    },
    error: (err) => { msg.textContent = ' ' + err.message; },
  });
}

async function resetAllLessons() {
  if (!confirm(
    ' Reset ALL lessons?\n\n' +
    'This permanently deletes every lesson record. Students will see no class until you generate or demo Day 1 again.\n\n' +
    'The curriculum (your uploaded CSV) is NOT affected  Day 1 will use your proper outline topics.\n\n' +
    'Are you sure?'
  )) return;
  const btn = $('adminResetBtn');
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Resetting';
  try {
    const data = await api('/api/admin/reset-lessons', { method: 'DELETE' });
    alert(` Done  ${data.deleted} lesson record(s) cleared. Click "Open Class"  "Regenerate" or "Demo" to start from Day 1.`);
    // Reload classroom view so the "no lesson yet" state shows
    if (typeof loadClassroom === 'function') await loadClassroom();
  } catch (e) {
    alert(' Reset failed: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

//  KaTeX helper: renders LaTeX in an element (polls until defer scripts load)
const _KATEX_OPTS = {
  delimiters: [
    { left: '$$', right: '$$', display: true },
    { left: '$', right: '$', display: false },
    { left: '\\[', right: '\\]', display: true },
    { left: '\\(', right: '\\)', display: false },
  ],
  throwOnError: false,
  output: 'html',
};
function typesetEl(el) {
  if (typeof window.renderMathInElement === 'function') {
    renderMathInElement(el, _KATEX_OPTS);
    return;
  }
  // auto-render.min.js not yet available (defer) — poll
  let attempts = 0;
  const poll = setInterval(() => {
    if (typeof window.renderMathInElement === 'function') {
      clearInterval(poll);
      renderMathInElement(el, _KATEX_OPTS);
    } else if (++attempts > 40) {
      clearInterval(poll);
    }
  }, 250);
}

//  Student: My Progress
async function openProgressModal() {
  $('progressModal').classList.remove('hidden');
  const list = $('progressList');
  list.innerHTML = '<p style="color:var(--muted)">Loading...</p>';
  if (!state.student) {
    list.innerHTML = '<p style="color:var(--muted)">Not logged in as a student.</p>';
    return;
  }
  try {
    const { overview } = await api(`/api/progress/overview`);
    if (!overview || !overview.length) {
      list.innerHTML = '<p style="color:var(--muted)">No progress data yet.</p>';
      return;
    }
    const enrolledKeys = new Set((state.subjects || []).map((s) => s.subject));
    const filtered = overview.filter((s) => enrolledKeys.has(s.subject));
    list.innerHTML = (filtered.length ? filtered : overview).map((s) => {
      const pct = s.totalClassDays ? Math.round(s.daysAttended / s.totalClassDays * 100) : 0;
      const barColor = pct >= 75 ? 'var(--purple)' : pct >= 50 ? 'var(--blue)' : 'var(--red)';
      return `<div class="grade-row-card">
        <div class="grade-row-header">
          <span class="grade-row-id">${escapeHtml(s.label || s.subject)}</span>
          <span class="grade-row-badge">${s.daysAttended}/${s.totalClassDays} days</span>
        </div>
        <div style="font-size:13px;color:var(--muted);margin-top:2px;">
          ${s.avgScore !== null ? `Avg score: <strong style="color:var(--white)">${s.avgScore}/10</strong>` : 'No scores yet'}
          ${s.lastDayAttended ? ` &bull; Last class: Day ${s.lastDayAttended}` : ''}
        </div>
        <div style="background:var(--srf-h);border-radius:6px;height:6px;overflow:hidden;margin-top:8px;">
          <div style="height:100%;width:${pct}%;background:${barColor};border-radius:6px;transition:width 0.4s;"></div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
  }
}

//  Student: Past Classes
async function openPastClassesModal() {
  $('pastClassesModal').classList.remove('hidden');
  $('pastClassesLesson').classList.add('hidden');
  $('pastClassesLesson').innerHTML = '';
  $('pastClassesList').innerHTML = '<p style="color:var(--muted)">Loading...</p>';

  const bar = $('pastClassesSubjectBar');
  bar.innerHTML = '';

  const subjects = state.subjects || [];
  if (!subjects.length) {
    $('pastClassesList').innerHTML = '<p style="color:var(--muted)">No subjects available.</p>';
    return;
  }

  subjects.forEach((s, i) => {
    const btn = document.createElement('button');
    btn.className = 'grade-tab' + (i === 0 ? ' grade-tab-active' : '');
    btn.textContent = s.label || s.subject;
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.grade-tab').forEach((b) => b.classList.remove('grade-tab-active'));
      btn.classList.add('grade-tab-active');
      $('pastClassesLesson').classList.add('hidden');
      $('pastClassesLesson').innerHTML = '';
      loadPastClassesForSubject(s.subject, s.department || 'general');
    });
    bar.appendChild(btn);
  });

  loadPastClassesForSubject(subjects[0].subject, subjects[0].department || 'general');
}

async function loadPastClassesForSubject(subject, department) {
  $('pastClassesList').innerHTML = '<p style="color:var(--muted)">Loading...</p>';
  try {
    const { lessons } = await api(`/api/lessons/archive?subject=${encodeURIComponent(subject)}&department=${encodeURIComponent(department)}`);
    if (!lessons || !lessons.length) {
      $('pastClassesList').innerHTML = '<p style="color:var(--muted)">No past classes for this subject yet.</p>';
      return;
    }
    const list = $('pastClassesList');
    list.innerHTML = '';
    lessons.forEach((l) => {
      const card = document.createElement('div');
      card.className = 'grade-row-card';
      card.style.cursor = 'pointer';
      card.innerHTML = `<div class="grade-row-header">
        <span class="grade-row-id">Day ${l.day_number}: ${escapeHtml(l.topic || '')}</span>
        <span class="grade-row-badge-muted" style="font-size:12px;padding:2px 10px;border-radius:999px;background:var(--srf-h);color:var(--dim);">${l.lesson_date || ''}</span>
      </div>`;
      card.addEventListener('click', () => loadPastLesson(subject, department, l.day_number));
      list.appendChild(card);
    });
  } catch (e) {
    $('pastClassesList').innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
  }
}

async function loadPastLesson(subject, department, day) {
  const lessonEl = $('pastClassesLesson');
  lessonEl.classList.remove('hidden');
  lessonEl.innerHTML = '<p style="color:var(--muted)">Loading lesson...</p>';
  lessonEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const { lesson } = await api(`/api/lessons/archive?subject=${encodeURIComponent(subject)}&department=${encodeURIComponent(department)}&day=${day}`);
    if (!lesson) {
      lessonEl.innerHTML = '<p style="color:var(--muted)">Lesson not found.</p>';
      return;
    }
    const blocks = parseSections(lesson.lesson_content_html || lesson.lesson_content);
    let html = `<div style="border-top:1px solid var(--brd);padding-top:1rem;">
      <h3 style="color:var(--white);margin:0 0 1rem;font-size:16px;font-weight:800;">Day ${lesson.day_number}: ${escapeHtml(lesson.topic || '')}</h3>`;
    for (const block of blocks) {
      if (block.type === 'section') {
        block.paragraphs.forEach((p) => {
          html += `<p style="color:var(--muted);font-size:14px;line-height:1.75;margin:0 0 0.8rem;">${p}</p>`;
        });
      } else if (block.type === 'check') {
        html += `<div style="background:var(--srf2,var(--srf));border:1px solid var(--brd);border-radius:8px;padding:12px;margin:12px 0;font-size:13px;color:var(--white);">📝 ${block.text}</div>`;
      }
    }
    html += '</div>';
    lessonEl.innerHTML = html;
  } catch (e) {
    lessonEl.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
  }
}

//  Student: My Submissions
async function openSubmissionsModal() {
  $('submissionsModal').classList.remove('hidden');
  $('submissionsList').innerHTML = '<p style="color:var(--muted)">Loading...</p>';

  const bar = $('submissionsSubjectBar');
  bar.innerHTML = '';

  const subjects = state.subjects || [];
  if (!subjects.length || !state.student) {
    $('submissionsList').innerHTML = '<p style="color:var(--muted)">No subjects available.</p>';
    return;
  }

  subjects.forEach((s, i) => {
    const btn = document.createElement('button');
    btn.className = 'grade-tab' + (i === 0 ? ' grade-tab-active' : '');
    btn.textContent = s.label || s.subject;
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.grade-tab').forEach((b) => b.classList.remove('grade-tab-active'));
      btn.classList.add('grade-tab-active');
      loadSubmissionsForSubject(s.subject);
    });
    bar.appendChild(btn);
  });

  loadSubmissionsForSubject(subjects[0].subject);
}

async function loadSubmissionsForSubject(subject) {
  const list = $('submissionsList');
  list.innerHTML = '<p style="color:var(--muted)">Loading...</p>';
  try {
    const { submissions } = await api(
      `/api/submissions/history?subject=${encodeURIComponent(subject)}`,
    );
    if (!submissions || !submissions.length) {
      list.innerHTML = '<p style="color:var(--muted)">No submissions yet for this subject.</p>';
      return;
    }

    // Group by day_number
    const byDay = {};
    for (const s of submissions) {
      if (!byDay[s.day_number]) byDay[s.day_number] = {};
      byDay[s.day_number][s.submission_type] = s;
    }

    list.innerHTML = '';
    Object.keys(byDay).sort((a, b) => Number(b) - Number(a)).forEach((day) => {
      const cw = byDay[day]['classwork'] || null;
      const asgn = byDay[day]['assignment'] || null;
      const date = (cw || asgn)?.lesson_date || '';

      const renderSub = (sub, label) => {
        if (!sub) return `<div style="font-size:13px;color:var(--dim);padding:4px 0 2px;">${label}: <em>not submitted</em></div>`;
        const scoreHtml = sub.score !== null
          ? `<span style="font-weight:800;color:var(--gold2);margin-left:6px;">${sub.score}/10</span>`
          : `<span style="color:var(--dim);margin-left:6px;">awaiting grade</span>`;
        return `<div style="border:1px solid var(--brd);border-radius:10px;padding:10px 14px;margin-top:8px;">
          <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;display:flex;align-items:center;">${label}${scoreHtml}</div>
          ${sub.submission_text ? `<div style="font-size:13.5px;color:var(--white);line-height:1.65;white-space:pre-wrap;">${escapeHtml(sub.submission_text)}</div>` : ''}
          ${sub.submission_file_url ? `<a href="${escapeHtml(sub.submission_file_url)}" target="_blank" rel="noopener" class="attach-file-link" style="display:inline-block;margin-top:6px;font-size:13px;">📎 View attachment</a>` : ''}
          ${sub.feedback ? `<div style="font-size:13px;color:#a78bfa;margin-top:8px;font-style:italic;border-top:1px solid var(--brd);padding-top:8px;">Teacher: "${escapeHtml(sub.feedback)}"</div>` : ''}
        </div>`;
      };

      const card = document.createElement('div');
      card.className = 'grade-row-card';
      card.innerHTML = `<div class="grade-row-header">
        <span class="grade-row-id">Day ${day}</span>
        <span style="font-size:12px;color:var(--dim);">${escapeHtml(date)}</span>
      </div>
      ${renderSub(cw, '✏️ Classwork')}
      ${renderSub(asgn, '📝 Assignment')}`;
      list.appendChild(card);
    });
  } catch (e) {
    list.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
  }
}

//  Admin: Absent students
async function loadAbsentStudents() {
  const subject = $('gradeSubjectPick').value;
  if (!subject) return;
  const meta = (state.subjects || []).find((s) => s.subject === subject);
  const department = meta?.department || 'general';
  $('gradeList').innerHTML = '<p style="color:var(--muted)">Loading absent list...</p>';
  $('gradeModalMsg').textContent = '';
  try {
    const { date, absent } = await api(
      `/api/admin/absent?subject=${encodeURIComponent(subject)}&department=${encodeURIComponent(department)}`,
    );
    if (!absent || !absent.length) {
      $('gradeList').innerHTML = `<p style="color:#4ade80">All students submitted classwork on ${date || 'today'}!</p>`;
      return;
    }
    const list = $('gradeList');
    list.innerHTML = `<p style="color:var(--muted);margin-bottom:4px;">${absent.length} student${absent.length > 1 ? 's' : ''} absent on ${date || 'today'}:</p>`;
    absent.forEach((s) => {
      const card = document.createElement('div');
      card.className = 'grade-row-card';
      card.innerHTML = `<div class="grade-row-header">
        <span class="grade-row-id">${escapeHtml(s.full_name)}</span>
        <span style="color:#f87171;font-size:12px;font-weight:800;background:rgba(248,113,113,0.12);padding:2px 10px;border-radius:999px;">ABSENT</span>
      </div>`;
      list.appendChild(card);
    });
  } catch (e) {
    $('gradeList').innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
  }
}

//  Utilities
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

//  Wire events 
function wireEvents() {
  // Lock scroll while login overlay is visible
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.width = '100%';

  $('subjectSelect').addEventListener('change', (e) => selectSubject(e.target.value));
  $('studentSelect').addEventListener('change', (e) => selectDemoStudent(e.target.value));

  // Assignment submit
  $('submitBtn').addEventListener('click', submitAnswer);
  $('refreshGradeBtn').addEventListener('click', refreshGrade);

  // Classwork submit
  $('classworkSubmitBtn').addEventListener('click', submitClasswork);
  $('classworkRefreshBtn').addEventListener('click', refreshClassworkGrade);

  // New student
  $('newStudentToggle').addEventListener('click', () => $('newStudentForm').classList.toggle('hidden'));
  $('newStudentCreate').addEventListener('click', createStudent);

  // Login
  $('loginBtn').addEventListener('click', doLogin);
  $('loginPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doLogin(); }
  });

  // File attachments
  wireClassworkFile();
  wireAnswerFile();
  wireQuestionFile();
  $('submitQuestionBtn').addEventListener('click', submitQuestion);

  // Admin  Open Class modal
  $('adminClassBtn').addEventListener('click', openClassModal);
  $('classModalClose').addEventListener('click', () => $('classModal').classList.add('hidden'));

  // Student  My Progress & Past Classes
  $('myProgressBtn').addEventListener('click', openProgressModal);
  $('progressModalClose').addEventListener('click', () => $('progressModal').classList.add('hidden'));
  $('pastClassesBtn').addEventListener('click', openPastClassesModal);
  $('pastClassesModalClose').addEventListener('click', () => $('pastClassesModal').classList.add('hidden'));
  $('mySubmissionsBtn').addEventListener('click', openSubmissionsModal);
  $('submissionsModalClose').addEventListener('click', () => $('submissionsModal').classList.add('hidden'));

  // Admin  Grade modal
  $('adminGradeBtn').addEventListener('click', openGradeModal);
  $('gradeModalClose').addEventListener('click', () => $('gradeModal').classList.add('hidden'));
  $('gradeLoadBtn').addEventListener('click', loadGradeSubmissions);
  $('gradeTabClasswork').addEventListener('click', () => { setGradeTab('classwork'); loadGradeSubmissions(); });
  $('gradeTabAssignment').addEventListener('click', () => { setGradeTab('assignment'); loadGradeSubmissions(); });
  $('gradeTabAbsent').addEventListener('click', () => { setGradeTab('absent'); loadAbsentStudents(); });
  $('reopenClassworkBtn').addEventListener('click', async () => {
    const subject = $('gradeSubjectPick').value;
    if (!subject) { $('gradeModalMsg').textContent = 'Select a subject first.'; return; }
    const meta = (state.subjects || []).find((s) => s.subject === subject);
    const department = meta?.department || 'general';
    const btn = $('reopenClassworkBtn');
    btn.disabled = true; btn.textContent = 'Reopening…';
    try {
      const { message } = await api('/api/admin/reopen-classwork', {
        method: 'POST',
        body: JSON.stringify({ subject, department }),
      });
      $('gradeModalMsg').textContent = '✅ ' + message;
      btn.textContent = '🔓 Reopened';
    } catch (e) {
      $('gradeModalMsg').textContent = '❌ ' + e.message;
      btn.disabled = false; btn.textContent = '🔓 Reopen classwork';
    }
  });

  // Admin  Questions modal
  $('adminQuestionsBtn').addEventListener('click', openQuestionsModal);
  $('questionsModalClose').addEventListener('click', () => $('questionsModal').classList.add('hidden'));
  $('questionsLoadBtn').addEventListener('click', loadQuestions);
  $('questionsDownloadBtn').addEventListener('click', downloadQuestions);

  // Admin  Password
  $('adminPasswordBtn').addEventListener('click', openPasswordModal);
  $('passwordModalClose').addEventListener('click', () => $('passwordModal').classList.add('hidden'));
  $('passwordSaveBtn').addEventListener('click', savePassword);

  // Admin  Outlines
  $('adminOutlinesBtn').addEventListener('click', openOutlines);
  $('outlinesClose').addEventListener('click', closeOutlines);
  $('outlinesUploadBtn').addEventListener('click', uploadOutlines);

  // Admin  Reset all lessons
  $('adminResetBtn').addEventListener('click', resetAllLessons);

  // Logout
  $('logoutBtn').addEventListener('click', logout);
}

init();
