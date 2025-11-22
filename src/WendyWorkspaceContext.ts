import * as vscode from "vscode";
import { WendyCLI } from "./wendy-cli/wendy-cli";
import { WendyFolderContext } from "./WendyFolderContext";
// Import only types, not the actual implementation
import type * as Swift from "swiftlang.swift-vscode";
import { WendyProjectDetector } from "./utilities/WendyProjectDetector";
import { makeDebugConfigurations, hasAnyWendyDebugConfiguration } from "./debugger/launch";

// Define the enum values as constants since we can't use the imported types at runtime
const FolderOperation = {
  add: "add",
  remove: "remove",
  focus: "focus",
  unfocus: "unfocus",
  packageUpdated: "packageUpdated",
  resolvedUpdated: "resolvedUpdated",
  workspaceStateUpdated: "workspaceStateUpdated",
  packageViewUpdated: "packageViewUpdated",
  pluginsUpdated: "pluginsUpdated",
} as const;

// This type helps us ensure our locally defined FolderOperation
// matches the imported Swift.FolderOperation
// If the Swift API changes in the future, TypeScript will show errors at compile time
type VerifyFolderOperation = Record<Swift.FolderOperation, string>;
// This will cause a compile-time error if our FolderOperation doesn't
// contain all the keys from Swift.FolderOperation
const _typeCheck: VerifyFolderOperation = FolderOperation;

export class WendyWorkspaceContext implements vscode.Disposable {
  public folders: WendyFolderContext[] = [];
  public readonly hasSwiftExtension: boolean;
  public readonly hasPythonExtension: boolean;
  private _onDidChangePackage = new vscode.EventEmitter<WendyFolderContext>();
  private hasWendyFolder = false;
  public readonly onDidChangePackage = this._onDidChangePackage.event;

  // Add a new event for when folders are ready
  private _onFoldersReady = new vscode.EventEmitter<void>();
  public readonly onFoldersReady = this._onFoldersReady.event;

  // Track whether initial folder setup is complete
  private _initialFoldersReady = false;
  private _initialFolderSetupTimeout: NodeJS.Timeout | null = null;

  // Track the initial workspace folders
  private _initialFolderPaths: Set<string> = new Set();
  private _processedFolderPaths: Set<string> = new Set();

  // Flag to prevent generating configurations multiple times
  private _generatedConfigurations = false;

  constructor(
    public readonly context: vscode.ExtensionContext,
    public readonly output: vscode.OutputChannel,
    public readonly cli: WendyCLI,
    public readonly swift: Swift.WorkspaceContext | undefined,
    hasPythonExtension = false
  ) {
    this.hasSwiftExtension = Boolean(swift);
    this.hasPythonExtension = hasPythonExtension;

    // Store initial workspace folders to track processing
    if (vscode.workspace.workspaceFolders) {
      console.log(`[Wendy] Initial workspace has ${vscode.workspace.workspaceFolders.length} folders`);
      for (const folder of vscode.workspace.workspaceFolders) {
        this._initialFolderPaths.add(folder.uri.fsPath);
      }
    } else {
      console.log(`[Wendy] No initial workspace folders`);
    }

    // Subscribe to Swift workspace events when available
    if (this.swift) {
      context.subscriptions.push(
        this.swift.onDidChangeFolders((event) => this.handleFolderEvent(event))
      );
    } else {
      // Without the Swift extension we won't receive folder events, so mark ready immediately
      this.markFoldersReady();
    }

    // Still set a timeout as a fallback, but extend it since we'll likely
    // finish processing folders before this timeout
    this._initialFolderSetupTimeout = setTimeout(() => {
      console.log("[Wendy] Initial folder setup complete (timeout)");
      this.markFoldersReady();
    }, 5000); // 5 second fallback timeout

    // Subscribe to our own folders ready event
    this.onFoldersReady(() => {
      console.log(`[Wendy] Folders ready event handler in WendyWorkspaceContext`);
      this.generateLaunchConfigurations();
    });
  }

