import "./globals.css";

export const metadata = { title: "Before: Corner Bakery" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Classic mistake 3: a synchronous third-party tag in <head>. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/vendor/widget.js"></script>
      </head>
      <body>{children}</body>
    </html>
  );
}
