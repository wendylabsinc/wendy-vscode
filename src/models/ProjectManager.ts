import * as vscode from "vscode";
import { execFile } from "child_process";
import { WendyCLI } from "../wendy-cli/wendy-cli";

export type EntitlementType = 'network' | 'video' | 'audio' | 'bluetooth' | 'gpu' | 'persist';

export interface Entitlement {
  type: EntitlementType;
  enabled: boolean;
  mode?: string;
  name?: string;
  path?: string;
}

export interface EntitlementOptions {
  mode?: string;
  name?: string;
  path?: string;
}

export interface BuildProjectOptions {
  /** Specific Dockerfile to build from (e.g. "Dockerfile.prod"). When omitted,
   *  the CLI will auto-detect or show an interactive picker. */
  dockerfile?: string;
  /** Build type to use when multiple project markers are present: docker, swift, or python. */
  buildType?: string;
  /** Target device address. */
  deviceAddress?: string;
  /** Executable name to build. */
  executable?: string;
}

export type OptimizeSeverity = "info" | "warning" | "error";

export interface OptimizeProjectOptions {
  /** Apply safe, deterministic fixes (cache mount, .dockerignore, release flag). */
  fix?: boolean;
  /** Emit a schema-versioned agent context bundle instead of a findings report. */
  agentic?: boolean;
  /** Force JSON output regardless of TTY state. */
  json?: boolean;
  /** Minimum severity that triggers a non-zero exit code. Defaults to "warning". */
  severity?: OptimizeSeverity;
  /** Target architecture override. Defaults to arm64 in the CLI. */
  arch?: string;
}

export interface OptimizeFinding {
  analyzer: string;
  severity: string;
  title: string;
  detail?: string;
  target?: string;
  location?: { file: string; line: number };
  fixable?: boolean;
}

export interface OptimizeReport {
  targets: unknown[];
  findings: OptimizeFinding[];
}

/**
 * Manages Wendy project operations
 */
export class ProjectManager {
  constructor(private outputChannel: vscode.OutputChannel) {}

  /**
   * Initialize a new Wendy project
   */
  async initProject(projectPath: string, language: 'swift' | 'python'): Promise<void> {
    const cli = await WendyCLI.create();
    if (!cli) {
      throw new Error("Wendy CLI not found");
    }

    return new Promise((resolve, reject) => {
      const args = ['init', '--path', projectPath, '--language', language];
      this.outputChannel.appendLine(`Executing: ${cli.path} ${args.join(' ')}`);

      execFile(cli.path, args, (error, stdout, stderr) => {
        if (error) {
          this.outputChannel.appendLine(`Error: ${stderr || error.message}`);
          reject(new Error(stderr || error.message));
          return;
        }
        this.outputChannel.appendLine(stdout);
        resolve();
      });
    });
  }

  /**
   * Build and push a Wendy project without running it.
   *
   * Accepts either the legacy positional-style arguments or a structured
   * {@link BuildProjectOptions} bag. The options bag is preferred for new
   * call-sites because it exposes the `--dockerfile` and `--build-type` flags
   * added in CLI PR #742.
   */
  async buildProject(
    projectPath: string,
    executableOrOptions?: string | BuildProjectOptions,
    deviceAddress?: string
  ): Promise<void> {
    const cli = await WendyCLI.create();
    if (!cli) {
      throw new Error("Wendy CLI not found");
    }

    // Normalise overloaded arguments.
    let executable: string | undefined;
    let resolvedDeviceAddress: string | undefined;
    let dockerfile: string | undefined;
    let buildType: string | undefined;

    if (executableOrOptions && typeof executableOrOptions === 'object') {
      executable = executableOrOptions.executable;
      resolvedDeviceAddress = executableOrOptions.deviceAddress;
      dockerfile = executableOrOptions.dockerfile;
      buildType = executableOrOptions.buildType;
    } else {
      executable = executableOrOptions as string | undefined;
      resolvedDeviceAddress = deviceAddress;
    }

    const args: string[] = ['build', '-y'];

    if (executable) {
      args.push(executable);
    }
    if (resolvedDeviceAddress) {
      args.push('--device', resolvedDeviceAddress);
    }
    // --dockerfile implies a Docker build; pass it before --build-type so the
    // CLI can apply its own normalisation. validateDockerfileName in the CLI
    // enforces the naming convention; we pass the value as-is.
    if (dockerfile) {
      args.push('--dockerfile', dockerfile);
    }
    if (buildType) {
      args.push('--build-type', buildType);
    }

    return new Promise((resolve, reject) => {
      this.outputChannel.appendLine(`Executing: ${cli.path} ${args.join(' ')}`);

      execFile(cli.path, args, { cwd: projectPath }, (error, stdout, stderr) => {
        if (error) {
          this.outputChannel.appendLine(`Error: ${stderr || error.message}`);
          reject(new Error(stderr || error.message));
          return;
        }
        this.outputChannel.appendLine(stdout);
        resolve();
      });
    });
  }

