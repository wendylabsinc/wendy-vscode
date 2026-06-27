import * as vscode from "vscode";
import { OptimizeFinding, OptimizeReport } from "../models/ProjectManager";

const SEVERITY_ORDER: Record<string, number> = {
  error: 3,
  warning: 2,
  info: 1,
};

const SEVERITY_ICONS: Record<string, string> = {
  error: "$(error)",
  warning: "$(warning)",
  info: "$(info)",
};

/**
 * Parses the JSON output of `wendy project optimize --json` and formats it
 * for display in the VS Code output channel.
 */
export function formatOptimizeOutput(raw: string): string {
  let report: OptimizeReport;
  try {
    report = JSON.parse(raw) as OptimizeReport;
  } catch {
    // Not JSON (e.g. human-mode output) — return as-is.
    return raw;
  }

  if (!report.findings || report.findings.length === 0) {
    return "✓ No build-config issues found.";
  }

  const lines: string[] = [];
  const sorted = [...report.findings].sort(
    (a, b) =>
      (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0)
  );

  let lastTarget: string | undefined;
  for (const f of sorted) {
    if (f.target && f.target !== lastTarget) {
      lines.push(`\n[${f.target}]`);
      lastTarget = f.target;
    }
    const icon = SEVERITY_ICONS[f.severity] ?? "$(circle-outline)";
    const loc = f.location ? `  (${f.location.file}:${f.location.line})` : "";
    const fix = f.fixable ? "  [fixable]" : "";
    lines.push(`  ${icon} ${f.severity.padEnd(7)}  ${f.analyzer.padEnd(14)}  ${f.title}${loc}${fix}`);
    if (f.detail) {
      lines.push(`             ${f.detail}`);
    }
  }

  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of report.findings) {
    if (f.severity in counts) {
      counts[f.severity as keyof typeof counts]++;
    }
  }
  const fixableCount = report.findings.filter((f) => f.fixable).length;

  lines.push("");
  lines.push(
    `Found ${report.findings.length} issue(s): ` +
      `${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info.` +
      (fixableCount > 0
        ? `  (${fixableCount} fixable — run "Wendy: Optimize Project (Apply Fixes)")`
        : "")
  );

  return lines.join("\n");
}

/**
 * Shows a VS Code information/warning/error message summarising the optimize
 * results and offers quick actions.
 */
export function showOptimizeSummaryMessage(
  raw: string,
  projectPath: string
): void {
  let report: OptimizeReport;
  try {
    report = JSON.parse(raw) as OptimizeReport;
  } catch {
    return;
  }

  if (!report.findings || report.findings.length === 0) {
    vscode.window.showInformationMessage(
      "Wendy Optimize: No build-config issues found in this project."
    );
    return;
  }

  const fixableCount = report.findings.filter((f) => f.fixable).length;
  const hasError = report.findings.some((f) => f.severity === "error");

  const summary = `Wendy Optimize: ${report.findings.length} issue(s) found in ${projectPath}.`;
  const actions: string[] = ["Show Output"];
  if (fixableCount > 0) {
    actions.push(`Apply ${fixableCount} Fix(es)`);
  }

  const showFn = hasError
    ? vscode.window.showWarningMessage
    : vscode.window.showInformationMessage;

  showFn(summary, ...actions).then((choice) => {
    if (choice === "Show Output") {
      vscode.commands.executeCommand("wendy.optimizeProject");
    } else if (choice?.startsWith("Apply")) {
      vscode.commands.executeCommand("wendy.optimizeProjectFix");
    }
  });
}
