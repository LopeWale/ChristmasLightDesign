import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lumen3D — 3D Exterior Reconstruction & Holiday Lighting Studio',
  description:
    'Metric-calibrated 3D exterior holiday lighting design studio with night-bloom rendering and Gemini spatial co-pilot.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="h-screen w-screen antialiased">{children}</body>
    </html>
  );
}
