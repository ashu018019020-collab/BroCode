#!/usr/bin/env node
/**
 * Generate the four acceptance sentences with the PRODUCTION voice, so the sound can be judged by ear
 * before anyone signs off on it.
 *
 * This is a build/QA tool, never a runtime dependency: it reads the same server module the API uses
 * (`server/tts.mjs`), calls the provider with the key from your environment, and writes MP3s. Nothing
 * is uploaded anywhere else, and no key is printed.
 *
 *   AZURE_SPEECH_KEY=… AZURE_SPEECH_REGION=centralindia npm run voice:preview
 *
 * Output: artifacts/voice-preview/{hi,en}-{1,2}.mp3 plus a small manifest.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTtsEngine } from '../server/tts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'artifacts', 'voice-preview');

const SAMPLES = [
  { id: 'hi-1', lang: 'hi-IN', text: 'Namaste! Welcome to BroCode. Aaj hum Python programming seekhenge. Main tumhe step by step samjhaungi.' },
  { id: 'hi-2', lang: 'hi-IN', text: 'Python mein list ek ordered collection hoti hai jisme hum multiple values store kar sakte hain.' },
  { id: 'en-1', lang: 'en-IN', text: 'Welcome to BroCode. Today we are going to learn Python programming step by step.' },
  { id: 'en-2', lang: 'en-IN', text: 'Artificial intelligence helps computers understand information, generate responses, and solve complex problems.' },
];

const key = process.env.AZURE_SPEECH_KEY ?? '';
const region = process.env.AZURE_SPEECH_REGION ?? '';

if (!key || !region) {
  console.error('Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION to generate the preview clips.');
  process.exit(1);
}

const engine = createTtsEngine({ key, region, voices: {
  ...(process.env.AZURE_SPEECH_VOICE_HI ? { 'hi-IN': process.env.AZURE_SPEECH_VOICE_HI } : {}),
  ...(process.env.AZURE_SPEECH_VOICE_EN ? { 'en-IN': process.env.AZURE_SPEECH_VOICE_EN } : {}),
} });

await mkdir(OUT_DIR, { recursive: true });
const manifest = [];

for (const sample of SAMPLES) {
  const speech = await engine.synthesize({ text: sample.text, lang: sample.lang, rate: 1 });
  const file = join(OUT_DIR, `${sample.id}.mp3`);
  await writeFile(file, speech.audio);
  manifest.push({
    id: sample.id,
    file: `artifacts/voice-preview/${sample.id}.mp3`,
    lang: speech.lang,
    voice: speech.voice,
    chars: sample.text.length,
    bytes: speech.audio.byteLength,
    text: sample.text,
  });
  console.log(`${sample.id}: ${speech.voice} · ${speech.audio.byteLength} bytes → ${file}`);
}

await writeFile(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\n${manifest.length} clips written to ${OUT_DIR}. Listen to all four before accepting the voice.`);
