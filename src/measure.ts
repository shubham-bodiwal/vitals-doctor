import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";
import type { Result as LHR } from "lighthouse";

export type FormFactor = "mobile" | "desktop";

export interface FieldData {
  source: "crux-url" | "crux-origin";
  lcp?: number;
  inp?: number;
  cls?: number;
  ttfb?: number;
}

export interface Measurement {
  lhr: LHR;
  field?: FieldData;
}

/** Run Lighthouse locally in headless Chrome (performance category only). */
export async function measureLocal(url: string, formFactor: FormFactor): Promise<Measurement> {
  const chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
  });
  try {
    const flags = { port: chrome.port, output: "json" as const, logLevel: "error" as const, onlyCategories: ["performance"] };
    const config =
      formFactor === "desktop"
        ? (await import("lighthouse/core/config/desktop-config.js")).default
        : undefined;
    const result = await lighthouse(url, flags, config);
    if (!result) throw new Error("Lighthouse returned no result");
    if (result.lhr.runtimeError) throw new Error(result.lhr.runtimeError.message);
    return { lhr: result.lhr };
  } finally {
    await chrome.kill();
  }
}

const CRUX: Record<string, keyof Omit<FieldData, "source">> = {
  LARGEST_CONTENTFUL_PAINT_MS: "lcp",
  INTERACTION_TO_NEXT_PAINT: "inp",
  CUMULATIVE_LAYOUT_SHIFT_SCORE: "cls",
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: "ttfb",
};

/** Run Lighthouse on Google's servers via the PageSpeed Insights API. Also returns CrUX field data (real INP). */
export async function measurePsi(url: string, key: string | undefined, formFactor: FormFactor): Promise<Measurement> {
  const api = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  api.searchParams.set("url", url);
  api.searchParams.set("category", "performance");
  api.searchParams.set("strategy", formFactor);
  if (key) api.searchParams.set("key", key);
  const res = await fetch(api);
  const body = (await res.json()) as PsiResponse;
  if (!res.ok) throw new Error(`PageSpeed Insights: ${body?.error?.message ?? res.status}`);

  const exp = body.loadingExperience?.metrics ? body.loadingExperience : body.originLoadingExperience;
  let field: FieldData | undefined;
  if (exp?.metrics) {
    field = { source: exp === body.loadingExperience && exp.id === url ? "crux-url" : "crux-origin" };
    for (const [k, name] of Object.entries(CRUX)) {
      const p = exp.metrics[k]?.percentile;
      // CrUX reports CLS multiplied by 100.
      if (typeof p === "number") field[name] = name === "cls" ? p / 100 : p;
    }
  }
  return { lhr: body.lighthouseResult as LHR, field };
}

interface CruxExperience {
  id?: string;
  metrics?: Record<string, { percentile?: number } | undefined>;
}

/** The parts of a PageSpeed Insights v5 response this tool reads. */
interface PsiResponse {
  error?: { message?: string };
  lighthouseResult?: unknown;
  loadingExperience?: CruxExperience;
  originLoadingExperience?: CruxExperience;
}
