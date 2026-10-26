'use client';

import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RunScreen, type RunScreenProps } from '@/components/run/RunScreen';

type Props = Omit<RunScreenProps, 'onAnswer' | 'onRunLive' | 'onRetry' | 'notice'>;

/** The synthetic sample plan with demo-only behavior: answering the question resumes to the finished sample. */
export function DemoRun(props: Props) {
  const router = useRouter();
  const [liveNote, setLiveNote] = useState(false);
  return (
    <RunScreen
      {...props}
      onAnswer={() => router.push('/plan/demo?view=where')}
      onRetry={() => router.push('/plan/demo')}
      onRunLive={() => setLiveNote(true)}
      notice={
        liveNote ? (
          <div className="flex items-start gap-3 border-2 border-link bg-surface p-4">
            <p className="flex-1">
              <span className="font-display text-lg font-bold tracking-[0.04em] uppercase">Live runs start from a brief. </span>
              <span className="text-muted">
                This sample is synthetic, so there is nothing live to replay. When the Qloo key is active, Run live plans this brief
                with real taste data and streams every Qloo call into the agent log.
              </span>
            </p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setLiveNote(false)}
              className="grid size-8 shrink-0 place-items-center border-2 border-surface-2 hover:border-text"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        ) : null
      }
    />
  );
}
