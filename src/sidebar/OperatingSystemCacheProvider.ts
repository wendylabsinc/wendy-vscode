import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";

export class CacheTreeItem extends vscode.TreeItem {
  constructor(
    public readonly fullPath: string,
    public readonly isDirectory: boolean
  ) {
    super(
      path.basename(fullPath) || fullPath,
      isDirectory
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    this.resourceUri = vscode.Uri.file(fullPath);
    this.contextValue = isDirectory
      ? "operatingSystemCacheDirectory"
      : "operatingSystemCacheFile";
    this.iconPath = new vscode.ThemeIcon(isDirectory ? "folder" : "file");

    if (!isDirectory) {
      this.command = {
        command: "vscode.open",
        title: "Open File",
        arguments: [this.resourceUri],
      };
    }
  }
}

export class OperatingSystemCacheProvider
  implements vscode.TreeDataProvider<CacheTreeItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<CacheTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly disposables: vscode.Disposable[] = [];
  private watcher?: vscode.FileSystemWatcher;
  private watcherDisposables: vscode.Disposable[] = [];
  private refreshTimeout?: NodeJS.Timeout;
  private currentRoot: string | undefined;

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("wendy.cache.root")) {
          this.ensureWatcher(true);
        }
      })
    );

    this.ensureWatcher(false);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: CacheTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: CacheTreeItem): Promise<CacheTreeItem[]> {
    this.ensureWatcher(false);

    const targetPath = element?.fullPath ?? this.getCacheRoot();

    if (!(await this.pathExists(targetPath))) {
      return [];
    }

    return this.getDirectoryEntries(targetPath);
  }

  getRootPath(): string {
    return this.getCacheRoot();
  }

  private async getDirectoryEntries(
    directory: string
  ): Promise<CacheTreeItem[]> {
    try {
      const dirents = await fs.readdir(directory, { withFileTypes: true });

      const entries = dirents
        .map((entry) => {
          const entryPath = path.join(directory, entry.name);
          return {
            entryPath,
            isDirectory: entry.isDirectory(),
            name: entry.name,
          };
        })
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1;
          }

          return a.name.localeCompare(b.name);
        });

      return entries.map(
        (entry) => new CacheTreeItem(entry.entryPath, entry.isDirectory)
      );
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === "ENOENT" || err?.code === "EACCES") {
        return [];
      }

      void vscode.window.showErrorMessage(
        `Failed to read Wendy cache directory: ${err?.message ?? error}`
      );
      return [];
    }
  }

  private ensureWatcher(forceRefresh: boolean): void {
    const rootPath = this.getCacheRoot();

    if (!forceRefresh && this.currentRoot === rootPath && this.watcher) {
      return;
    }

    this.currentRoot = rootPath;
    this.resetWatcher(rootPath);
  }

  private resetWatcher(rootPath: string): void {
    this.disposeWatcher();

    try {
      const pattern = new vscode.RelativePattern(rootPath, "**/*");
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      this.watcher = watcher;

      const onFsEvent = (): void => {
        this.scheduleRefresh();
      };

      this.watcherDisposables = [
        watcher.onDidCreate(onFsEvent),
        watcher.onDidChange(onFsEvent),
        watcher.onDidDelete(onFsEvent),
      ];
    } catch (error) {
      const err = error as Error;
      void vscode.window.showErrorMessage(
        `Failed to watch Wendy cache directory: ${err.message}`
      );
      this.watcher = undefined;
      this.watcherDisposables = [];
    }

    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    this.refreshTimeout = setTimeout(() => {
      this.refresh();
      this.refreshTimeout = undefined;
    }, 200);
  }

  private getCacheRoot(): string {
    const configuredRoot = vscode.workspace
      .getConfiguration("wendy")
      .get<string>("cache.root");
    const trimmed = configuredRoot?.trim();

    if (trimmed) {
      return path.resolve(this.expandHome(trimmed));
    }

    if (process.platform === "win32") {
      const localAppData =
        process.env.LOCALAPPDATA ||
        path.join(os.homedir(), "AppData", "Local");
      return path.join(localAppData, "Wendy", "cache");
    }

    return path.join(os.homedir(), ".wendy", "cache");
  }

  private expandHome(targetPath: string): string {
    if (targetPath === "~") {
      return os.homedir();
    }

    if (targetPath.startsWith("~/") || targetPath.startsWith("~\\")) {
      return path.join(os.homedir(), targetPath.slice(2));
    }
    return targetPath;
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private disposeWatcher(): void {
    this.watcher?.dispose();
    this.watcher = undefined;

    this.watcherDisposables.forEach((disposable) => disposable.dispose());
    this.watcherDisposables = [];
  }

  dispose(): void {
    this.disposeWatcher();

    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = undefined;
    }

    this.disposables.forEach((disposable) => disposable.dispose());
    this._onDidChangeTreeData.dispose();
  }
}
