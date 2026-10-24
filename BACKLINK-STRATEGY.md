# Backlink strategy

Who this is for: the maintainer. It is not shipped (root `.md` files stay out of `dist/`), it is not
a feature, and no part of the app changes because of it — the app never phones home, so everything
below is done by hand or by publishing, never by runtime code.

The one rule this document exists to enforce: **a backlink is only worth earning once there is a live
URL to land on.** Every tactic below is gated on §0. Anything earlier sends people — and crawlers —
to a 404, and a stale `canonical` deindexes the real host (§4).

## 0. The gate — measured, not assumed

Measured 2026-10-05 with `curl` and the public GitHub API:

| What | State | Evidence |
| --- | --- | --- |
| Canonical origin `https://ashu018019020-collab.github.io/BroCode/` | **404** | `curl` → `HTTP 404`; `/BroCode/sitemap.xml` 404; host-root `/robots.txt` 404 |
| GitHub Pages | **off** | `GET api.github.com/repos/ashu018019020-collab/BroCode` → `"has_pages": false` |
| `package.json` `homepage` → `https://brocode-rouge.vercel.app` | **dead** | `curl` → `DEPLOYMENT_NOT_FOUND` ("The deployment could not be found on Vercel") |
| Repo reachability | public, but bare | `"visibility": "public"`, `stars: 0`, `forks: 0`, `description: null`, `topics: []` |
| License | **none** | `"license": null`, no `LICENSE`, `package.json` has no `license` field (and says `private: true`) |
| Crawl assets | ready | `public/sitemap.xml` (119 URLs, byte-for-byte asserted), `robots.txt`, canonical, JSON-LD graph, `public/brocode-og.png` 1200×630 |

So: nothing is live anywhere, no property can be verified in Search Console, and no link could
resolve. **Order of operations: publish → point every artifact at that ONE origin → verify Search
Console (`AGENTS.md` has the method) → submit the sitemap by URL → then §3.**

## 1. What backlinks do and do not fix

They do: discovery (a crawl path and a referral path that is not search), authority for the brand
query, and the first impression of a shared link — which is now a real card, not a bare URL, because
`public/brocode-og.png` exists.

They do not fix: an unpublished site; the name collision (§5); thin content (not a problem here —
13,865 published items); or indexing (that is Search Console's job, first).

## 2. What is genuinely link-worthy here

Write pitches around these, never around "another learning platform".

| Asset | Why a stranger would cite it | Where the number comes from |
| --- | --- | --- |
| The practice bank | **13,865** published items over a Hinglish-authored curriculum, with an English/Hinglish UI switch — a large rare-language corpus in a field dominated by English | `public/generated/search/index.json` → `counts.items`; `src/app/i18n/locales.ts` |
| Offline learning | Python (Pyodide), SQL (sql.js), notebooks, Monaco and the source PDF all run in the browser after first load — no sign-up for the learning path, and the account service is optional | `README.md`, `public/sw.js`, `scripts/tests/offline.test.cjs` |
| The reproducibility discipline | Artifacts asserted **byte-for-byte** against their generators (search index, sitemap, robots), 360 tests, a 1200×630 social card rendered by headless Chrome as a build step | `scripts/tests/*.test.mjs`, `scripts/og.cjs` |
| Breadth as data | 36 course steps, 11 courses, 29 sections, 8 tracks, 10 domains — all counted from registries, never typed by hand | `public/generated/**`, `index.html` JSON-LD |
| The free win nobody uses | The OG card is the exact 1200×630 GitHub wants for the repo's **Social preview** — set it and every GitHub link previews as the card | GitHub → repo → Settings |

What is *not* link-worthy, so it should not appear in a pitch: "offline" alone (every PWA claims it),
the hash-routed URL scheme, the emoji-free icon set, or anything about the tech stack without a
result attached.

## 3. Where links actually come from, by temperature

**Tier 0 — self-controlled, no outreach, do it the day the site is live**
1. Repo **About**: one-line description, the live URL as the website, and topics
   (`python`, `learning-platform`, `offline-first`, `pwa`, `hinglish`, `education`, `pyodide`,
   `sql-js`, `interview-preparation`) — topics are how GitHub's own search and topic pages link you.
2. Repo **Social preview** image = `public/brocode-og.png`.
3. `package.json` `homepage` set to the real origin (it currently points at a deleted deployment).
4. README: live demo link at the top, the counts in the pitch, screenshots, and a "Press kit" section
   (logo PNGs + card + one-paragraph description) so a writer can copy instead of asking.
5. Every fork inherits the README link — which is why step 4 matters more than any single outreach.

**Tier 1 — curated lists (gated on a LICENSE, see §6)**
`awesome-*` style lists and regional-resource lists. Realistic winners: lists that match
`offline-first`, `education`, `regional-language`, `python practice`. Each is a one-line PR; expect
rejections, and do not argue with maintainers. Kaggle/Hugging Face dataset pages are a link source
*if* the bank is exported as a dataset with provenance and a license.

**Tier 2 — communities where the project is the content**
Show HN (a weekday ~08:00–10:00 ET launch), Reddit's weekly self-promotion threads (never a
drive-by link: each sub has its own rule, e.g. a 9:1 participation ratio), and one long-form
write-up on dev.to or Hashnode ("How 13,865 practice items are kept byte-for-byte reproducible").
Product Hunt or Indie Hackers — pick one, not both.

