import {
  execFile,
  expandFilePathTilde,
  getErrorDescription,
} from "../utilities/utilities";
import * as fs from "fs/promises";
import * as vscode from "vscode";

export class WendyCLI {
  public version: string;

  constructor(public readonly path: string, version?: string) {
    this.version = version || "";
  }

  static async create(): Promise<WendyCLI | undefined> {
    try {
      const path = await WendyCLI.getWendyPath();
      const cli = new WendyCLI(path);
      cli.version = await cli.getVersion();
      return cli;
    } catch (error) {
      console.error("Failed to create WendyCLI:", getErrorDescription(error));
      return undefined;
    }
  }

  private static async getWendyPath(): Promise<string> {
    // Check if a custom path is configured
    const config = vscode.workspace.getConfiguration("wendyos");
    const configuredPath = config.get<string>("cliPath");

    if (configuredPath && configuredPath.trim() !== "") {
      try {
        // Check if the configured path exists and is executable
        const expandedPath = expandFilePathTilde(configuredPath);
        await fs.access(expandedPath, fs.constants.X_OK);
        return expandedPath;
      } catch (error) {
        throw new Error(
          `Configured Wendy CLI path "${configuredPath}" is not accessible or executable.`
        );
      }
    }

    // Fall back to auto-discovery if no path is configured
    try {
      let wendyCli: string;
      // TODO: Allow overriding the path via a setting.
      switch (process.platform) {
        case "win32": {
          const { stdout } = await execFile("where", ["wendy"]);
          // `where` may return multiple lines; take the first match
          wendyCli = stdout.trimEnd().split(/\r?\n/)[0];
          break;
        }
        case "darwin": {
          const { stdout } = await execFile("which", ["wendy"]);
          wendyCli = stdout.trimEnd();
          break;
        }
        default: {
          // similar to SwiftToolchain.getSwiftFolderPath(), use `type` to find `wendy`
          const { stdout } = await execFile("/bin/sh", [
            "-c",
            "LC_MESSAGES=C type wendy",
          ]);
          const wendyMatch = /^wendy is (.*)$/.exec(stdout.trimEnd());
          if (wendyMatch) {
            wendyCli = wendyMatch[1];
          } else {
            throw Error("Failed to find wendy executable");
          }
          break;
        }
      }

      // It might be a symbolic link, so resolve it.
      const realWendy = await fs.realpath(wendyCli);
      return expandFilePathTilde(realWendy);
    } catch (error) {
      throw new Error(`Failed to find wendy executable`);
    }
  }

  private async exec(args: string[]): Promise<string> {
    const { stdout } = await execFile(this.path, args);
    return stdout.trimEnd();
  }

  public async getVersion(): Promise<string> {
    return await this.exec(["--version"]);
  }

  public async getInfo(): Promise<WendyInfo> {
    const output = await this.exec(["info"]);
    return JSON.parse(output);
  }

  public async getJsonSchema(): Promise<string> {
    return await this.exec(["json", "schema"]);
  }

  /**
   * Unenrolls a device, resetting it to an unprovisioned state and removing
   * its asset record from Wendy Cloud. Passes `--yes` to skip the interactive
   * confirmation prompt (confirmation is handled by the VS Code UI before
   * this method is called). Optionally overrides the cloud gRPC endpoint.
   *
   * @param deviceAddress Address (hostname or hostname:port) of the device to unenroll.
   * @param cloudGRPC Optional cloud gRPC endpoint override.
   */
  public async unenrollDevice(
    deviceAddress: string,
    cloudGRPC?: string
  ): Promise<void> {
    const args = ["device", "unenroll", "--agent", deviceAddress, "--yes"];
    if (cloudGRPC && cloudGRPC.trim() !== "") {
      args.push("--cloud-grpc", cloudGRPC.trim());
    }
    await this.exec(args);
  }

  /**
   * Renames a device — sets its hostname (and mDNS `.local` name) on the
   * device itself and updates its asset name in Wendy Cloud (when enrolled).
   * Delegates entirely to `wendy device rename <name> --device <address>`;
   * the CLI handles the two-step rename and partial-failure reporting.
   *
   * The name must be a valid DNS label: starts with a lowercase letter,
   * contains only lowercase letters, digits, and hyphens, does not end with a
   * hyphen, and is at most 63 characters. Validation is enforced by the CLI
   * (and the agent); this method passes the value through as-is.
   *
   * @param deviceAddress Address (hostname or hostname:port) of the device to rename.
   * @param name New device name (a valid DNS label).
   * @param cloudGRPC Optional cloud gRPC endpoint override.
   */
  public async renameDevice(
    deviceAddress: string,
    name: string,
    cloudGRPC?: string
  ): Promise<void> {
    const args = ["device", "rename", name, "--device", deviceAddress];
    if (cloudGRPC && cloudGRPC.trim() !== "") {
      args.push("--cloud-grpc", cloudGRPC.trim());
    }
    await this.exec(args);
  }
}

export interface WendyInfo {
  version: string;
  swift?: {
    version: string;
    sdk: string;
    sdkDownloadURL: string;
  };
}

/**
 * Validates a device name as a DNS label, mirroring the rule enforced by the
 * CLI (`validateHostnameArg`) and the agent (`validHostname`):
 *   - 1–63 characters
 *   - starts with a lowercase letter
 *   - contains only lowercase letters, digits, and hyphens
 *   - does not end with a hyphen
 *
 * Returns an error message string when invalid, or `undefined` when valid.
 * The return type matches the signature expected by `vscode.window.showInputBox`'s
 * `validateInput` option.
 */
export function validateDeviceName(name: string): string | undefined {
  if (!name || name.length === 0) {
    return "Name must not be empty.";
  }
  if (name.length > 63) {
    return "Name must be at most 63 characters.";
  }
  for (let i = 0; i < name.length; i++) {
    const c = name[i];
    const isLower = c >= "a" && c <= "z";
    const isDigit = c >= "0" && c <= "9";
    const isHyphen = c === "-";
    if (!isLower && !isDigit && !isHyphen) {
      return "Name may only contain lowercase letters, digits, and hyphens.";
    }
    if (i === 0 && !isLower) {
      return "Name must start with a lowercase letter.";
    }
  }
  if (name[name.length - 1] === "-") {
    return "Name must not end with a hyphen.";
  }
  return undefined;
}
