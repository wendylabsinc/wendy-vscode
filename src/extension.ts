import * as vscode from "vscode";
import { ProjectManager } from "./models/ProjectManager";
import { DeviceManager } from "./models/DeviceManager";
import { DiskManager } from "./models/DiskManager";
import { DevicesProvider } from "./sidebar/DevicesProvider";
import { DisksProvider } from "./sidebar/DisksProvider";
import { HardwareProvider } from "./sidebar/HardwareProvider";
import { WendyTaskProvider } from "./tasks/WendyTaskProvider";
import { WendyDebugConfigurationProvider } from "./debugger/WendyDebugConfigurationProvider";
import { EntitlementsEditorProvider } from "./editors/EntitlementsEditorProvider";
import {
  formatOptimizeOutput,
  showOptimizeSummaryMessage,
} from "./utilities/OptimizeResultProvider";

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("Wendy");
  context.subscriptions.push(outputChannel);

  const projectManager = new ProjectManager(outputChannel);
  const deviceManager = new DeviceManager(outputChannel);
  const diskManager = new DiskManager(outputChannel);

  // ── Sidebar providers ────────────────────────────────────────────────────
  const devicesProvider = new DevicesProvider(deviceManager, outputChannel);
  vscode.window.registerTreeDataProvider("wendyDevices", devicesProvider);

  const disksProvider = new DisksProvider(diskManager, outputChannel);
  vscode.window.registerTreeDataProvider("wendyDisks", disksProvider);

  const hardwareProvider = new HardwareProvider(deviceManager, outputChannel);
  vscode.window.registerTreeDataProvider("wendyHardware", hardwareProvider);

  // ── Task provider ────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.tasks.registerTaskProvider(
      "wendy",
      new WendyTaskProvider(outputChannel)
    )
  );

  // ── Debug configuration provider ─────────────────────────────────────────
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(
      "wendy",
      new WendyDebugConfigurationProvider(deviceManager, outputChannel)
    )
  );

  // ── Entitlements editor ──────────────────────────────────────────────────
  context.subscriptions.push(
    EntitlementsEditorProvider.register(context, projectManager)
  );

  // ── Command: wendy.optimizeProject ───────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("wendy.optimizeProject", async () => {
      const projectPath = getWorkspaceRoot();
      if (!projectPath) {
        vscode.window.showErrorMessage(
          "Wendy: No workspace folder open. Open a project folder first."
        );
        return;
      }

      outputChannel.show(true);
      outputChannel.appendLine(
        "─── wendy project optimize ─────────────────────────────────────"
      );

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Wendy: Analyzing build configuration…",
          cancellable: false,
        },
        async () => {
          try {
            const raw = await projectManager.optimizeProject(projectPath, {
              json: true,
            });
            const formatted = formatOptimizeOutput(raw);
            outputChannel.appendLine(formatted);
            showOptimizeSummaryMessage(raw, projectPath);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            outputChannel.appendLine(`Error: ${msg}`);
            vscode.window.showErrorMessage(
              `Wendy Optimize failed: ${msg}`
            );
          }
        }
      );
    })
  );

  // ── Command: wendy.optimizeProjectFix ────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("wendy.optimizeProjectFix", async () => {
      const projectPath = getWorkspaceRoot();
      if (!projectPath) {
        vscode.window.showErrorMessage(
          "Wendy: No workspace folder open. Open a project folder first."
        );
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        "Wendy Optimize will apply safe, deterministic fixes to your project's build configuration (cache mounts, .dockerignore, release flags). This modifies files on disk.",
        { modal: true },
        "Apply Fixes"
      );
      if (confirm !== "Apply Fixes") {
        return;
      }

      outputChannel.show(true);
      outputChannel.appendLine(
        "─── wendy project optimize --fix ───────────────────────────────"
      );

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Wendy: Applying build-config fixes…",
          cancellable: false,
        },
        async () => {
          try {
            const raw = await projectManager.optimizeProject(projectPath, {
              fix: true,
              json: true,
            });
            const formatted = formatOptimizeOutput(raw);
            outputChannel.appendLine(formatted);
            vscode.window.showInformationMessage(
              "Wendy Optimize: Fixes applied. They take effect on your next build."
            );
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            outputChannel.appendLine(`Error: ${msg}`);
            vscode.window.showErrorMessage(
              `Wendy Optimize (fix) failed: ${msg}`
            );
          }
        }
      );
    })
  );

  // ── Command: wendy.buildProject ──────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("wendy.buildProject", async () => {
      const projectPath = getWorkspaceRoot();
      if (!projectPath) {
        vscode.window.showErrorMessage(
          "Wendy: No workspace folder open. Open a project folder first."
        );
        return;
      }
      outputChannel.show(true);
      try {
        await projectManager.buildProject(projectPath);
        vscode.window.showInformationMessage("Wendy: Build succeeded.");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Wendy: Build failed — ${msg}`);
      }
    })
  );

  // ── Command: wendy.manageEntitlements ────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("wendy.manageEntitlements", async () => {
      const projectPath = getWorkspaceRoot();
      if (!projectPath) {
        vscode.window.showErrorMessage(
          "Wendy: No workspace folder open. Open a project folder first."
        );
        return;
      }
      vscode.commands.executeCommand("wendy.openEntitlementsEditor");
    })
  );

  // ── Device commands ──────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("wendyDevices.addDevice", async () => {
      const address = await vscode.window.showInputBox({
        prompt: "Enter device address (hostname or hostname:port)",
        placeHolder: "wendy-device.local",
      });
      if (!address) {
        return;
      }
      await deviceManager.addDevice(address);
      devicesProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("wendyDevices.refreshDevices", () => {
      devicesProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "wendyDevices.deleteDevice",
      async (item) => {
        if (!item?.device?.id) {
          return;
        }
        await deviceManager.removeDevice(item.device.id);
        devicesProvider.refresh();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "wendyDevices.selectDevice",
      async (item) => {
        if (!item?.device?.id) {
          return;
        }
        await deviceManager.setCurrentDevice(item.device.id);
        devicesProvider.refresh();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("wendyDevices.showLogs", async (item) => {
      const address = item?.device?.address;
      if (!address) {
        return;
      }
      outputChannel.show(true);
      outputChannel.appendLine(`Showing logs for device: ${address}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "wendyDevices.showDashboard",
      async (item) => {
        const address = item?.device?.address;
        if (!address) {
          return;
        }
        vscode.env.openExternal(
          vscode.Uri.parse(`http://${address}:3000`)
        );
      }
    )
  );

  // ── Disk commands ────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("wendyDisks.refreshDisks", () => {
      disksProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("wendyDisks.flashDisk", async (item) => {
      if (!item?.disk) {
        return;
      }
      outputChannel.show(true);
      try {
        await diskManager.flashDisk(item.disk);
        vscode.window.showInformationMessage(
          `Wendy: Disk ${item.disk.name} flashed successfully.`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Wendy: Flash failed — ${msg}`);
      }
    })
  );

  // ── Hardware commands ────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("wendyHardware.refresh", () => {
      hardwareProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "wendyHardware.watchCamera",
      async (item) => {
        const deviceAddress = item?.deviceAddress;
        if (!deviceAddress) {
          return;
        }
        vscode.env.openExternal(
          vscode.Uri.parse(`http://${deviceAddress}:8080/camera`)
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "wendyHardware.listenAudioInput",
      async (_item) => {
        vscode.window.showInformationMessage(
          "Wendy: Audio monitoring is not yet supported in the extension."
        );
      }
    )
  );

  // ── Debug configuration refresh ──────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "wendy.refreshDebugConfigurations",
      () => {
        outputChannel.appendLine("Debug configurations refreshed.");
      }
    )
  );
}

export function deactivate(): void {
  // Nothing to tear down; subscriptions are disposed automatically.
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
