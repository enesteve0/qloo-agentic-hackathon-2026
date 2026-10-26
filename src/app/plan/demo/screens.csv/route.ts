import { syntheticDemoRun } from '@/content/demo-run';
import { kiosks, ntas } from '@/server/data';
import { planToCsv } from '@/server/plan/export';

export const dynamic = 'force-static';

/** The synthetic sample plan's screen list, built by the same exporter as live plans. */
export function GET() {
  const run = syntheticDemoRun();
  const names = Object.fromEntries(ntas.map((n) => [n.code, n.name]));
  const csv = planToCsv(run.plan!, kiosks, names, run.creative);
  return new Response(`Note,SYNTHETIC demo data: not Qloo data\r\n${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="stoop-sample-plan-synthetic.csv"',
      'X-Robots-Tag': 'noindex',
    },
  });
}
