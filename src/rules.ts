import type { Result as LHR } from "lighthouse";
import type { FieldData } from "./measure.js";

export type MetricId = "LCP" | "INP" | "CLS" | "TTFB" | "FCP" | "TBT";
export type Rating = "good" | "needs-improvement" | "poor";

/** web.dev thresholds: [good upper bound, poor lower bound]. */
export const THRESHOLDS: Record<MetricId, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  TTFB: [800, 1800],
  FCP: [1800, 3000],
  TBT: [200, 600],
};

export interface Metric {
  id: MetricId;
  value: number;
  rating: Rating;
  source: "lab" | "field";
}

export interface Finding {
  id: string;
  title: string;
  /** Metrics this finding hurts, with estimated savings in that metric's unit (ms, or unitless for CLS). */
  savings: Partial<Record<MetricId, number>>;
  impact: "high" | "medium" | "low";
  /** What was found: URLs, selectors, numbers. */
  evidence: string[];
  /** How to fix it in Next.js / React. */
  fix: string;
}

export interface Report {
  url: string;
  lighthouseVersion: string;
  formFactor: string;
  performanceScore: number | null;
  metrics: Metric[];
  findings: Finding[];
}

export function rate(id: MetricId, value: number): Rating {
  const [good, poor] = THRESHOLDS[id];
  return value <= good ? "good" : value > poor ? "poor" : "needs-improvement";
}

// ---------- small LHR helpers ----------

type Audit = LHR["audits"][string];
const audit = (lhr: LHR, id: string): Audit | undefined => lhr.audits[id];
const failed = (a?: Audit) => !!a && a.score !== null && a.score < 0.9 && a.scoreDisplayMode !== "notApplicable";
const items = (a?: Audit): any[] => ((a?.details as any)?.items as any[]) ?? [];
const ms = (n: number) => `${Math.round(n).toLocaleString("en-US")} ms`;
const kb = (n: number) => `${Math.round(n / 1024).toLocaleString("en-US")} KiB`;
const shortUrl = (u: string, base: string) => {
  try {
    const p = new URL(u, base);
    const b = new URL(base);
    return p.origin === b.origin ? p.pathname + p.search : p.host + p.pathname;
  } catch {
    return u;
  }
};
/** The list-type insights hold a checklist/table plus the node; pick the first item of a given type. */
const part = (a: Audit | undefined, type: string): any => items(a).find((i) => i?.type === type);

function lcpNode(lhr: LHR): { selector: string; snippet: string; isImage: boolean } | undefined {
  const node = part(audit(lhr, "lcp-breakdown-insight"), "node") ?? part(audit(lhr, "lcp-discovery-insight"), "node");
  if (!node) return undefined;
  const snippet: string = node.snippet ?? "";
  // A request-backed LCP (img, picture, video poster, CSS background) shows up in lcp-discovery-insight.
  const isImage = /^<(img|image|video|picture)\b/i.test(snippet) || !!part(audit(lhr, "lcp-discovery-insight"), "checklist");
  return { selector: node.selector ?? "", snippet, isImage };
}

// ---------- rules ----------

type Rule = (lhr: LHR) => Finding | Finding[] | null;

