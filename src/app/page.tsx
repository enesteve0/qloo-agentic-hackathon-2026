import MapClient from '@/components/map/MapClient';
import meta from '@/data/meta.json';

const fmt = new Intl.NumberFormat('en-US');

export default function Home() {
  const { counts } = meta;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between border-b-2 border-surface-2 px-4 py-3 sm:px-6">
        <p className="sign-plate px-2 py-0.5 text-xl" aria-label="Stoop">
          Stoop
        </p>
        <p className="font-mono text-xs text-muted">Qloo Agentic Hackathon 2026</p>
      </header>

      <main id="main" className="flex flex-1 flex-col">
        <section className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:py-16">
          <div className="flex flex-col gap-5">
            <h1 className="font-display text-5xl leading-[0.95] font-bold uppercase sm:text-6xl lg:text-7xl">
              Most ad tech knows where phones go.
              <span className="mt-2 block text-amber">Stoop knows what neighborhoods love.</span>
            </h1>
            <p className="max-w-xl text-lg text-muted">
              The AI media planner for New York&apos;s street screens. Describe your business and budget. In about a
              minute, Stoop picks the screens, writes an ad for each neighborhood, and shows the Qloo taste evidence
              behind every choice.
            </p>
            <p className="ticker text-sm" role="status">
              Live demo opening soon
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-px self-end border-2 border-surface-2 bg-surface-2">
            {[
              [fmt.format(counts.kiosks), 'live ad-capable street screens'],
              [fmt.format(counts.eligibleNtas), 'neighborhoods with 2+ screens'],
              [fmt.format(counts.gridCells), 'taste-map cells over the city'],
              ['0', 'phones tracked'],
            ].map(([value, label]) => (
              <div key={label} className="bg-bg p-4">
                <dt className="text-sm text-muted">{label}</dt>
                <dd className="font-display text-4xl font-bold text-text">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="map-heading" className="border-y-2 border-surface-2">
          <h2 id="map-heading" className="sr-only">
            Every live LinkNYC street screen in New York City
          </h2>
          <div className="h-[62vh] min-h-[420px] w-full">
            <MapClient
              className="h-full w-full"
              ariaLabel={`Night map of New York City showing ${fmt.format(counts.kiosks)} live ad-capable LinkNYC street screens`}
            />
          </div>
        </section>
      </main>

      <footer className="flex flex-col gap-2 px-4 py-6 text-xs text-muted sm:px-6">
        <p>
          Screens: NYC Open Data (LinkNYC Locations, s4kf-3yrf; 2020 Neighborhood Tabulation Areas, 9nt8-h7nd). Map:
          OpenFreeMap, OpenMapTiles, © OpenStreetMap contributors. Taste data: Qloo.
        </p>
        <p>
          No phones tracked. Nothing about you goes to Qloo. Not affiliated with LinkNYC, Intersection, CityBridge or
          the City of New York.
        </p>
      </footer>
    </div>
  );
}
