/**
 * Make an authored Java learning snippet compile as the single file Judge0 runs.
 *
 * Judge0 saves every Java submission as `Main.java` and runs `Main`. Lesson content is authored in
 * three shapes that do not satisfy that alone:
 *
 *   1. a complete program whose public class is called something else (`public class Student`);
 *   2. a complete program whose only class is package-private (`class Demo`);
 *   3. a bare snippet — statements with no class at all, sometimes after imports.
 *
 * (1) and (2) fail with "class X is public, should be declared in X.java" or "Could not find or load
 * main class Main"; (3) fails at the first statement. This module is the one place that turns all
 * three into a real compilation unit. It never executes or invents output: the JDK still compiles and
 * runs the result, and a genuine compiler error is still returned to the learner.
 *
 * Renaming is token-aware: comments, string literals, char literals and text blocks are copied
 * untouched, so a message like `System.out.println("Student")` keeps its text.
 */

const IDENT = /[A-Za-z_$0-9]/;

/** Copy `source`, replacing the identifier `from` with `to` only in Java code. */
export function renameJavaIdentifier(source, from, to) {
  if (!from || from === to || from === 'Main') return source;
  const text = String(source ?? '');
  let out = '';
  let i = 0;
  let mode = 'code';
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (mode === 'code') {
      if (ch === '/' && next === '/') { mode = 'line'; out += '//'; i += 2; continue; }
      if (ch === '/' && next === '*') { mode = 'block'; out += '/*'; i += 2; continue; }
      if (ch === '"' && text.slice(i, i + 3) === '"""') { mode = 'text'; out += '"""'; i += 3; continue; }
      if (ch === '"') { mode = 'string'; out += ch; i += 1; continue; }
      if (ch === "'") { mode = 'char'; out += ch; i += 1; continue; }
      if (IDENT.test(ch)) {
        let j = i + 1;
        while (j < text.length && IDENT.test(text[j])) j += 1;
        const word = text.slice(i, j);
        out += word === from ? to : word;
        i = j;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    if (mode === 'line') {
      out += ch;
      i += 1;
      if (ch === '\n') mode = 'code';
      continue;
    }
    if (mode === 'block') {
      out += ch;
      i += 1;
      if (ch === '*' && next === '/') { out += '/'; i += 1; mode = 'code'; }
      continue;
    }
    if (mode === 'string') {
      out += ch;
      i += 1;
      if (ch === '\\' && i < text.length) { out += text[i]; i += 1; continue; }
      if (ch === '"') mode = 'code';
      continue;
    }
    if (mode === 'char') {
      out += ch;
      i += 1;
      if (ch === '\\' && i < text.length) { out += text[i]; i += 1; continue; }
      if (ch === "'") mode = 'code';
      continue;
    }
    if (mode === 'text') {
      if (text.slice(i, i + 3) === '"""') { out += '"""'; i += 3; mode = 'code'; continue; }
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** A top-level type declaration, ignoring indented/nested ones as far as a regex can. */
const TYPE_DECL = /(^|\n)[ \t]*(public\s+)?(?:(?:final|abstract|sealed|non-sealed|strictfp)\s+)*(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/;

/**
 * How the source is being run:
 *  - `program`  — already a complete `Main` file;
 *  - `renamed`  — a complete file whose type was renamed to `Main`;
 *  - `wrapped`  — bare statements wrapped in `Main.main`;
 *  - `empty`    — nothing to run.
 */
export function prepareJavaSource(raw) {
  const original = String(raw ?? '').replace(/^\uFEFF/, '');
  if (!original.trim()) return { source: original, mode: 'empty', changed: false };

  const source = original;
  const declarations = [];
  const re = new RegExp(TYPE_DECL.source, 'g');
  let match;
  while ((match = re.exec(source)) !== null) {
    declarations.push({ name: match[4], kind: match[3], isPublic: Boolean(match[2]) });
    if (re.lastIndex === match.index) re.lastIndex += 1;
  }

  if (declarations.length) {
    const chosen = declarations.find((d) => d.isPublic) ?? declarations[0];
    // A file with any `Main` type can be run as-is; renaming a second public type would not fix a
    // genuinely invalid multi-public-class file, so leave that compiler error visible.
    if (declarations.some((d) => d.name === 'Main')) {
      return { source, mode: 'program', changed: false };
    }
    return {
      source: renameJavaIdentifier(source, chosen.name, 'Main'),
      mode: 'renamed',
      changed: true,
    };
  }

  // Bare snippet: keep leading imports and comments, wrap the statements in main.
  const lines = source.split('\n');
  let cut = 0;
  while (cut < lines.length) {
    const line = lines[cut];
    if (/^\s*$/.test(line) || /^\s*import\s+/.test(line) || /^\s*\/\//.test(line) || /^\s*\/\*/.test(line)) {
      cut += 1;
      continue;
    }
    break;
  }
  // Keep leading imports AND comments with the generated class; dropping a learner's opening
  // comment made the wrapped copy look like it had edited their code.
  const prefix = lines.slice(0, cut).join('\n').trimEnd();
  const body = lines.slice(cut).join('\n').trimEnd();
  if (!body.trim()) return { source, mode: 'empty', changed: false };
  const indented = body.split('\n').map((line) => (line ? `        ${line}` : '')).join('\n');
  const wrapped = `${prefix ? `${prefix}\n\n` : ''}public class Main {\n    public static void main(String[] args) {\n${indented}\n    }\n}\n`;
  return { source: wrapped, mode: 'wrapped', changed: true };
}