const lcpElement: Rule = (lhr) => {
  const lcp = audit(lhr, "largest-contentful-paint")?.numericValue;
  const node = lcpNode(lhr);
  if (lcp === undefined || !node || rate("LCP", lcp) === "good") return null;
  // Simulated (throttled) phases from the metrics audit match the headline LCP number.
  const m = items(audit(lhr, "metrics"))[0] ?? {};
  const ttfb = m.timeToFirstByte ?? 0;
  const loadDelay = node.isImage ? m.lcpLoadDelay ?? 0 : 0;
  const loadDuration = node.isImage ? m.lcpLoadDuration ?? 0 : 0;
  const renderDelay = Math.max(0, lcp - ttfb - loadDelay - loadDuration);
  const phases: [string, number, string][] = [
    ["Time to first byte", ttfb, "The server is slow to answer. Serve the route statically or from cache (static rendering, ISR / `revalidate`, a CDN) and avoid blocking data fetches in the root layout."],
    ["Resource load delay", loadDelay, "The browser found the LCP image late. Render it in the server HTML (not after hydration or from CSS), drop `loading=\"lazy\"`, and preload it: `<Image preload fetchPriority=\"high\" />` in Next 16 (`priority` in Next 13–15)."],
    ["Resource load duration", loadDuration, "The LCP image is too heavy. Use `next/image` with an accurate `sizes` so it serves AVIF/WebP at the displayed width, or compress it."],
    ["Element render delay", renderDelay, node.isImage
      ? "The image arrived but couldn't paint yet: render-blocking CSS/JS or a client component that mounts it after hydration. See render-blocking and long-task findings."
      : "Text LCP waits on render-blocking CSS/JS and web fonts. Inline or trim critical CSS, defer scripts with `next/script`, and load fonts with `next/font` (`display: \"swap\"`)."],
  ];
  const worst = phases.reduce((a, b) => (b[1] > a[1] ? b : a));
  return {
    id: "lcp-element",
    title: `LCP is ${ms(lcp)}: the ${node.isImage ? "image" : "text"} element spends most time in "${worst[0]}"`,
    savings: { LCP: lcp - THRESHOLDS.LCP[0] },
    impact: "high",
    evidence: [
      `Element: ${node.selector}`,
      `HTML: ${node.snippet}`,
      ...phases.filter((p) => p[1] > 0).map((p) => `${p[0]}: ${ms(p[1])}`),
    ],
    fix: worst[2],
  };
};

const lcpDiscovery: Rule = (lhr) => {
  const a = audit(lhr, "lcp-discovery-insight");
  const checklist = part(a, "checklist")?.items as Record<string, { label: string; value: boolean }> | undefined;
  if (!checklist) return null;
  const bad = Object.entries(checklist).filter(([, v]) => !v.value);
  if (!bad.length) return null;
  const keys = new Set(bad.map(([k]) => k));
  const fixes: string[] = [];
  if (keys.has("eagerlyLoaded")) fixes.push("remove `loading=\"lazy\"` from the LCP image");
  if (keys.has("priorityHinted")) fixes.push("use `<Image preload fetchPriority=\"high\" />` in Next 16 or `priority` in Next 13–15; on a plain `<img>` add `fetchPriority=\"high\"`");
  if (keys.has("requestDiscoverable")) fixes.push("put the image in the server-rendered HTML as an `<img>`/`<Image>` instead of a CSS background or a client-only component");
  const m = items(audit(lhr, "metrics"))[0] ?? {};
  const lcp = audit(lhr, "largest-contentful-paint")?.numericValue ?? 0;
  return {
    id: "lcp-discovery",
    title: keys.has("eagerlyLoaded") ? "LCP image is lazy-loaded" : "LCP image is not prioritised",
    savings: { LCP: m.lcpLoadDelay ?? 0 },
    impact: rate("LCP", lcp) === "good" ? "low" : "high",
    evidence: bad.map(([, v]) => `Failed: ${v.label}`),
    fix: fixes.join("; ") + ".",
  };
};

const imageDelivery: Rule = (lhr) => {
  const a = audit(lhr, "image-delivery-insight");
  const list = items(a).filter((i) => i.wastedBytes > 10 * 1024);
  if (!list.length) return null;
  return {
    id: "image-delivery",
    title: `Images are ${kb(list.reduce((s, i) => s + i.wastedBytes, 0))} heavier than they need to be`,
    savings: { LCP: a?.metricSavings?.LCP ?? 0 },
    impact: "medium",
    evidence: list.map((i) => `${shortUrl(i.url, lhr.finalDisplayedUrl)}: ${kb(i.totalBytes)}, could save ${kb(i.wastedBytes)}`),
    fix: "Use `next/image` (AVIF/WebP, resized per device) and give it a `sizes` that matches the layout, e.g. `sizes=\"(max-width: 768px) 100vw, 50vw\"`. Without `sizes` a fill/responsive image downloads the largest candidate.",
  };
};

