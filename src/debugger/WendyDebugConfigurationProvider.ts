import * as vscode from "vscode";
import * as path from "path";
import { WendyCLI } from "../wendy-cli/wendy-cli";
import { WendyWorkspaceContext } from "../WendyWorkspaceContext";
import { DeviceManager } from "../models/DeviceManager";
import { getErrorDescription } from "../utilities/utilities";
import { realpath } from "fs/promises";
import * as os from "os";
import { debug } from "console";

export const WENDY_LAUNCH_CONFIG_TYPE = "wendy";
// Default debug port used by Wendy agent
export const DEFAULT_DEBUG_PORT = 4242;
// Default debugpy port
export const DEFAULT_DEBUGPY_PORT = 5678;
// Debugger type to use - can be "lldb-dap" or "codelldb"
export type DebuggerType = "lldb-dap" | "codelldb";
export const DEBUGGER_TYPE: DebuggerType = "lldb-dap";

export class WendyDebugConfigurationProvider
  implements vscode.DebugConfigurationProvider {
  constructor(
    private readonly outputChannel: vscode.OutputChannel,
    private readonly cli: WendyCLI,
    private readonly workspaceContext: WendyWorkspaceContext,
    private readonly deviceManager: DeviceManager
  ) { }

  async provideDebugConfigurations(
    folder: vscode.WorkspaceFolder | undefined,
    token?: vscode.CancellationToken
  ): Promise<vscode.DebugConfiguration[]> {
    this.outputChannel.appendLine("Providing Wendy debug configurations...");
    if (!folder) {
      this.outputChannel.appendLine("No workspace folder found.");
      return [];
    }

    const edgeJson = path.join(folder.uri.fsPath, 'wendy.json');
    let edgeConfig: any = undefined;
    try {
      // Read wendy.json from the workspace folder and parse it as JSON
      const fileData = await vscode.workspace.fs.readFile(
        vscode.Uri.file(edgeJson)
      );
      const fileText = Buffer.from(fileData).toString("utf8");
      edgeConfig = JSON.parse(fileText);
    } catch (err) {
      // If the file doesn't exist or is invalid JSON, log and continue without it
      this.outputChannel.appendLine(
        `Could not read or parse wendy.json at ${edgeJson}: ${getErrorDescription(
          err
        )}`
      );
      edgeConfig = undefined;
    }

    // Route to language-specific providers when appropriate
    if (edgeConfig.language === "python") {
      return this.provideDebugConfigurationsPython(folder, token);
    }

    // Default to Swift provider
    return this.provideDebugConfigurationsSwift(folder, token);
  }

  async provideDebugConfigurationsPython(
    folder: vscode.WorkspaceFolder | undefined,
    token?: vscode.CancellationToken
  ): Promise<vscode.DebugConfiguration[]> {
    return [
      {
        type: WENDY_LAUNCH_CONFIG_TYPE,
        name: "Debug Python App on WendyOS",
        request: "attach",
        target: "Python App",
        cwd: folder?.uri.path,
        preLaunchTask: "wendy: Run Python App",
      }
    ];
  }

  async provideDebugConfigurationsSwift(
    folder: vscode.WorkspaceFolder | undefined,
    token?: vscode.CancellationToken
  ): Promise<vscode.DebugConfiguration[]> {
    const configs: vscode.DebugConfiguration[] = [];

    // Generate a debug configuration for each Swift executable target
    for (const folderContext of this.workspaceContext.folders) {
      if (!folderContext.swift) {
        continue;
      }

      const executableProducts = await folderContext.swift.swiftPackage
        .executableProducts;

      for (const product of executableProducts) {
        configs.push({
          type: WENDY_LAUNCH_CONFIG_TYPE,
          name: `Debug ${product.name} on WendyOS`,
          request: "attach",
          target: product.name,
          cwd: folderContext.swift.folder.fsPath,
          preLaunchTask: `wendy: Run ${product.name}`,
        });
      }
    }

    return configs;
  }

  /**
   * Ensure the address includes port 4242 for debugging
   */
  private ensureDebugPort(address: string, port: number): string {
    // Check if address already includes a port
    if (address.includes(":")) {
      // Extract host and port
      const [host, port] = address.split(":");

      // If port is already 4242, return as is
      if (port === port.toString()) {
        return address;
      }

      return `${host}:${port}`;
    }

    // No port specified, append the default debug port
    return `${address}:${port}`;
  }

  async selectCurrentDevice(
    folder: vscode.WorkspaceFolder | undefined,
    port: number | null
  ): Promise<null | string> {
    // Check if a device is selected
    const currentDevice = this.deviceManager.getCurrentDevice();
    if (!currentDevice) {
      const actions = ["Add Device", "Select Device", "Cancel"];
      const selection = await vscode.window.showErrorMessage(
        "No WendyOS device is selected. You must select a device before debugging.",
        ...actions
      );

      if (selection === "Add Device") {
        await vscode.commands.executeCommand("wendyDevices.addDevice");
      } else if (selection === "Select Device") {
        // Open the devices view to allow selection
        await vscode.commands.executeCommand(
          "workbench.view.extension.wendy-explorer"
        );
      }

      return null; // Cancel debugging
    }

    if (port) {
      // Get the device address and ensure it has the correct debug port
      return this.ensureDebugPort(currentDevice.address, port);
    } else {
      return currentDevice.address;
    }
  }

  async resolveDebugConfigurationWithSubstitutedVariables(
    folder: vscode.WorkspaceFolder | undefined,
    debugConfiguration: vscode.DebugConfiguration,
    token?: vscode.CancellationToken
  ): Promise<vscode.DebugConfiguration | undefined | null> {
    if (!folder) {
      return null;
    }

    const edgeConfigPath = path.join(folder.uri.fsPath, 'wendy.json');
    let edgeConfig: any = undefined;
    try {
      // Read wendy.json from the workspace folder and parse it as JSON
      const fileData = await vscode.workspace.fs.readFile(
        vscode.Uri.file(edgeConfigPath)
      );
      const fileText = Buffer.from(fileData).toString("utf8");
      edgeConfig = JSON.parse(fileText);
    } catch (err) {
      // If the file doesn't exist or is invalid JSON, log and continue without it
      this.outputChannel.appendLine(
        `Could not read or parse wendy.json at ${edgeConfigPath}: ${getErrorDescription(
          err
        )}`
      );
      edgeConfig = undefined;
    }

    // Route to language-specific resolvers when appropriate
    if (edgeConfig.language === "python") {
      return this.resolveDebugConfigurationWithSubstitutedVariablesPython(
        folder,
        debugConfiguration,
        token
      );
    }

    // Default to Swift resolver
    return this.resolveDebugConfigurationWithSubstitutedVariablesSwift(
      folder,
      debugConfiguration,
      token
    );
  }

  async resolveDebugConfigurationWithSubstitutedVariablesPython(
    folder: vscode.WorkspaceFolder | undefined,
    debugConfiguration: vscode.DebugConfiguration,
    token?: vscode.CancellationToken
  ): Promise<vscode.DebugConfiguration | undefined | null> {
    // Wait for launch to be ready
    // Try to discover a TCP connection on port 5678
    this.outputChannel.appendLine("Waiting for Python debug server to be ready...");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    this.outputChannel.appendLine("Resolving Python debug configuration...");
    const remoteAddress = await this.selectCurrentDevice(folder, null);
    if (!remoteAddress) {
      this.outputChannel.appendLine("No remote address found.");
      return null; // Cancel debugging
    }

    debugConfiguration.type = "debugpy";
    debugConfiguration.request = "attach";
    debugConfiguration.connect = {
      host: remoteAddress,
      port: DEFAULT_DEBUGPY_PORT,
    };
    debugConfiguration.pathMappings = [
      {
        localRoot: folder?.uri.fsPath,
        remoteRoot: "/app", // TODO: Workdir of app. How to determine?
      },
    ];

    // Ensure we have a preLaunchTask to build the target if not specified
    if (!debugConfiguration.preLaunchTask && debugConfiguration.target) {
      debugConfiguration.preLaunchTask = `wendy: Run Python App`;
    }

    return debugConfiguration;
  }

  async resolveDebugConfigurationWithSubstitutedVariablesSwift(
    folder: vscode.WorkspaceFolder | undefined,
    debugConfiguration: vscode.DebugConfiguration,
    token?: vscode.CancellationToken
  ): Promise<vscode.DebugConfiguration | undefined | null> {
    // Check if Swift SDK path is set
    const config = vscode.workspace.getConfiguration("wendyos");
    let sdkPath = config.get<string>("swiftSdkPath");

    if (!sdkPath || sdkPath.trim() === "") {
      const actions = ["Configure Swift SDK Path", "Cancel"];
      const selection = await vscode.window.showErrorMessage(
        "Swift SDK path is not set. This is required for debugging WendyOS applications.",
        ...actions
      );

      if (selection === "Configure Swift SDK Path") {
        await vscode.commands.executeCommand("wendy.configureSwiftSdkPath");
      }

      return null; // Cancel debugging
    }

    try {
      // NodeJS realpath does not expand ~, so we need to do it manually
      if (sdkPath.startsWith("~")) {
        sdkPath = path.join(os.homedir(), sdkPath.slice(1));
      }

      // Expand the SDK path to the real path
      sdkPath = await realpath(sdkPath);
      // Check if the SDK path exists
      await vscode.workspace.fs.stat(vscode.Uri.file(sdkPath));
    } catch (error) {
      const actions = ["Configure Swift SDK Path", "Cancel"];
      const selection = await vscode.window.showErrorMessage(
        `The configured Swift SDK path "${sdkPath}" does not exist: ${getErrorDescription(
          error
        )}`,
        ...actions
      );

      if (selection === "Configure Swift SDK Path") {
        await vscode.commands.executeCommand("wendy.configureSwiftSdkPath");
      }

      return null; // Cancel debugging
    }

    const remoteAddress = await this.selectCurrentDevice(folder, DEFAULT_DEBUG_PORT);
    if (!remoteAddress) {
      return null; // Cancel debugging
    }

    // Build debug target path
    const targetBasePath = path.join(
      folder?.uri.fsPath || "",
      ".wendy-build/debug"
    );

    // Check the format of the SDK bundle to ensure we're using the right paths
    const sdkSubPath = "";
    // TODO: Detect SDK structure dynamically, instead of assuming Swift 6.2.1 layout
    const moduleSubPath =
      "6.2.1-RELEASE_wendyos_aarch64/aarch64-unknown-linux-gnu/debian-bookworm.sdk/usr/lib/swift_static/linux";

    // Create shared SDK path commands for both debugger types
    const sdkPathCommands = [
      `settings set target.sdk-path "${path.join(sdkPath, sdkSubPath)}"`,
      `settings set target.swift-module-search-paths "${path.join(
        sdkPath,
        moduleSubPath
      )}"`,
    ];

    // Set up debug configuration based on debugger type
    if (DEBUGGER_TYPE === "lldb-dap") {
      // lldb-dap configuration
      debugConfiguration.type = "lldb-dap";
      debugConfiguration.request = "attach";

      // Set the SDK path and module search paths in initCommands
      debugConfiguration.initCommands = sdkPathCommands;
      debugConfiguration.attachCommands = [
        `target create ${targetBasePath}/${debugConfiguration.target}`,
        `gdb-remote ${remoteAddress}`,
      ];

      // TODO: Don't hardcode this path - once the Wendy CLI is capable of managing the SDK,
      // this path will be dynamically generated
      // debugConfiguration.debugAdapterExecutable =
      // ("/Library/Developer/Toolchains/swift-6.1-RELEASE.xctoolchain/usr/bin/lldb-dap");
    } else {
      // Default to codelldb configuration
      debugConfiguration.type = "lldb";
      debugConfiguration.request = "launch";

      // Add the current device address to the debug configuration
      debugConfiguration.agent = remoteAddress;

      // Configure commands for CodeLLDB
      debugConfiguration.targetCreateCommands = [
        `target create ${targetBasePath}/${debugConfiguration.target}`,
        ...sdkPathCommands,
      ];
      debugConfiguration.processCreateCommands = [
        `gdb-remote ${remoteAddress}`,
      ];
    }

    // Ensure we have a preLaunchTask to build the target if not specified
    if (!debugConfiguration.preLaunchTask && debugConfiguration.target) {
      debugConfiguration.preLaunchTask = `wendy: Run ${debugConfiguration.target}`;
    }

    // Log configuration to the output channel
    this.outputChannel.appendLine("Resolved debug configuration:");
    this.outputChannel.appendLine(JSON.stringify(debugConfiguration, null, 2));

    return debugConfiguration;
  }

  /**
   * Registers the Wendy debug configuration provider with VS Code.
   */
  public static register(
    context: WendyWorkspaceContext,
    outputChannel: vscode.OutputChannel,
    deviceManager: DeviceManager
  ): vscode.Disposable[] {
    const provider = new WendyDebugConfigurationProvider(
      outputChannel,
      context.cli,
      context,
      deviceManager
    );

    // Register as both a regular provider (for resolving configurations)
    const regularProvider = vscode.debug.registerDebugConfigurationProvider(
      WENDY_LAUNCH_CONFIG_TYPE,
      provider
    );

    const dynamicProvider = vscode.debug.registerDebugConfigurationProvider(
      WENDY_LAUNCH_CONFIG_TYPE,
      provider,
      vscode.DebugConfigurationProviderTriggerKind.Dynamic
    );

    return [regularProvider, dynamicProvider];
  }
}
