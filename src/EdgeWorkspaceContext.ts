import * as vscode from "vscode";
import { EdgeCLI } from "./edge-cli/edge-cli";
import { EdgeFolderContext } from "./EdgeFolderContext";
// Import only types, not the actual implementation
import type * as Swift from "swiftlang.swift-vscode";
import { EdgeProjectDetector } from "./utilities/EdgeProjectDetector";
import { makeDebugConfigurations, hasAnyEdgeDebugConfiguration } from "./debugger/launch";

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

export class EdgeWorkspaceContext implements vscode.Disposable {
  public folders: EdgeFolderContext[] = [];
  private _onDidChangePackage = new vscode.EventEmitter<EdgeFolderContext>();
  private hasEdgeFolder = false;
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
    public readonly cli: EdgeCLI,
    public readonly swift: Swift.WorkspaceContext
  ) {
    // Store initial workspace folders to track processing
    if (vscode.workspace.workspaceFolders) {
      console.log(`[Edge] Initial workspace has ${vscode.workspace.workspaceFolders.length} folders`);
      for (const folder of vscode.workspace.workspaceFolders) {
        this._initialFolderPaths.add(folder.uri.fsPath);
      }
    } else {
      console.log(`[Edge] No initial workspace folders`);
    }
    
    // Subscribe to Swift workspace events
    context.subscriptions.push(
      this.swift.onDidChangeFolders((event) => this.handleFolderEvent(event))
    );
    
    // Still set a timeout as a fallback, but extend it since we'll likely
    // finish processing folders before this timeout
    this._initialFolderSetupTimeout = setTimeout(() => {
      console.log("[Edge] Initial folder setup complete (timeout)");
      this.markFoldersReady();
    }, 5000); // 5 second fallback timeout
    
    // Subscribe to our own folders ready event
    this.onFoldersReady(() => {
      console.log(`[Edge] Folders ready event handler in EdgeWorkspaceContext`);
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
      console.log(`[Edge] Marking folders as ready, found ${this.folders.length} processed folders`);
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
      console.log(`[Edge] All initial folders processed (${this._processedFolderPaths.size}/${this._initialFolderPaths.size})`);
      this.markFoldersReady();
    } else {
      console.log(`[Edge] Still waiting for folders: ${this._processedFolderPaths.size}/${this._initialFolderPaths.size}`);
    }
  }
  
  /**
   * Generate launch configurations for Edge projects
   */
  public async generateLaunchConfigurations(): Promise<void> {
    // Only generate configurations once
    if (this._generatedConfigurations) {
      console.log(`[Edge] Already generated configurations, skipping`);
      return;
    }
    
    this._generatedConfigurations = true;
    console.log(`[Edge] Starting launch configuration generation from EdgeWorkspaceContext`);
    
    try {
      const hasExistingEdgeConfig = await hasAnyEdgeDebugConfiguration();
      console.log(`[Edge] Existing Edge configurations found: ${hasExistingEdgeConfig}`);
      
      if (hasExistingEdgeConfig) {
        console.log(`[Edge] Skipping configuration generation as Edge configurations already exist`);
        return
      } else if (!vscode.workspace.workspaceFolders) {
        console.log(`[Edge] No workspace folders found, skipping configuration generation`);
        return;
      }

      console.log(`[Edge] No existing configurations found, checking ${vscode.workspace.workspaceFolders.length} workspace folders`);
      
      nextFolder: for (const folder of vscode.workspace.workspaceFolders) {
        console.log(`[Edge] Checking if folder is an Edge project: ${folder.name} (${folder.uri.fsPath})`);
        const isEdgeProject = await EdgeProjectDetector.isEdgeProject(folder.uri.fsPath);
        console.log(`[Edge] Is Edge project: ${isEdgeProject} for folder: ${folder.name}`);
        
        if (!isEdgeProject) {
          continue nextFolder;
        }

        this.output.appendLine(`Detected Edge project in folder: ${folder.name}`);
        console.log(`[Edge] Searching for matching EdgeFolderContext in ${this.folders.length} contexts`);
        
        // Dump all available EdgeFolderContext objects for debugging
        this.folders.forEach((edgeFolder, index) => {
          console.log(`[Edge] Context ${index}: ${edgeFolder.swift.folder.fsPath}`);
        });
        
        let matchFound = false;
        // Find the corresponding EdgeFolderContext
        nextEdgeFolder: for (const edgeFolder of this.folders) {
          console.log(`[Edge] Comparing paths: ${edgeFolder.swift.folder.fsPath} vs ${folder.uri.fsPath}`);
          
          if (edgeFolder.swift.folder.fsPath !== folder.uri.fsPath) {
            continue nextEdgeFolder;
          }
          matchFound = true;
          console.log(`[Edge] Found matching EdgeFolderContext, generating configurations`);
          
          const result = await makeDebugConfigurations(edgeFolder.swift);
          console.log(`[Edge] makeDebugConfigurations result: ${result}`);
          
          if (result) {
            this.output.appendLine(`Added Edge debug configurations to ${folder.name}`);
            console.log(`[Edge] Successfully added configurations to ${folder.name}`);
            await this.promptRefreshDebugConfigurations();
          } else {
            this.output.appendLine(`Edge configurations already exist or couldn't be added for ${folder.name}`);
            console.log(`[Edge] Failed to add configurations to ${folder.name}`);
          }
        }
        
        if (!matchFound) {
          console.log(`[Edge] No matching EdgeFolderContext found for ${folder.name}`);
          this.output.appendLine(`No EdgeFolderContext found for ${folder.name}, cannot create debug configurations`);
        }
      }
    } catch (error) {
      console.error(`[Edge] Error generating launch configurations: ${error}`);
      this.output.appendLine(`Error generating launch configurations: ${error}`);
    }
  }

  /**
   * Ensure we have an EdgeFolderContext for the given Swift folder context.
   * @param folder
   * @returns Either the existing EdgeFolderContext or a new one.
   */
  private getOrCreateFolderContext(
    folder: Swift.FolderContext
  ): EdgeFolderContext {
    // Check if we already have a context for this folder
    const existingFolder = this.folders.find((f) => f.swift === folder);

    if (existingFolder) {
      this.hasEdgeFolder = true;
      return existingFolder;
    }

    // Create a new context if one doesn't exist
    const newFolder = new EdgeFolderContext(folder, this);
    this.folders.push(newFolder);
    
    // Mark this folder as processed
    const folderPath = folder.folder.fsPath;
    this._processedFolderPaths.add(folderPath);
    console.log(`[Edge] Processed folder: ${folderPath}`);
    
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
    if (!folder) {
      return;
    }

    console.log(`[Edge] Folder event: ${operation} for ${folder.folder.fsPath}`);

    switch (operation) {
      case FolderOperation.add:
      case FolderOperation.packageUpdated: {
        // Ensure we have an EdgeFolderContext for the folder
        const edgeFolder = this.getOrCreateFolderContext(folder);

        // Emit an event indicating the package was updated
        this._onDidChangePackage.fire(edgeFolder);
        break;
      }
      case FolderOperation.remove: {
        // Clean up the EdgeFolderContext for the removed folder
        const edgeFolder = this.folders.find((f) => f.swift === folder);
        if (edgeFolder && !this.hasEdgeFolder) {
          edgeFolder.dispose();
          this.folders.splice(this.folders.indexOf(edgeFolder), 1);

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
