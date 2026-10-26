'use client';

import dynamic from 'next/dynamic';
import type { NightMapProps } from './NightMap';

/** MapLibre needs `window`; load the map only in the browser. */
const NightMap = dynamic(() => import('./NightMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-surface">
      <p className="ticker text-sm">Loading the city…</p>
    </div>
  ),
});

export default function MapClient(props: NightMapProps) {
  return <NightMap {...props} />;
}
