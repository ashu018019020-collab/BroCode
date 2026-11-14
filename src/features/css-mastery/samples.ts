/**
 * Starter and example documents for the CSS playground.
 *
 * They are DATA, not the page's own markup: the course page owns the single h1 of the rendered page,
 * and the playground owns the sandboxed preview document.
 *
 * The HTML editor holds body markup only; the CSS editor holds declarations only. The playground
 * assembles the document, which is what lets a learner see one stylesheet beside one fragment
 * without writing boilerplate every time.
 */
export const STARTER_HTML = `<div class="card">
  <h1>Hello BroCode!</h1>
  <p>My CSS journey starts here.</p>
  <a class="btn" href="#">Start learning</a>
</div>
`;

export const STARTER_CSS = `body {
  font-family: system-ui, sans-serif;
  padding: 24px;
  background: #f8fafc;
}

.card {
  max-width: 420px;
  padding: 24px;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
}

h1 {
  margin: 0 0 8px;
  color: #2965f1;
}

.btn {
  display: inline-block;
  margin-top: 12px;
  padding: 10px 16px;
  border-radius: 8px;
  background: #2965f1;
  color: #ffffff;
  text-decoration: none;
}
`;

export const EXAMPLE_HTML = `<section class="pricing">
  <header>
    <p class="eyebrow">Pro plan</p>
    <h1>₹499 / month</h1>
    <p class="note">Everything you need to finish the course.</p>
  </header>
  <ul>
    <li>All 24 modules</li>
    <li>Sandboxed playground</li>
    <li>Debug challenges</li>
  </ul>
  <a class="cta" href="#">Choose Pro</a>
</section>
`;

export const EXAMPLE_CSS = `body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  font-family: system-ui, sans-serif;
  background-image: linear-gradient(135deg, #2965f1, #7c3aed);
}

.pricing {
  width: min(100%, 360px);
  padding: 28px;
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
}

.eyebrow {
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 12px;
  color: #2965f1;
}

h1 {
  margin: 4px 0 8px;
  font-size: 2rem;
}

.note {
  margin: 0 0 16px;
  color: #475569;
}

ul {
  margin: 0 0 20px;
  padding-left: 18px;
  color: #334155;
}

li { margin-bottom: 6px; }

.cta {
  display: block;
  padding: 12px 16px;
  border-radius: 10px;
  background: #2965f1;
  color: #ffffff;
  text-align: center;
  text-decoration: none;
}
`;
