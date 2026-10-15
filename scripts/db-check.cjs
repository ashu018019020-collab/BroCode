#!/usr/bin/env node
/**
 * npm run db:check — WHY is the database unreachable, before Prisma says "P1001".
 *
 * `prisma migrate deploy` reports `P1001: Can't reach database server` for at least four different
 * faults, and they need opposite fixes:
 *
 *   · the hostname is stale, so nothing is listening at all;
 *   · the hostname resolves and the TCP port OPENS, but the service behind it is not Postgres — a
 *     retired Supabase pooler still accepts the connection and then answers a TLS ClientHello with a
 *     non-TLS record. Raw TCP reachability therefore proves nothing, which is exactly how this wastes
 *     an afternoon;
 *   · Postgres answers and REJECTS the credentials (`P1000`, "Authentication failed") — the host is
 *     fine and only the password (or the username form) is wrong;
 *   · the password contains a character that was pasted unencoded, so the client sends a truncated
 *     credential.
 *
 * This script separates those cases and prints the one that applies. READ-ONLY: it opens sockets and
 * runs `select 1`, and never migrates, writes, or prints a secret. Exit 0 = the connection works.
 *
 * `npm run db:deploy` stays the tool that applies migrations. This runs BEFORE it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PRISMA = path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js');
const TARGETS = ['DATABASE_URL', 'DIRECT_URL', 'SUPABASE_DATABASE_URL'];

const green = (m) => `\x1b[32m${m}\x1b[0m`;
const red = (m) => `\x1b[31m${m}\x1b[0m`;
const yellow = (m) => `\x1b[33m${m}\x1b[0m`;
const dim = (m) => `\x1b[2m${m}\x1b[0m`;

/** Values are read from `.env` directly: this must work before any app code is imported. */
function readEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

/**
 * Split a connection string WITHOUT `new URL`.
 *
 * `URL` normalises and percent-encodes, so round-tripping a password through it can silently change
 * what is sent. The username is the only part under test, so everything else is preserved byte for
 * byte by slicing on the real delimiters.
 */
function dissect(raw) {
  const schemeEnd = raw.indexOf('://');
  const at = raw.lastIndexOf('@');
  if (schemeEnd < 0 || at < 0) return null;
  const credentials = raw.slice(schemeEnd + 3, at);
  const colon = credentials.indexOf(':');
  if (colon < 0) return null;
  const user = credentials.slice(0, colon);
  const password = credentials.slice(colon + 1);
  const rest = raw.slice(at); // "@host:port/db/params"
  const hostMatch = rest.match(/^@(\[[^\]]+\]|[^:/]+):?(\d+)?/);
  return {
    raw,
    user,
    password,
    rest,
    host: hostMatch?.[1]?.replace(/[[\]]/g, '') ?? '(unparsed)',
    port: hostMatch?.[2] ?? '5432',
    // A password with no "%" but with a URL-special character is the paste-unencoded case.
    looksUnencoded: /[#?[\]@/]/.test(password) && !/%[0-9A-Fa-f]{2}/.test(password),
    hasPercent: password.includes('%'),
    length: password.length,
  };
}

function tcpOpen(host, port, timeoutMs = 7000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: Number(port) });
    const done = (r) => { socket.destroy(); resolve(r); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done({ ok: true }));
    socket.once('timeout', () => done({ ok: false, reason: `timeout after ${timeoutMs}ms` }));
    socket.once('error', (e) => done({ ok: false, reason: e.code ?? e.message }));
  });
}

/** Is the thing behind this port actually Postgres? A TLS ClientHello must produce a TLS record. */
function tlsSpeaks(host, port, timeoutMs = 9000) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs });
    const done = (r) => { socket.destroy(); resolve(r); };
    socket.once('secureConnect', () => done({ ok: true, protocol: socket.getProtocol() }));
    socket.once('timeout', () => done({ ok: false, reason: 'silent (no TLS reply)' }));
    socket.once('error', (e) => done({
      ok: false,
      reason: e.code === 'ERR_SSL_WRONG_VERSION_NUMBER'
        ? 'NOT POSTGRES — the port answered the TLS handshake with a non-TLS record'
        : (e.code ?? e.message),
    }));
  });
}