const renderBlocking: Rule = (lhr) => {
  const a = audit(lhr, "render-blocking-insight");
  const list = [...items(a)].sort((x, y) => y.wastedMs - x.wastedMs);
  const fcpSave = a?.metricSavings?.FCP ?? 0;
  if (!list.length || fcpSave < 100) return null;
  const scripts = list.filter((i) => /\.m?js(\?|$)/.test(i.url));
  const css = list.filter((i) => !scripts.includes(i));
  const fixes: string[] = [];
  if (scripts.length) fixes.push("Move synchronous `<script>` tags to `next/script` with `strategy=\"afterInteractive\"` (or `\"lazyOnload\"` for widgets/analytics); plain `<script>` in `<head>` blocks first paint.");
  if (css.length) fixes.push("Trim render-blocking CSS: import global CSS once in the root layout, move route-specific styles into CSS Modules for that route, replace `@import`ed font CSS with `next/font`, or let Next inline it with `experimental.inlineCss: true`.");
  return {
    id: "render-blocking",
    title: `${list.length} render-blocking request${list.length > 1 ? "s delay" : " delays"} first paint`,
    savings: { FCP: fcpSave, LCP: a?.metricSavings?.LCP || fcpSave },
    impact: fcpSave >= 500 ? "high" : "medium",
    evidence: list.map((i) => `${shortUrl(i.url, lhr.finalDisplayedUrl)} (${ms(i.wastedMs)})`),
    fix: fixes.join(" "),
  };
};

const clsCulprits: Rule = (lhr) => {
  const cls = audit(lhr, "cumulative-layout-shift")?.numericValue ?? 0;
  if (cls < 0.05) return null;
  // First row is "Total"; the rest are shifted elements with cause sub-items.
  const rows = (part(audit(lhr, "cls-culprits-insight"), "table")?.items ?? []).filter((r: any) => r.node?.type === "node");
  const causes = new Map<string, Set<string>>();
  for (const r of rows) {
    const subs = r.subItems?.items ?? [];
    if (!subs.length) (causes.get("Unknown") ?? causes.set("Unknown", new Set()).get("Unknown")!).add(r.node.selector);
    for (const s of subs) {
      const what = s.extra?.type === "url" ? shortUrl(s.extra.value, lhr.finalDisplayedUrl) : s.extra?.selector ?? "";
      (causes.get(s.cause) ?? causes.set(s.cause, new Set()).get(s.cause)!).add(what);
    }
  }
  const advice: Record<string, string> = {
    "Unsized image element": "give every image `width` and `height` (a static `import img from './x.jpg'` with `next/image` does this), or use `fill` inside a box with a fixed `aspect-ratio`",
    "Web font": "load fonts with `next/font`; it preloads them and adds a size-adjusted fallback so the swap doesn't move text",
    "Injected iframe": "reserve the embed's space with a fixed-size or `aspect-ratio` wrapper before it loads",
    "Animation": "animate `transform`/`opacity` instead of `top`/`height`/`margin`",
    Unknown: "content was inserted or resized without reserved space (banners, cookie bars, client-fetched lists); render a placeholder with the final `min-height`, or overlay it with `position: fixed`",
  };
  const evidence = [...causes].map(([c, w]) => `${c}: ${[...w].filter(Boolean).join(", ") || "(see Lighthouse report)"}`);
  const fixes = [...causes.keys()].map((c) => advice[c] ?? advice.Unknown);
  return {
    id: "cls-culprits",
    title: `Layout shifts add up to CLS ${cls.toFixed(3)}`,
    savings: { CLS: cls },
    impact: cls > THRESHOLDS.CLS[0] ? "high" : "low",
    evidence: evidence.length ? evidence : ["Shifts found but no culprit attributed"],
    fix: (fixes.length ? [...new Set(fixes)] : [advice.Unknown]).map((f) => f[0].toUpperCase() + f.slice(1)).join(". ") + ".",
  };
};