**Tier 3 — earned, slow, highest quality**
Teachers and computer-lab coordinators (an offline lab for a lab with no internet is a real need),
Hinglish YouTube/Instagram educators (offer the bank as a free practice set), newsletters
(Python Weekly, PyCoder's Weekly) *when* there is a release and a story, and the Pyodide/Vite
communities when there is a specific bug or technique worth reporting.

**Tier 4 — rejected on purpose**
Paid links, PBNs, link exchanges, comment and forum spam, "write for us" farms, AI-generated
listicles. These violate search engines' link spam policies, and on a personal GitHub identity they
are a permanent liability attached to the name.

## 4. The canonical trap — do not deploy to a third host

Every crawl artifact currently names `https://ashu018019020-collab.github.io/BroCode/`:
`index.html` (canonical, OG/Twitter, JSON-LD), `scripts/sitemap.cjs`'s `DEFAULT_BASE`, `public`
(`sitemap.xml`, `robots.txt`). Meanwhile `package.json`'s `homepage` names a dead Vercel URL. If the
app is next deployed somewhere *else* and nobody regenerates those files, the live pages tell Google
"the real version of me is that 404" — the outcome is worse than not deploying: the real host
competes with a dead canonical and can be dropped from the index.

So pick one origin and make the repo agree with it in one pass:

- **GitHub Pages** at the existing canonical — nothing to regenerate (the artifacts already point
  there); flip Pages on and publish `dist/`. Requires a publish path: a `gh-pages` branch built from
  `npm run build`, since the repo has no CI and `dist/` is gitignored.
- **Vercel** — recreate the project, then regenerate: set `DEFAULT_BASE` in `scripts/sitemap.cjs`,
  `npm run sitemap:write`, update `index.html`'s canonical/OG/JSON-LD absolutes, and set
  `package.json`'s `homepage`.
- **A custom domain** — the same regeneration, plus the domain becomes the brand signal instead of
  the name collision in §5.

Whichever is chosen, the check afterwards is mechanical: every absolute URL in `index.html` plus
every `<loc>` in `sitemap.xml` must return 200 on that origin, and the OG card must fetch.

## 5. The name collision

"BroCode" is already a TV-show phrase and a common repo name, so the bare brand query is polluted.
Practical rules that cost nothing:

- Always pair the name with a qualifier in titles, anchors and descriptions: **"BroCode, the offline
  technology learning platform"**. Prefer anchors like "BroCode offline learning platform" over
  "click here" or "this app".
- Target the qualifying search: `offline learning platform`, `offline python practice`, `hinglish
  python questions`, `pyodide practice app`, `no internet coding practice`.
- Own the URLs that carry the brand: the repo path (`github.com/ashu018019020-collab/BroCode`) and
  the eventual origin. Consistency of handle across GitHub, dev.to, Reddit and Hugging Face matters
  more than any single link.

## 6. Immediate repo-side fixes (a licence is a link prerequisite)

Many curated lists and every dataset reuse require an explicit licence; today the repo is
all-rights-reserved by default, `package.json` says `private: true`, and the API reports no licence.
Decide the licence before Tier 1 — MIT or Apache-2.0 maximise reuse and links, AGPL-3.0 protects
against closed reuse but lists will reject it, and "no licence" means only the repo itself can be
linked. Then: add `LICENSE`, set `package.json`'s `license` (and clear `private` if the package is
meant to be reused), and add the same licence line to the README and to any dataset export.

