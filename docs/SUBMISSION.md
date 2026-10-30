# Submission checklist

Event: [Qloo Agentic Hackathon 2026](https://qloo.devpost.com/). Rules checked: **2026-10-23**. See [research](RESEARCH.md) for supporting sources, conflicts and unresolved details.

Deadline: **October 30, 2026, 23:45 EDT (UTC-04:00)** / **October 31, 2026, 06:45 Europe/Istanbul**. Aim to finish well before this hard deadline; do not depend on upload-time extensions.

A box is ticked only with the evidence written next to it. Last updated 2026-10-30.

## Event requirements

- [ ] Confirm the Qloo event API key works; keep secrets outside Git and client-side bundles. *No working key
      on 2026-10-30 (none in the owner's inbox); the owner is requesting one through the form, the Devpost
      forum, Discord and ian@qloo.com. The submission says so and runs on labelled synthetic data; going live
      is `QLOO_MODE=live`. Secrets: server-only modules, no `NEXT_PUBLIC_` secrets, bundle grep in
      `pnpm audit:public` and gitleaks on the full history in CI.*
- [x] Select an agent workflow whose result materially depends on Qloo. *Neighborhoods, screens and ad copy
      all come from Qloo data ([product](PRODUCT.md), [architecture](ARCHITECTURE.md)); without Qloo a run
      has no plan.*
- [x] Record any reused code and significant event-period contributions; resolve ambiguous reuse terms.
      *[Provenance](PROVENANCE.md): no imported application code; implementation began 2026-10-26; Qloo
      harness semantics mirrored (MIT), no code copied; third-party notices in
      [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).*
- [x] Provide reproducible setup/run instructions and redacted Qloo integration evidence. *Setup: README
      "Run it locally", verified by CI from a clean checkout on every push. Every plan's agent log copies a
      redacted trace of its Qloo requests; the Devpost text quotes the Halfnote sample plan's (requests as the
      live client sends them, answers synthetic, and it says so).*
- [x] Publish the working demo externally and test its core journey without private invitations. *Public
      at https://usestoop.vercel.app since 2026-10-29; live AI writer (Groq) and Upstash storage since
      2026-10-30 00:05 Istanbul, checked with a live run on production; Qloo data still synthetic and
      labelled SYNTHETIC. The six sample plans were recorded on 2026-10-30 with the live AI planner and
      writer on synthetic data (36 of 36 model-written ads passed the copy rules). 30 browser tests on the
      production build in CI. Live Qloo data: after a key.*
- [x] When authorized to publish, make the source repo public and verify MIT is detected. *Owner's
      instruction 2026-10-30 17:49 Istanbul (recorded in [provenance](PROVENANCE.md)); public after the
      release audit; logged out: page 200, `private: false`, MIT; secret scanning and push protection on.*
- [x] Complete the feature description; video is optional, not required. *Devpost About (no-key version),
      thumbnail, 10 captioned gallery images, 17 "Built with" tags, demo and repo links, additional info.
      No video at submission (the owner has no YouTube channel yet).*
- [x] Submit before October 30, 23:45 EDT / October 31, 06:45 Istanbul. *Submitted 2026-10-30 at about
      17:58 Istanbul (10:58 ET):
      https://devpost.com/software/stoop-ai-media-planner-for-nyc-street-screens*
- [ ] Keep demo access working through the later published judging end: November 5, 23:45 EST.

## Release review

- [x] Recheck the current official rules, schedule and event updates. *2026-10-30 12:40 Istanbul: rules text
      unchanged from 2026-10-29; deadline still October 30, 23:45 EDT; no new updates since "Final call"
      (Oct 28). Judging period: November 2, 12:00 ET to November 5, 23:45 ET.*
- [x] Replace planning status with an accurate description of what actually works. *README rewritten
      2026-10-29; 2026-10-30: status row, validation line and limitations say there is no working key and
      the data is synthetic.*
- [x] Verify instructions from a clean checkout and test the demonstrated user journey. *CI runs the README
      setup from a clean checkout and 30 browser tests on every push (green on 65d2d20); the judge path was
      checked on production on 2026-10-30 (sample plan, all five views, agent log, a fresh live brief).*
- [x] Audit source and full Git history for secrets, private data and unlicensed assets. *gitleaks,
      trufflehog and `pnpm audit:public` clean on 2026-10-30 at 6c0333c (79 commits), before publication.*
- [x] Check source visibility and judge access against the event requirements. *Logged out on 2026-10-30
      17:59 Istanbul: public repository (MIT), demo without login and the Devpost page all return 200.*
- [x] Record the submitted commit/tag, demo URL and artifact URLs in provenance. *[Submission
      record](PROVENANCE.md#submission-record): tag `v1.0.0-submission` → 65d2d20.*
- [x] Check the applicable post-deadline edit restrictions and availability period. *Rules §5: no changes to
      the Submission after the submission period, except material Qloo and Devpost ask to remove; the project
      must stay free and unrestricted until the judging period ends (November 5, 23:45 ET). Turning on live
      Qloo data after the deadline therefore needs Qloo's written permission (asked in the key request).*

## Kit submission guide

The official kit's [submission guide](https://github.com/qloo/qloo-hackathon-kit/blob/main/docs/SUBMISSION.md)
asks for six things; where each one is:

1. Problem statement: Devpost "Inspiration" and README intro.
2. The Qloo workflow used and why it fits: Devpost and README "How Stoop uses Qloo" (direct REST from the
   server; no harness workflows or MCP at run time).
3. A redacted request-to-result explanation, with entity and tag choices: Devpost "One plan, request to
   result" and every plan's agent log ("Copy redacted trace").
4. Screenshots or a demo with no credentials or personal data: Devpost gallery from the public demo.
5. Setup from a clean environment: README "Run it locally (no keys needed)", run by CI on every push.
6. Known limitations and what the result does not establish: README and Devpost "Known limitations", and
   each Qloo stage's "what this supports" note in the agent log.