const unsizedImages: Rule = (lhr) => {
  const list = items(audit(lhr, "unsized-images"));
  if (!list.length) return null;
  return {
    id: "unsized-images",
    title: `${list.length} image${list.length > 1 ? "s have" : " has"} no width/height`,
    savings: { CLS: 0 },
    impact: "low",
    evidence: list.map((i) => `${i.node?.selector}: ${shortUrl(i.url, lhr.finalDisplayedUrl)}`),
    fix: "Set `width`/`height` (or CSS `aspect-ratio`) on every `<img>`. With `next/image`, a static import fills them in; for remote images pass them explicitly or use `fill` in a sized parent.",
  };
};

const longTasks: Rule = (lhr) => {
  const tbt = audit(lhr, "total-blocking-time")?.numericValue ?? 0;
  const list = items(audit(lhr, "long-tasks")).filter((t) => t.duration >= 50);
  if (!list.length || tbt < 100) return null;
  const byUrl = new Map<string, number>();
  for (const t of list) byUrl.set(t.url, Math.max(byUrl.get(t.url) ?? 0, t.duration));
  return {
    id: "long-tasks",
    title: `${list.length} long main-thread task${list.length > 1 ? "s" : ""} block input (TBT ${ms(tbt)}, the lab proxy for INP)`,
    savings: { TBT: tbt, INP: tbt },
    impact: rate("TBT", tbt) === "poor" ? "high" : "medium",
    evidence: [...byUrl].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([u, d]) => `${shortUrl(u, lhr.finalDisplayedUrl)}: longest task ${ms(d)}`),
    fix: "Split work so no task runs over 50 ms: lazy-load heavy client components with `next/dynamic`, keep large data out of client components (fetch in Server Components), wrap non-urgent updates in `startTransition`, and yield in loops (`await scheduler.yield()` or `setTimeout`).",
  };
};

const bootup: Rule = (lhr) => {
  const a = audit(lhr, "bootup-time");
  if (!failed(a)) return null;
  const list = items(a).filter((i) => i.url !== "Unattributable" && i.scripting >= 100);
  if (!list.length) return null;
  return {
    id: "js-execution",
    title: `JavaScript takes ${ms(a!.numericValue ?? 0)} to execute`,
    savings: { TBT: a?.metricSavings?.TBT ?? 0 },
    impact: rate("TBT", audit(lhr, "total-blocking-time")?.numericValue ?? 0) === "good" ? "low" : "medium",
    evidence: list.slice(0, 5).map((i) => `${shortUrl(i.url, lhr.finalDisplayedUrl)}: ${ms(i.scripting)} scripting`),
    fix: "Ship less client JS: move components without interactivity out of `\"use client\"`, `next/dynamic` anything below the fold, and check `@next/bundle-analyzer` for heavy libraries (date, chart and icon packages are common).",
  };
};

const unusedJs: Rule = (lhr) => {
  const list = items(audit(lhr, "unused-javascript")).filter((i) => i.wastedBytes >= 50 * 1024);
  if (!list.length) return null;
  return {
    id: "unused-javascript",
    title: `${kb(list.reduce((s, i) => s + i.wastedBytes, 0))} of JavaScript is downloaded but unused`,
    savings: { LCP: audit(lhr, "unused-javascript")?.metricSavings?.LCP ?? 0 },
    impact: "low",
    evidence: list.slice(0, 5).map((i) => `${shortUrl(i.url, lhr.finalDisplayedUrl)}: ${kb(i.wastedBytes)} unused`),
    fix: "Code-split with `next/dynamic` and route-level boundaries, import only what you use (`import debounce from \"lodash/debounce\"`), and use `optimizePackageImports` in next.config for barrel-file packages.",
  };
};