## 7. Templates

**Awesome-list PR** — title: `Add BroCode (offline-first practice platform)`. Body: one line ≤100
chars, alphabetical position, and the two facts maintainers ask for: the live URL, the licence, and
"runs entirely offline in the browser, 13,865 practice items in Hinglish". One PR per list; never
batch-edit lists you have not read.

**Show HN** — title: `Show HN: BroCode – an offline-first learning platform that runs in the
browser`. First comment: what it is, who it is for, the one hard problem (13,865 items kept
byte-for-byte reproducible with no build server), what is unfinished, and a direct link. Answer
criticism with facts, never defensiveness; do not repost for at least a few months.

**Reddit weekly thread** — post the *thing that helps* (a free practice set, a printable sheet), with
the link inside the post. Read the sub's self-promotion rule first; a removed post is a wasted week.

**Educator email** (≤150 words) — who you are, what runs where (browser, no internet, no accounts,
no data leaves the machine), what you will give them (the full bank as a printable/offline set),
and one ask: feedback, not a link. Links come from use, not from asking.

**Newsletter pitch** — three sentences: what it is, the audience it serves, the single most
interesting engineering fact. Attach nothing; link the repo.

## 8. Measurement without analytics

The app has no telemetry by design, so measurement is external:

- **Search Console → Links** (top linking sites, anchor text) — needs the §0 gate; reports lag weeks.
- **Search Console → Performance** for brand and long-tail queries (§5's qualifiers).
- **GitHub → Insights → Traffic → Referring sites** — a free, real backlink report for the repo.
- **Vercel/other host logs** if that origin is used; GitHub Pages exposes no logs at all, which is
  itself an argument for pairing Pages with GSC.
- Baseline table to fill after publish: linking sites, referring sites, brand impressions, stars,
  forks. What cannot be known — how visitors behave inside the app — should not be claimed anywhere.

## 9. Cadence

| When | Do | Done when |
| --- | --- | --- |
| Week 0 | Pick the origin and the licence; publish; regenerate artifacts if the origin moved | Every artifact URL returns 200, GSC property verified, sitemap submitted |
| Week 1 | Tier 0: About, topics, social preview, README press kit, `homepage` fixed | GitHub link previews show the card; topics render on the repo page |
| Week 2 | One Show HN and one write-up (same week, so the traffic has somewhere to land) | Both live; every comment answered with facts |
| Week 4 | Two awesome-list PRs matching the licence; three educator emails | PRs opened (acceptance is not in your control); replies tracked |
| Week 8 | Read GSC Links + GitHub referrers; double down on the one channel that produced links | A ranked list of channels by links earned, and one decision to continue or drop |

## 10. Honesty rules

- Every number in a pitch comes from a registry and names it: 13,865 items → **"13,000+
  questions"** (`public/generated/search/index.json`), 36 steps and 11 courses
  (`public/generated/courses/index.json`), 476 archive items, 29 sections, 10 domains. `index.html`'s
  own claims are pinned by `scripts/tests/sitemap.test.mjs` — a pitch that oversells contradicts the
  tested shell.
- Never claim users, students, downloads or "used by" — there are no such numbers, and inventing one
  poisons every later ask.
- Never link to a 404, and never publish before §0. A broken link spends the one first impression a
  channel gives you.
- No fabricated benchmarks. Be exact about what "offline" means here, because it is a pinned
  property and not a slogan: the runtimes and the PDF are bundled, guest learning needs no account,
  and `scripts/tests/offline.test.cjs` asserts the service worker's cache coverage of
  `/generated/` and `/notebooks` (network-first, cache fallback). "Fast", "SEO-friendly" and "used
  by" are not claims this repo can back, so they do not appear in a pitch.
