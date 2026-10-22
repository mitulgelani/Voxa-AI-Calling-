import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Geist, Noto_Sans_Devanagari, Noto_Sans_Gujarati } from 'next/font/google';
import './iso.css';
import './globals.css';

const bricolage = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-bricolage', display: 'swap' });
const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const deva = Noto_Sans_Devanagari({ subsets: ['devanagari'], weight: ['400', '500', '600'], variable: '--font-deva', display: 'swap' });
const gujr = Noto_Sans_Gujarati({ subsets: ['gujarati'], weight: ['400', '500', '600'], variable: '--font-gujr', display: 'swap' });

// Every page is rendered per request so the CSP nonce from middleware reaches Next's scripts.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://vanidial.vercel.app'),
  title: { default: 'VaniDial · Feedback calls in your customers’ language', template: '%s · VaniDial' },
  description:
    'VaniDial calls your customers in Hindi, Gujarati, Hinglish and English, holds a natural conversation, and returns every answer with the second of audio that proves it.',
  openGraph: { type: 'website', siteName: 'VaniDial' },
};

export const viewport: Viewport = { themeColor: '#0d1726', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${geist.variable} ${deva.variable} ${gujr.variable}`}>
      <body>{children}</body>
    </html>
  );
}
