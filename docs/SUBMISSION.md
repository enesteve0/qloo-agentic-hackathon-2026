# Submission checklist

Event: [Qloo Agentic Hackathon 2026](https://qloo.devpost.com/). Rules checked: **2026-10-23**. See [research](RESEARCH.md) for supporting sources, conflicts and unresolved details.

Deadline: **October 30, 2026, 23:45 EDT (UTC-04:00)** / **October 31, 2026, 06:45 Europe/Istanbul**. Aim to finish well before this hard deadline; do not depend on upload-time extensions.

A box is ticked only with the evidence written next to it. Last updated 2026-10-29.

## Event requirements

- [ ] Confirm the Qloo event API key works; keep secrets outside Git and client-side bundles. *Waiting for the
      key in production. Secrets: server-only modules, no `NEXT_PUBLIC_` secrets, bundle grep in
      `pnpm audit:public` and gitleaks on the full history in CI.*
- [x] Select an agent workflow whose result materially depends on Qloo. *Neighborhoods, screens and ad copy
      all come from Qloo data ([product](PRODUCT.md), [architecture](ARCHITECTURE.md)); without Qloo a run
      has no plan.*
- [x] Record any reused code and significant event-period contributions; resolve ambiguous reuse terms.
      *[Provenance](PROVENANCE.md): no imported application code; implementation began 2026-10-26; Qloo
      harness semantics mirrored (MIT), no code copied; third-party notices in
      [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).*
- [ ] Provide reproducible setup/run instructions and redacted Qloo integration evidence. *Setup: README
      "Run it locally", verified by CI from a clean checkout on every push. Redacted live trace: after the
      key.*
- [ ] Publish the working demo externally and test its core journey without private invitations. *Public
      at https://usestoop.vercel.app since 2026-10-29; live AI writer (Groq) and Upstash storage since
      2026-10-30 00:05 Istanbul, checked with a live run on production; Qloo data still synthetic and
      labelled SYNTHETIC. 30 browser tests on the production build in CI. Live Qloo data: after the key.*
- [ ] When authorized to publish, make the source repo public and verify MIT is detected.
- [ ] Complete the feature description; video is optional, not required.
- [ ] Submit before October 30, 23:45 EDT / October 31, 06:45 Istanbul.
- [ ] Keep demo access working through the later published judging end: November 5, 23:45 EST.

## Release review

- [ ] Recheck the current official rules, schedule and event updates.
- [ ] Replace planning status with an accurate description of what actually works. *README rewritten
      2026-10-29; final pass after the live switch.*
- [ ] Verify instructions from a clean checkout and test the demonstrated user journey. *CI does both on
      mocks; repeat on the live demo before submitting.*
- [ ] Audit source and full Git history for secrets, private data and unlicensed assets. *gitleaks and
      trufflehog clean on 2026-10-29; repeat on the release commit.*
- [ ] Check source visibility and judge access against the event requirements.
- [ ] Record the submitted commit/tag, demo URL and artifact URLs in provenance.
- [ ] Check the applicable post-deadline edit restrictions and availability period.
