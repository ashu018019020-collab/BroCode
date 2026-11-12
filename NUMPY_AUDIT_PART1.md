# NumPy course — Part 1 audit (measured)

Every number below comes from the shipped artifact, the route table or a live HTTP check — commands
are quoted so they can be re-run. Nothing is inferred from memory.

## 1. Live site

| Check | Command | Result |
|---|---|---|
| Home reachable | `curl -s -o /dev/null -w '%{http_code}' https://mybrocode.vercel.app/` | **200** |
| NumPy course listed in the sitemap | `curl -s .../sitemap.xml \| grep numpy` | `https://mybrocode.vercel.app/#/numpy` |
| Course artifact served | `curl .../generated/numpy-course/index.json` | **200**, 1,480,623 bytes |
| Hash route is the real URL | route table `src/app/App.tsx:934` | `/#/numpy` (HashRouter), not `/numpy` |
| Direct `/numpy` | `curl -s -o /dev/null -w '%{http_code}' .../numpy` | **404** — expected on a hash router; the sitemap and in-app links use the hash form |
| Route is gated | `App.tsx:934` | wrapped in `<Protect>` — sign-in required, so module screens cannot be inspected anonymously |

**What I could not verify live:** the rendered module screens, tab behaviour and click-through. The
product requires an account (`docs/AUTHENTICATION.md`), and there is no browser session available to
this run. Those are covered by the source and artifact checks below, and the shipped chunk is
verified byte-for-byte (section 5), but a human click-through is still outstanding.

## 2. Structure found (artifact scan)

`node -e "…index.json…"` over all 20 modules:

| Section | Records | Has code | Has output | Has check | Rubric | Options |
|---|---:|---:|---:|---:|---:|---:|
| Learn | 240 | 240 | 240 | 0 | 0 | 0 |
| Interview | 420 | 240 | 0 | 0 | 0 | 0 |
| Coding Lab | 500 | 0 (500 starters) | 0 | 500 | 0 | 0 |
| Logic | 240 | 240 | 0 (answer field) | 0 | 0 | 0 |
| Debug | 200 | 200 | 0 (error + fix) | 0 | 0 | 0 |
| Practice Solutions | 240 | **0** (`solution` field) | **0** (`expected`) | 0 | 0 | 0 |
| Mini Project | 20 | 0 (`body` + steps) | 0 | 0 | 0 | 0 |
| Project Lab | 20 | 0 (`body` + steps) | 0 | 0 | 0 | 0 |
| Defense | 180 | 0 | 0 | 0 | 0 | 0 |
| Checkpoint | 480 | 240 | 0 | 0 | 240 | 240 |

- Empty sections: **0**.
- Duplicate entry ids: **0**. Duplicate question text: **0**.
- Learn bodies reused by another section: **0** of 280 distinct bodies.
- Learn titles repeated across modules: **0**.

## 3. Problems found (and what was done)

| Audit area | Current situation | Problem | Action |
|---|---|---|---|
| Practice Solutions | Data lives in `task` / `solution` / `expected` | The new workspace read only `statement` / `code`, so 240 practice records showed a title and an empty cell | **Fixed**: `TopicCard` reads `task`, the cell panel loads `solution`, grading compares `expected` |
| Mini Project / Project Lab | `body` + `steps` only | Left panel showed nothing (no `statement`) | **Fixed**: `body` is rendered as the brief with its steps |
| Logic | `answer` only | Learner had no way to predict then reveal | **Fixed**: reveal button for the verified answer |
| Interview / Defense | `answer` only | Answers were not reachable from the card | **Fixed**: reveal button (authored answers, never a Learn body) |
| Debug | `code` + `error` + `fix` | Error was not shown, fix was unreachable | **Fixed**: error chip + reveal for the fix |
| Chapter screens | All 20 modules | Only Learn/Coding/Debug had a fully populated cell | **Fixed** by the field mapping above; every module uses the same component |
| Progress persistence | `nmod:` / `nans:` / `ntick:` keys in localStorage | Not part of the account progress payload (`src/core/auth/client.ts`) — key family is course-local | **Open**: progress survives refresh on one device, but does not sync across devices |
| Mobile layout | `minWidth: 260` on the course header, 320px-cap elsewhere | One fixed 260px block on the narrowest screens | **Open**: harmless on 320px+ but should become `min(260px, 100%)` |
| Course length | 20 modules × 127 = 2,540 | Brief asks 500 items per module (10,000) | **Open**: 7,460 short; ledger tracks it |

## 4. Progress saving — how it actually behaves

- A section records `nmod:<module>:<section>` in `AppState.attempts`; written checkpoints also store
  `nans:<entry>` and `ntick:<entry>`.
- `setState` writes the whole state to localStorage synchronously, so a refresh keeps progress and
  rubric ticks.
- Written drafts use `useSavedAnswer` (400 ms debounce, flush on unmount), so typing is not lost on
  navigation.
- The module's completion rule needs all ten sections — a checkpoint alone never completes it
  (`isModuleComplete`), and a test pins that.

## 5. Shipped-code verification

`npm run typecheck` · `npm test` · `npm run build`, then the lazy chunk is compared byte-for-byte
against the deployed one (`cmp`), which is how the live bundle hash and its markers are confirmed.
That proves the audited code is the code users receive; it does not replace a signed-in click-through.
