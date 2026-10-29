# Lessons

Patterns learned from corrections and surprises during this build. Each entry: what happened, the
rule that prevents it, and how to check.

## 2026-10-26

- **zsh clobbers `PATH` when a loop variable is named `path`.** A `for path in …` loop made `curl`
  and `python3` "command not found". Rule: never name a shell variable `path` (use `pg`, `u`, `f`).
- **Devpost blocks WebFetch (403) but serves normal HTML to curl with a browser User-Agent.** Rule:
  fetch Devpost pages with curl + UA and strip HTML locally.
- **Overpass (OpenStreetMap) returns 406 without a descriptive User-Agent.** Rule: always send one.
- **Public counts need filtering before use.** The LinkNYC dataset has 2,255 rows but only 2,183
  live, ad-capable kiosks, and its NTA field uses 2010 names. Rule: derive counts and joins from the
  data, never from a headline row count.
- **Branching: the owner wants all work on `master` only — no feature branches, no PRs** (correction,
  2026-10-26, overriding the repo's earlier "focused branches" convention). Rule: commit directly on
  `master`; never run `git checkout -b`/`git switch -c`; check `git branch --show-current` before
  committing.
- **Commits: no `Co-Authored-By` or "Generated with" trailers** (owner instruction, 2026-10-26).
  Committing and pushing to `master` is pre-approved. Rule: plain conventional-commit messages;
  before every push, `git log --format=%B origin/master..HEAD | grep -i co-authored` must be empty.
- **Parallel agents share the working tree: never `git add -A` while they run.** Stage explicit
  paths that you wrote and reviewed (e.g. `git add src/data scripts/build-geo.ts`), then check
  `git diff --cached --name-only` before committing.
- Next.js loads route handlers and pages as separate module instances in one process. A process-wide
  singleton that must be shared (the in-memory KV) has to live on `globalThis`, or a run saved by the
  API is invisible to the page that renders it. Test reload-after-stream in a production build.
- Release per-run shared resources (the cross-run Qloo slot) right after the last stage that needs
  them and again in `finally`; a leak only shows up on the third back-to-back run, so test that.
- Don't hand-pick sample cells in tests of a generator that drops random cells; pick them
  programmatically (the synthetic heatmap's 2.5% "holes" broke a fixed geohash).
- A cache key must cover everything the cached output shows. The identical-brief key ignored dates and
  address (both visible in the plan), so one visitor could see another's. Include the data mode too, or a
  synthetic result gets served as a live one.
- Get an independent review of the judge-facing path. One reviewer pass found ten real bugs (8
  reproduced with throwaway tests) that unit, integration and e2e suites all missed.
- Test mocks in route tests: scope a failure flag to the request under test, or the mock also breaks the
  fallback path that should rescue it.

## 2026-10-29

- **A URL rewritten with `history.replaceState` leaves the router on the old route.** After a live run moved
  `/plan/new` to `/plan/<id>` in place, a `<Link href="/plan/new">` counted as a same-page navigation and the
  old run stayed on screen. Rule: links that must reset client state after an in-place URL rewrite (new
  brief, the sample plan from the error page) are plain `<a>` with a reasoned lint disable; e2e-test them in
  the same visit, not after a reload.
- **Count what the reader means.** The optimizer listed every top neighborhood, including ones the budget
  could not reach, so "1 screens · 3 neighborhoods" reached the ticker, the PLAN heading and the agent log.
  Rule: derived counts come from rows that carry the thing counted; test one-of and zero-of cases.
- **A second independent review paid off again** (four real bugs in the design polish pass, all missed by
  unit, integration and browser tests). Rule: review every large judge-facing change before a freeze.
- **Run the real model early.** The first live Groq runs (Thursday night, after the planned prompt freeze)
  showed three things no mock test could: the prompt said "used in the copy" while the validator only
  read the headline and body, so most offer-led ads were thrown away; models overshoot character limits
  by one or two; the small model picks wrong-type and mass-market anchors. Rule: get a free model key on
  day one, run a batch of real briefs and read why each ad failed before freezing prompts. Ask the model
  for a margin under hard limits.
- **Keep what passed.** A batch that missed the half-way bar was discarded whole, even ads that passed
  every rule. With one configured provider that meant six templates. Rule: when no retry is left, keep
  the best answer's passing parts.
- **Compare storage drivers against the real backend.** Upstash's client decodes JSON-looking strings
  ("123" comes back as 123); the in-memory store does not. A 30-line script running the same operations
  on both found it in a minute.
- **Credentials and terms need the owner.** The browser cannot sign in, accept third-party terms,
  create API keys or search mail for keys, even with a general go-ahead. Plan these as owner steps and
  hand over clipboard one-liners (`pbpaste` into a git-ignored file) so keys never pass through chat.
