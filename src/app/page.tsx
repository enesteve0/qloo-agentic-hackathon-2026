export default function Home() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-5xl flex-col justify-center gap-8 px-6 py-16">
      <p className="sign-plate inline-block w-fit px-3 py-1 text-2xl">Stoop</p>
      <h1 className="font-display text-5xl leading-none font-bold uppercase sm:text-7xl">
        Most ad tech knows where phones go.
        <br />
        <span className="text-amber">Stoop knows what neighborhoods love.</span>
      </h1>
      <p className="max-w-2xl text-lg text-muted">
        The AI media planner for New York&apos;s street screens. Describe your business and budget. In about a minute,
        Stoop picks the screens, writes an ad for each neighborhood, and shows the Qloo taste evidence behind every
        choice.
      </p>
      <p className="ticker text-sm">Building — demo opening soon</p>
    </main>
  );
}
