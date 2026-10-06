#!/usr/bin/env node
/**
 * npm run db:setup — one command for the account-service database path.
 *
 * It runs the same steps server/README.md documents (validate → generate → deploy), adds a
 * read-only migration status check and a real API health check, and classifies every failure with
 * an actionable message: placeholder credential, unreachable host, wrong password, migration
 * already applied, schema drift (P3005/P3009/P3018), API down. Secrets are never printed — URLs are
 * redacted to user@host:port.
 *
 *   npm run db:setup                 full setup (applies pending migrations, checks the API)
 *   npm run db:setup -- --check      validate env + schema + migration status; no writes, no API
 *   npm run db:setup -- --keep-api   leave the API dev server running after the health check
 *   npm run db:setup -- --admin      bootstrap the owner account after a healthy check
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PRISMA_CLI = path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js');
const SCHEMA = path.join(ROOT, 'prisma', 'schema.prisma');
const MIGRATION = '20261002120000_supabase_accounts';
const DB_VARS = ['DATABASE_URL', 'DIRECT_URL'];

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`\x1b[33m⚠\x1b[0m ${m}`);
const bad = (m) => console.log(`\x1b[31m✕\x1b[0m ${m}`);
const info = (m) => console.log(`  ${m}`);
const section = (m) => console.log(`\n— ${m} —`);

// ---- pure helpers (exported for scripts/tests/db-setup.test.mjs) -------------------------

/** Never print a connection password. */
function redact(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/:\/\/([^:@/\s]+):([^@/\s]+)@/g, '://$1:***@');
}

/** Parse `.env` text into { name, value, line } without loading secrets into the environment. */
function envEntries(text) {
  const out = [];
  String(text).split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) return;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out.push({ name: match[1], value, line: index + 1 });
  });
  return out;
}

const PLACEHOLDER = /percent-encoded-password|your-|<[^>]+>/i;

/** Which connection strings still hold a placeholder instead of a real password. */
function findCredentialBlockers(envText) {
  const blockers = [];
  for (const entry of envEntries(envText)) {
    if (!DB_VARS.includes(entry.name)) continue;
    if (!entry.value) blockers.push({ ...entry, reason: 'missing' });
    else if (PLACEHOLDER.test(entry.value)) blockers.push({ ...entry, reason: 'placeholder' });
  }
  return blockers;
}

/** Redacted display + project ref for the direct-host fallback hint. */
function inspectUrl(raw) {
  try {
    const url = new URL(raw);
    return {
      host: `${url.hostname}:${url.port || '5432'}`,
      hostname: url.hostname,
      user: decodeURIComponent(url.username || ''),
      hasPassword: Boolean(url.password),
      ref: (url.username || '').split('.').pop() || '',
    };
  } catch {
    return null;
  }
}