  dispose(): void {
    this.folders.forEach((folder) => folder.dispose());
    this.folders.length = 0;
    this._onDidChangePackage.dispose();
    this._onFoldersReady.dispose();

    if (this._initialFolderSetupTimeout) {
      clearTimeout(this._initialFolderSetupTimeout);
    }
  }

  /**
   * Returns whether the initial folder setup is complete
   */
  public get initialFoldersReady(): boolean {
    return this._initialFoldersReady;
  }

  /**
   * Mark folders as ready and fire the event if not already done
   */
  private markFoldersReady(): void {
    if (!this._initialFoldersReady) {
      this._initialFoldersReady = true;
      console.log(`[Wendy] Marking folders as ready, found ${this.folders.length} processed folders`);
      this._onFoldersReady.fire();

      // Clear the timeout if it's still pending
      if (this._initialFolderSetupTimeout) {
        clearTimeout(this._initialFolderSetupTimeout);
        this._initialFolderSetupTimeout = null;
      }
    }
  }

  /**
   * Check if all initial folders have been processed
   */
  private checkAllFoldersProcessed(): void {
    // If we have no initial folders, or we've processed all of them, we're ready
    if (this._initialFolderPaths.size === 0 ||
      this._initialFolderPaths.size === this._processedFolderPaths.size) {
      console.log(`[Wendy] All initial folders processed (${this._processedFolderPaths.size}/${this._initialFolderPaths.size})`);
      this.markFoldersReady();
    } else {
      console.log(`[Wendy] Still waiting for folders: ${this._processedFolderPaths.size}/${this._initialFolderPaths.size}`);
    }
  }

  /**
   * Generate launch configurations for Wendy projects
   */
  public async generateLaunchConfigurations(): Promise<void> {
    // Only generate configurations once
    if (this._generatedConfigurations) {
      console.log(`[Wendy] Already generated configurations, skipping`);
      return;
    }

    this._generatedConfigurations = true;
    console.log(`[Wendy] Starting launch configuration generation from WendyWorkspaceContext`);

    try {
      const hasExistingWendyConfig = await hasAnyWendyDebugConfiguration();
      console.log(`[Wendy] Existing Wendy configurations found: ${hasExistingWendyConfig}`);

      if (!vscode.workspace.workspaceFolders) {
        console.log(`[Wendy] No workspace folders found, skipping configuration generation`);
        return;
      }

      console.log(`[Wendy] No existing configurations found, checking ${vscode.workspace.workspaceFolders.length} workspace folders`);

      nextFolder: for (const folder of vscode.workspace.workspaceFolders) {
        console.log(`[Wendy] Checking if folder is an Wendy project: ${folder.name} (${folder.uri.fsPath})`);
        const isWendyProject = await WendyProjectDetector.isWendyProject(folder.uri.fsPath);
        console.log(`[Wendy] Is Wendy project: ${isWendyProject} for folder: ${folder.name}`);

        if (!isWendyProject) {
          continue nextFolder;
        }

        this.output.appendLine(`Detected Wendy project in folder: ${folder.name}`);
        console.log(`[Wendy] Searching for matching WendyFolderContext in ${this.folders.length} contexts`);

        // Dump all available WendyFolderContext objects for debugging
        this.folders.forEach((wendyFolder, index) => {
          console.log(`[Wendy] Context ${index}: ${wendyFolder.folder.fsPath}`);
        });

        let existingMatchFound = false;
        // Find the corresponding WendyFolderContext
        for (const wendyFolder of this.folders) {
          console.log(`[Wendy] Comparing paths: ${wendyFolder.folder.fsPath} vs ${folder.uri.fsPath}`);

          if (wendyFolder.folder.fsPath === folder.uri.fsPath) {
            existingMatchFound = true;
            console.log(`[Wendy] Found matching WendyFolderContext, generating configurations`);

            const result = await makeDebugConfigurations(wendyFolder);
            console.log(`[Wendy] makeDebugConfigurations result: ${result}`);

            if (result) {
              this.output.appendLine(`Added Wendy debug configurations to ${folder.name}`);
              console.log(`[Wendy] Successfully added configurations to ${folder.name}`);
              await this.promptRefreshDebugConfigurations();
              return;
            } else {
              this.output.appendLine(`Wendy configurations already exist or couldn't be added for ${folder.name}`);
              console.log(`[Wendy] Failed to add configurations to ${folder.name}`);
            }
            break;
          }
        }

        {
          console.log(`[Wendy] No matching WendyFolderContext found for ${folder.name}`);
          const newFolder = new WendyFolderContext(undefined, this, folder.uri);
          this.folders.push(newFolder);

          // Mark this folder as processed
          const folderPath = folder.uri.fsPath;
          this._processedFolderPaths.add(folderPath);
          console.log(`[Wendy] Processed folder: ${folderPath}`);

          // Check if all initial folders are now processed
          if (this._initialFolderPaths.has(folderPath)) {
            this.checkAllFoldersProcessed();
          }

          const result = await makeDebugConfigurations(newFolder);
          console.log(`[Wendy] makeDebugConfigurations result: ${result}`);

          if (result) {
            this.output.appendLine(`Added Wendy debug configurations to ${folder.name}`);
            console.log(`[Wendy] Successfully added configurations to ${folder.name}`);
          } else {
            this.output.appendLine(`Wendy configurations already exist or couldn't be added for ${folder.name}`);
            console.log(`[Wendy] Failed to add configurations to ${folder.name}`);
          }
        }
      }
    } catch (error) {
      console.error(`[Wendy] Error generating launch configurations: ${error}`);
      this.output.appendLine(`Error generating launch configurations: ${error}`);
    }
  }

