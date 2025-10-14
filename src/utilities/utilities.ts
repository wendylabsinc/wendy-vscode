// Portions of this code taken from the VS Code Swift open source project
// (https://github.com/vscode‑swift), licensed under Apache 2.0.

import * as cp from "child_process";
import * as path from "path";

/**
 * Return string description of Error object
 * @param error Error object
 * @returns String description of error
 */
export function getErrorDescription(error: unknown): string {
  if (!error) {
    return "No error provided";
  } else if ((error as { stderr: string }).stderr) {
    return (error as { stderr: string }).stderr;
  } else if ((error as { error: string }).error) {
    return JSON.stringify((error as { error: string }).error);
  } else if (error instanceof Error) {
    return error.message;
  } else {
    return JSON.stringify(error);
  }
}

export class ExecFileError extends Error {
  constructor(
    public readonly causedBy: Error,
    public readonly stdout: string,
    public readonly stderr: string
  ) {
    super(causedBy.message);
  }
}

/**
 * Asynchronous wrapper around {@link cp.execFile child_process.execFile}.
 *
 * Assumes output will be a string
 *
 * @param executable name of executable to run
 * @param args arguments to be passed to executable
 * @param options execution options
 */
export async function execFile(
  executable: string,
  args: string[],
  options: cp.ExecFileOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  options = {
    ...options,
    maxBuffer: options.maxBuffer ?? 1024 * 1024 * 64, // 64MB
  };
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    cp.execFile(executable, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new ExecFileError(error, stdout, stderr));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}


/**
 * Expand ~ in file path to full $HOME folder
 * @param filepath File path
 * @returns full path
 */
export function expandFilePathTilde(
  filepath: string,
  directory: string | null = process.env.HOME ?? null,
  platform: NodeJS.Platform = process.platform
): string {
  // Guard no expanding on windows
  if (platform === "win32") {
    return filepath;
  }
  // Guard tilde is present
  if (filepath[0] !== "~") {
    return filepath;
  }
  // Guard we know home directory
  if (!directory) {
    return filepath;
  }
  return path.join(directory, filepath.slice(1));
}
