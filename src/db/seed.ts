import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../config';
import { POSTUTME_DEPT } from '../subjects';
import type { CurriculumDay } from '../types';
import type { TutorDB } from './repository';

// Sample curriculum to get started — subject keys match the CBT app (lowercase).
// Admins upload the rest via the Outlines panel (CSV → tutor_curriculum).
type Outline = Omit<CurriculumDay, 'id'>;
const D = POSTUTME_DEPT;

const CURRICULUM: Outline[] = [
  // ── physics ────────────────────────────────────────────────────────────────
  {
    department: D, subject: 'physics', day_number: 1,
    topic: 'Measurements, Units & Dimensions',
    outline:
      'Fundamental vs derived quantities; the seven SI base units; standard form and prefixes; ' +
      'dimensional analysis and using it to check equations; precision, accuracy and significant ' +
      'figures; systematic vs random errors. Probe: why dimensional consistency does not guarantee a ' +
      'correct equation.',
  },
  {
    department: D, subject: 'physics', day_number: 2,
    topic: 'Kinematics',
    outline:
      'Distance vs displacement, speed vs velocity, acceleration; the four equations of uniformly ' +
      'accelerated motion; interpreting displacement-time and velocity-time graphs (gradient & area); ' +
      'motion under gravity; introduction to projectile motion. Push them to derive results.',
  },
  {
    department: D, subject: 'physics', day_number: 3,
    topic: "Newton's Laws of Motion",
    outline:
      "The three laws stated precisely; inertia and inertial mass; linear momentum and impulse; " +
      'conservation of linear momentum in collisions (elastic vs inelastic); friction as a contact ' +
      'force and the laws of friction. Demand free-body reasoning on every problem.',
  },
  {
    department: D, subject: 'physics', day_number: 4,
    topic: 'Work, Energy & Power',
    outline:
      'Work as force x displacement (and the cosine factor); kinetic and gravitational potential ' +
      'energy; the work-energy theorem; conservation of mechanical energy and where it appears to ' +
      'fail (friction -> heat); power and efficiency. Contrast with momentum conservation from Day 3.',
  },
  {
    department: D, subject: 'physics', day_number: 5,
    topic: 'Current Electricity',
    outline:
      "Charge, current, drift; potential difference and EMF; Ohm's law and its limits; resistors in " +
      'series and parallel; internal resistance and terminal voltage; electrical energy and power ' +
      '(P = IV = I^2R). Insist on unit-tracking through every calculation.',
  },

  // ── chemistry ──────────────────────────────────────────────────────────────
  {
    department: D, subject: 'chemistry', day_number: 1,
    topic: 'Atomic Structure & Periodicity',
    outline:
      'Protons, neutrons, electrons; atomic number, mass number, isotopes; electronic configuration ' +
      '(s, p, d ordering); periodic trends in atomic radius, ionisation energy and electronegativity ' +
      'and the reasons behind them. Make them explain trends, not just state them.',
  },
  {
    department: D, subject: 'chemistry', day_number: 2,
    topic: 'Chemical Bonding',
    outline:
      'Ionic, covalent (single/double/dative), metallic and hydrogen bonding; electronegativity and ' +
      'bond polarity; basic VSEPR shapes; relating bonding to physical properties (m.p., conductivity, ' +
      'solubility). Challenge them with borderline cases.',
  },
  {
    department: D, subject: 'chemistry', day_number: 3,
    topic: 'Stoichiometry & The Mole',
    outline:
      'The mole and Avogadro constant; molar mass; empirical vs molecular formulae; balancing equations; ' +
      'limiting reagent; percentage yield and percentage purity. Heavy on multi-step numerical problems.',
  },

  // ── economics ──────────────────────────────────────────────────────────────
  {
    department: D, subject: 'economics', day_number: 1,
    topic: 'Basic Economic Problems',
    outline:
      'Scarcity, choice and opportunity cost; the production possibility curve and what shifts it; ' +
      'the three central questions; economic systems (capitalist, socialist, mixed). Force concrete ' +
      'Nigerian examples for every concept.',
  },
  {
    department: D, subject: 'economics', day_number: 2,
    topic: 'Theory of Demand & Supply',
    outline:
      'Laws of demand and supply; determinants and movements vs shifts; market equilibrium and the ' +
      'effect of shifts; price elasticity of demand and supply, and total revenue. Demand precise use ' +
      'of "change in quantity demanded" vs "change in demand".',
  },
  {
    department: D, subject: 'economics', day_number: 3,
    topic: 'Theory of Production',
    outline:
      'Factors of production and their rewards; fixed vs variable factors; total, average and marginal ' +
      'product; the law of diminishing returns; short-run cost curves. Connect the production function ' +
      'to the cost curves explicitly.',
  },
];

const DEMO_ANNOUNCEMENT =
  'The Grand Mock CBT holds this Saturday at 4:00 PM — 60 questions in 45 minutes under real exam ' +
  'conditions. Top 10 scorers get featured. Sitting it is not optional for serious candidates.';

export function buildInitialDB(): TutorDB {
  const curriculum: CurriculumDay[] = CURRICULUM.map((c, i) => ({ id: i + 1, ...c }));

  return {
    students: [
      {
        id: 'stu_demo',
        full_name: 'Tunde Adebayo (demo)',
        department: POSTUTME_DEPT,
        created_at: new Date().toISOString(),
      },
    ],
    curriculum,
    progress: [],
    messages: [],
    announcements: [
      {
        id: 1,
        message: DEMO_ANNOUNCEMENT,
        link: 'https://insideoau.vercel.app',
        active: true,
        created_at: new Date().toISOString(),
      },
    ],
    _seq: {
      curriculum: curriculum.length,
      progress: 0,
      messages: 0,
      announcements: 1,
    },
  };
}

// `npm run seed` -> rebuild the embedded store from scratch.
const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const dbObj = buildInitialDB();
  fs.mkdirSync(path.dirname(CONFIG.dataFile), { recursive: true });
  fs.writeFileSync(CONFIG.dataFile, JSON.stringify(dbObj, null, 2), 'utf8');
  console.log(`Seeded fresh database at ${CONFIG.dataFile}`);
  console.log(
    `  ${dbObj.students.length} student(s), ${dbObj.curriculum.length} curriculum days, ` +
      `${dbObj.announcements.length} announcement(s).`,
  );
}
