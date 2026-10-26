'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { applyPart, emptyRunView, readUiMessageSse, viewFromState, type RunView } from '@/shared/stream';
import type { Brief, ResolutionChoice, RunExtras, RunState } from '@/shared/types';

const POLL_MS = 2_000;
const POLL_GIVE_UP_MS = 240_000;

export type LiveRunRequest =
  | { mode: 'start'; brief: Brief; presetSlug?: string | null }
  | { mode: 'resume'; runId: string; choices: ResolutionChoice[] };

export interface LiveRun {
  view: RunView;
  /** Problems with the request itself (validation, expired run); capacity problems arrive as `view.fallback`. */
  error: { message: string; details: string[] } | null;
  busy: boolean;
  start: (brief: Brief, presetSlug?: string | null) => Promise<void>;
  answer: (choices: ResolutionChoice[]) => Promise<void>;
}

/** Where a run lives once it has an id: recorded presets under /p/, everything else under /plan/. */
function runPath(state: RunState): string {
  return state.label?.kind === 'recorded' && state.presetSlug ? `/p/${state.presetSlug}` : `/plan/${state.id}`;
}

/**
 * Starts, resumes and follows a plan. Streams POST /api/runs through the shared `applyPart` reducer; if the
 * stream drops (or the page was reloaded mid-run) it polls the saved run until it settles.
 */
export function useLiveRun(initial: RunState | null = null): LiveRun {
  const [view, setView] = useState<RunView>(() => (initial ? viewFromState(initial) : emptyRunView()));
  const [error, setError] = useState<LiveRun['error']>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const pathRef = useRef<string | null>(null);

  const syncUrl = useCallback((state: RunState | null) => {
    if (!state) return;
    const path = runPath(state);
    if (pathRef.current === path || window.location.pathname === path) return;
    pathRef.current = path;
    window.history.replaceState(null, '', path);
  }, []);

  const follow = useCallback(
    async (runId: string, signal: AbortSignal) => {
      const until = Date.now() + POLL_GIVE_UP_MS;
      while (!signal.aborted && Date.now() < until) {
        const res = await fetch(`/api/runs/${runId}`, { cache: 'no-store', signal }).catch(() => null);
        if (res?.ok) {
          const { extras, ...state } = (await res.json()) as RunState & { extras?: RunExtras | null };
          setView((v) => ({ ...viewFromState(state), fallback: v.fallback, extras: extras ?? v.extras }));
          syncUrl(state);
          if (state.status !== 'running') return;
        } else if (res?.status === 404) {
          setError({ message: 'That plan has expired. Start a new one.', details: [] });
          return;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    },
    [syncUrl],
  );

  const send = useCallback(
    async (request: LiveRunRequest) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setError(null);
      if (request.mode === 'start') setView(emptyRunView());
      let latest: RunView = request.mode === 'start' ? emptyRunView() : view;
      try {
        const res = await fetch('/api/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        const type = res.headers.get('content-type') ?? '';
        if (!type.includes('text/event-stream') || !res.body) {
          const body = (await res.json().catch(() => ({}))) as { error?: string; errors?: string[]; runId?: string; follow?: boolean };
          if (body.follow && body.runId) {
            await follow(body.runId, controller.signal);
            return;
          }
          setError({ message: body.error ?? 'Something went wrong. Try again.', details: body.errors ?? [] });
          return;
        }
        for await (const part of readUiMessageSse(res.body)) {
          latest = applyPart(latest, part);
          setView(latest);
          if (part.type === 'data-run' || part.type === 'data-snapshot') syncUrl(latest.state);
        }
        syncUrl(latest.state);
        // The stream can end early (network, deploy); the run itself keeps going on the server.
        if (latest.state && !latest.done && latest.state.status === 'running') await follow(latest.state.id, controller.signal);
      } catch {
        if (controller.signal.aborted) return;
        if (latest.state && latest.state.status === 'running') await follow(latest.state.id, controller.signal);
        else setError({ message: 'The connection dropped. Try again.', details: [] });
      } finally {
        if (abortRef.current === controller) setBusy(false);
      }
    },
    [follow, syncUrl, view],
  );

  // A reload in the middle of a run: keep watching the saved state.
  useEffect(() => {
    if (!initial || initial.status !== 'running') return;
    const controller = new AbortController();
    abortRef.current = controller;
    // The server just rendered this state, so the first check waits one poll interval.
    const timer = setTimeout(() => void follow(initial.id, controller.signal), POLL_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [initial, follow]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback((brief: Brief, presetSlug?: string | null) => send({ mode: 'start', brief, presetSlug }), [send]);
  const answer = useCallback(
    (choices: ResolutionChoice[]) => {
      const runId = view.state?.id;
      return runId ? send({ mode: 'resume', runId, choices }) : Promise.resolve();
    },
    [send, view.state?.id],
  );

  return { view, error, busy, start, answer };
}
