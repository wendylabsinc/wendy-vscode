import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import { exec } from 'child_process';

/**
 * A utility for detecting if a workspace folder is an Edge project.
 * This could check various signals:
 * 1. Package.swift dependencies that include Edge libraries
 * 2. Presence of edge.json configuration file
 * 3. Output from running `edge info` in the directory
 */
export class EdgeProjectDetector {
  // Edge-specific dependency URLs that indicate an Edge project
  private static readonly EDGE_DEPENDENCY_PATTERNS = [
    'edge-runtime',
    'edge-agent',
    'edge-proxy',
    'apache-edge',
    'apache/edge'
  ];

  /**
   * Checks if the given folder is an Edge project
   * @param folderPath Path to the folder to check
   * @returns Promise that resolves to true if it's an Edge project, false otherwise
   */
  public static async isEdgeProject(folderPath: string): Promise<boolean> {
    // Method 1: Check Package.swift for Edge dependencies
    const packageSwiftPath = path.join(folderPath, 'Package.swift');
    try {
      const packageSwiftExists = fs.existsSync(packageSwiftPath);
      if (packageSwiftExists) {
        const packageContent = await fs.promises.readFile(packageSwiftPath, 'utf8');
        
        // Check for Edge-specific dependencies in the Package.swift
        for (const pattern of this.EDGE_DEPENDENCY_PATTERNS) {
          if (packageContent.includes(pattern)) {
            return true;
          }
        }
      }
    } catch (error) {
      // If there's an error reading the file, continue to the next method
      console.error(`Error checking Package.swift: ${error}`);
    }

    // Method 2: Check for .edge directory or configuration
    const edgeConfigPath = path.join(folderPath, 'edge.json');
    try {
      if (fs.existsSync(edgeConfigPath)) {
        return true;
      }
    } catch (error) {
      console.error(`Error checking for edge.json: ${error}`);
    }

    // Method 3: Run edge info command in the directory
    // This method is more expensive, so we only run it if the previous methods failed
    try {
      const execPromise = util.promisify(exec);
      const { stdout } = await execPromise('edge info', { cwd: folderPath });
      
      // If the command returns successfully and doesn't contain error messages,
      // it's likely an Edge project
      if (stdout && !stdout.toLowerCase().includes('error')) {
        return true;
      }
    } catch (error) {
      // Command failed, which is expected for non-Edge projects
      // No need to log this error
    }

    // If we've made it this far, it's not an Edge project
    return false;
  }
} 