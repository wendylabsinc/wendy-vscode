// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { getErrorDescription } from "./utilities/utilities";
import { WendyCLI } from "./wendy-cli/wendy-cli";
import type { SwiftExtensionApi } from "swiftlang.swift-vscode";
import { WendyWorkspaceContext } from "./WendyWorkspaceContext";
import { WendyTaskProvider } from "./tasks/WendyTaskProvider";
import { DocumentationProvider } from "./sidebar/DocumentationProvider";
import { DevicesProvider } from "./sidebar/DevicesProvider";
import { DeviceManager } from "./models/DeviceManager";
import { DiskManager } from "./models/DiskManager";
import { WendyDebugConfigurationProvider, WENDY_LAUNCH_CONFIG_TYPE } from "./debugger/WendyDebugConfigurationProvider";
import { DisksProvider } from "./sidebar/DisksProvider";
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
    vscode.window.registerTreeDataProvider("wendyDevices", devicesProvider);

    // Register the disks provider
    const disksProvider = new DisksProvider(diskManager);
    vscode.window.registerTreeDataProvider("wendyDisks", disksProvider);

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
          
          // Check if this is an Wendy project
          const isWendyProject = await WendyProjectDetector.isWendyProject(folder.folder.fsPath);
          if (isWendyProject) {
            // Find the corresponding WendyFolderContext
            for (const wendyFolder of wendyWorkspaceContext.folders) {
              if (wendyFolder.swift === folder) {
                // Check if there are already Wendy configurations for this folder
                const wsLaunchSection = vscode.workspace.getConfiguration("launch", folder.folder);
                const configurations = wsLaunchSection.get<any[]>("configurations") || [];
                const hasWendyConfigurations = configurations.some(
                  config => config.type === WENDY_LAUNCH_CONFIG_TYPE
                );

                if (!hasWendyConfigurations) {
                  await makeDebugConfigurations(wendyFolder);
                  await wendyWorkspaceContext.promptRefreshDebugConfigurations();
                  outputChannel.appendLine(`Added Wendy debug configurations to new folder ${folder.folder.fsPath}`);
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
      swiftAPI.workspaceContext
    );

    // Store the WendyWorkspaceContext in the extension context for later use
    context.subscriptions.push(wendyWorkspaceContext);

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

      // Show notification during activation
      const actions = ["Configure Now", "Later"];
      vscode.window
        .showWarningMessage(
          "WendyOS Swift SDK path is not set. This is required for debugging WendyOS applications.",
          ...actions
        )
        .then((selection) => {
          if (selection === "Configure Now") {
            vscode.commands.executeCommand("wendy.configureSwiftSdkPath");
          }
        });
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