const fonts: Rule = (lhr) => {
  const list = items(audit(lhr, "font-display-insight")).filter((i) => (i.wastedMs ?? 0) > 0);
  if (!list.length) return null;
  return {
    id: "font-display",
    title: `${list.length} web font${list.length > 1 ? "s hide" : " hides"} text while loading`,
    savings: { FCP: Math.max(...list.map((i) => i.wastedMs)), LCP: Math.max(...list.map((i) => i.wastedMs)) },
    impact: "medium",
    evidence: list.map((i) => `${shortUrl(i.url, lhr.finalDisplayedUrl)}: text invisible for up to ${ms(i.wastedMs)}`),
    fix: "Load fonts with `next/font/google` or `next/font/local`: they are self-hosted, preloaded and use `font-display: swap` by default. For hand-written `@font-face`, add `font-display: swap` and `<link rel=\"preload\" as=\"font\" crossorigin>`.",
  };
};

const thirdParties: Rule = (lhr) => {
  const list = items(audit(lhr, "third-parties-insight")).filter((i) => i.mainThreadTime >= 50 || i.transferSize >= 50 * 1024);
  if (!list.length) return null;
  const mt = list.reduce((s, i) => s + (i.mainThreadTime ?? 0), 0);
  const entity = (e: any) => (typeof e === "string" ? e : e?.text ?? e?.name ?? "unknown");
  return {
    id: "third-parties",
    title: `Third-party code: ${ms(mt)} main-thread time across ${list.length} provider${list.length > 1 ? "s" : ""}`,
    savings: { TBT: mt, INP: mt },
    impact: mt >= 250 ? "high" : "medium",
    evidence: list.slice(0, 6).map((i) => `${entity(i.entity)}: ${kb(i.transferSize)}, ${ms(i.mainThreadTime)} main thread`),
    fix: "Load tags with `next/script` `strategy=\"lazyOnload\"` (or `\"worker\"` with Partytown), use `@next/third-parties` for Google Analytics/Tag Manager/YouTube/Maps, and replace heavy embeds with a click-to-load facade.",
  };
};

const ttfb: Rule = (lhr) => {
  const a = audit(lhr, "server-response-time");
  const v = a?.numericValue ?? 0;
  if (v < 600) return null;
  return {
    id: "server-response",
    title: `Server takes ${ms(v)} to send the HTML`,
    savings: { TTFB: v - 600, FCP: v - 600, LCP: v - 600 },
    impact: v >= 1800 ? "high" : "medium",
    evidence: [`Document response time: ${ms(v)} (good is under 600 ms in the lab)`],
    fix: "Make the route static or cached: avoid `cookies()`/`headers()`/`no-store` fetches where not needed, use `revalidate` (ISR) or `\"use cache\"`, stream slow parts behind `<Suspense>`, and serve from a CDN/edge close to users.",
  };
};

export const RULES: Record<string, Rule> = {
  "lcp-element": lcpElement,
  "lcp-discovery": lcpDiscovery,
  "image-delivery": imageDelivery,
  "render-blocking": renderBlocking,
  "cls-culprits": clsCulprits,
  "unsized-images": unsizedImages,
  "long-tasks": longTasks,
  "js-execution": bootup,
  "unused-javascript": unusedJs,
  "font-display": fonts,
  "third-parties": thirdParties,
  "server-response": ttfb,
};

// ---------- prioritisation ----------

const IMPACT_RANK = { high: 0, medium: 1, low: 2 };

/** Savings relative to the "good" threshold, weighted up when the metric is currently failing. */
function priority(f: Finding, metrics: Metric[]): number {
  let p = 0;
  for (const [id, save] of Object.entries(f.savings) as [MetricId, number][]) {
    const m = metrics.find((x) => x.id === id);
    const weight = m?.rating === "poor" ? 3 : m?.rating === "needs-improvement" ? 2 : 1;
    p = Math.max(p, ((save ?? 0) / THRESHOLDS[id][0]) * weight);
  }
  return p;
}

