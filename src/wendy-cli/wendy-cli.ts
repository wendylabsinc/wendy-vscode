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
}
