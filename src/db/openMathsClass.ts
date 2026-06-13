/**
 * One-shot script: generates today's maths lesson via Claude and saves it.
 * npx tsx src/db/openMathsClass.ts
 */
import 'dotenv/config';
import { openClass } from '../engine/groupClass';

console.log('Generating Mathematics Day 1 lesson via Claude…');
const { lesson, isNew } = await openClass('mathematics');

if (isNew) {
  console.log('✅ Lesson generated!');
} else {
  console.log('ℹ️  Lesson already existed for today — returned cached version.');
}
console.log(`   Day ${lesson.day_number}: ${lesson.topic}`);
console.log('');
console.log('── LESSON (first 300 chars) ──');
console.log(lesson.lesson_content.slice(0, 300) + '…');
console.log('');
console.log('── ASSIGNMENT ──');
console.log(lesson.assignment_prompt.slice(0, 300) + '…');
