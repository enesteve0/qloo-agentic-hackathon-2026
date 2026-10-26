import Link from 'next/link';
import { NavLinks } from './Header';

/** Site footer: navigation, data credits and the privacy line (same credits as the original landing page). */
export function Footer() {
  return (
    <footer className="border-t-2 border-surface-2 bg-bg">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/" aria-label="Stoop home" className="sign-plate sign-plate-rim m-0.5 px-2 py-0.5 text-xl leading-none text-sign-text no-underline">
            Stoop
          </Link>
          <nav aria-label="Footer" className="-mx-2">
            <NavLinks />
          </nav>
        </div>
        <div className="flex flex-col gap-2 text-xs text-muted">
          <p>
            Screens: NYC Open Data (LinkNYC Locations, s4kf-3yrf; 2020 Neighborhood Tabulation Areas, 9nt8-h7nd). Map:
            OpenFreeMap, OpenMapTiles, © OpenStreetMap contributors. Taste data: Qloo.
          </p>
          <p>
            No phones tracked. Nothing about you goes to Qloo. Not affiliated with LinkNYC, Intersection, CityBridge or the City of
            New York.
          </p>
          <p className="font-mono">Qloo Agentic Hackathon 2026</p>
        </div>
      </div>
    </footer>
  );
}
