import { styleText } from "node:util";
import { fmt, type Report, type Rating } from "./rules.js";

const RATING: Record<Rating, [string, Parameters<typeof styleText>[0]]> = {
  good: ["good", "green"],
  "needs-improvement": ["needs work", "yellow"],
  poor: ["poor", "red"],
};
const IMPACT = { high: "red", medium: "yellow", low: "gray" } as const;

/** Human-readable report. Colours are dropped automatically when stdout is not a TTY or NO_COLOR is set. */
export function formatText(r: Report): string {
  const c = (s: Parameters<typeof styleText>[0], t: string) => styleText(s, t, { stream: process.stdout });
  const out: string[] = [];
  const score = r.performanceScore === null ? "n/a" : String(Math.round(r.performanceScore * 100));
  out.push(c("bold", `vitals-doctor  ${r.url}`));
  out.push(c("gray", `Lighthouse ${r.lighthouseVersion} · ${r.formFactor} · performance score ${score}`));
  out.push("");
  for (const m of r.metrics) {
    const [label, color] = RATING[m.rating];
    const name = m.id === "TBT" ? "TBT (INP proxy)" : m.id;
    out.push(`  ${name.padEnd(16)}${fmt(m.id, m.value).padStart(10)}  ${c(color, label.padEnd(11))}${c("gray", m.source)}`);
  }
  out.push("");
  if (!r.findings.length) {
    out.push(c("green", "No issues found. Nice."));
    return out.join("\n");
  }
  out.push(c("bold", `${r.findings.length} fix${r.findings.length > 1 ? "es" : ""}, most impactful first`));
  r.findings.forEach((f, i) => {
    const save = Object.entries(f.savings)
      .filter(([, v]) => v && v > 0)
      .map(([k, v]) => `${k} -${fmt(k as any, v!)}`)
      .join(", ");
    out.push("");
    out.push(`${c("bold", `${i + 1}.`)} ${c(IMPACT[f.impact], `[${f.impact}]`)} ${c("bold", f.title)}`);
    if (save) out.push(c("gray", `   est. savings: ${save}`));
    for (const e of f.evidence) out.push(c("gray", `   · ${e}`));
    out.push(`   ${c("cyan", "Fix:")} ${f.fix}`);
  });
  return out.join("\n");
}
