# OAU AI Tutor — Stateful Virtual Classroom

A standalone **web app** that simulates a strict, deeply-invested Nigerian Post-UTME
tutor whose academic rigour reflects the **OAU Standard**. It is not a Q&A chatbot —
it is a stateful classroom engine with a perfect memory of each student's journey,
powered by the **Claude API** (`claude-opus-4-8`).

Open it in a browser, pick a student and subject, press **Enter Class**, and the tutor
takes attendance, grades yesterday's assignment, teaches today's topic with rapid-fire
questions, and sets new work — exactly the daily loop from the brief.

```
 ┌─────────────┐    HTTP/JSON     ┌──────────────────────┐   Messages API   ┌────────┐
 │  Browser    │ ───────────────▶ │  Express server      │ ───────────────▶ │ Claude │
 │  (public/)  │ ◀─────────────── │  + classroom engine  │ ◀─────────────── │  API   │
 └─────────────┘                  │  + embedded store    │                  └────────┘
                                   └──────────────────────┘
```

## Why a server (and not Claude-in-the-browser)

The Anthropic API key **never touches the browser**. A web page ships its source to every
visitor, so a key embedded there is a stolen key and an unbounded bill. The browser talks
only to this app's own `/api/*` endpoints; the server holds the key and calls Claude. This
is the correct architecture for any client-side app (mobile included) and is non-negotiable.

## Quick start

```bash
cd oau-ai-tutor
npm install

# Optional but recommended — the real tutor:
cp .env.example .env            # then put your key in ANTHROPIC_API_KEY
# (Windows PowerShell: Copy-Item .env.example .env)

npm start                       # serves the web app
# open http://localhost:3000
```

**No API key?** It still runs. Without `ANTHROPIC_API_KEY` the app uses a clearly-labelled
**offline stub** tutor so you can exercise the whole state machine (attendance, progression,
grading, persistence) with zero secrets. Set the key and restart for the real Claude tutor.

### See the engine without a browser

```bash
npm run demo     # scripted multi-day scenario: first class -> graded day -> missed days
```

## Seeing "Missed Class" detection

You don't have to wait real days. In the sidebar there's a **Simulate "today"** date picker:
set it a few days ahead, press **Enter Class**, and watch the tutor reprimand the student for
the gap. (Same calendar day = continue; next day = advance one lesson; 2+ day gap = advance
one lesson **and** flag `missed_class`, with `days_missed = gap − 1`.) Calendar days are
reckoned in **West Africa Time**.

## The Daily Operational Loop

The brief's four phases are driven by the stateful system prompt; the server injects live
state each turn and persists the results.

| Phase | What happens | Where |
|------|---------------|-------|
| Inject context | student, department, subject, today's & yesterday's curriculum, missed-class flag, announcement | [`engine/classroom.ts`](src/engine/classroom.ts) `buildContext` |
| 1 · Recap & discipline | greet / reprimand for absences, summarise yesterday | system prompt directives 1-3 |
| 2 · Assignment grading | tutor grades out of 10; backend **captures the score** via a tool and saves it | [`anthropic/gradeTool.ts`](src/anthropic/gradeTool.ts) + `client.ts` |
| 3 · Core lecture | teach today's topic from the curriculum outline, rapid-fire questions | system prompt directive 5 |
| 4 · Wrap-up | new assignment + plug the upcoming platform CBT challenge | system prompt directive 6 |

### How the score is captured reliably

Rather than scraping a number out of prose, the tutor calls a dedicated
`record_assignment_grade(score, rationale)` tool in the same turn it delivers its critique.
The server runs a short tool-use loop, reads the integer score, persists it to
`student_progress.latest_assignment_score`, and lets the class continue.

### Memory / token cost

The full conversation is stored (`chat_messages`), but each API call injects only the
**last 5 interactions** (`CONFIG.historyTurns`) plus the always-fresh stateful system prompt —
as the brief requires. Orchestration "kickoff" turns are stored `visible=false` so they never
appear in the student-facing transcript.

## Database

The canonical relational design lives in [`schema.sql`](schema.sql) — `students`,
`curriculum`, `student_progress`, `chat_messages`, `announcements`. It tracks everything the
brief specifies: `current_day_level`, `last_login_timestamp`, `missed_days_count`,
`latest_assignment_score`, daily curriculum by Department → Subject → Day, and full chat
memory.

The bundled runtime implements that schema with a **zero-dependency embedded store**
([`db/repository.ts`](src/db/repository.ts), persisted to `data/tutor.json`) so the project
installs and runs on any machine with no native build and no database server. Everything that
touches storage goes through the repository module — point it at Postgres/Supabase/SQLite by
re-implementing those functions against your driver; nothing else changes. Seed/reset with:

```bash
npm run seed
```

Seed data ships a demo student (Tunde Adebayo, Science), a Physics (5-day), Chemistry (3-day)
and Economics (3-day) curriculum, and a sample CBT announcement.

## HTTP API

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/api/health` | tutor mode (`claude` / `offline-stub`) + model |
| GET  | `/api/students` · `/api/students/:id` | list / detail (with subjects & progress) |
| POST | `/api/students` | create a student `{ full_name, department }` |
| GET  | `/api/curriculum?department=&subject=` | curriculum days |
| GET  | `/api/announcement` · POST `/api/announcement` | read / set the platform challenge |
| GET  | `/api/history?studentId=&subject=` | visible transcript + progress |
| POST | `/api/sessions/start` | begin a class session `{ studentId, subject, simulatedNow? }` |
| POST | `/api/sessions/message` | student turn `{ studentId, subject, text, simulatedNow? }` |

`simulatedNow` is an optional ISO timestamp used only to demo missed-class detection.

## Configuration

| Env var | Default | Notes |
|---------|---------|-------|
| `ANTHROPIC_API_KEY` | — | unset → offline stub; set → real Claude |
| `ANTHROPIC_MODEL` | `claude-opus-4-8` | the model the tutor runs on |
| `PORT` | `3000` | web app / API port |

Other knobs (history window, timezone offset, max tokens) live in
[`src/config.ts`](src/config.ts).

## Project layout

```
oau-ai-tutor/
├─ schema.sql               canonical relational design (reference DDL)
├─ public/                  the web app (index.html, styles.css, app.js)
├─ src/
│  ├─ server.ts             Express: /api/* + static web client
│  ├─ demo.ts               headless multi-day scenario
│  ├─ config.ts  types.ts
│  ├─ db/        repository.ts (embedded store) · seed.ts
│  ├─ anthropic/ client.ts (Claude + tool loop + offline stub)
│  │             systemPrompt.ts (the stateful prompt) · gradeTool.ts
│  └─ engine/    classroom.ts (daily loop) · missedClass.ts (attendance)
└─ data/                    runtime store (git-ignored)
```

## Requirements

Node.js 18+ (uses `tsx`, no build step). The only runtime dependencies are
`@anthropic-ai/sdk`, `express`, and `dotenv` — all pure JS, so `npm install` won't try to
compile anything.