export function labMetrics(lhr: LHR, field?: FieldData): Metric[] {
  const v = (id: string) => audit(lhr, id)?.numericValue;
  const ttfb = items(audit(lhr, "metrics"))[0]?.timeToFirstByte;
  const lab: [MetricId, number | undefined][] = [
    ["LCP", v("largest-contentful-paint")],
    ["CLS", v("cumulative-layout-shift")],
    ["TBT", v("total-blocking-time")],
    ["FCP", v("first-contentful-paint")],
    ["TTFB", ttfb],
  ];
  const out: Metric[] = [];
  for (const [id, value] of lab) if (typeof value === "number") out.push({ id, value, rating: rate(id, value), source: "lab" });
  if (field) {
    for (const id of ["LCP", "INP", "CLS", "TTFB"] as const) {
      const value = field[id.toLowerCase() as "lcp"];
      if (typeof value !== "number") continue;
      const i = out.findIndex((m) => m.id === id);
      const m: Metric = { id, value, rating: rate(id, value), source: "field" };
      if (i >= 0) out[i] = m;
      else out.push(m);
    }
  }
  const order: MetricId[] = ["LCP", "INP", "CLS", "TTFB", "FCP", "TBT"];
  return out.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

export function diagnose(lhr: LHR, field?: FieldData): Report {
  const metrics = labMetrics(lhr, field);
  const findings = Object.values(RULES)
    .flatMap((r) => r(lhr) ?? [])
    .map((f) => ({ f, p: priority(f, metrics) }))
    .sort((a, b) => IMPACT_RANK[a.f.impact] - IMPACT_RANK[b.f.impact] || b.p - a.p)
    .map(({ f }) => f);
  return {
    url: lhr.finalDisplayedUrl ?? lhr.requestedUrl ?? "",
    lighthouseVersion: lhr.lighthouseVersion,
    formFactor: lhr.configSettings?.formFactor ?? "mobile",
    performanceScore: lhr.categories?.performance?.score ?? null,
    metrics,
    findings,
  };
}

// ---------- budgets ----------

export type Budget = Partial<Record<MetricId, number>>;

/** "lcp=2500,cls=0.1,inp=200". An empty string means the web.dev "good" thresholds for LCP/INP/CLS. */
export function parseBudget(s: string): Budget {
  if (!s.trim()) return { LCP: THRESHOLDS.LCP[0], INP: THRESHOLDS.INP[0], CLS: THRESHOLDS.CLS[0] };
  const out: Budget = {};
  for (const pair of s.split(",")) {
    const [k, v] = pair.split("=").map((x) => x.trim());
    const id = k?.toUpperCase() as MetricId;
    const n = Number(v);
    if (!(id in THRESHOLDS) || !v || Number.isNaN(n)) throw new Error(`Bad budget entry "${pair}". Use e.g. lcp=2500,cls=0.1,inp=200`);
    out[id] = n;
  }
  return out;
}

/** Returns one message per broken budget. INP falls back to TBT when there is no field data. */
export function checkBudget(report: Report, budget: Budget): string[] {
  const broken: string[] = [];
  for (const [id, max] of Object.entries(budget) as [MetricId, number][]) {
    let m = report.metrics.find((x) => x.id === id);
    let label: string = id;
    if (!m && id === "INP") {
      m = report.metrics.find((x) => x.id === "TBT");
      label = "INP (TBT as lab proxy)";
    }
    if (m && m.value > max) broken.push(`${label} ${fmt(m.id, m.value)} > budget ${fmt(m.id, max)}`);
  }
  return broken;
}

export const fmt = (id: MetricId, v: number) => (id === "CLS" ? v.toFixed(3) : ms(v));