  /**
   * Ensure we have an WendyFolderContext for the given Swift folder context.
   * @param folder
   * @returns Either the existing WendyFolderContext or a new one.
   */
  private getOrCreateFolderContext(
    folder: Swift.FolderContext
  ): WendyFolderContext {
    // Check if we already have a context for this folder
    const existingFolder = this.folders.find((f) => f.swift === folder);

    if (existingFolder) {
      this.hasWendyFolder = true;
      return existingFolder;
    }

    // Create a new context if one doesn't exist
    const newFolder = new WendyFolderContext(folder, this, folder.folder);
    this.folders.push(newFolder);

    // Mark this folder as processed
    const folderPath = folder.folder.fsPath;
    this._processedFolderPaths.add(folderPath);
    console.log(`[Wendy] Processed folder: ${folderPath}`);

    // Check if all initial folders are now processed
    if (this._initialFolderPaths.has(folderPath)) {
      this.checkAllFoldersProcessed();
    }

    return newFolder;
  }

  private async handleFolderEvent({
    operation,
    workspace,
    folder,
  }: Swift.FolderEvent) {
    console.log(`[Wendy] Handling folder event: ${operation}`);
    if (!folder) {
      console.log(`[Wendy] Received folder event with no folder context, skipping`);
      return;
    }

    console.log(`[Wendy] Folder event: ${operation} for ${folder.folder.fsPath}`);

    switch (operation) {
      case FolderOperation.add:
      case FolderOperation.packageUpdated: {
        // Ensure we have an WendyFolderContext for the folder
        console.log(`Wendy folder ${operation} detected: ${folder.name}`);
        const wendyFolder = this.getOrCreateFolderContext(folder);

        // Emit an event indicating the package was updated
        this._onDidChangePackage.fire(wendyFolder);
        break;
      }
      case FolderOperation.remove: {
        // Clean up the WendyFolderContext for the removed folder
        const wendyFolder = this.folders.find((f) => f.swift === folder || f.folder.fsPath === folder.folder.fsPath);
        if (wendyFolder && !this.hasWendyFolder) {
          wendyFolder.dispose();
          this.folders.splice(this.folders.indexOf(wendyFolder), 1);

          // Refresh debug configurations after removing a folder
          this.promptRefreshDebugConfigurations();
        }
        break;
      }
      default: {
        // Skip other operations
        return;
      }
    }
  }

  /**
   * Refresh the debug configurations in VS Code
   */
  public async promptRefreshDebugConfigurations(): Promise<void> {
    const selection = await vscode.window.showInformationMessage(
      "Swift package updated. You may need to refresh debug configurations.",
      "Refresh"
    );

    if (selection === "Refresh") {
      vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
  }
}
