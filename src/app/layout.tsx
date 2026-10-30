import type { Metadata, Viewport } from 'next';
import { Barlow_Condensed, IBM_Plex_Mono, Public_Sans } from 'next/font/google';
import './globals.css';

const display = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-barlow-condensed',
  display: 'swap',
});
const sans = Public_Sans({ subsets: ['latin'], weight: ['400', '600'], variable: '--font-public-sans', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400'], variable: '--font-plex-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Stoop — AI media planner for NYC street screens', template: '%s · Stoop' },
  description:
    'Most ad tech knows where phones go. Stoop knows what neighborhoods love. An AI agent that picks New York street screens with Qloo taste maps and writes each neighborhood its own ads. No tracking.',
  applicationName: 'Stoop',
};

export const viewport: Viewport = {
  themeColor: '#0e0f11',
  colorScheme: 'dark light',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-surface focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
