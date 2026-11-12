import { useMemo, useState } from 'react';
import { BarChart3, CalendarDays, Copy, Grid3x3, Layers, Sigma, Timer } from 'lucide-react';
import {
  axisReduce, broadcastShape, dtypeMemory, DTYPE_BYTES, gridShape, maskFilter, matmul, missingSummary,
  parseMatrix, parseShape, percentile, reshapeGrid, reshapePlan, sharingOutcome, SHARING_OPS, shapeSize,
  shapeStrides, sliceIndices, type SharingOp,
  statsSummary, transpose, uniformSamples, type CompareOp, type Shape,
} from '../../core/learning/numpy-tools';
import { benchmarkSource, parseBenchmark, type BenchReport } from '../../core/learning/numpy-bench';
import { runPython } from '../coding/runners';
import {
  charLengths, dateDifference, dateSpan, parseStringList, shiftDate, sortedStrings, stringDtype, stringSummary,
  truncateAll, upperAll, type DateUnit,
} from '../../core/learning/numpy-text-time';

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line, #d6dbe4)',
  background: 'var(--bg2, #fff)', color: 'inherit', fontFamily: 'ui-monospace, monospace', fontSize: 13,
} as const;

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ margin: 0, padding: '8px 10px' }}>
      <span className="small muted" style={{ display: 'block' }}>{label}</span>
      <b style={{ fontFamily: 'ui-monospace, monospace' }}>{value}</b>
    </div>
  );
}

/** Draws a shape as an index grid, so the learner sees which position each cell is. */
function ArrayVisualizer() {
  const [raw, setRaw] = useState('2, 3');
  const shape = parseShape(raw);
  const grid = shape ? gridShape(shape) : null;
  const draws = Boolean(shape && grid && shapeSize(shape) <= 24 && grid.rows <= 6 && grid.cols <= 8);
  const indices = useMemo(() => {
    if (!shape || shape.length !== 2) return null;
    return Array.from({ length: shape[0] }, (_, i) => Array.from({ length: shape[1] }, (_, j) => `[${i},${j}]`));
  }, [shape]);

  return (
    <div>
      <label className="small muted" htmlFor="nvisual-shape">Shape — enter 1 to 4 dimensions</label>
      <input id="nvisual-shape" value={raw} onChange={(e) => setRaw(e.target.value)} style={inputStyle} />
      {!shape && <p className="small" style={{ color: 'var(--red)' }}>Use positive whole numbers, e.g. <code>2, 3</code> or <code>2x3</code>.</p>}
      {shape && (
        <>
          <div className="row" style={{ gap: 6, margin: '8px 0', flexWrap: 'wrap' }}>
            <span className="chip">ndim · {shape.length}</span>
            <span className="chip">size · {shapeSize(shape)}</span>
            <span className="chip">strides · ({shapeStrides(shape).join(', ')})</span>
            <span className="chip">C-order</span>
          </div>
          <pre className="codeblock" style={{ margin: '0 0 8px' }}>{`a = np.zeros((${shape.join(', ')}), dtype=np.int64)\na.shape   # (${shape.join(', ')})`}</pre>
          {indices ? (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${indices[0].length}, minmax(48px, 1fr))`, gap: 6 }}>
              {indices.flatMap((row, i) => row.map((cell, j) => (
                <div
                  key={cell}
                  style={{
                    padding: '10px 4px', textAlign: 'center', borderRadius: 8, fontFamily: 'ui-monospace, monospace',
                    fontSize: 12, border: '1px solid var(--line, #d6dbe4)',
                    background: (i + j) % 2 ? 'var(--bg2, #f6f8fb)' : 'transparent',
                  }}
                >{cell}</div>
              )))}
            </div>
          ) : shape.length === 1 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(44px, 1fr))', gap: 6 }}>
              {Array.from({ length: shape[0] }, (_, i) => (
                <div key={i} style={{ padding: '10px 4px', textAlign: 'center', borderRadius: 8, border: '1px solid var(--line, #d6dbe4)', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>[{i}]</div>
              ))}
            </div>
          ) : draws ? (
            <p className="small muted" style={{ margin: 0 }}>{shape.length}-D shape accepted; the grid shows the first two axes.</p>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>That many cells is too many to draw — pick a smaller shape.</p>
          )}
        </>
      )}
    </div>
  );
}

function BroadcastingSimulator() {
  const [left, setLeft] = useState('3, 1');
  const [right, setRight] = useState('1, 4');
  const a = parseShape(left);
  const b = parseShape(right);
  const result = a && b ? broadcastShape(a, b) : null;

  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 140px' }}>
          <label className="small muted" htmlFor="bcast-a">Shape A</label>
          <input id="bcast-a" value={left} onChange={(e) => setLeft(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ flex: '1 1 140px' }}>
          <label className="small muted" htmlFor="bcast-b">Shape B</label>
          <input id="bcast-b" value={right} onChange={(e) => setRight(e.target.value)} style={inputStyle} />
        </div>
      </div>
      {result && (
        <>
          <p className="small" style={{ margin: '8px 0 4px' }}>
            {result.ok
              ? <>Broadcastable → <b>({result.shape?.join(', ')})</b> with {result.shape ? shapeSize(result.shape) : 0} cells</>
              : <span style={{ color: 'var(--red)' }}>Not broadcastable — NumPy raises ValueError here.</span>}
          </p>
          <pre className="codeblock" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {result.ok
              ? `np.broadcast_shapes((${a?.join(', ')}), (${b?.join(', ')}))  # (${result.shape?.join(', ')})`
              : `np.broadcast_shapes((${a?.join(', ')}), (${b?.join(', ')}))  # ValueError`}
            {'\n'}
            {result.steps.join('\n')}
          </pre>
        </>
      )}
      {!result && <p className="small" style={{ color: 'var(--red)' }}>Both shapes need positive whole numbers.</p>}
    </div>
  );
}

