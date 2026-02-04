import * as vscode from "vscode";
import * as path from "path";
import * as dns from "dns";
import { WendyCLI } from "../wendy-cli/wendy-cli";
import { WendyWorkspaceContext } from "../WendyWorkspaceContext";
import { DeviceManager } from "../models/DeviceManager";
import { getErrorDescription } from "../utilities/utilities";
import * as os from "os";
import { warnMissingPythonExtension } from "../utilities/PythonExtensionNotifications";

/**
 * Resolve a hostname to an IPv4 address.
 * This is needed because LLDB has issues with .local mDNS hostnames.
 */
async function resolveHostname(hostname: string): Promise<string> {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { family: 4 }, (err, address) => {
      if (err) {
        reject(err);
      } else {
        resolve(address);
      }
    });
  });
}

export const WENDY_LAUNCH_CONFIG_TYPE = "wendy";
// Default debug port used by Wendy agent
export const DEFAULT_DEBUG_PORT = 4242;
// Default debugpy port
export const DEFAULT_DEBUGPY_PORT = 5678;
// Debugger type to use - can be "lldb-dap" or "codelldb"
export type DebuggerType = "lldb-dap" | "codelldb";
export const DEBUGGER_TYPE: DebuggerType = "lldb-dap";

export interface WendyConfig {
  appId?: string;
  language?: string;
  version?: string;
  python?: {
    container?: {
      sourceRoot: string;
      [key: string]: any;
    };
    [key: string]: any;
  };
  [key: string]: any;
}

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
    if (!this.workspaceContext.hasPythonExtension) {
      return [];
    }

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
      edgeConfig = JSON.parse(fileText) as WendyConfig;
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
        token,
        edgeConfig
      );
    }

    // Default to Swift resolver
    return this.resolveDebugConfigurationWithSubstitutedVariablesSwift(
      folder,
      debugConfiguration,
      token,
      edgeConfig
    );
  }

  async resolveDebugConfigurationWithSubstitutedVariablesPython(
    folder: vscode.WorkspaceFolder | undefined,
    debugConfiguration: vscode.DebugConfiguration,
    token?: vscode.CancellationToken,
    wendyConfig?: WendyConfig
  ): Promise<vscode.DebugConfiguration | undefined | null> {
    if (!this.workspaceContext.hasPythonExtension) {
      warnMissingPythonExtension();
      return null;
    }

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

    let remoteRoot = "/app"; // Default remote root
    // If wendyConfig has a "python" section with "remoteRoot", use that
    if (
      wendyConfig && wendyConfig.python && wendyConfig.python.container &&
      typeof wendyConfig.python.container.sourceRoot === "string"
    ) {
      remoteRoot = wendyConfig.python.container.sourceRoot;
    }

    debugConfiguration.pathMappings = [
      {
        localRoot: folder?.uri.fsPath,
        remoteRoot,
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
    token?: vscode.CancellationToken,
    wendyConfig?: WendyConfig
  ): Promise<vscode.DebugConfiguration | undefined | null> {
    // Get SDK info from wendy CLI
    let wendyInfo;
    try {
      wendyInfo = await this.cli.getInfo();
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to get Wendy info: ${getErrorDescription(error)}. Please ensure the Wendy CLI is installed.`
      );
      return null;
    }

    const sdkPath = path.join(os.homedir(), ".swiftpm", "swift-sdks");
    const sdkBundle = wendyInfo.swift.sdk;

    this.outputChannel.appendLine(`Swift version: ${wendyInfo.swift.version}`);
    this.outputChannel.appendLine(`Using SDK: ${sdkBundle}`);

    let remoteAddress = await this.selectCurrentDevice(folder, DEFAULT_DEBUG_PORT);
    if (!remoteAddress) {
      return null; // Cancel debugging
    }

    // Resolve .local hostnames to IP addresses to work around LLDB bug
    // that incorrectly wraps .local hostnames in brackets
    const [host, port] = remoteAddress.split(":");
    if (host.endsWith(".local")) {
      try {
        const ip = await resolveHostname(host);
        remoteAddress = `${ip}:${port}`;
        this.outputChannel.appendLine(`Resolved ${host} to ${ip}`);
      } catch (error) {
        this.outputChannel.appendLine(
          `Failed to resolve ${host}: ${getErrorDescription(error)}`
        );
      }
    }

    // Build debug target path
    const targetBasePath = path.join(
      folder?.uri.fsPath || "",
      ".build/aarch64-unknown-linux-gnu/debug"
    );

    // Check the format of the SDK bundle to ensure we're using the right paths
    // SDK structure: <bundle>.artifactbundle/<bundle>/aarch64-unknown-linux-gnu/debian-bookworm.sdk
    const sdkSubPath = `${sdkBundle}.artifactbundle/${sdkBundle}/aarch64-unknown-linux-gnu/debian-bookworm.sdk`;
    const moduleSubPath = `${sdkSubPath}/usr/lib/swift/linux`;

    // Use lldb-dap from Swiftly installation (matches the Swift version used for cross-compilation)
    const swiftlyLldbDap = path.join(os.homedir(), ".swiftly", "bin", "lldb-dap");

    // SDK path commands for Swift expression evaluation
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

      // Use lldb-dap from Swiftly for cross-compilation support
      debugConfiguration.debugAdapterExecutable = swiftlyLldbDap;
      this.outputChannel.appendLine(`Using lldb-dap from Swiftly: ${swiftlyLldbDap}`);

      // Set SDK path BEFORE target creation so SwiftASTContext picks it up
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
