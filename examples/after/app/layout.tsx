import Script from "next/script";
import localFont from "next/font/local";
import "./globals.css";

// Fix 4: next/font self-hosts, preloads, sets font-display: swap and adds a
// size-adjusted fallback so the swap doesn't shift layout.
const inter = localFont({
  src: [
    { path: "./fonts/inter-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/inter-latin-700-normal.woff2", weight: "700" },
  ],
  display: "swap",
});

export const metadata = { title: "After: Corner Bakery" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className}>
      <body>
        {children}
        {/* Fix 3: load the third-party tag after the page is idle. The tag
            itself now yields between slices instead of one long task. */}
        <Script src="/vendor/widget.js" strategy="lazyOnload" />
      </body>
    </html>
  );
}
