# Working instructions

This is the private preparation workspace for Qloo Agentic Hackathon 2026. Read README.md, docs/RESEARCH.md, docs/SUBMISSION.md and docs/PROVENANCE.md before changing the project.

## Event-specific boundary

Qloo API access has not been verified. An externally hosted public demo and public source are submission requirements; this foundation remains private until a separate publication instruction.

## Development

- Confirm the current official rules and eligible work dates before implementation. Preserve unresolved facts instead of inventing requirements.
- Follow the selected product and stack once the owner chooses them; this foundation makes neither choice.
- Keep each hackathon's source and provenance separate. Never infer cross-event reuse permission.
- Keep repository visibility private unless the owner explicitly instructs otherwise. A documented public-submission requirement is not permission to publish immediately.
- Never commit credentials, real customer data, or private account details. Use placeholder-only configuration examples when configuration actually exists.
- Preserve third-party license notices and check model/API terms separately.
- Document real setup, tests, required integration evidence and demo behavior as implementation is added. Do not claim an untested integration or mark checklist items complete without evidence.
- Run checks appropriate to the change. For this foundation, review Markdown links and whitespace; add runtime checks and CI with the actual implementation.
- Record baseline imports, material decisions and submission revisions in docs/PROVENANCE.md. Respect any submission freeze.

## Repository conventions

Work directly on `master` only — do not create other branches or pull requests (owner instruction, 2026-10-26). Use descriptive conventional commits. Keep documentation in English. Repository-local Git identity is configured; do not change global Git settings.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
