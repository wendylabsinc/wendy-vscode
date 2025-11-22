// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { getErrorDescription } from "./utilities/utilities";
import { WendyCLI } from "./wendy-cli/wendy-cli";
import type { SwiftExtensionApi } from "swiftlang.swift-vscode";
import { WendyWorkspaceContext } from "./WendyWorkspaceContext";
import { WendyTaskProvider } from "./tasks/WendyTaskProvider";
import * as path from "path";
import * as fs from "fs/promises";
import { DocumentationProvider } from "./sidebar/DocumentationProvider";
import { DevicesProvider, DeviceTreeItem } from "./sidebar/DevicesProvider";
import { DeviceManager, LANDevice } from "./models/DeviceManager";
import { DiskManager } from "./models/DiskManager";
import { WendyDebugConfigurationProvider, WENDY_LAUNCH_CONFIG_TYPE } from "./debugger/WendyDebugConfigurationProvider";
import { DisksProvider } from "./sidebar/DisksProvider";
import {
  OperatingSystemCacheProvider,
  CacheTreeItem,
} from "./sidebar/OperatingSystemCacheProvider";
import { WendyImager } from "./utilities/Imager";
import { WendyProjectDetector } from "./utilities/WendyProjectDetector";
import { makeDebugConfigurations, hasAnyWendyDebugConfiguration } from "./debugger/launch";

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  try {
    const outputChannel = vscode.window.createOutputChannel("WendyOS");
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine(
      "Activating WendyOS extension for Visual Studio Code..."
    );

    // If we're developing the extension, focus the output channel
    if (context.extensionMode === vscode.ExtensionMode.Development) {
      outputChannel.show();
    }

    // Create the DeviceManager
    const deviceManager = new DeviceManager();
    const diskManager = new DiskManager(outputChannel);

    // Register the devices provider
    const devicesProvider = new DevicesProvider(deviceManager);
    const devicesTreeView = vscode.window.createTreeView("wendyDevices", {
      treeDataProvider: devicesProvider,
    });
    context.subscriptions.push(devicesTreeView);

    // Register the disks provider
    const disksProvider = new DisksProvider(diskManager);
    vscode.window.registerTreeDataProvider("wendyDisks", disksProvider);

    const operatingSystemCacheProvider = new OperatingSystemCacheProvider();
    const operatingSystemCacheTreeView = vscode.window.createTreeView(
      "wendyOperatingSystemCache",
      { treeDataProvider: operatingSystemCacheProvider }
    );
    context.subscriptions.push(
      operatingSystemCacheProvider,
      operatingSystemCacheTreeView
    );

    const getTargetDeviceTreeItem = (
      item?: DeviceTreeItem
    ): DeviceTreeItem | undefined => {
      if (item) {
        return item;
      }

      return devicesTreeView.selection?.[0];
    };

    const copyDeviceValue = async (
      item: DeviceTreeItem | undefined,
      valueFactory: (device: DeviceTreeItem["device"]) => string | undefined,
      label: string
    ): Promise<void> => {
      const targetItem = getTargetDeviceTreeItem(item);

      if (!targetItem) {
        return;
      }

      const value = valueFactory(targetItem.device);

      if (!value) {
        void vscode.window.showWarningMessage(
          `No ${label.toLowerCase()} available for ${targetItem.device.name}.`
        );
        return;
      }

      await vscode.env.clipboard.writeText(value);
      vscode.window.setStatusBarMessage(`Copied ${label}`, 2000);
    };

    const createDeviceInfoHtml = (
      deviceItem: DeviceTreeItem,
      deviceDetails: LANDevice | undefined
    ): string => {
      const escapeHtml = (value: string): string =>
        value
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");

      const attrEscape = (value: string): string =>
        escapeHtml(value).replace(/`/g, "&#96;");

      const displayName =
        deviceDetails?.displayName ?? deviceItem.device.name ?? "Unknown";
      const hostname = deviceDetails?.hostname ?? deviceItem.device.address;
      const rows: Array<[string, string]> = [];

      rows.push(["Display Name", displayName]);
      rows.push(["Hostname", hostname]);
      if (deviceDetails?.port) {
        rows.push(["Port", `${deviceDetails.port}`]);
      }
      rows.push(["Device ID", deviceItem.device.id]);

      if (deviceItem.device.agentVersion) {
        rows.push(["Agent Version", deviceItem.device.agentVersion]);
      }

      if (deviceDetails?.interfaceType) {
        rows.push(["Interface Type", deviceDetails.interfaceType]);
      } else {
        rows.push(["Interface Type", deviceItem.device.connectionType]);
      }

      if (deviceDetails?.isWendyDevice !== undefined) {
        rows.push([
          "Is Wendy Device",
          deviceDetails.isWendyDevice ? "Yes" : "No",
        ]);
      }

      const tableRowsHtml = rows
        .filter(([, value]) => value !== undefined && value !== "")
        .map(([label, value]) => {
          const escapedLabel = escapeHtml(label);
          const escapedValue = escapeHtml(value);
          const attrValue = attrEscape(value);
          const attrLabel = attrEscape(label);
          return `<tr>
              <th>${escapedLabel}</th>
              <td>
                <span class="value-text">${escapedValue}</span>
                <button class="copy-button" data-value="${attrValue}" data-label="${attrLabel}" title="Copy ${escapedLabel}" aria-label="Copy ${escapedLabel}">
                  <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M4 4l1-1h5.414L14 6.586V14l-1 1H5l-1-1V4zm9 3l-3-3H5v10h8V7z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M3 1L2 2v10l1 1V2h6.414l-1-1H3z"/></svg>
                </button>
              </td>
            </tr>`;
        })
        .join("");

      const subtitle = hostname
        ? `${hostname}${deviceDetails?.port ? `:${deviceDetails.port}` : ""}`
        : deviceItem.device.address;

      const appsSection = (() => {
        const apps = deviceDetails?.apps ?? [];
        if (apps.length === 0) {
          return `<p>No apps were discovered.</p>`;
        }

        const appRows = apps
          .map((app) => {
            const name = app?.name ?? "";
            const version = app?.version ?? "";
            const bundle = app?.bundleIdentifier ?? "";
            const nameEscaped = escapeHtml(name);
            const versionEscaped = escapeHtml(version);
            const bundleEscaped = escapeHtml(bundle);
            const copyButton = (value: string, label: string): string => {
              if (!value) {
                return "";
              }
              return `<button class="copy-button" data-value="${attrEscape(
                value
              )}" data-label="${attrEscape(label)}" title="Copy ${escapeHtml(
                label
              )}" aria-label="Copy ${escapeHtml(label)}">
                  <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M4 4l1-1h5.414L14 6.586V14l-1 1H5l-1-1V4zm9 3l-3-3H5v10h8V7z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M3 1L2 2v10l1 1V2h6.414l-1-1H3z"/></svg>
                </button>`;
            };

            return `<tr>
              <td>
                <span class="value-text">${nameEscaped || "&nbsp;"}</span>
                ${copyButton(name, "App Name")}
              </td>
              <td>
                <span class="value-text">${versionEscaped || "&nbsp;"}</span>
                ${copyButton(version, "App Version")}
              </td>
              <td>
                <span class="value-text">${bundleEscaped || "&nbsp;"}</span>
                ${copyButton(bundle, "Bundle Identifier")}
              </td>
            </tr>`;
          })
          .join("");

        return `<table class="info-table apps-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Version</th>
              <th>Bundle Identifier</th>
            </tr>
          </thead>
          <tbody>${appRows}</tbody>
        </table>`;
      })();

      const script = `
        const vscode = acquireVsCodeApi();
        document.querySelectorAll('.copy-button').forEach((button) => {
          button.addEventListener('click', () => {
            const value = button.getAttribute('data-value') ?? '';
            const label = button.getAttribute('data-label') ?? 'value';
            vscode.postMessage({ command: 'copy', value, label });
          });
        });
      `;

      return `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>${escapeHtml(displayName)}</title>
            <style>
              body {
                margin: 16px;
                font-family: var(--vscode-font-family, sans-serif);
                color: var(--vscode-editor-foreground, inherit);
                background-color: var(--vscode-editor-background, inherit);
              }

              .copy-button {
                border: none;
                background: transparent;
                cursor: pointer;
                padding: 2px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                color: var(--vscode-icon-foreground, inherit);
                margin-left: auto;
              }

              .copy-button:hover {
                background-color: var(--vscode-toolbar-hoverBackground, rgba(0,0,0,0.05));
              }

              .copy-button:active {
                background-color: var(--vscode-toolbar-activeBackground, rgba(0,0,0,0.1));
              }

              h1 {
                margin-bottom: 4px;
              }

              .subtitle {
                margin-top: 0;
                color: var(--vscode-descriptionForeground, inherit);
              }

              .info-table {
                width: 100%;
                border-collapse: collapse;
                border: 1px solid var(--vscode-panel-border, rgba(0,0,0,0.2));
                margin-bottom: 16px;
              }

              .info-table th,
              .info-table td {
                padding: 8px 12px;
                border-bottom: 1px solid var(--vscode-panel-border, rgba(0,0,0,0.2));
                text-align: left;
                vertical-align: middle;
              }

              .info-table th {
                width: 28%;
                color: var(--vscode-descriptionForeground, inherit);
              }

              .info-table tr:last-child th,
              .info-table tr:last-child td {
                border-bottom: none;
              }

              .info-table td {
                display: flex;
                align-items: center;
                gap: 8px;
              }

              .value-text {
                flex: 1;
                margin-right: 0;
                min-width: 0;
              }

              .apps-table th {
                width: auto;
              }
            </style>
          </head>
          <body>
            <h1>${escapeHtml(displayName)}</h1>
            <p class="subtitle">${escapeHtml(subtitle ?? "")}</p>
            <table class="info-table">
              <tbody>
                ${tableRowsHtml}
              </tbody>
            </table>
            <h2>Apps</h2>
            ${appsSection}
            <script>${script}</script>
          </body>
        </html>
      `;
    };

    const showDeviceInfo = (item?: DeviceTreeItem): void => {
      const targetItem = getTargetDeviceTreeItem(item);

      if (!targetItem) {
        return;
      }

      const details = deviceManager.getLanDeviceDetails(targetItem.device.id);
      const panel = vscode.window.createWebviewPanel(
        "wendyDeviceInfo",
        `${targetItem.device.name}`,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
        }
      );

      panel.webview.html = createDeviceInfoHtml(targetItem, details);

      const disposable = panel.webview.onDidReceiveMessage(async (message) => {
        if (message?.command === "copy" && typeof message.value === "string") {
          await vscode.env.clipboard.writeText(message.value);
          const label =
            typeof message.label === "string" && message.label
              ? message.label
              : "value";
          vscode.window.setStatusBarMessage(`Copied ${label}`, 2000);
        }
      });

      panel.onDidDispose(() => {
        disposable.dispose();
      });
    };

    const revealRootInFileManager = async (): Promise<void> => {
      const rootPath = operatingSystemCacheProvider.getRootPath();
      const rootUri = vscode.Uri.file(rootPath);

      try {
        await vscode.workspace.fs.stat(rootUri);
      } catch {
        void vscode.window.showWarningMessage(
          `Cache folder '${rootPath}' does not exist.`
        );
        return;
      }

      await vscode.commands.executeCommand("revealFileInOS", rootUri);
    };

    const revealEntryInFileManager = async (item?: CacheTreeItem): Promise<void> => {
      const targetItem =
        item ?? operatingSystemCacheTreeView.selection?.[0];

      if (!targetItem) {
        return;
      }

      const targetUri = vscode.Uri.file(targetItem.fullPath);

      try {
        await vscode.workspace.fs.stat(targetUri);
      } catch {
        void vscode.window.showWarningMessage(
          `Unable to reveal '${targetItem.fullPath}' because it no longer exists.`
        );
        return;
      }

      await vscode.commands.executeCommand("revealFileInOS", targetUri);
    };

    devicesProvider.autorefresh();
    disksProvider.autorefresh();

    // Register device-related commands
    context.subscriptions.push(
      vscode.commands.registerCommand("wendyDevices.refreshDevices", () => {
        devicesProvider.refresh();
      }),

      vscode.commands.registerCommand("wendyDevices.addDevice", async () => {
        const address = await vscode.window.showInputBox({
          placeHolder: "hostname or hostname:port",
          prompt: "Enter the address of the Wendy device",
        });

        if (address) {
          try {
            await deviceManager.addDevice(address);
            vscode.window.showInformationMessage(
              `Device ${address} added successfully`
            );
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to add device: ${getErrorDescription(error)}`
            );
          }
        }
      }),

      vscode.commands.registerCommand(
        "wendyDevices.deleteDevice",
        async (item) => {
          if (item?.device) {
            const confirmed = await vscode.window.showWarningMessage(
              `Are you sure you want to remove device ${item.device.address}?`,
              { modal: true },
              "Remove"
            );

            if (confirmed === "Remove") {
              try {
                await deviceManager.deleteDevice(item.device.id);
                vscode.window.showInformationMessage(
                  `Device ${item.device.address} removed`
                );
              } catch (error) {
                vscode.window.showErrorMessage(
                  `Failed to remove device: ${getErrorDescription(error)}`
                );
              }
            }
          }
        }
      ),

      vscode.commands.registerCommand(
        "wendyDevices.connectWifi",
        async (item) => {
          if (item?.device) {
            try {
              await deviceManager.connectWifi(item.device.id);
            } catch (error) {
              vscode.window.showErrorMessage(
                `Failed to connect to WiFi: ${getErrorDescription(error)}`
              );
            }
          }
        }
      ),

      vscode.commands.registerCommand(
        "wendyDevices.updateAgent",
        async (item) => {
          if (item?.device) {
            await deviceManager.updateAgent(item.device.id);
          }
        }
      ),

      vscode.commands.registerCommand(
        "wendyDevices.showInfo",
        (item: DeviceTreeItem | undefined) => {
          showDeviceInfo(item);
        }
      ),

      vscode.commands.registerCommand(
        "wendyDevices.copyHostname",
        async (item: DeviceTreeItem | undefined) => {
          await copyDeviceValue(
            item,
            (device) => device.address,
            "Hostname"
          );
        }
      ),

      vscode.commands.registerCommand(
        "wendyDevices.copyAgentVersion",
        async (item: DeviceTreeItem | undefined) => {
          await copyDeviceValue(
            item,
            (device) => device.agentVersion,
            "Wendy Agent Version"
          );
        }
      ),

      vscode.commands.registerCommand(
        "wendyDevices.selectDevice",
        async (item) => {
          if (item?.device) {
            try {
              await deviceManager.setCurrentDevice(item.device.id);
              vscode.window.showInformationMessage(
                `${item.device.address} set as current device`
              );
            } catch (error) {
              vscode.window.showErrorMessage(
                `Failed to set current device: ${getErrorDescription(error)}`
              );
            }
          }
        }
      ),

      vscode.commands.registerCommand(
        "wendyDisks.refreshDisks",
        () => {
          disksProvider.refresh();
        }
      ),

      vscode.commands.registerCommand(
        "wendyOperatingSystemCache.deleteEntry",
        async (item?: CacheTreeItem) => {
          const targetItem =
            item ?? operatingSystemCacheTreeView.selection?.[0];

          if (!targetItem) {
            return;
          }

          const entryName =
            path.basename(targetItem.fullPath) || targetItem.fullPath;
          const entryType = targetItem.isDirectory ? "folder" : "file";
          const confirmation = await vscode.window.showWarningMessage(
            `Delete ${entryType} '${entryName}'? This action cannot be undone.`,
            { modal: true },
            "Delete"
          );

          if (confirmation !== "Delete") {
            return;
          }

          try {
            await fs.rm(targetItem.fullPath, { recursive: true, force: true });
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to delete ${entryType} '${entryName}': ${getErrorDescription(
                error
              )}`
            );
            return;
          }

          operatingSystemCacheProvider.refresh();
        }
      ),

      vscode.commands.registerCommand(
        "wendyDisks.flashDisk",
        async (item) => {
          if (!item || !item.disk) {
            return;
          }

          const confirmed = await vscode.window.showWarningMessage(
            "This feature will erase all data on the disk. Are you sure you want to continue?",
            { modal: true },
            "No",
            "Yes"
          ) === "Yes";

          if (!confirmed) {
            return;
          }

          const supportedDevices = await WendyImager.listSupportedDevices();
          const selectedImage = await vscode.window.showQuickPick(
            supportedDevices,
            {
              placeHolder: "Select the device type you're flashing",
              canPickMany: false
            }
          );

          if (!selectedImage) {
            return;
          }

          try {
            await diskManager.flashWendyOS(item.disk, selectedImage);
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to flash WendyOS: ${getErrorDescription(error)}`
            );
          }
        }
      ),

      vscode.commands.registerCommand(
        "wendy.configureSwiftSdkPath",
        async () => {
          await vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "wendyos.swiftSdkPath"
          );
        }
      )
    );

    const rootRevealCommandIds = [
      "wendyOperatingSystemCache.openRootFinder",
      "wendyOperatingSystemCache.openRootExplorer",
      "wendyOperatingSystemCache.openRootFileManager",
    ];

    for (const commandId of rootRevealCommandIds) {
      context.subscriptions.push(
        vscode.commands.registerCommand(commandId, revealRootInFileManager)
      );
    }

    const entryRevealCommandIds = [
      "wendyOperatingSystemCache.revealFinder",
      "wendyOperatingSystemCache.revealExplorer",
      "wendyOperatingSystemCache.revealFileManager",
    ];

    for (const commandId of entryRevealCommandIds) {
      context.subscriptions.push(
        vscode.commands.registerCommand(commandId, revealEntryInFileManager)
      );
    }

    // Register the documentation provider
    const documentationProvider = new DocumentationProvider();
    vscode.window.registerTreeDataProvider(
      "wendyDocumentation",
      documentationProvider
    );

    // Listen for configuration changes to the CLI path
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("wendyos.cliPath")) {
          const message =
            "WendyOS: CLI path has been changed. Reload window for changes to take effect.";
          vscode.window
            .showInformationMessage(message, "Reload Window")
            .then((selection) => {
              if (selection === "Reload Window") {
                vscode.commands.executeCommand("workbench.action.reloadWindow");
              }
            });
        }
      })
    );

    const pythonExtension = vscode.extensions.getExtension("ms-python.debugpy");
    if (pythonExtension) {
      outputChannel.appendLine(`Python extension version: ${pythonExtension.packageJSON.version}`);
      await pythonExtension.activate();
    } else {
      outputChannel.appendLine("Python extension not found");
    }

    const swiftExtension = vscode.extensions.getExtension<SwiftExtensionApi>(
      "swiftlang.swift-vscode"
    );
    let swiftAPI: SwiftExtensionApi | undefined;

    if (!swiftExtension) {
      outputChannel.appendLine("Swift extension not found; Swift-specific features will be disabled.");
    } else {
      outputChannel.appendLine(`Swift extension version: ${swiftExtension.packageJSON.version}`);
      try {
        swiftAPI = await swiftExtension.activate();
        outputChannel.appendLine("Swift extension activated.");
      } catch (error) {
        outputChannel.appendLine(`Failed to activate Swift extension: ${getErrorDescription(error)}`);
      }
    }

    const swiftWorkspaceContext = swiftAPI?.workspaceContext;
    if (swiftAPI && !swiftWorkspaceContext) {
      outputChannel.appendLine("Swift API workspace context not found; Swift-specific features will be disabled.");
    }

    const wendyCLI = await WendyCLI.create();
    if (!wendyCLI) {
      const config = vscode.workspace.getConfiguration("wendyos");
      const configuredPath = config.get<string>("cliPath");

      const options = ["Configure Path", "View Installation Instructions"];
      const choice = await vscode.window.showErrorMessage(
        configuredPath && configuredPath.trim() !== ""
          ? `The configured Wendy CLI path "${configuredPath}" is not accessible or executable.`
          : "Unable to automatically discover your Wendy CLI installation.",
        ...options
      );

      if (choice === "Configure Path") {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "wendyos.cliPath"
        );
      } else if (choice === "View Installation Instructions") {
        vscode.env.openExternal(
          vscode.Uri.parse(
            "https://github.com/wendylabsinc/wendy-agent/blob/main/README.md"
          )
        );
      }
      return;
    }

    outputChannel.appendLine(`Discovered Wendy CLI at path: ${wendyCLI.path}`);
    outputChannel.appendLine(`Wendy CLI version: ${wendyCLI.version}`);

    // Create the WendyWorkspaceContext with all the necessary components
    const wendyWorkspaceContext = new WendyWorkspaceContext(
      context,
      outputChannel,
      wendyCLI,
      swiftWorkspaceContext,
      !!pythonExtension
    );

    // Store the WendyWorkspaceContext in the extension context for later use
    context.subscriptions.push(wendyWorkspaceContext);

    if (swiftWorkspaceContext) {
      // Subscribe to folder changes in the Swift workspace context
      const folderChangeDisposable = swiftWorkspaceContext.onDidChangeFolders(
        async ({ folder, operation }) => {
          outputChannel.appendLine(`Swift folder change detected: ${operation}`);
          if (folder && operation === "add") {
            outputChannel.appendLine(`Folder added: ${folder.folder.fsPath}`);

            // Check if this is a Wendy project
            const isWendyProject = await WendyProjectDetector.isWendyProject(
              folder.folder.fsPath
            );
            if (isWendyProject) {
              // Find the corresponding WendyFolderContext
              for (const wendyFolder of wendyWorkspaceContext.folders) {
                if (wendyFolder.swift === folder) {
                  // Check if there are already Wendy configurations for this folder
                  const wsLaunchSection = vscode.workspace.getConfiguration(
                    "launch",
                    folder.folder
                  );
                  const configurations =
                    wsLaunchSection.get<any[]>("configurations") || [];
                  const hasWendyConfigurations = configurations.some(
                    (config) => config.type === WENDY_LAUNCH_CONFIG_TYPE
                  );

                  if (!hasWendyConfigurations) {
                    await makeDebugConfigurations(wendyFolder);
                    await wendyWorkspaceContext.promptRefreshDebugConfigurations();
                    outputChannel.appendLine(
                      `Added Wendy debug configurations to new folder ${folder.folder.fsPath}`
                    );
                  }
                  break;
                }
              }
            }
          }
        }
      );
      context.subscriptions.push(folderChangeDisposable);
      outputChannel.appendLine("Listening for Swift folder changes...");
    }

    // Register the task provider
    context.subscriptions.push(
      WendyTaskProvider.register(wendyWorkspaceContext, deviceManager, {
        hasPythonExtension: !!pythonExtension
      })
    );

    // Register the debug configuration providers
    const debugProviders = WendyDebugConfigurationProvider.register(
      wendyWorkspaceContext,
      outputChannel,
      deviceManager
    );
    context.subscriptions.push(...debugProviders);

    // Add command to refresh debug configurations
    const refreshDebugConfigsCommand = vscode.commands.registerCommand(
      "wendy.refreshDebugConfigurations",
      () => {
        vscode.commands.executeCommand("workbench.action.debug.configure");
      }
    );
    context.subscriptions.push(refreshDebugConfigsCommand);

    // Check if Swift SDK path is set
    const config = vscode.workspace.getConfiguration("wendyos");
    const sdkPath = config.get<string>("swiftSdkPath");
    if (!sdkPath || sdkPath.trim() === "") {
      outputChannel.appendLine(
        "Swift SDK path is not set. Debugging may not work properly."
      );
    }

    // Note: Launch configuration generation is now handled directly in WendyWorkspaceContext
    // The configurations will be generated automatically when all folders are ready
    console.log(`[Wendy] Configuration generation handled by WendyWorkspaceContext`);

    outputChannel.appendLine("WendyOS extension activated successfully.");
  } catch (error) {
    const errorMessage = getErrorDescription(error);
    vscode.window.showErrorMessage(
      `Activating Wendy extension failed: ${errorMessage}`
    );
  }
}

// This method is called when your extension is deactivated
export function deactivate() { }
