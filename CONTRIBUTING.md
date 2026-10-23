# Contribution workflow

Start with [research](docs/RESEARCH.md), [the submission checklist](docs/SUBMISSION.md) and [agent instructions](AGENTS.md). Confirm the event's work window before starting implementation.

Use short-lived branches such as `docs/update-requirements`, `feat/selected-workflow` or `fix/demo-access`. Keep changes focused and use descriptive conventional commits (`docs:`, `feat:`, `fix:`, `chore:`). Submit a pull request with the included template; squash merge is configured and merged branches are deleted automatically. Required reviewer approvals and protected-branch enforcement are not asserted by this foundation.

For documentation, review internal links, factual sources, dates and `git diff --check`. For application changes, run the project's documented build/tests and check the demonstrated journey. The application stack and CI will be selected with implementation; no passing build or runtime integration is claimed now.

Record reused work, licenses and significant decisions in [provenance](docs/PROVENANCE.md). Keep secrets outside Git, respect publication instructions, and observe the event-specific submission freeze.
