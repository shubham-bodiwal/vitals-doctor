#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { measureLocal, measurePsi, type FormFactor, type Measurement } from "./measure.js";
import { diagnose, parseBudget, checkBudget } from "./rules.js";
import { formatText } from "./format.js";

const HELP = `vitals-doctor <url> [options]

Measure a page with Lighthouse and print Core Web Vitals plus prioritised fixes.

Options
  --desktop           Desktop profile (default: mobile, throttled)
  --psi               Use the PageSpeed Insights API instead of local Chrome
                      (adds real-user CrUX data incl. INP). Key: --key or PSI_API_KEY
  --key <key>         PageSpeed Insights API key
  --from <file>       Diagnose an existing Lighthouse JSON report instead of measuring
  --json              Print the report as JSON
  --budget [spec]     Exit 1 if a metric is over budget. Spec: lcp=2500,cls=0.1,inp=200
                      (no spec = web.dev "good": LCP 2500 ms, INP 200 ms, CLS 0.1)
  -h, --help          Show this help

Local runs need Chrome or Chromium installed (or CHROME_PATH set).`;

async function main(): Promise<number> {
  // `--budget` with no value: normalise so parseArgs can treat it as a string option.
  const argv = process.argv.slice(2);
  const bi = argv.indexOf("--budget");
  if (bi >= 0 && (bi === argv.length - 1 || argv[bi + 1].startsWith("-") || /^https?:/.test(argv[bi + 1]))) argv.splice(bi + 1, 0, "");

  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      desktop: { type: "boolean" },
      psi: { type: "boolean" },
      key: { type: "string" },
      from: { type: "string" },
      json: { type: "boolean" },
      budget: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const url = positionals[0];
  if (values.help || (!url && !values.from)) {
    console.log(HELP);
    return values.help ? 0 : 2;
  }
  if (url && !/^https?:\/\//.test(url)) throw new Error(`Expected an http(s) URL, got "${url}"`);
  const budget = values.budget !== undefined ? parseBudget(values.budget) : undefined;

  const ff: FormFactor = values.desktop ? "desktop" : "mobile";
  let m: Measurement;
  if (values.from) m = { lhr: JSON.parse(readFileSync(values.from, "utf8")) };
  else if (values.psi) m = await measurePsi(url, values.key ?? process.env.PSI_API_KEY, ff);
  else {
    if (!values.json) process.stderr.write(`Measuring ${url} (${ff}) with Lighthouse…\n`);
    m = await measureLocal(url, ff);
  }

  const report = diagnose(m.lhr, m.field);
  const broken = budget ? checkBudget(report, budget) : [];
  if (values.json) console.log(JSON.stringify({ ...report, budget: budget ? { limits: budget, broken } : undefined }, null, 2));
  else {
    console.log(formatText(report));
    if (budget) console.log("\n" + (broken.length ? `Budget failed:\n  ${broken.join("\n  ")}` : "Budget passed."));
  }
  return broken.length ? 1 : 0;
}

main().then(
  (code) => (process.exitCode = code),
  (err) => {
    console.error(`vitals-doctor: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 2;
  },
);
