#!/usr/bin/env tsx
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { join } from "path";
import { fileURLToPath } from "url";
import { runRules } from "../detection/rules.js";
import { detect } from "../detection/index.js";
import type { DetectionLabel } from "../types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

interface Sample {
  id: string;
  label: DetectionLabel;
  text: string;
}

async function loadDataset(): Promise<Sample[]> {
  const datasetPath = join(__dirname, "dataset.jsonl");
  const rl = createInterface({
    input: createReadStream(datasetPath),
    crlfDelay: Infinity,
  });
  const samples: Sample[] = [];
  for await (const line of rl) {
    if (line.trim()) samples.push(JSON.parse(line) as Sample);
  }
  return samples;
}

type ConfusionRow = Record<DetectionLabel, number>;
type ConfusionMatrix = Record<DetectionLabel, ConfusionRow>;

function emptyRow(): ConfusionRow {
  return { scam: 0, suspicious: 0, likely_safe: 0 };
}

function emptyMatrix(): ConfusionMatrix {
  return { scam: emptyRow(), suspicious: emptyRow(), likely_safe: emptyRow() };
}

interface Metrics {
  precision: number;
  recall: number;
  fpr: number; // false positive rate (legit → scam)
  f1: number;
  accuracy: number;
  confusion: ConfusionMatrix;
}

function computeMetrics(
  samples: Sample[],
  getPrediction: (s: Sample) => DetectionLabel
): Metrics {
  const confusion = emptyMatrix();
  for (const s of samples) {
    const pred = getPrediction(s);
    confusion[s.label][pred]++;
  }

  // Treat "scam" as the positive class
  const tp = confusion.scam.scam;
  const fp = confusion.likely_safe.scam + confusion.suspicious.scam;
  const fn = confusion.scam.suspicious + confusion.scam.likely_safe;
  const tn =
    confusion.likely_safe.likely_safe +
    confusion.likely_safe.suspicious +
    confusion.suspicious.likely_safe +
    confusion.suspicious.suspicious;

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const fpr = fp + tn === 0 ? 0 : fp / (fp + tn);
  const f1 =
    precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const accuracy = samples.length === 0 ? 0 : (tp + tn) / samples.length;

  return { precision, recall, fpr, f1, accuracy, confusion };
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

function printTable(label: string, m: Metrics): void {
  console.log(`\n${"═".repeat(50)}`);
  console.log(` ${label}`);
  console.log("═".repeat(50));
  console.log(` Precision (scam):  ${pct(m.precision)}`);
  console.log(` Recall (scam):     ${pct(m.recall)}`);
  console.log(` False Positive Rate: ${pct(m.fpr)}`);
  console.log(` F1 Score:          ${pct(m.f1)}`);
  console.log(` Accuracy:          ${pct(m.accuracy)}`);
  console.log("\n Confusion Matrix (rows=actual, cols=predicted):");
  console.log("              scam  susp  safe");
  for (const actual of ["scam", "suspicious", "likely_safe"] as DetectionLabel[]) {
    const r = m.confusion[actual];
    const shortName = actual === "likely_safe" ? "safe" : actual === "suspicious" ? "susp" : "scam";
    console.log(
      ` ${shortName.padEnd(14)}${String(r.scam).padStart(4)}  ${String(r.suspicious).padStart(4)}  ${String(r.likely_safe).padStart(4)}`
    );
  }
}

async function main(): Promise<void> {
  console.log("Loading dataset…");
  const samples = await loadDataset();
  console.log(`Loaded ${samples.length} samples.`);

  // ── Rules only ────────────────────────────────────────────────────────────
  const rulesMetrics = computeMetrics(samples, (s) => {
    const { score } = runRules({ text: s.text });
    if (score >= 0.65) return "scam";
    if (score >= 0.35) return "suspicious";
    return "likely_safe";
  });
  printTable("Rules-only", rulesMetrics);

  // ── Combined (rules + LLM stub) ───────────────────────────────────────────
  // In eval mode we run without an LLM key to get pure rule metrics
  // Pass --llm flag + LLM_PROVIDER env to run with LLM (adds latency)
  const useLLM = process.argv.includes("--llm");
  if (useLLM) {
    console.log("\nRunning combined evaluation with LLM (this may take a while)…");
    const { LLMClientImpl } = await import("../../src/llm/LLMClient.js" as string);
    const llmClient = new (LLMClientImpl as any)();
    const combinedResults: DetectionLabel[] = [];
    for (const s of samples) {
      const result = await detect({ text: s.text }, {
        callLLM: (prompt) => llmClient.complete(prompt),
      });
      combinedResults.push(result.label);
    }
    const combinedMetrics = computeMetrics(samples, (s) => {
      const idx = samples.indexOf(s);
      return combinedResults[idx]!;
    });
    printTable("Combined (rules + LLM)", combinedMetrics);
  } else {
    console.log("\n[Skipping LLM evaluation — pass --llm flag to include it]");
  }

  // ── Summary table for slides ──────────────────────────────────────────────
  console.log("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(" SLIDE SUMMARY: Safe Signal Detection Performance");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(` Method      Precision  Recall  F1      FPR`);
  console.log("─────────────────────────────────────────────────────");
  console.log(
    ` Rules only  ${pct(rulesMetrics.precision).padEnd(9)}  ${pct(rulesMetrics.recall).padEnd(6)}  ${pct(rulesMetrics.f1).padEnd(6)}  ${pct(rulesMetrics.fpr)}`
  );
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
