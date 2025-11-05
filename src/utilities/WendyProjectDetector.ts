import * as fs from "fs";
import * as path from "path";
import * as util from "util";
import { exec } from "child_process";

/**
 * Detects whether a workspace folder is a Wendy project by checking
 * for known package dependencies, configuration files, or CLI metadata.
 */
export class WendyProjectDetector {
  // Known dependency identifiers that imply a Wendy project
  private static readonly WENDY_DEPENDENCY_PATTERNS = [
    "wendy-runtime",
    "wendy-agent",
    "wendy-proxy",
    "apache-wendy",
    "apache/wendy",
  ];

  /**
   * Checks if the given folder is a Wendy project.
   * @param folderPath Path to the folder to check.
   * @returns Promise that resolves to true if it's a Wendy project, false otherwise.
   */
  public static async isWendyProject(folderPath: string): Promise<boolean> {
    // Method 1: Look for Wendy dependencies inside Package.swift
    const packageSwiftPath = path.join(folderPath, "Package.swift");
    try {
      if (fs.existsSync(packageSwiftPath)) {
        const packageContent = await fs.promises.readFile(
          packageSwiftPath,
          "utf8"
        );
        for (const pattern of this.WENDY_DEPENDENCY_PATTERNS) {
          if (packageContent.includes(pattern)) {
            return true;
          }
        }
      }
    } catch (error) {
      console.error(`Error checking Package.swift: ${error}`);
    }

    // Method 2: Look for wendy.json configuration
    const wendyConfigPath = path.join(folderPath, "wendy.json");
    try {
      if (fs.existsSync(wendyConfigPath)) {
        return true;
      }
    } catch (error) {
      console.error(`Error checking for wendy.json: ${error}`);
    }

    // Method 3: Run `wendy info` within the directory
    try {
      const execPromise = util.promisify(exec);
      const { stdout } = await execPromise("wendy info", { cwd: folderPath });
      if (stdout && !stdout.toLowerCase().includes("error")) {
        return true;
      }
    } catch {
      // Ignore failures; they are expected when the folder is not a Wendy project.
    }

    return false;
  }
}
