// Run npm audit and fail only on real findings at or above the chosen level.
//
// Usage: node scripts/audit-check.mjs [--omit=dev] [--level high]
//
// The registry's audit endpoint is not always available (it has answered 400
// and 503 to otherwise valid requests). A registry error is reported as a
// warning so a push is not blocked by an outage; the weekly audit.yml run and
// the repository's Dependabot alerts cover that window. Real vulnerabilities
// at or above the level still fail the step.

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const levelIndex = args.indexOf("--level");
const level = levelIndex >= 0 ? (args[levelIndex + 1] ?? "high") : "high";
const omitDev = args.includes("--omit=dev");
const severities = ["info", "low", "moderate", "high", "critical"];
const threshold = severities.indexOf(level);
if (threshold === -1) {
  console.error(`unknown --level ${level}; use one of ${severities.join(", ")}`);
  process.exit(2);
}

const npmArgs = ["audit", "--json", ...(omitDev ? ["--omit=dev"] : [])];
// npm is a .cmd shim on Windows, which needs a shell; pass one fixed command
// string there so Node does not warn about unescaped arguments (DEP0190).
const result =
  process.platform === "win32"
    ? spawnSync(`npm.cmd ${npmArgs.join(" ")}`, { encoding: "utf8", shell: true })
    : spawnSync("npm", npmArgs, { encoding: "utf8" });
const output = `${result.stdout ?? ""}`.trim();

let report;
try {
  report = JSON.parse(output);
} catch {
  console.log(`::warning title=npm audit::audit output was not JSON (exit ${result.status}); treating as a registry problem, not a finding`);
  console.log((result.stderr ?? "").trim().split("\n").slice(-5).join("\n"));
  process.exit(0);
}

if (report.error) {
  const detail = typeof report.error === "object" ? JSON.stringify(report.error) : String(report.error);
  console.log(`::warning title=npm audit::the registry audit endpoint failed (${detail}); no vulnerability data this run`);
  process.exit(0);
}

const counts = report.metadata?.vulnerabilities ?? {};
const summary = severities.map((s) => `${s}=${counts[s] ?? 0}`).join(" ");
console.log(`npm audit${omitDev ? " (production dependencies)" : ""}: ${summary}`);
const failing = severities.slice(threshold).reduce((n, s) => n + (counts[s] ?? 0), 0);
if (failing > 0) {
  for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
    if (severities.indexOf(v.severity) >= threshold) {
      const via = (v.via ?? []).map((x) => (typeof x === "object" ? x.url ?? x.title : x)).join(", ");
      console.log(`::error title=npm audit ${v.severity}::${name} ${v.range ?? ""} ${via}`.trim());
    }
  }
  console.error(`npm audit: ${failing} vulnerabilit${failing === 1 ? "y" : "ies"} at ${level} or above`);
  process.exit(1);
}
