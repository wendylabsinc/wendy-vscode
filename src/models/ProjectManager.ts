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
   * Build and push a Wendy project without running it
   */
  async buildProject(projectPath: string, executable?: string, deviceAddress?: string): Promise<void> {
    const cli = await WendyCLI.create();
    if (!cli) {
      throw new Error("Wendy CLI not found");
    }

    let args = ['build', '-y'];
    if (executable) {
      args.push(executable);
    }
    if (deviceAddress) {
      args.push('--device', deviceAddress);
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