/** Turn Prisma CLI output into a classified, actionable failure. */
function classifyPrismaFailure(output) {
  const text = String(output || '');
  const code = (text.match(/\bP\d{4}\b/) || [null])[0];
  if (/P1000/.test(text)) return { kind: 'auth', code: 'P1000' };
  if (/P1002/.test(text)) return { kind: 'timeout', code: 'P1002' };
  if (/P1001|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(text)) {
    const host = (text.match(/at [`'"]?([^\s`'"]+)/) || [])[1] || '';
    return { kind: 'unreachable', code: 'P1001', host };
  }
  if (/P3005/.test(text)) return { kind: 'schema-not-empty', code: 'P3005' };
  if (/P3009/.test(text)) return { kind: 'failed-migration', code: 'P3009' };
  if (/P3018/.test(text)) return { kind: 'migration-failed', code: 'P3018' };
  if (/No pending migrations to apply/i.test(text)) return { kind: 'up-to-date', code: null };
  return { kind: 'unknown', code, tail: text.trim().split(/\r?\n/).slice(-8).join('\n') };
}

/** Classify the /api/health probe. */
function classifyHealth(probe) {
  if (!probe) return { kind: 'unreachable' };
  if (probe.error) return { kind: 'unreachable', code: probe.error };
  if (probe.status === 200 && probe.body?.api === 'ok' && probe.body?.database === 'ok') return { kind: 'ok' };
  if (probe.status === 500) return { kind: 'database-down', body: probe.body };
  if (probe.status === 404) return { kind: 'not-api' };
  return { kind: 'unexpected', status: probe.status, body: probe.body };
}

// ---- process runners ----------------------------------------------------------------------

function runPrisma(args) {
  if (!fs.existsSync(PRISMA_CLI)) {
    return { status: 127, output: `Prisma CLI not found at ${path.join('node_modules', 'prisma', 'build', 'index.js')}. Run npm install first.` };
  }
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args, '--schema', SCHEMA], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180_000,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  if (result.error) return { status: 1, output: `${output}\n${result.error.message}` };
  return { status: result.status, output };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function probeHealth(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    let body = null;
    try { body = await response.json(); } catch { /* non-JSON */ }
    return { status: response.status, body };
  } catch (error) {
    return { error: error?.cause?.code || error?.code || error?.name || 'ERROR' };
  }
}

// ---- main ---------------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const keepApi = args.includes('--keep-api');
  const admin = args.includes('--admin');

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: npm run db:setup [-- --check] [-- --keep-api] [-- --admin]');
    console.log('  --check     validate env + schema + migration status; no writes, no API start');
    console.log('  --keep-api  leave the API dev server running after a healthy check');
    console.log('  --admin     run bootstrap:admin after a healthy check');
    return;
  }

  let failures = 0;
  const fail = (message) => { bad(message); failures += 1; };

  section('1/6  Environment preflight (doctor)');
  const doctor = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'doctor.cjs')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (doctor.status !== 0) {
    console.log(redact(doctor.stdout || ''));
    fail('Environment preflight failed — fix the problems above, then run db:setup again.');
    process.exitCode = 1;
    return;
  }
  ok('doctor: environment ready');

  section('2/6  Credential gate');
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    fail('Missing .env — copy .env.example to .env and fill in the Supabase values.');
    process.exitCode = 1;
    return;
  }
  const envText = fs.readFileSync(envPath, 'utf8');
  const blockers = findCredentialBlockers(envText);
  if (blockers.length) {
    bad('The database password is still a placeholder.');
    for (const blocker of blockers) {
      info(`.env line ${blocker.line}: ${blocker.name} — ${blocker.reason}`);
    }
    info('Get the real password: Supabase Dashboard → Project Settings → Database →');
    info('Connection string (or Reset database password). Percent-encode special characters,');
    info('update DATABASE_URL and DIRECT_URL in .env, then run db:setup again. No network call was made.');
    process.exitCode = 1;
    return;
  }
  const urls = {};
  for (const name of DB_VARS) {
    const entry = envEntries(envText).find((candidate) => candidate.name === name);
    if (!entry) {
      fail(`Missing ${name} in .env.`);
      process.exitCode = 1;
      return;
    }
    const parsed = inspectUrl(entry.value);
    if (!parsed || !parsed.hasPassword) {
      fail(`${name} is not a complete postgres connection string.`);
      process.exitCode = 1;
      return;
    }
    urls[name] = parsed;
    ok(`${name} → ${parsed.user}@${parsed.host}`);
  }
  const directHint = `db.${urls.DIRECT_URL.ref}.supabase.co:5432`;

  section('3/6  Prisma schema (prisma validate)');
  const validate = runPrisma(['validate']);
  if (validate.status !== 0) {
    console.log(redact(validate.output));
    fail('Prisma schema validation failed.');
    process.exitCode = 1;
    return;
  }
  ok('Schema is valid');

  section(`4/6  Migration status (${check ? 'read-only' : 'then apply'})`);
  const status = runPrisma(['migrate', 'status']);
  if (status.status !== 0) {
    const classified = classifyPrismaFailure(status.output);
    const pooler = Object.values(urls).some((url) => url.hostname.includes('pooler.supabase.com'));
    if (classified.kind === 'unreachable') {
      fail(`Can't reach the database at ${classified.host || 'the configured host'}.`);
      if (pooler) {
        warn('The URL still uses the shared pooler host. If it keeps failing, switch to the project\'s direct host:');
        info(directHint);
      }
    } else if (classified.kind === 'auth') {
      fail('The database rejected the credentials (P1000). Reset the password in the Supabase dashboard, percent-encode it, and update .env.');
    } else if (classified.kind === 'timeout') {
      fail('The database connection timed out (P1002). Check the host, port, and that the project is running.');
    } else {
      console.log(redact(status.output));
      fail('prisma migrate status failed.');
    }
    process.exitCode = 1;
    return;
  }
  const statusClass = classifyPrismaFailure(status.output);
  if (statusClass.kind === 'up-to-date') ok(`Migration ${MIGRATION} is already applied — nothing to do`);
  else ok('Migration status read; pending work will be applied next');

  if (!check) {
    const deploy = runPrisma(['migrate', 'deploy']);
    const deployClass = classifyPrismaFailure(deploy.output);
    if (deploy.status !== 0) {
      if (deployClass.kind === 'up-to-date') {
        ok('No pending migrations to apply');
      } else if (deployClass.kind === 'schema-not-empty') {
        fail('The database schema is not empty but has no migration history (P3005).');
        info(`Baseline it once, then rerun: prisma migrate resolve --applied ${MIGRATION}`);
      } else if (deployClass.kind === 'failed-migration' || deployClass.kind === 'migration-failed') {
        fail(`A migration failed (${deployClass.code}). Inspect it, then resolve with prisma migrate resolve.`);
        console.log(redact(deploy.output));
      } else {
        console.log(redact(deploy.output));
        fail('prisma migrate deploy failed.');
      }
      process.exitCode = 1;
      return;
    }
    if (deployClass.kind === 'up-to-date') ok('No pending migrations to apply');
    else ok(`Migration applied (${MIGRATION})`);

    section('5/6  Generated Prisma client (prisma generate)');
    const generate = runPrisma(['generate']);
    if (generate.status !== 0) {
      console.log(redact(generate.output));
      fail('prisma generate failed.');
      process.exitCode = 1;
      return;
    }
    ok('Prisma client generated');
  } else {
    section('5/6  Generated Prisma client');
    info('Skipped (--check)');
  }

  if (check) {
    section('6/6  API health');
    info('Skipped (--check); run without --check to start/verify the API');
    console.log(failures ? `\n\x1b[31m✕ ${failures} problem(s) found\x1b[0m` : '\n\x1b[32m✓ Env + schema + migration status OK — no writes made\x1b[0m');
    process.exitCode = failures ? 1 : 0;
    return;
  }

  section('6/6  API health (GET /api/health)');
  const envMap = Object.fromEntries(envEntries(envText).map((entry) => [entry.name, entry.value]));
  const port = Number(envMap.API_PORT || 8787);
  const healthUrl = `http://localhost:${port}/api/health`;

  let child = null;
  let log = '';
  let probe = await probeHealth(healthUrl);
  if (probe.error) {
    info(`Nothing on port ${port} — starting the API (server/index.mjs)`);
    child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { log += chunk.toString(); });
    child.stderr.on('data', (chunk) => { log += chunk.toString(); });
    for (let attempt = 0; attempt < 30 && child.exitCode === null; attempt += 1) {
      await sleep(500);
      probe = await probeHealth(healthUrl);
      if (!probe.error) break;
    }
  }

  const health = classifyHealth(probe);
  if (health.kind === 'ok') {
    ok(`API healthy at ${healthUrl} — database reachable`);
  } else if (health.kind === 'database-down') {
    fail('The API is running but cannot reach the database.');
    info('Migrations use DIRECT_URL; the running API uses DATABASE_URL. Check DATABASE_URL first.');
  } else if (health.kind === 'not-api') {
    fail(`Port ${port} answered but is not the account API (404 on /api/health). Stop the other process.`);
  } else if (health.kind === 'unreachable' && child?.exitCode !== null) {
    fail(`The API exited before answering (${health.code || 'exit'}).`);
    if (log.trim()) console.log(redact(log.trim().split(/\r?\n/).slice(-8).join('\n')));
  } else {
    fail(`Health check failed (${health.kind}${health.code ? `: ${health.code}` : ''}).`);
  }

  if (child) {
    if (keepApi && failures === 0) {
      ok(`API left running (pid ${child.pid}, --keep-api)`);
    } else {
      child.kill();
    }
  }

  if (admin && failures === 0) {
    section('Owner bootstrap (npm run bootstrap:admin)');
    const bootstrap = spawnSync(process.execPath, [path.join(ROOT, 'server', 'bootstrap-admin.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    if (bootstrap.status === 0) ok((bootstrap.stdout || '').trim() || 'Owner bootstrap complete');
    else {
      console.log(redact([bootstrap.stdout, bootstrap.stderr].filter(Boolean).join('\n')));
      fail('Owner bootstrap failed.');
    }
  }

  console.log(failures
    ? `\n\x1b[31m✕ ${failures} problem(s) found — database setup incomplete\x1b[0m`
    : '\n\x1b[32m✓ Database setup complete — migration applied, client generated, API healthy\x1b[0m');
  process.exitCode = failures ? 1 : 0;
}

if (require.main === module) {
  main().catch((error) => {
    bad(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  redact,
  envEntries,
  findCredentialBlockers,
  inspectUrl,
  classifyPrismaFailure,
  classifyHealth,
};
