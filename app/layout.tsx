import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Steel Sync — Metal Building Designer',
  description: 'Design and price your custom metal building in 3D',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