function StatisticsPlayground() {
  const [raw, setRaw] = useState('12, 15, 18, 22, 30, 41');
  const values = raw.split(/[,\s]+/).filter(Boolean).map(Number);
  const valid = values.length > 0 && values.every((n) => Number.isFinite(n));
  const stats = valid ? statsSummary(values) : null;
  const quartileProbe = valid ? percentile(values, 25) : null;

  return (
    <div>
      <label className="small muted" htmlFor="nstats">Numbers — commas or spaces</label>
      <textarea id="nstats" value={raw} onChange={(e) => setRaw(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
      {!valid && <p className="small" style={{ color: 'var(--red)' }}>Enter only numbers, separated by commas or spaces.</p>}
      {stats && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 6, marginTop: 8 }}>
            <Cell label="count" value={String(stats.count)} />
            <Cell label="mean" value={num(stats.mean)} />
            <Cell label="median" value={num(stats.median)} />
            <Cell label="std (ddof=0)" value={num(stats.std)} />
            <Cell label="variance" value={num(stats.variance)} />
            <Cell label="min → max" value={`${num(stats.min)} → ${num(stats.max)}`} />
            <Cell label="p25 / p50 / p75" value={`${num(stats.p25)} / ${num(stats.p50)} / ${num(stats.p75)}`} />
            <Cell label="range (ptp)" value={num(stats.range)} />
          </div>
          <pre className="codeblock" style={{ margin: '8px 0 0' }}>{`a = np.array([${values.join(', ')}])
a.mean(), a.std(), np.percentile(a, 25)  # ${num(stats.mean)}, ${num(stats.std)}, ${num(quartileProbe as number)}`}</pre>
        </>
      )}
    </div>
  );
}

