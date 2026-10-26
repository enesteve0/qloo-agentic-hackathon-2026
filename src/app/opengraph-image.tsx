import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

export const alt = 'Stoop: most ad tech knows where phones go. Stoop knows what neighborhoods love.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const FONTS = join(process.cwd(), 'src/assets/fonts');
const bold = await readFile(join(FONTS, 'BarlowCondensed-Bold.ttf'));
const medium = await readFile(join(FONTS, 'BarlowCondensed-Medium.ttf'));

/** The social card: street-sign wordmark, the tagline, and a scatter of amber "screens". */
export default function Image() {
  // A fixed constellation of street screens (decorative; positions are hand-picked, not data).
  const screens: [x: number, y: number][] = [
    [930, 140], [968, 176], [1010, 150], [1046, 214], [990, 248], [1080, 262], [948, 300], [1032, 330],
    [1104, 356], [978, 384], [1060, 420], [1012, 462], [1118, 470],
  ];
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', backgroundColor: '#0e0f11', padding: '64px 72px', fontFamily: 'Barlow Condensed' }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: 780 }}>
          <div
            style={{
              display: 'flex',
              alignSelf: 'flex-start',
              backgroundColor: '#00804f',
              color: '#ffffff',
              border: '4px solid #ffffff',
              borderRadius: 8,
              padding: '4px 18px',
              fontSize: 56,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            STOOP
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', fontSize: 74, lineHeight: 0.95, fontWeight: 700, textTransform: 'uppercase' }}>
            <div style={{ display: 'flex', color: '#f2f0ea' }}>Most ad tech knows where phones go.</div>
            <div style={{ display: 'flex', color: '#ffb547', marginTop: 14 }}>Stoop knows what neighborhoods love.</div>
          </div>
          <div style={{ display: 'flex', fontSize: 32, fontWeight: 500, color: '#a6a9ae' }}>
            AI media planner for New York&apos;s street screens · No tracking
          </div>
        </div>
        <div style={{ display: 'flex', position: 'relative', flex: 1 }}>
          {screens.map(([x, y], i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: x - 852,
                top: y - 64,
                width: i % 3 === 0 ? 22 : 16,
                height: i % 3 === 0 ? 22 : 16,
                backgroundColor: '#ffb547',
                border: '3px solid #0e0f11',
              }}
            />
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Barlow Condensed', data: bold, weight: 700, style: 'normal' },
        { name: 'Barlow Condensed', data: medium, weight: 500, style: 'normal' },
      ],
    },
  );
}
