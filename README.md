# vitals-doctor

Lighthouse tells you a score. **vitals-doctor tells you what to change.**

It measures a page with Lighthouse (local headless Chrome, or Google's PageSpeed Insights API), prints LCP / INP / CLS / TTFB, and turns the raw audits into a short, prioritised list of fixes. Each fix names the cause it found (the LCP element and its slowest phase, the exact blocking file, the element that shifted and why) and says how to fix it in Next.js / React.

```sh
npx vitals-doctor https://example.com
```

## Why

Most Core Web Vitals work I've done comes down to the same handful of causes: a lazy-loaded or oversized hero image, a sync tag in `<head>`, images without dimensions, a web font swap, one long task from a third-party script. Lighthouse reports all of them, but spread over 40+ audits, with generic advice. This tool reads those audits, works out which cause is behind each failing metric, and orders the fixes by estimated savings against the metric that is actually failing.

## Sample output

Run against [`examples/before`](examples/before) (mobile profile, simulated throttling):

```text
$ vitals-doctor http://localhost:3101 --budget
vitals-doctor  http://localhost:3101/
Lighthouse 13.6.0 · mobile · performance score 60

  LCP               9,603 ms  poor       lab
  CLS                  0.246  needs work lab
  TTFB                452 ms  good       lab
  FCP               2,304 ms  needs work lab
  TBT (INP proxy)      29 ms  good       lab

7 fixes, most impactful first

1. [high] LCP image is lazy-loaded
   est. savings: LCP -8,435 ms
   · Failed: fetchpriority=high should be applied
   · Failed: LCP resources shouldn’t use loading=lazy
   Fix: remove `loading="lazy"` from the LCP image; use `<Image preload fetchPriority="high" />`
   in Next 16 or `priority` in Next 13–15; on a plain `<img>` add `fetchPriority="high"`.

2. [high] LCP is 9,603 ms: the image element spends most time in "Resource load delay"
   est. savings: LCP -7,103 ms
   · Element: body > main > div.hero > img
   · HTML: <img src="/hero.jpg" alt="Loaves cooling on a rack" loading="lazy">
   · Time to first byte: 452 ms
   · Resource load delay: 8,435 ms
   · Resource load duration: 123 ms
   · Element render delay: 593 ms
   Fix: The browser found the LCP image late. Render it in the server HTML (not after
   hydration or from CSS), drop `loading="lazy"`, and preload it.

3. [high] Layout shifts add up to CLS 0.246
   est. savings: CLS -0.246
   · Unsized image element: body > main > div.hero > img
   · Web font: /fonts/inter-latin-400-normal.woff2, /fonts/inter-latin-700-normal.woff2
   Fix: Give every image `width` and `height` (a static `import img from './x.jpg'` with
   `next/image` does this) ... Load fonts with `next/font`; it preloads them and adds a
   size-adjusted fallback so the swap doesn't move text.

4. [high] 2 render-blocking requests delay first paint
   est. savings: FCP -1,700 ms, LCP -1,700 ms
   · /vendor/widget.js (302 ms)
   · /_next/static/chunks/162k1vv3w9phm.css (152 ms)
   Fix: Move synchronous `<script>` tags to `next/script` with `strategy="afterInteractive"`
   (or `"lazyOnload"` for widgets/analytics) ...

5. [medium] Images are 1,410 KiB heavier than they need to be
   · /hero.jpg: 1,458 KiB, could save 1,410 KiB
   Fix: Use `next/image` (AVIF/WebP, resized per device) and give it a `sizes` ...

6. [low] JavaScript takes 1,525 ms to execute          (trimmed)
7. [low] 1 image has no width/height                    (trimmed)

Budget failed:
  LCP 9,603 ms > budget 2,500 ms
  CLS 0.246 > budget 0.100
```

Exit code `1` because the budget failed.

## Usage

```sh
npx vitals-doctor <url> [options]
```

| Option | What it does |
| --- | --- |
| `--desktop` | Desktop profile. Default is mobile with simulated 4G + 4x CPU slowdown. |
| `--psi` | Run on Google's servers via the PageSpeed Insights API. Adds real-user CrUX data (p75), including **real INP**, when the URL or origin has enough traffic. |
| `--key <key>` | PSI API key (or `PSI_API_KEY`). Free from Google Cloud; PSI works without one at a low rate limit. |
| `--from <file>` | Diagnose a Lighthouse JSON report you already have (`lighthouse --output=json`). |
| `--json` | Machine-readable report (metrics, findings, budget result). |
| `--budget [spec]` | Exit `1` when over budget. `--budget lcp=2500,cls=0.1,inp=200`. With no spec it uses the web.dev "good" thresholds (LCP 2.5 s, INP 200 ms, CLS 0.1). |

Local runs need Chrome or Chromium (`CHROME_PATH` to point at a specific binary). Node 20+.

**About INP:** INP needs real user interactions, so a lab run can't measure it. Locally the tool shows **TBT** as the proxy (long tasks are what make INP bad), and an `inp` budget is checked against TBT. With `--psi`, field INP from CrUX is shown and used instead.

### In CI

```sh
# against a preview deployment or a local `next start`
npx vitals-doctor "$PREVIEW_URL" --budget lcp=2500,cls=0.1,inp=200 --json > vitals.json
```

Lab numbers move a few percent run to run; give budgets some headroom.

## Rules

Each rule reads one or more Lighthouse 13 audits and produces at most one finding.

| Rule | Metric | Reads | Detects | Next.js / React fix |
| --- | --- | --- | --- | --- |
| `lcp-element` | LCP | `lcp-breakdown-insight`, `metrics` | LCP element, image vs text, and which phase dominates: TTFB, load delay, load duration, render delay | Per phase: static/ISR for TTFB; server-render + preload for delay; `next/image` + `sizes` for duration; unblock CSS/JS/fonts for render delay |
| `lcp-discovery` | LCP | `lcp-discovery-insight` | LCP image lazy-loaded, not high priority, or not in the initial HTML | Drop `loading="lazy"`, `<Image preload fetchPriority="high">` / `priority`, render in server HTML |
| `image-delivery` | LCP | `image-delivery-insight` | Oversized or old-format images | `next/image` with an accurate `sizes` |
| `render-blocking` | FCP, LCP | `render-blocking-insight` | Sync scripts and blocking CSS, split by type | `next/script` strategies; CSS Modules, `next/font`, `experimental.inlineCss` |
| `cls-culprits` | CLS | `cls-culprits-insight` | Shifted elements grouped by cause: unsized image, web font, injected iframe, animation, unattributed insertions | `width`/`height` or `aspect-ratio`, `next/font`, reserved `min-height`, transform-only animation |
| `unsized-images` | CLS | `unsized-images` | `<img>` without dimensions | Static import with `next/image`, or explicit sizes |
| `long-tasks` | INP (TBT) | `long-tasks`, `total-blocking-time` | Tasks over 50 ms, grouped by script | `next/dynamic`, Server Components, `startTransition`, `scheduler.yield()` |
| `js-execution` | TBT | `bootup-time` | Scripts with heavy execution time | Fewer `"use client"` boundaries, `next/dynamic`, bundle analysis |
| `unused-javascript` | LCP | `unused-javascript` | 50 KiB+ of shipped-but-unused JS per file | Code-splitting, direct imports, `optimizePackageImports` |
| `font-display` | FCP, LCP | `font-display-insight` | Fonts that hide text while loading | `next/font`, or `font-display: swap` + preload |
| `third-parties` | INP (TBT) | `third-parties-insight` | Providers with 50 ms+ main-thread time or 50 KiB+ | `next/script` `lazyOnload`/`worker`, `@next/third-parties`, click-to-load facades |
| `server-response` | TTFB | `server-response-time` | HTML slower than 600 ms | Static rendering, `revalidate` / `"use cache"`, `<Suspense>` streaming, CDN |

**Ordering.** Findings are sorted by impact (high / medium / low), then by estimated savings divided by the metric's "good" threshold, weighted ×3 when that metric is currently poor and ×2 when it needs improvement. A 300 ms LCP saving on a page with a 9 s LCP ranks above a 300 ms TBT saving on a page whose TBT is already fine.

## Before / after example

[`examples/before`](examples/before) and [`examples/after`](examples/after) are the same one-page Next.js 16 site with four classic problems, and their fixes:

| # | Problem in `before` | Fix in `after` | Metric |
| --- | --- | --- | --- |
| 1 | 2400 px, 1.5 MB JPEG hero via `<img loading="lazy">` | `next/image` with `preload`, `fetchPriority="high"`, `sizes="100vw"` (serves AVIF at the viewport width) | LCP |
| 2 | Hero has no `width`/`height`; a promo banner is injected after load with no reserved space | Static image import supplies dimensions; banner slot has a fixed `min-height` | CLS |
| 3 | Synchronous third-party tag in `<head>` doing 350 ms of work in one task | `next/script strategy="lazyOnload"`, and the work yields every 10 ms | FCP, TBT/INP |
| 4 | Hand-written `@font-face` with no `font-display` and no preload | `next/font/local` (preloaded, `swap`, size-adjusted fallback) | CLS, FCP |

Measured with vitals-doctor 0.1.0 / Lighthouse 13.6.0, mobile profile, simulated throttling, `next build && next start` on an M-series Mac, median of 3 runs:

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| LCP | 9,605 ms | 2,251 ms | **-77%** |
| FCP | 2,305 ms | 757 ms | **-67%** |
| CLS | 0.246 | 0 | **-100%** |
| TBT | 30 ms | 14 ms | -53% |
| Page weight | 1,644 KiB | 198 KiB | -88% |
| Performance score | 60 | 99 | +39 |

Two honest notes. Before's TBT is already low because the sync script runs *before* first paint, so Lighthouse counts it as render-blocking time rather than blocking time; the cost shows up in FCP instead. And before's LCP swings between runs (one run was 2.4 s) because a lazy image's fetch start depends on when layout decides it's near the viewport, which is part of why `loading="lazy"` on the LCP image is a bad idea.

The tool still reports three findings on `after`: blocking Next.js CSS (~150 ms; `experimental.inlineCss` would remove it), an LCP priority hint (low impact because LCP is already good) and the widget's total execution time (low, since it now yields). That's intended: it tells you what's left, ranked so you can stop when the remaining items aren't worth it.

Try it:

```sh
cd examples/before && pnpm install && pnpm build && pnpm start   # :3101
cd examples/after  && pnpm install && pnpm build && pnpm start   # :3102
npx vitals-doctor http://localhost:3101
npx vitals-doctor http://localhost:3102
```

## Development

```sh
pnpm install
pnpm test        # vitest, no network: rules run on recorded Lighthouse JSON
pnpm build       # tsc -> dist/
node dist/cli.js --from test/fixtures/before.lhr.json
```

`test/fixtures/*.lhr.json` are real Lighthouse 13 runs of the two examples, trimmed to the audits the rules read. Rules that the examples can't trigger (third parties, slow server, text LCP, font-display) are tested with small synthetic audit objects.

Layout: `src/measure.ts` (Lighthouse / PSI), `src/rules.ts` (rules, priority, budgets), `src/format.ts` (terminal output), `src/cli.ts`.

## License

MIT. The Inter font files in `examples/` are under the SIL Open Font License ([examples/FONT-LICENSE-OFL.txt](examples/FONT-LICENSE-OFL.txt)).
