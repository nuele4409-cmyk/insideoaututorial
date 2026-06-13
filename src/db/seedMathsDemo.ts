/**
 * One-shot script: inserts 5 days of Post-UTME maths curriculum into Supabase.
 * Run with:  npx tsx src/db/seedMathsDemo.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../config';

const sb = createClient(CONFIG.cbt.url, CONFIG.cbt.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const rows = [
  {
    department: 'postutme',
    subject: 'mathematics',
    day_number: 1,
    topic: 'Number and Numeration',
    outline:
      'Integers, fractions and decimals — converting between forms and performing operations; ' +
      'laws of indices — product, quotient, power-of-a-power, zero and negative exponents; ' +
      'surds — simplifying, rationalising denominators with single and compound surds; ' +
      'standard form (scientific notation) — expressing very large and very small numbers; ' +
      'number bases — converting between base 10 and other bases (2, 8, 16), adding and subtracting in non-decimal bases',
  },
  {
    department: 'postutme',
    subject: 'mathematics',
    day_number: 2,
    topic: 'Algebra — Equations and Inequalities',
    outline:
      'Linear equations in one and two variables — solving and interpreting solutions; ' +
      'simultaneous linear equations — substitution and elimination methods; ' +
      'quadratic equations — factorisation, completing the square, quadratic formula, nature of roots (discriminant); ' +
      'word problems — translating real-world scenarios into algebraic equations; ' +
      'linear and quadratic inequalities — solving, graphing on the number line, interval notation; ' +
      'variation — direct, inverse, joint and partial variation with problem applications',
  },
  {
    department: 'postutme',
    subject: 'mathematics',
    day_number: 3,
    topic: 'Geometry and Mensuration',
    outline:
      'Angles — types (acute, obtuse, reflex), angles on a straight line, vertically opposite angles, angles in parallel lines (alternate, co-interior, corresponding); ' +
      'triangles — angle sum property, types, congruence (SSS, SAS, ASA, RHS), similarity; ' +
      'polygons — interior and exterior angle sums for n-sided polygons; ' +
      'circles — chord properties, arc length, sector area, angle at centre vs angle at circumference; ' +
      'mensuration — perimeter, area of 2-D shapes (triangle, rectangle, trapezium, circle); volume and surface area of prisms, cylinders, cones, spheres and pyramids',
  },
  {
    department: 'postutme',
    subject: 'mathematics',
    day_number: 4,
    topic: 'Trigonometry',
    outline:
      'Basic trigonometric ratios — sin, cos, tan defined for right-angled triangles (SOHCAHTOA); ' +
      'exact values — 30°, 45°, 60° triangles and their ratios without a calculator; ' +
      'sine rule and cosine rule — deriving and applying to non-right-angled triangles; ' +
      'angles of elevation and depression — setting up and solving practical problems; ' +
      'trigonometric identities — sin²θ + cos²θ = 1 and its derivatives; ' +
      'graphs of sin, cos and tan — amplitude, period, transformations',
  },
  {
    department: 'postutme',
    subject: 'mathematics',
    day_number: 5,
    topic: 'Statistics and Probability',
    outline:
      'Data collection and presentation — frequency tables, bar charts, histograms, pie charts, frequency polygons; ' +
      'measures of central tendency — mean (ungrouped and grouped), median, mode, and when each is most useful; ' +
      'measures of dispersion — range, mean deviation, variance, standard deviation; ' +
      'cumulative frequency — ogive curves, reading quartiles, percentiles, interquartile range; ' +
      'probability — sample space, events, classical definition P(E) = n(E)/n(S); ' +
      'probability rules — addition rule (mutually exclusive), multiplication rule (independent events), conditional probability',
  },
];

const { error } = await sb
  .from('tutor_curriculum')
  .upsert(rows, { onConflict: 'department,subject,day_number' });

if (error) {
  console.error('❌ Seed failed:', error.message);
  process.exit(1);
} else {
  console.log(`✅ Inserted ${rows.length} maths curriculum days into Supabase.`);
  console.log('   Subject key: mathematics  |  Dept: postutme  |  Days: 1–5');
}