/** The only test that proves the credentials work: run a real query through Prisma. */
function queryWorks(url) {
  const sqlFile = path.join(process.env.TEMP ?? '/tmp', 'brocode-dbcheck.sql');
  fs.writeFileSync(sqlFile, 'select 1;\n');
  try {
    execFileSync(process.execPath, [PRISMA, 'db', 'execute', '--url', url, '--file', sqlFile], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true };
  } catch (error) {
    const text = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
    const code = text.match(/Error: (P\d{4})/)?.[1] ?? null;
    const auth = /Authentication failed|password authentication failed/i.test(text);
    const reach = text.match(/Can't reach database server at `([^`]+)`/)?.[1] ?? null;
    return { ok: false, code, auth, unreachable: reach, text };
  }
}

(async () => {
  const env = readEnv();
  console.log('\n— Database connection check —\n');

  const seen = new Map();
  const reports = [];
  for (const key of TARGETS) {
    const raw = env[key];
    if (!raw) { console.log(`${key.padEnd(22)} ${dim('(not set)')}`); continue; }
    const d = dissect(raw);
    if (!d) { console.log(`${key.padEnd(22)} ${red('unparseable connection string')}`); reports.push({ key, verdict: 'unparseable' }); continue; }
    // Two variables often point at the same server; probing once keeps the output readable.
    const id = `${d.host}:${d.port}`;
    if (seen.has(id)) {
      console.log(`${key.padEnd(22)} ${dim(`same endpoint as ${seen.get(id)}`)}`);
      reports.push({ key, verdict: 'duplicate', host: d.host, port: d.port });
      continue;
    }
    seen.set(id, key);

    console.log(`${key.padEnd(22)} ${d.user}@${d.host}:${d.port}`);
    const tcp = await tcpOpen(d.host, d.port);
    if (!tcp.ok) {
      console.log(`  ${red('✕')} socket      ${tcp.reason}`);
      reports.push({ key, verdict: 'unreachable', host: d.host, port: d.port, reason: tcp.reason });
      continue;
    }
    console.log(`  ${green('✓')} socket      open`);

    const tlsResult = await tlsSpeaks(d.host, d.port);
    if (!tlsResult.ok) {
      console.log(`  ${red('✕')} postgres    ${tlsResult.reason}`);
      reports.push({ key, verdict: 'not-postgres', host: d.host, port: d.port, reason: tlsResult.reason });
      continue;
    }
    console.log(`  ${green('✓')} postgres    TLS ${tlsResult.protocol}`);

    if (d.looksUnencoded) {
      console.log(`  ${yellow('!')} password    contains a URL-special character with no %XX escape — if auth fails, percent-encode it`);
    }
    const query = queryWorks(d.raw);
    if (query.ok) {
      console.log(`  ${green('✓')} credentials accepted (select 1)`);
      reports.push({ key, verdict: 'ok', host: d.host, port: d.port });
    } else if (query.auth) {
      console.log(`  ${red('✕')} credentials REJECTED (P1000) — the host is fine, the password is wrong`);
      reports.push({ key, verdict: 'auth', host: d.host, port: d.port });
    } else {
      console.log(`  ${red('✕')} query failed ${query.code ?? ''} ${query.unreachable ? `(reported unreachable: ${query.unreachable})` : ''}`);
      reports.push({ key, verdict: 'query', host: d.host, port: d.port, code: query.code });
    }
    console.log('');
  }

  console.log('— Verdict —');
  const ok = reports.filter((r) => r.verdict === 'ok');
  const notPg = reports.filter((r) => r.verdict === 'not-postgres');
  const auth = reports.filter((r) => r.verdict === 'auth');
  const unreachable = reports.filter((r) => r.verdict === 'unreachable');

  if (ok.length) console.log(`  ${green('✓')} A working connection exists (${ok.map((r) => r.key).join(', ')}) — migrations can run.`);
  if (notPg.length) {
    console.log(`  ${red('✕')} ${notPg.map((r) => `${r.key} (${r.host}:${r.port})`).join(', ')} is NOT a Postgres endpoint.`);
    console.log(`     ${dim('A retired Supabase pooler hostname behaves exactly like this: the port opens, then it answers a')}`);
    console.log(`     ${dim('TLS handshake with a non-TLS record. Copy the CURRENT strings from the dashboard:')}`);
    console.log(`     ${dim('Project Settings → Database → Connection string → URI, and use the Session pooler for')}`);
    console.log(`     ${dim('DATABASE_URL and the Direct connection for DIRECT_URL.')}`);
  }
  if (auth.length) {
    console.log(`  ${red('✕')} ${auth.map((r) => r.key).join(', ')}: the server answered and rejected the PASSWORD.`);
    console.log(`     ${dim('Reset it at Project Settings → Database → Reset database password, then re-copy the URI.')}`);
    console.log(`     ${dim('A password containing @ : / ? # must be percent-encoded in the URL.')}`);
  }
  if (unreachable.length) {
    console.log(`  ${red('✕')} ${unreachable.map((r) => `${r.key} DNS/TCP: ${r.reason}`).join(', ')}`);
  }
  if (!ok.length && !reports.length) {
    console.log(`  ${yellow('!')} no database variables are set — the account API will run on Supabase Auth alone`);
    console.log(`     ${dim('(server/auth-store.mjs). Sign-in works; progress history is not stored server-side.')}`);
  }

  console.log('');
  process.exit(ok.length ? 0 : 1);
})().catch((error) => {
  console.error(`db:check failed unexpectedly: ${error.message}`);
  process.exit(1);
});