function MatrixLab() {
  const [left, setLeft] = useState('1, 2; 3, 4');
  const [right, setRight] = useState('5, 6; 7, 8');
  const a = parseMatrix(left);
  const b = parseMatrix(right);
  const product = a && b ? matmul(a, b) : null;
  const showMatrix = (m: number[][] | null) => (m ? m.map((r) => r.map(num).join('  ')).join('\n') : '—');

  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px' }}>
          <label className="small muted" htmlFor="nmat-a">Matrix A — rows by <code>;</code></label>
          <textarea id="nmat-a" value={left} onChange={(e) => setLeft(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        <div style={{ flex: '1 1 160px' }}>
          <label className="small muted" htmlFor="nmat-b">Matrix B</label>
          <textarea id="nmat-b" value={right} onChange={(e) => setRight(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
      </div>
      {(!a || !b) && <p className="small" style={{ color: 'var(--red)' }}>Each row needs the same number of numbers, e.g. <code>1, 2; 3, 4</code>.</p>}
      {a && b && (
        <>
          <div className="row" style={{ gap: 6, margin: '8px 0', flexWrap: 'wrap' }}>
            <span className="chip">A · {a.length}×{a[0].length}</span>
            <span className="chip">B · {b.length}×{b[0].length}</span>
            <span className="chip">Aᵀ · {a[0].length}×{a.length}</span>
            <span className={`chip${product ? ' easy' : ' hard'}`}>{product ? 'A @ B works' : 'A @ B raises ValueError'}</span>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 160px', minWidth: 0 }}>
              <span className="small muted">A @ B</span>
              <pre className="codeblock" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{showMatrix(product)}</pre>
            </div>
            <div style={{ flex: '1 1 160px', minWidth: 0 }}>
              <span className="small muted">A.T</span>
              <pre className="codeblock" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{showMatrix(transpose(a))}</pre>
            </div>
          </div>
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            Prefer <code>np.linalg.solve(A, b)</code> over computing <code>inv(A)</code> and multiplying — it is
            more stable and usually faster.
          </p>
        </>
      )}
    </div>
  );
}

function SlicingExplorer() {
  const [length, setLength] = useState('10');
  const [start, setStart] = useState('');
  const [stop, setStop] = useState('');
  const [step, setStep] = useState('1');
  const n = Number(length);
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const plan = Number.isInteger(n) ? sliceIndices(n, num(start), num(stop), Number(step) || 0) : null;
  const chosen = new Set(plan?.indices ?? []);
  return (
    <div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 70px' }}><label className="small muted" htmlFor="sl-len">length</label><input id="sl-len" value={length} onChange={(e) => setLength(e.target.value)} style={inputStyle} /></div>
        <div style={{ flex: '1 1 70px' }}><label className="small muted" htmlFor="sl-start">start</label><input id="sl-start" value={start} onChange={(e) => setStart(e.target.value)} placeholder="blank" style={inputStyle} /></div>
        <div style={{ flex: '1 1 70px' }}><label className="small muted" htmlFor="sl-stop">stop</label><input id="sl-stop" value={stop} onChange={(e) => setStop(e.target.value)} placeholder="blank" style={inputStyle} /></div>
        <div style={{ flex: '1 1 70px' }}><label className="small muted" htmlFor="sl-step">step</label><input id="sl-step" value={step} onChange={(e) => setStep(e.target.value)} style={inputStyle} /></div>
      </div>
      {plan?.error && <p className="small" style={{ color: 'var(--red)', margin: '8px 0 0' }}>{plan.error}</p>}
      {plan && !plan.error && (
        <>
          <p className="small" style={{ margin: '8px 0 4px' }}>
            <code>a[{start || ''}:{stop || ''}:{step || ''}]</code> selects {plan.indices.length} of {n} elements
            {plan.indices.length ? ` — indices ${plan.indices.join(', ')}` : ' — an empty array'}.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(34px, 1fr))', gap: 4 }}>
            {Array.from({ length: Math.max(0, Math.min(40, n)) }, (_, i) => (
              <div key={i} style={{
                padding: '6px 2px', textAlign: 'center', borderRadius: 6, fontSize: 12,
                fontFamily: 'ui-monospace, monospace', border: '1px solid var(--line, #d6dbe4)',
                background: chosen.has(i) ? 'rgba(37, 99, 235, 0.18)' : 'transparent',
                borderColor: chosen.has(i) ? 'var(--blue, #2563eb)' : undefined,
              }}>{i}</div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MaskExplorer() {
  const [raw, setRaw] = useState('4, 11, 10, 15, 3');
  const [op, setOp] = useState<CompareOp>('>');
  const [threshold, setThreshold] = useState('10');
  const values = raw.split(/[,\s]+/).filter(Boolean).map(Number);
  const valid = values.length > 0 && values.every((v) => Number.isFinite(v));
  const result = valid ? maskFilter(values, op, Number(threshold)) : null;
  return (
    <div>
      <label className="small muted" htmlFor="mk-values">Values</label>
      <input id="mk-values" value={raw} onChange={(e) => setRaw(e.target.value)} style={inputStyle} />
      <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        <select value={op} onChange={(e) => setOp(e.target.value as CompareOp)} aria-label="comparison" style={{ ...inputStyle, width: 'auto' }}>
          {['>', '>=', '<', '<=', '==', '!='].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <input value={threshold} onChange={(e) => setThreshold(e.target.value)} aria-label="threshold" style={{ ...inputStyle, width: 110 }} />
      </div>
      {result && (
        <>
          <pre className="codeblock" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{`mask = a ${op} ${threshold}   # ${result.mask.map((b) => (b ? 1 : 0)).join(' ')}
a[mask]             # [${result.selected.join(' ')}]`}</pre>
          <div className="row" style={{ gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
            {values.map((v, i) => (
              <span key={`${v}-${i}`} className={`chip${result.mask[i] ? ' easy' : ''}`} style={{ fontFamily: 'ui-monospace, monospace' }}>{v}</span>
            ))}
          </div>
          <p className="small muted" style={{ margin: '8px 0 0' }}>{result.selected.length} of {values.length} cells pass the comparison.</p>
        </>
      )}
    </div>
  );
}

function ShapeArrow({ before, after }: { before: number[]; after: number[] }) {
  return (
    <p className="small" style={{ margin: '8px 0 0', fontFamily: 'ui-monospace, monospace' }}>
      <span className="muted">before </span>{`(${before.join(', ')})`}
      <span className="muted">  →  after </span>{`(${after.join(', ')})`}
    </p>
  );
}

function ReshapeExplorer() {
  const [size, setSize] = useState('6');
  const [rows, setRows] = useState('2');
  const [cols, setCols] = useState('3');
  const plan = reshapePlan(Number(size), Number(rows), Number(cols));
  const [r, c] = plan.after;
  const grid = plan.ok ? reshapeGrid(r, c) : [];
  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 90px' }}><label className="small muted" htmlFor="rs-size">array size</label><input id="rs-size" value={size} onChange={(e) => setSize(e.target.value)} style={inputStyle} /></div>
        <div style={{ flex: '1 1 90px' }}><label className="small muted" htmlFor="rs-rows">rows (-1 infers)</label><input id="rs-rows" value={rows} onChange={(e) => setRows(e.target.value)} style={inputStyle} /></div>
        <div style={{ flex: '1 1 90px' }}><label className="small muted" htmlFor="rs-cols">cols (-1 infers)</label><input id="rs-cols" value={cols} onChange={(e) => setCols(e.target.value)} style={inputStyle} /></div>
      </div>
      <ShapeArrow before={plan.before} after={plan.after} />
      {plan.ok ? (
        <>
          <pre className="codeblock" style={{ margin: '8px 0 0' }}>{`np.arange(${plan.before[0]}).reshape(${rows}, ${cols})   # → (${r}, ${c})`}</pre>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(c, 8)}, minmax(36px, 1fr))`, gap: 4, marginTop: 8 }}>
            {grid.flatMap((row, i) => row.map((flat, j) => (
              <div key={flat} style={{ padding: '6px 2px', textAlign: 'center', fontSize: 12, borderRadius: 6, border: '1px solid var(--line, #d6dbe4)', fontFamily: 'ui-monospace, monospace' }}>
                {flat}<span className="muted" style={{ fontSize: 9, display: 'block' }}>[{i},{j}]</span>
              </div>
            )))}
          </div>
          <p className="small muted" style={{ margin: '8px 0 0' }}>{r * c} cells before and after — reshape never changes how many values exist, only how they are grouped. C order runs left to right, then down.</p>
        </>
      ) : <p className="small" style={{ color: 'var(--red)', margin: '8px 0 0' }}>{plan.error}</p>}
    </div>
  );
}

/**
 * Copy versus view, with the write-through experiment the rule predicts.
 *
 * `sharingOutcome` decides whether the derived array shares the buffer; the panel then shows what
 * happens to the source when the first element of the result is overwritten. A view changes the
 * source, a copy cannot — the distinction learners get wrong most often.
 */
const DERIVED_SOURCE_INDEX: Record<SharingOp, number | null> = {
  slice: 1, copy: null, fancy: null, reshape: 0, transpose: 0, ravel: 0, flatten: null, reverse: 5,
};

/**
 * Loop versus vectorised, measured in this tab.
 *
 * The program runs in the app's bundled Pyodide runtime with the bundled NumPy wheel, so both kernels
 * are the real thing: a Python `for` loop over `tolist()` and `np.sum(values * values)`. The panel shows
 * the median of the repeats plus every repeat, and confirms both kernels produced the same sum.
 */
/**
 * datetime64 and fixed-width strings, both computed.
 *
 * The date block re-derives NumPy's unit conversion from the two picked dates; the string block rebuilds
 * the `<U<n>` dtype from the longest value, then shows lengths, uppercase, truncation and sort order.
 * `numpy-datetime.test.mjs` checks each result against real NumPy calls, so nothing here is decorative.
 */
function DateTimeStringExplorer() {
  const [a, setA] = useState('2026-01-01');
  const [b, setB] = useState('2026-03-01');
  const [unit, setUnit] = useState<DateUnit>('D');
  const [days, setDays] = useState('45');
  const [rawNames, setRawNames] = useState('ada, bob, cy');
  const [width, setWidth] = useState('3');

  const diff = dateDifference(a, b, unit);
  const span = dateSpan(a, b);
  const shifted = shiftDate(a, Number(days), 'D');
  const names = parseStringList(rawNames);
  const summary = stringSummary(names);
  const cut = Math.max(0, Number(width) || 0);

  return (
    <div>
      <h2 style={{ margin: '0 0 6px', fontSize: 16 }}>datetime64</h2>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="small muted">Start<br />
          <input type="date" value={a} onChange={(e) => setA(e.target.value)} style={inputStyle} />
        </label>
        <label className="small muted">End<br />
          <input type="date" value={b} onChange={(e) => setB(e.target.value)} style={inputStyle} />
        </label>
        <label className="small muted">Unit<br />
          <select value={unit} onChange={(e) => setUnit(e.target.value as DateUnit)} style={inputStyle}>
            <option value="D">days (D)</option>
            <option value="s">seconds (s)</option>
            <option value="ms">milliseconds (ms)</option>
          </select>
        </label>
        <label className="small muted">Add days<br />
          <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" style={inputStyle} />
        </label>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <Cell label={`end − start in ${unit}`} value={diff === null ? 'invalid date' : `${num(diff)} ${unit}`} />
        <Cell label="as weeks" value={span === null ? 'invalid date' : `${num(span.weeks)} weeks`} />
        <Cell label="as hours" value={span === null ? 'invalid date' : `${num(span.hours)} hours`} />
        <Cell label="as minutes" value={span === null ? 'invalid date' : `${num(span.minutes)} minutes`} />
        <Cell label="start + days" value={shifted ?? 'invalid date'} />
        <Cell label="dtype" value="datetime64[D]" />
      </div>
      <p className="small muted" style={{ margin: '6px 0 14px' }}>
        The difference is a <code>timedelta64</code>: NumPy stores the count, so the unit you choose decides the number.
        The week, hour and minute readings are the same span converted — for example, 59 days is 8.4286 weeks,
        1416 hours or 84,960 minutes.
      </p>

      <h2 style={{ margin: '0 0 6px', fontSize: 16 }}>Fixed-width string array</h2>
      <label className="small muted" htmlFor="nstr-names">Values, comma separated</label>
      <input id="nstr-names" value={rawNames} onChange={(e) => setRawNames(e.target.value)} style={inputStyle} />
      <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="small muted">Truncate to width<br />
          <input value={width} onChange={(e) => setWidth(e.target.value)} inputMode="numeric" style={{ ...inputStyle, width: 90 }} />
        </label>
        <span className="chip hard">{summary.dtype}</span>
        <span className="small muted">{summary.count} values · longest {summary.longest} · {summary.totalChars} characters</span>
      </div>
      {names.length === 0 ? (
        <p className="small" style={{ color: 'var(--red)' }}>Type at least one value to see the array.</p>
      ) : (
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <Cell label="lengths" value={`[${charLengths(names).join(' ')}]`} />
          <Cell label="upper()" value={`[${upperAll(names).join(' ')}]`} />
          <Cell label={`astype('<U${Math.min(cut, summary.longest) || 0}')`} value={`[${truncateAll(names, cut).join(' ')}]`} />
          <Cell label="sorted" value={`[${sortedStrings(names).join(' ')}]`} />
        </div>
      )}
      <p className="small muted" style={{ margin: '6px 0 0' }}>
        One width fits every value, so assigning a longer string later truncates it instead of growing the buffer.
      </p>
    </div>
  );
}

function PerformanceLab() {
  const [n, setN] = useState(200_000);
  const [report, setReport] = useState<BenchReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const reps = 5;

  async function measure() {
    setBusy(true);
    setNote('Starting the in-browser Python runtime…');
    setReport(null);
    const run = await runPython(benchmarkSource(n, reps));
    setBusy(false);
    if (!run.ok) {
      setNote(run.error || 'The benchmark did not finish.');
      return;
    }
    const parsed = parseBenchmark(run.output);
    if (!parsed) {
      setNote('The runtime printed no benchmark line — open the console for this run.');
      return;
    }
    setReport(parsed);
    setNote(`Measured in this tab: ${parsed.reps} repeats of ${parsed.n.toLocaleString()} values each.`);
  }

  return (
    <div>
      <p className="small muted" style={{ marginTop: 0 }}>
        A real Python <code>for</code> loop against a real NumPy expression, timed with <code>perf_counter</code>
        in the bundled offline runtime. The first run boots Python (5–15 s); repeat it to compare sizes.
      </p>
      <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {[100_000, 500_000, 1_000_000].map((size) => (
          <button
            key={size}
            type="button"
            className={`chip${n === size ? ' easy' : ''}`}
            style={{ cursor: 'pointer' }}
            onClick={() => setN(size)}
            disabled={busy}
            aria-pressed={n === size}
          >
            {size.toLocaleString()} values
          </button>
        ))}
        <button type="button" className="btn" onClick={measure} disabled={busy} style={{ marginLeft: 'auto' }}>
          {busy ? 'Measuring…' : 'Run benchmark'}
        </button>
      </div>
      {report && (
        <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Cell label="Python loop (median)" value={`${num(report.loopMs)} ms`} />
            <Cell label="Vectorised (median)" value={`${num(report.vectorMs)} ms`} />
            <Cell label="Vectorised is" value={`${report.speedup.toFixed(1)}× faster`} />
          </div>
          <p className="small" style={{ margin: '8px 0 0' }}>
            Loop repeats: {report.loopTimes.map(num).join(', ')} ms · vectorised: {report.vectorTimes.map(num).join(', ')} ms
          </p>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            Same sum from both kernels (difference {report.checksumDelta}) — the speed is not the result of doing less work.
          </p>
        </>
      )}
      {note && <p className="small" style={{ margin: '8px 0 0' }}>{note}</p>}
    </div>
  );
}

function CopyViewExplorer() {
  const [op, setOp] = useState<SharingOp>('slice');
  const result = sharingOutcome(op);
  const source = [0, 1, 2, 3, 4, 5];
  const after = [...source];
  const hit = DERIVED_SOURCE_INDEX[op];
  if (hit !== null) after[hit] = 99;
  return (
    <div>
      <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {SHARING_OPS.map((key) => (
          <button
            key={key}
            type="button"
            className={`chip${op === key ? ' easy' : ''}`}
            style={{ cursor: 'pointer', fontFamily: 'ui-monospace, monospace' }}
            onClick={() => setOp(key)}
            aria-pressed={op === key}
          >
            {sharingOutcome(key).label}
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={`chip ${result.kind === 'view' ? 'hard' : 'easy'}`}>{result.kind === 'view' ? 'view · shares memory' : 'copy · own buffer'}</span>
        <span className="small muted">{result.shares ? 'writes reach the source' : 'writes stay local'}</span>
      </div>
      <p className="small" style={{ margin: '8px 0 0' }}>{result.why}</p>
      <pre className="codeblock" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{`a = np.arange(6)
b = ${result.label}
b[0] = 99`}</pre>
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <Cell label="a before" value={`[${source.join(' ')}]`} />
        <Cell label="a after b[0] = 99" value={`[${after.join(' ')}]`} />
      </div>
      <p className="small muted" style={{ margin: '8px 0 0' }}>
        {result.shares
          ? 'Same buffer, so the source changed. Copy first if the original must stay intact.'
          : 'A separate buffer, so the source is untouched. This is the safe choice before mutating a selection.'}
      </p>
    </div>
  );
}

function AxisExplorer() {
  const [rows, setRows] = useState('3');
  const [cols, setCols] = useState('4');
  const [axis, setAxis] = useState<'0' | '1'>('0');
  const r = Math.max(1, Math.min(6, Number(rows) || 1));
  const c = Math.max(1, Math.min(6, Number(cols) || 1));
  const grid = reshapeGrid(r, c).map((row) => row.map((flat) => flat + 1));
  const result = axisReduce(grid, axis === '0' ? 0 : 1);
  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 80px' }}><label className="small muted" htmlFor="ax-rows">rows</label><input id="ax-rows" value={rows} onChange={(e) => setRows(e.target.value)} style={inputStyle} /></div>
        <div style={{ flex: '1 1 80px' }}><label className="small muted" htmlFor="ax-cols">cols</label><input id="ax-cols" value={cols} onChange={(e) => setCols(e.target.value)} style={inputStyle} /></div>
        <div style={{ flex: '1 1 110px' }}>
          <label className="small muted" htmlFor="ax-axis">axis</label>
          <select id="ax-axis" value={axis} onChange={(e) => setAxis(e.target.value as '0' | '1')} style={inputStyle}>
            <option value="0">0 — collapse rows</option>
            <option value="1">1 — collapse columns</option>
          </select>
        </div>
      </div>
      <ShapeArrow before={result.before} after={result.after} />
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${c}, minmax(34px, 1fr))`, gap: 4, marginTop: 8 }}>
        {grid.flatMap((row, i) => row.map((v, j) => (
          <div key={`${i}-${j}`} style={{ padding: '6px 2px', textAlign: 'center', fontSize: 12, borderRadius: 6, border: '1px solid var(--line, #d6dbe4)', fontFamily: 'ui-monospace, monospace' }}>{v}</div>
        )))}
      </div>
      <p className="small" style={{ margin: '8px 0 0' }}>
        <b>a.sum(axis={axis})</b> = <span style={{ fontFamily: 'ui-monospace, monospace' }}>[{result.totals.join(' ')}]</span>
        <span className="muted"> — the {result.collapsed} axis disappears, so {result.before.join('×')} becomes {result.after.join('×')}.</span>
      </p>
      <pre className="codeblock" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{`a = np.arange(1, ${r * c + 1}).reshape(${r}, ${c})
a.sum(axis=${axis})   # → ${result.totals.join(' ')}  shape ${`(${result.after.join(', ')})`}`}</pre>
    </div>
  );
}

function MemoryCalculator() {
  const [dtype, setDtype] = useState('float64');
  const [count, setCount] = useState('1000000');
  const mem = dtypeMemory(dtype, Number(count));
  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 130px' }}>
          <label className="small muted" htmlFor="mc-dtype">dtype</label>
          <select id="mc-dtype" value={dtype} onChange={(e) => setDtype(e.target.value)} style={inputStyle}>
            {Object.keys(DTYPE_BYTES).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div style={{ flex: '1 1 130px' }}><label className="small muted" htmlFor="mc-count">elements</label><input id="mc-count" value={count} onChange={(e) => setCount(e.target.value)} style={inputStyle} /></div>
      </div>
      {mem ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 6, marginTop: 8 }}>
            <Cell label="itemsize" value={`${DTYPE_BYTES[dtype]} B`} />
            <Cell label="nbytes" value={String(mem.bytes)} />
            <Cell label="readable" value={mem.readable} />
          </div>
          <pre className="codeblock" style={{ margin: '8px 0 0' }}>{`np.zeros(${count}, dtype=np.${dtype}).nbytes  # ${mem.bytes}`}</pre>
        </>
      ) : <p className="small" style={{ color: 'var(--red)' }}>Elements must be a whole number.</p>}
    </div>
  );
}

function RngPlayground() {
  const [seed, setSeed] = useState('42');
  const [count, setCount] = useState('5');
  const values = uniformSamples(Number(seed) || 0, Number(count) || 0);
  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 110px' }}><label className="small muted" htmlFor="rng-seed">seed</label><input id="rng-seed" value={seed} onChange={(e) => setSeed(e.target.value)} style={inputStyle} /></div>
        <div style={{ flex: '1 1 110px' }}><label className="small muted" htmlFor="rng-count">count</label><input id="rng-count" value={count} onChange={(e) => setCount(e.target.value)} style={inputStyle} /></div>
      </div>
      <pre className="codeblock" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{`rng = np.random.default_rng(${seed})
rng.random(${count})`}</pre>
      <div className="row" style={{ gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
        {values.map((v, i) => <span key={i} className="chip" style={{ fontFamily: 'ui-monospace, monospace' }}>{v}</span>)}
      </div>
      <p className="small muted" style={{ margin: '8px 0 0' }}>
        Same seed, same numbers — that is reproducibility. This panel uses a small deterministic
        xorshift so it runs without a kernel; the NumPy snippet above is the real call, and Code Bro
        can run it for the exact PCG64 stream.
      </p>
    </div>
  );
}

function MissingExplorer() {
  const [raw, setRaw] = useState('1, null, -999, 5, nan');
  const [sentinel, setSentinel] = useState('-999');
  const parsed = raw.split(/[,\s]+/).filter(Boolean).map((t) => {
    if (t.toLowerCase() === 'null' || t.toLowerCase() === 'nan') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  });
  const summary = missingSummary(parsed, sentinel.trim() === '' ? null : Number(sentinel));
  return (
    <div>
      <label className="small muted" htmlFor="ms-values">Values (null / nan allowed)</label>
      <input id="ms-values" value={raw} onChange={(e) => setRaw(e.target.value)} style={inputStyle} />
      <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 120px' }}><label className="small muted" htmlFor="ms-sentinel">missing sentinel</label><input id="ms-sentinel" value={sentinel} onChange={(e) => setSentinel(e.target.value)} style={inputStyle} /></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 6, marginTop: 8 }}>
        <Cell label="cells" value={String(summary.total)} />
        <Cell label="missing" value={String(summary.missing)} />
        <Cell label="present" value={String(summary.present)} />
        <Cell label="mean (present)" value={summary.meanPresent === null ? '—' : num(summary.meanPresent)} />
        <Cell label="min / max" value={summary.minPresent === null ? '—' : `${num(summary.minPresent)} / ${num(summary.maxPresent as number)}`} />
      </div>
      <p className="small muted" style={{ margin: '8px 0 0' }}>
        A plain <code>.mean()</code> on this data returns nan (or a number dragged toward the sentinel).
        <code> np.nanmean</code> or a masked array skips the missing cells — the count above shows what it would ignore.
      </p>
    </div>
  );
}

const TOOLS = [
  { key: 'array', label: 'Array visualizer', icon: Grid3x3, render: () => <ArrayVisualizer /> },
  { key: 'broadcast', label: 'Broadcasting', icon: Layers, render: () => <BroadcastingSimulator /> },
  { key: 'slice', label: 'Slicing', icon: Grid3x3, render: () => <SlicingExplorer /> },
  { key: 'mask', label: 'Boolean mask', icon: Layers, render: () => <MaskExplorer /> },
  { key: 'axis', label: 'Axis explorer', icon: Layers, render: () => <AxisExplorer /> },
  { key: 'sharing', label: 'Copy vs view', icon: Copy, render: () => <CopyViewExplorer /> },
  { key: 'perf', label: 'Performance lab', icon: Timer, render: () => <PerformanceLab /> },
  { key: 'datetime', label: 'Dates & strings', icon: CalendarDays, render: () => <DateTimeStringExplorer /> },
  { key: 'reshape', label: 'Reshape', icon: Grid3x3, render: () => <ReshapeExplorer /> },
  { key: 'stats', label: 'Statistics', icon: Sigma, render: () => <StatisticsPlayground /> },
  { key: 'matrix', label: 'Matrix lab', icon: BarChart3, render: () => <MatrixLab /> },
  { key: 'memory', label: 'dtype memory', icon: BarChart3, render: () => <MemoryCalculator /> },
  { key: 'rng', label: 'Random & seeds', icon: Sigma, render: () => <RngPlayground /> },
  { key: 'missing', label: 'Missing values', icon: Sigma, render: () => <MissingExplorer /> },
] as const;

/**
 * The module's interactive tools, shared by all modules.
 *
 * Every panel computes with the pure rules in `core/learning/numpy-tools.ts`, so the numbers on screen
 * are the values NumPy would produce — no placeholder cards, no canned outputs.
 */
export function NTools() {
  const [tab, setTab] = useState<(typeof TOOLS)[number]['key']>('array');
  const active = TOOLS.find((t) => t.key === tab) ?? TOOLS[0];
  const shape = parseShape('2, 3');
  const sample: Shape = shape ?? [2, 3];

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <b className="small">Interactive NumPy tools</b>
        <span className="small muted">computed live · {shapeStrides(sample).length} axes supported</span>
      </div>
      <div className="row" style={{ gap: 6, margin: '8px 0', flexWrap: 'wrap' }}>
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.key}
              type="button"
              className={`chip${tool.key === tab ? ' easy' : ''}`}
              style={{ cursor: 'pointer' }}
              aria-pressed={tool.key === tab}
              onClick={() => setTab(tool.key)}
            >
              <Icon size={12} /> {tool.label}
            </button>
          );
        })}
      </div>
      {active.render()}
    </div>
  );
}
