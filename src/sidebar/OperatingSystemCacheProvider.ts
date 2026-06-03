import * as vscode from "vscode";
import { WendyCLI } from "../wendy-cli/wendy-cli";
import { execFile } from "../utilities/utilities";

export interface OsCacheEntry {
  name: string;
  sizeBytes: number;
  size: string;
}

export class OperatingSystemCacheProvider
  implements vscode.TreeDataProvider<OsCacheItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    OsCacheItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly outputChannel: vscode.OutputChannel) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: OsCacheItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: OsCacheItem): Promise<OsCacheItem[]> {
    if (element) {
      return [];
    }

    const entries = await this.listOsCacheEntries();
    if (entries.length === 0) {
      return [new OsCacheEmptyItem()];
    }
    return entries.map((e) => new OsCacheItem(e));
  }

  private async listOsCacheEntries(): Promise<OsCacheEntry[]> {
    const cli = await WendyCLI.create();
    if (!cli) {
      return [];
    }

    try {
      const { stdout } = await execFile(cli.path, [
        "--json",
        "os",
        "cache",
        "list",
      ]);
      const parsed: OsCacheEntry[] = JSON.parse(stdout.trim());
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      this.outputChannel.appendLine(
        `Failed to list OS cache: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }
}

export class OsCacheItem extends vscode.TreeItem {
  constructor(public readonly entry: OsCacheEntry) {
    super(entry.name, vscode.TreeItemCollapsibleState.None);
    this.description = entry.size;
    this.tooltip = `${entry.name}\n${entry.size} (${entry.sizeBytes.toLocaleString()} bytes)`;
    this.contextValue = "osCacheEntry";
    this.iconPath = new vscode.ThemeIcon("archive");
  }
}

class OsCacheEmptyItem extends vscode.TreeItem {
  constructor() {
    super("No cached OS images", vscode.TreeItemCollapsibleState.None);
    this.contextValue = "osCacheEmpty";
    this.iconPath = new vscode.ThemeIcon("info");
  }
}
