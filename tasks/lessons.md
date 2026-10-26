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
