import * as vscode from "vscode";

// Show the missing Swift extension warning only once per session
const shownMessages = new Set<string>();

/**
 * Notify the user that the Swift extension is missing when Swift-specific
 * functionality is requested. Only shows once per session to avoid spam.
 */
export function warnMissingSwiftExtension(feature?: string): void {
  const key = "missing-swift-extension";
  if (shownMessages.has(key)) {
    return;
  }

  const details =
    feature ??
    "Swift-dependent Wendy features (debugging, tasks, autoconfiguration) are disabled until you install it.";
  const message = `Swift for Visual Studio Code (swiftlang.swift-vscode) is not installed. ${details}`;

  shownMessages.add(key);
  void vscode.window.showWarningMessage(message.trim());
}
