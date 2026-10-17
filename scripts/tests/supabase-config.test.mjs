/**
 * Production Supabase bootstrap contract.
 *
 * The reported production bug was not an invalid password: the built app had no Supabase URL/key,
 * so every submit failed before a request left the browser and the form showed the generic
 * "account service unavailable" sentence twice. These tests pin the two halves of the fix:
 * a PUBLIC production fallback (publishable key only) and ONE error banner.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const { PUBLIC_SUPABASE_CONFIG } = await import(
  pathToFileURL(path.join(ROOT, 'src', 'core', 'auth', 'public-config.ts')).href
);

test('the public fallback carries a publishable key, never a service-role secret', () => {
  assert.match(PUBLIC_SUPABASE_CONFIG.url, /^https:\/\/[a-z0-9-]+\.supabase\.co$/i);
  assert.match(PUBLIC_SUPABASE_CONFIG.publishableKey, /^(sb_publishable_|eyJ)/,
    'a publishable key or the legacy anon JWT is browser-safe');
  assert.doesNotMatch(PUBLIC_SUPABASE_CONFIG.publishableKey, /sb_secret_/);
  const code = read('src/core/auth/public-config.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(code, /sb_secret_|SUPABASE_SECRET_KEY|DATABASE_URL/);
});

test('real environment variables take precedence and the fallback is production-only', () => {
  const client = read('src/core/auth/client.ts');
  assert.match(client, /import\.meta\.env\.VITE_SUPABASE_URL/);
  assert.match(client, /import\.meta\.env\.VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(client, /if \(import\.meta\.env\.PROD[\s\S]{0,220}PUBLIC_SUPABASE_CONFIG/,
    'a development build with placeholders must not silently use the production project');
  assert.match(client, /isUsable\(url\) && isUsable\(key\)/, 'a bad env value is rejected, not passed to createClient');
});

test('the auth form renders one failure banner, not the same sentence twice', () => {
  const form = read('src/features/auth/AuthForm.tsx');
  assert.match(form, /const authFailure = error \|\| redirectError \|\| serviceError/);
  assert.equal((form.match(/className=\{authFailureIsAlert \? 'auth-error' : 'auth-message'\}/g) ?? []).length, 1);
  assert.doesNotMatch(form, /\{serviceError && <p className="auth-message"/,
    'the old duplicate service banner must be gone');
});

test('the built bundle contains the public project URL and no secret key', { skip: !fs.existsSync(path.join(ROOT, 'dist', 'index.html')) && 'run npm run build first' }, () => {
  const assets = fs.readdirSync(path.join(ROOT, 'dist', 'assets')).filter((name) => name.endsWith('.js'));
  const text = assets.map((name) => fs.readFileSync(path.join(ROOT, 'dist', 'assets', name), 'utf8')).join('\n');
  assert.ok(text.includes(PUBLIC_SUPABASE_CONFIG.url), 'the production bundle must carry the Supabase URL');
  assert.ok(text.includes(PUBLIC_SUPABASE_CONFIG.publishableKey), 'and the publishable key');
  assert.doesNotMatch(text, /sb_secret_[A-Za-z0-9_-]{8,}/, 'a service-role secret reached the browser bundle');
});