  /**
   * Run `wendy project optimize` against the given project directory.
   *
   * Returns the raw CLI output (human-readable text or JSON depending on
   * `options.json`). The caller is responsible for surfacing it to the user.
   *
   * Throws when the CLI exits with code 2 (error). Exit code 1 (findings
   * above the severity threshold) is not thrown — the findings are returned
   * in the output string so the caller can display them.
   */
  async optimizeProject(
    projectPath: string,
    options: OptimizeProjectOptions = {}
  ): Promise<string> {
    const cli = await WendyCLI.create();
    if (!cli) {
      throw new Error("Wendy CLI not found");
    }

    const args: string[] = ['project', 'optimize'];

    // Always request JSON output from the extension so we can parse / display
    // findings in a structured way inside VS Code.
    args.push('--json');

    if (options.fix) {
      args.push('--fix');
    }
    if (options.agentic) {
      args.push('--agentic');
    }
    if (options.severity) {
      args.push('--severity', options.severity);
    }
    if (options.arch) {
      args.push('--arch', options.arch);
    }

    this.outputChannel.appendLine(`Executing: ${cli.path} ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
      execFile(
        cli.path,
        args,
        { cwd: projectPath },
        (error, stdout, stderr) => {
          // Exit code 1 means findings were found above the severity threshold.
          // We still want to surface the output, so only reject on a hard error
          // (exit code 2 or a spawn error with no stdout).
          if (error) {
            const code = (error as NodeJS.ErrnoException & { code?: number }).code;
            // execFile sets error.code to the exit code for non-zero exits.
            if (typeof code === 'number' && code === 1 && stdout) {
              // Findings present — resolve so the caller can display them.
              this.outputChannel.appendLine(stdout);
              resolve(stdout);
              return;
            }
            const msg = stderr || error.message;
            this.outputChannel.appendLine(`Error: ${msg}`);
            reject(new Error(msg));
            return;
          }
          this.outputChannel.appendLine(stdout);
          resolve(stdout);
        }
      );
    });
  }

  /**
   * List project entitlements
   */
  async listEntitlements(projectPath: string, showAll: boolean = false): Promise<Entitlement[]> {
    const cli = await WendyCLI.create();
    if (!cli) {
      throw new Error("Wendy CLI not found");
    }

    return new Promise((resolve, reject) => {
      let args = ['--json', 'project', 'entitlements', 'list'];
      if (showAll) {
        args.push('--show-all');
      }
      args.push('--project', projectPath);

      this.outputChannel.appendLine(`Executing: ${cli.path} ${args.join(' ')}`);

      execFile(cli.path, args, (error, stdout, stderr) => {
        if (error) {
          this.outputChannel.appendLine(`Error: ${stderr || error.message}`);
          reject(new Error(stderr || error.message));
          return;
        }
        try {
          const entitlements = JSON.parse(stdout);
          resolve(entitlements);
        } catch {
          // If JSON parsing fails, return empty array
          resolve([]);
        }
      });
    });
  }

  /**
   * Add an entitlement to the project
   */
  async addEntitlement(
    projectPath: string,
    type: EntitlementType,
    options?: EntitlementOptions
  ): Promise<void> {
    const cli = await WendyCLI.create();
    if (!cli) {
      throw new Error("Wendy CLI not found");
    }

    let args = ['project', 'entitlements', 'add', '--entitlement-type', type];

    if (options?.mode) {
      args.push('--mode', options.mode);
    }
    if (options?.name) {
      args.push('--name', options.name);
    }
    if (options?.path) {
      args.push('--path', options.path);
    }
    args.push('--project', projectPath);

    return new Promise((resolve, reject) => {
      this.outputChannel.appendLine(`Executing: ${cli.path} ${args.join(' ')}`);

      execFile(cli.path, args, (error, stdout, stderr) => {
        if (error) {
          this.outputChannel.appendLine(`Error: ${stderr || error.message}`);
          reject(new Error(stderr || error.message));
          return;
        }
        this.outputChannel.appendLine(stdout);
        resolve();
      });
    });
  }

  /**
   * Remove an entitlement from the project
   */
  async removeEntitlement(projectPath: string, type: EntitlementType): Promise<void> {
    const cli = await WendyCLI.create();
    if (!cli) {
      throw new Error("Wendy CLI not found");
    }

    const args = ['project', 'entitlements', 'remove', '--entitlement-type', type, '--project', projectPath];

    return new Promise((resolve, reject) => {
      this.outputChannel.appendLine(`Executing: ${cli.path} ${args.join(' ')}`);

      execFile(cli.path, args, (error, stdout, stderr) => {
        if (error) {
          this.outputChannel.appendLine(`Error: ${stderr || error.message}`);
          reject(new Error(stderr || error.message));
          return;
        }
        this.outputChannel.appendLine(stdout);
        resolve();
      });
    });
  }
}
