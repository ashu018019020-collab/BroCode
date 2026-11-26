/**
 * The ML dataset and Colab `check` commands compare CONTENT, not the day they were published.
 *
 * Both generators stamp `generated: new Date().toISOString().slice(0, 10)` into their public
 * manifest, and `check` builds today's payload to compare against it. Comparing the raw JSON made
 * the check fail every day after publication even when no dataset or notebook had changed — a
 * daily false alarm that trains people to ignore the one check meant to catch a real drift.
 *
 * This pins the contract end to end in a throwaway fixture: publish there, rewrite the manifest's
 * date to 2001, and require both checks to still pass. A regression to a raw/date comparison fails
 * here instead of waiting until tomorrow morning.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A mini project root with the scripts and authored sources the two checks read. */
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-freshness-'));
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'core', 'data'), { recursive: true });
  for (const script of ['ml-datasets.cjs', 'ml-colab.cjs']) {
    fs.copyFileSync(path.join(ROOT, 'scripts', script), path.join(dir, 'scripts', script));
  }
  fs.cpSync(path.join(ROOT, 'content', 'datasets', 'ml'), path.join(dir, 'content', 'datasets', 'ml'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'content', 'colab-ml'), path.join(dir, 'content', 'colab-ml'), { recursive: true });
  return dir;
}

const run = (dir, script, mode) =>
  spawnSync(process.execPath, [path.join(dir, 'scripts', script), mode], { cwd: dir, encoding: 'utf8' });

/** Rewrite one file with CRLF, the way a Windows Git checkout materialises it. */
function asCrlf(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
  fs.writeFileSync(file, text.replace(/\n/g, '\r\n'));
}

/** Rewrite every text artifact below a directory as CRLF. */
function dirAsCrlf(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) dirAsCrlf(file);
    else asCrlf(file);
  }
}

/** Publish both fixtures, then simulate a Windows checkout of every generated copy. */
function publishAsWindowsCheckout(dir) {
  for (const script of ['ml-datasets.cjs', 'ml-colab.cjs']) {
    const write = run(dir, script, '--write');
    assert.equal(write.status, 0, `${script} --write failed\n${write.stderr}`);
  }
  asCrlf(path.join(dir, 'src', 'core', 'data', 'mlDatasets.ts'));
  dirAsCrlf(path.join(dir, 'public', 'datasets', 'ml'));
  dirAsCrlf(path.join(dir, 'public', 'colab-ml'));
}

test('ML dataset and Colab checks pass when the manifest generated date is old', (t) => {
  const dir = makeFixture();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  for (const [script, manifest] of [
    ['ml-datasets.cjs', 'public/datasets/ml/manifest.json'],
    ['ml-colab.cjs', 'public/colab-ml/manifest.json'],
  ]) {
    const write = run(dir, script, '--write');
    assert.equal(write.status, 0, `${script} --write failed\n${write.stderr}`);

    const manifestPath = path.join(dir, manifest);
    const published = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.ok(published.generated, `${manifest}: no publication date to age`);
    published.generated = '2001-01-01';
    fs.writeFileSync(manifestPath, JSON.stringify(published, null, 2) + '\n');

    const check = run(dir, script, 'check');
    assert.equal(
      check.status,
      0,
      `${script} check must ignore the publish date, not compare it with today\n${check.stderr}`,
    );
    assert.match(check.stdout, /valid/, `${script} check should report a valid artifact`);
  }
});

test('ML dataset and Colab checks pass when their generated copies use CRLF', (t) => {
  const dir = makeFixture();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  publishAsWindowsCheckout(dir);

  for (const script of ['ml-datasets.cjs', 'ml-colab.cjs']) {
    const check = run(dir, script, 'check');
    assert.equal(
      check.status,
      0,
      `${script} check must compare line-ending-insensitive content\n${check.stderr}`,
    );
    assert.match(check.stdout, /valid/, `${script} check should report a valid artifact`);
  }
});

test('ML dataset and Colab checks still detect a real change in a CRLF checkout', (t) => {
  const dir = makeFixture();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  publishAsWindowsCheckout(dir);

  fs.appendFileSync(path.join(dir, 'public', 'datasets', 'ml', 'iris.csv'), 'drift\n');
  fs.appendFileSync(path.join(dir, 'public', 'colab-ml', 'ml-xgboost-regression.ipynb'), 'drift\n');

  for (const [script, file] of [
    ['ml-datasets.cjs', 'public/datasets/ml/iris.csv'],
    ['ml-colab.cjs', 'public/colab-ml/ml-xgboost-regression.ipynb'],
  ]) {
    const check = run(dir, script, 'check');
    assert.notEqual(check.status, 0, `${script} check must not hide a changed ${file}`);
    assert.match(check.stderr, /stale/, `${script} check should name the stale copy`);
  }
});
