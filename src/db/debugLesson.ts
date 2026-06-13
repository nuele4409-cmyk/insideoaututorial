import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { CONFIG } from '../config';

const client = new Anthropic({ apiKey: CONFIG.anthropicApiKey });

const prompt =
  `You are generating a group class for a Nigerian Post-UTME preparation academy.\n` +
  `Subject: MATHEMATICS — Day 1: "Number and Numeration"\n` +
  `Curriculum outline: Integers, fractions and decimals; laws of indices; surds; standard form; number bases\n\n` +
  `Write exactly two sections using these exact headers:\n\n` +
  `## LESSON\n` +
  `A clear, energetic lesson in 2 paragraphs. Insert one "Quick check:" question. End with "Key takeaway:" sentence.\n\n` +
  `## ASSIGNMENT\n` +
  `One exam-style question. End with [Rubric: what a full-marks answer must include].`;

const resp = await (client as any).messages.create({
  model: CONFIG.model,
  max_tokens: 1500,
  thinking: { type: 'adaptive' },
  messages: [{ role: 'user', content: prompt }],
});

console.log('Block types:', (resp.content as any[]).map((b: any) => b.type));
for (const block of resp.content as any[]) {
  if (block.type === 'text') {
    console.log('\n── RAW TEXT ──\n');
    console.log(block.text);
  }
}
