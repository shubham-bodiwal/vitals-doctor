import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Result as LHR } from "lighthouse";
import { diagnose, parseBudget, checkBudget, rate, RULES, type Finding } from "../src/rules.js";

// Real Lighthouse 13 runs of examples/before and examples/after, trimmed to the audits the rules read.
const load = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.lhr.json`, import.meta.url), "utf8"));
const before = load("before");
const after = load("after");
const ids = (r: ReturnType<typeof diagnose>) => r.findings.map((f) => f.id);

describe("before example (unoptimised)", () => {
  const r = diagnose(before);

  it("reports lab metrics with ratings", () => {
    const lcp = r.metrics.find((m) => m.id === "LCP")!;
    expect(lcp.rating).toBe("poor");
    expect(r.metrics.find((m) => m.id === "CLS")!.rating).not.toBe("good");
    expect(r.metrics.every((m) => m.source === "lab")).toBe(true);
  });

  it("finds the classic problems", () => {
    expect(ids(r)).toEqual(expect.arrayContaining(["lcp-discovery", "lcp-element", "cls-culprits", "render-blocking", "image-delivery", "unsized-images"]));
  });

  it("identifies the LCP element as a lazy image and names the slow phase", () => {
    const f = r.findings.find((f) => f.id === "lcp-element")!;
    expect(f.title).toContain("image");
    expect(f.title).toContain("Resource load delay");
    expect(f.evidence.join("\n")).toContain('loading="lazy"');
    expect(r.findings.find((f) => f.id === "lcp-discovery")!.title).toBe("LCP image is lazy-loaded");
  });

  it("attributes CLS to the unsized image and the web font, with next/font advice", () => {
    const f = r.findings.find((f) => f.id === "cls-culprits")!;
    const ev = f.evidence.join("\n");
    expect(ev).toContain("Unsized image element");
    expect(ev).toContain("Web font");
    expect(f.fix).toContain("next/font");
  });

  it("separates the blocking script from blocking CSS", () => {
    const f = r.findings.find((f) => f.id === "render-blocking")!;
    expect(f.evidence[0]).toContain("/vendor/widget.js");
    expect(f.fix).toContain("next/script");
    expect(f.fix).toContain("CSS");
  });

  it("puts high-impact findings first", () => {
    const rank = { high: 0, medium: 1, low: 2 };
    const order = r.findings.map((f) => rank[f.impact]);
    expect(order).toEqual([...order].sort());
    expect(r.findings[0].impact).toBe("high");
  });
});

describe("after example (fixed)", () => {
  const r = diagnose(after);

  it("passes the vitals", () => {
    for (const id of ["LCP", "CLS", "TBT"]) expect(r.metrics.find((m) => m.id === id)!.rating).toBe("good");
  });

  it("no longer reports the fixed problems", () => {
    for (const id of ["lcp-element", "cls-culprits", "image-delivery", "unsized-images", "long-tasks"]) expect(ids(r)).not.toContain(id);
  });

  it("keeps a remaining LCP hint but as low impact, because LCP is already good", () => {
    expect(r.findings.find((f) => f.id === "lcp-discovery")?.impact).toBe("low");
  });

  it("has no high-impact findings left", () => {
    expect(r.findings.filter((f) => f.impact === "high")).toEqual([]);
  });
});

describe("rules on synthetic audits", () => {
  const lhr = (audits: Record<string, unknown>) => ({ finalDisplayedUrl: "https://shop.example/", audits }) as unknown as LHR;

  it("long tasks: groups by script and reports TBT", () => {
    const f = RULES["long-tasks"](lhr({
      "total-blocking-time": { numericValue: 900 },
      "long-tasks": { details: { items: [
        { url: "https://shop.example/_next/static/chunks/app.js", duration: 300 },
        { url: "https://cdn.vendor.example/tag.js", duration: 450 },
        { url: "https://shop.example/_next/static/chunks/app.js", duration: 120 },
      ] } },
    })) as Finding;
    expect(f.impact).toBe("high");
    expect(f.evidence[0]).toBe("cdn.vendor.example/tag.js: longest task 450 ms");
    expect(f.evidence).toHaveLength(2);
    expect(f.fix).toContain("next/dynamic");
  });

  it("third parties: flags heavy providers only", () => {
    const f = RULES["third-parties"](lhr({
      "third-parties-insight": { details: { items: [
        { entity: "Google Tag Manager", transferSize: 120_000, mainThreadTime: 310 },
        { entity: "Tiny pixel", transferSize: 400, mainThreadTime: 2 },
      ] } },
    })) as Finding;
    expect(f.evidence).toHaveLength(1);
    expect(f.evidence[0]).toContain("Google Tag Manager");
    expect(f.impact).toBe("high");
    expect(f.fix).toContain("@next/third-parties");
  });

  it("text LCP gets font/CSS advice, not image advice", () => {
    const f = RULES["lcp-element"](lhr({
      "largest-contentful-paint": { numericValue: 5000 },
      metrics: { details: { items: [{ timeToFirstByte: 400, lcpLoadDelay: 0, lcpLoadDuration: 0 }] } },
      "lcp-breakdown-insight": { details: { items: [{ type: "node", selector: "h1", snippet: "<h1 class=\"title\">" }] } },
    })) as Finding;
    expect(f.title).toContain("text element");
    expect(f.title).toContain("Element render delay");
    expect(f.fix).toContain("next/font");
  });

  it("slow server response", () => {
    const f = RULES["server-response"](lhr({ "server-response-time": { numericValue: 2100 } })) as Finding;
    expect(f.impact).toBe("high");
    expect(f.fix).toContain("revalidate");
    expect(RULES["server-response"](lhr({ "server-response-time": { numericValue: 120 } }))).toBeNull();
  });

  it("font-display: only fonts that actually hid text", () => {
    const f = RULES["font-display"](lhr({
      "font-display-insight": { details: { items: [{ url: "https://shop.example/f.woff2", wastedMs: 640 }, { url: "https://shop.example/g.woff2", wastedMs: 0 }] } },
    })) as Finding;
    expect(f.evidence).toEqual(["/f.woff2: text invisible for up to 640 ms"]);
  });
});

describe("field data and budgets", () => {
  it("field data replaces lab values and adds INP", () => {
    const r = diagnose(after, { source: "crux-url", lcp: 3100, inp: 320, cls: 0.02 });
    expect(r.metrics.find((m) => m.id === "LCP")).toMatchObject({ value: 3100, source: "field", rating: "needs-improvement" });
    expect(r.metrics.find((m) => m.id === "INP")).toMatchObject({ value: 320, source: "field" });
  });

  it("default budget is the web.dev good thresholds", () => {
    expect(parseBudget("")).toEqual({ LCP: 2500, INP: 200, CLS: 0.1 });
    expect(checkBudget(diagnose(before), parseBudget(""))).toEqual([expect.stringContaining("LCP"), expect.stringContaining("CLS")]);
    expect(checkBudget(diagnose(after), parseBudget(""))).toEqual([]);
  });

  it("custom budget, INP falls back to TBT in the lab", () => {
    expect(parseBudget("lcp=3000, cls=0.05")).toEqual({ LCP: 3000, CLS: 0.05 });
    const broken = checkBudget(diagnose(after), { INP: 1 });
    expect(broken[0]).toMatch(/^INP \(TBT as lab proxy\)/);
    expect(() => parseBudget("speed=1")).toThrow(/Bad budget/);
  });

  it("rates on threshold edges", () => {
    expect(rate("LCP", 2500)).toBe("good");
    expect(rate("LCP", 4001)).toBe("poor");
    expect(rate("CLS", 0.11)).toBe("needs-improvement");
  });
});
