import * as vscode from "vscode";

// Show the missing Python extension warning only once per session
const shownMessages = new Set<string>();

/**
 * Notify the user that the Python extension is missing when Python-specific
 * functionality is requested. Only shows once per session to avoid spam.
 */
export function warnMissingPythonExtension(feature?: string): void {
  const key = "missing-python-extension";
  if (shownMessages.has(key)) {
    return;
  }

  const details =
    feature ??
    "Python-dependent Wendy features (debugging, tasks, autoconfiguration) are disabled until you install it.";
  const message = `Python extension (ms-python.debugpy) is not installed. ${details}`;

  shownMessages.add(key);
  void vscode.window.showWarningMessage(message.trim());
}
