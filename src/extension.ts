// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { getErrorDescription } from "./utilities/utilities";
import { EdgeCLI } from "./edge-cli/edge-cli";
import type { SwiftExtensionApi } from "swiftlang.swift-vscode";
import { EdgeWorkspaceContext } from "./EdgeWorkspaceContext";
import { EdgeTaskProvider } from "./tasks/EdgeTaskProvider";
import { DocumentationProvider } from "./sidebar/DocumentationProvider";
import { DevicesProvider } from "./sidebar/DevicesProvider";
import { DeviceManager } from "./models/DeviceManager";
import { DiskManager } from "./models/DiskManager";
import { EdgeDebugConfigurationProvider, EDGE_LAUNCH_CONFIG_TYPE } from "./debugger/EdgeDebugConfigurationProvider";
import { DisksProvider } from "./sidebar/DisksProvider";
import { EdgeImager } from "./utilities/Imager";
import { EdgeProjectDetector } from "./utilities/EdgeProjectDetector";
import { makeDebugConfigurations, hasAnyEdgeDebugConfiguration } from "./debugger/launch";

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  try {
    const outputChannel = vscode.window.createOutputChannel("EdgeOS");
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine(
      "Activating EdgeOS extension for Visual Studio Code..."
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
    vscode.window.registerTreeDataProvider("edgeDevices", devicesProvider);

    // Register the disks provider
    const disksProvider = new DisksProvider(diskManager);
    vscode.window.registerTreeDataProvider("edgeDisks", disksProvider);

    devicesProvider.autorefresh();
    disksProvider.autorefresh();

    // Register device-related commands
    context.subscriptions.push(
      vscode.commands.registerCommand("edgeDevices.refreshDevices", () => {
        devicesProvider.refresh();
      }),

      vscode.commands.registerCommand("edgeDevices.addDevice", async () => {
        const address = await vscode.window.showInputBox({
          placeHolder: "hostname or hostname:port",
          prompt: "Enter the address of the Edge device",
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
        "edgeDevices.deleteDevice",
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
        "edgeDevices.connectWifi",
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
        "edgeDevices.updateAgent",
        async (item) => {
          if (item?.device) {
            await deviceManager.updateAgent(item.device.id);
          }
        }
      ),

      vscode.commands.registerCommand(
        "edgeDevices.selectDevice",
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
        "edgeDisks.refreshDisks",
        () => {
          disksProvider.refresh();
        }
      ),

      vscode.commands.registerCommand(
        "edgeDisks.flashDisk",
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

          const supportedDevices = await EdgeImager.listSupportedDevices();
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
            await diskManager.flashEdgeOS(item.disk, selectedImage);
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to flash EdgeOS: ${getErrorDescription(error)}`
            );
          }
        }
      ),

      vscode.commands.registerCommand(
        "edge.configureSwiftSdkPath",
        async () => {
          await vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "edgeos.swiftSdkPath"
          );
        }
      )
    );

    // Register the documentation provider
    const documentationProvider = new DocumentationProvider();
    vscode.window.registerTreeDataProvider(
      "edgeDocumentation",
      documentationProvider
    );

    // Listen for configuration changes to the CLI path
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("edgeos.cliPath")) {
          const message =
            "EdgeOS: CLI path has been changed. Reload window for changes to take effect.";
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

    const swiftExtension = vscode.extensions.getExtension<SwiftExtensionApi>(
      "swiftlang.swift-vscode"
    );
    if (!swiftExtension) {
      throw new Error("Swift extension not found");
    }

    const swiftVersion = swiftExtension.packageJSON.version;
    outputChannel.appendLine(`Swift extension version: ${swiftVersion}`);

    const swiftAPI = await swiftExtension.activate();
    outputChannel.appendLine(`Swift API: ${swiftAPI}`);

    if (!swiftAPI.workspaceContext) {
      throw new Error("Swift API workspace context not found");
    }

    // Subscribe to folder changes in the Swift workspace context
    const folderChangeDisposable = swiftAPI.workspaceContext.onDidChangeFolders(
      async ({ folder, operation }) => {
        outputChannel.appendLine(`Swift folder change detected: ${operation}`);
        if (folder && operation === 'add') {
          outputChannel.appendLine(`Folder added: ${folder.folder.fsPath}`);
          
          // Check if this is an Edge project
          const isEdgeProject = await EdgeProjectDetector.isEdgeProject(folder.folder.fsPath);
          if (isEdgeProject) {
            // Check if there are already Edge configurations for this folder
            const wsLaunchSection = vscode.workspace.getConfiguration("launch", folder.folder);
            const configurations = wsLaunchSection.get<any[]>("configurations") || [];
            const hasEdgeConfigurations = configurations.some(
              config => config.type === EDGE_LAUNCH_CONFIG_TYPE
            );
            
            if (!hasEdgeConfigurations) {
              await makeDebugConfigurations(folder);
              await edgeWorkspaceContext.promptRefreshDebugConfigurations();
              outputChannel.appendLine(`Added Edge debug configurations to new folder ${folder.folder.fsPath}`);
            }
          }
        }
      }
    );
    context.subscriptions.push(folderChangeDisposable);
    outputChannel.appendLine("Listening for Swift folder changes...");

    const edgeCLI = await EdgeCLI.create();
    if (!edgeCLI) {
      const config = vscode.workspace.getConfiguration("edgeos");
      const configuredPath = config.get<string>("cliPath");

      const options = ["Configure Path", "View Installation Instructions"];
      const choice = await vscode.window.showErrorMessage(
        configuredPath && configuredPath.trim() !== ""
          ? `The configured Edge CLI path "${configuredPath}" is not accessible or executable.`
          : "Unable to automatically discover your Edge CLI installation.",
        ...options
      );

      if (choice === "Configure Path") {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "edgeos.cliPath"
        );
      } else if (choice === "View Installation Instructions") {
        vscode.env.openExternal(
          vscode.Uri.parse(
            "https://github.com/apache-edge/edge-agent/blob/main/README.md"
          )
        );
      }
      return;
    }

    outputChannel.appendLine(`Discovered Edge CLI at path: ${edgeCLI.path}`);
    outputChannel.appendLine(`Edge CLI version: ${edgeCLI.version}`);

    // Create the EdgeWorkspaceContext with all the necessary components
    const edgeWorkspaceContext = new EdgeWorkspaceContext(
      context,
      outputChannel,
      edgeCLI,
      swiftAPI.workspaceContext
    );

    // Store the EdgeWorkspaceContext in the extension context for later use
    context.subscriptions.push(edgeWorkspaceContext);

    // Register the task provider
    context.subscriptions.push(
      EdgeTaskProvider.register(edgeWorkspaceContext, deviceManager)
    );

    // Register the debug configuration providers
    const debugProviders = EdgeDebugConfigurationProvider.register(
      edgeWorkspaceContext,
      outputChannel,
      deviceManager
    );
    context.subscriptions.push(...debugProviders);

    // Add command to refresh debug configurations
    const refreshDebugConfigsCommand = vscode.commands.registerCommand(
      "edge.refreshDebugConfigurations",
      () => {
        vscode.commands.executeCommand("workbench.action.debug.configure");
      }
    );
    context.subscriptions.push(refreshDebugConfigsCommand);

    // Check if Swift SDK path is set
    const config = vscode.workspace.getConfiguration("edgeos");
    const sdkPath = config.get<string>("swiftSdkPath");
    if (!sdkPath || sdkPath.trim() === "") {
      outputChannel.appendLine(
        "Swift SDK path is not set. Debugging may not work properly."
      );

      // Show notification during activation
      const actions = ["Configure Now", "Later"];
      vscode.window
        .showWarningMessage(
          "EdgeOS Swift SDK path is not set. This is required for debugging EdgeOS applications.",
          ...actions
        )
        .then((selection) => {
          if (selection === "Configure Now") {
            vscode.commands.executeCommand("edge.configureSwiftSdkPath");
          }
        });
    }

    // Note: Launch configuration generation is now handled directly in EdgeWorkspaceContext
    // The configurations will be generated automatically when all folders are ready
    console.log(`[Edge] Configuration generation handled by EdgeWorkspaceContext`);

    outputChannel.appendLine("EdgeOS extension activated successfully.");
  } catch (error) {
    const errorMessage = getErrorDescription(error);
    vscode.window.showErrorMessage(
      `Activating Edge extension failed: ${errorMessage}`
    );
  }
}

// This method is called when your extension is deactivated
export function deactivate() {}
