import * as vscode from "vscode";
import { DevicesProvider } from "./sidebar/DevicesProvider";
import { DisksProvider } from "./sidebar/DisksProvider";
import { DocumentationProvider } from "./sidebar/DocumentationProvider";
import { HardwareProvider } from "./sidebar/HardwareProvider";
import { OperatingSystemCacheProvider } from "./sidebar/OperatingSystemCacheProvider";
import { WendyCLI, validateDeviceName } from "./wendy-cli/wendy-cli";
import { DeviceManager } from "./models/DeviceManager";
import { DiskManager } from "./models/DiskManager";
import { ProjectManager } from "./models/ProjectManager";
import { WendyTaskProvider } from "./tasks/WendyTaskProvider";
import { WendyDebugConfigurationProvider } from "./debugger/WendyDebugConfigurationProvider";
import { EntitlementsEditorProvider } from "./editors/EntitlementsEditorProvider";
import { TelemetryDashboardProvider } from "./telemetry/TelemetryDashboardProvider";
import { Device } from "./models/Device";

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("Wendy");
  context.subscriptions.push(outputChannel);

  const deviceManager = new DeviceManager(context);
  const diskManager = new DiskManager(context);
  const projectManager = new ProjectManager(outputChannel);

  // ── Sidebar providers ────────────────────────────────────────────────────
  const devicesProvider = new DevicesProvider(deviceManager);
  const disksProvider = new DisksProvider(diskManager);
  const documentationProvider = new DocumentationProvider();
  const hardwareProvider = new HardwareProvider(deviceManager);
  const osCacheProvider = new OperatingSystemCacheProvider();

  vscode.window.registerTreeDataProvider("wendyDevices", devicesProvider);
  vscode.window.registerTreeDataProvider("wendyDisks", disksProvider);
  vscode.window.registerTreeDataProvider(
    "wendyDocumentation",
    documentationProvider
  );
  vscode.window.registerTreeDataProvider("wendyHardware", hardwareProvider);
  vscode.window.registerTreeDataProvider(
    "wendyOperatingSystemCache",
    osCacheProvider
  );

  // ── Editors ──────────────────────────────────────────────────────────────
  context.subscriptions.push(
    EntitlementsEditorProvider.register(context, projectManager)
  );

  // ── Telemetry ────────────────────────────────────────────────────────────
  context.subscriptions.push(
    TelemetryDashboardProvider.register(context, deviceManager)
  );

  // ── Task provider ────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.tasks.registerTaskProvider(
      "wendy",
      new WendyTaskProvider(deviceManager, projectManager)
    )
  );

  // ── Debug configuration provider ─────────────────────────────────────────
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(
      "wendy",
      new WendyDebugConfigurationProvider(deviceManager)
    )
  );

  // ── Device commands ───────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "wendyDevices.refreshDevices",
      async () => {
        devicesProvider.refresh();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "wendyDevices.addDevice",
      async () => {
        const address = await vscode.window.showInputBox({
          prompt: "Enter device address (hostname or hostname:port)",
          placeHolder: "wendyos-device.local",
        });
        if (address) {
          await deviceManager.addDevice(address);
          devicesProvider.refresh();
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "wendyDevices.removeDevice",
      async (device: Device) => {
        await deviceManager.removeDevice(device.id);
        devicesProvider.refresh();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "wendyDevices.selectDevice",
      async (device: Device) => {
        await deviceManager.setCurrentDevice(device.id);
        devicesProvider.refresh();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "wendyDevices.unenrollDevice",
      async (device: Device) => {
        const confirm = await vscode.window.showWarningMessage(
          `Unenroll "${device.name}" (${device.address})? This will revoke its certificates and remove its cloud asset record.`,
          { modal: true },
          "Unenroll"
        );
        if (confirm !== "Unenroll") {
          return;
        }

        const cli = await WendyCLI.create();
        if (!cli) {
          vscode.window.showErrorMessage("Wendy CLI not found.");
          return;
        }

        try {
          await cli.unenrollDevice(device.address);
          vscode.window.showInformationMessage(
            `Device "${device.name}" unenrolled successfully.`
          );
          devicesProvider.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to unenroll device: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    )
  );

  // ── wendy device rename ───────────────────────────────────────────────────
  // Invoked from the Devices panel context menu or the command palette.
  // Prompts for a new DNS-label name (pre-filled with "wendyos-"), validates
  // it, delegates to `wendy device rename <name> --device <address>`, and
  // refreshes the Devices tree.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "wendyDevices.renameDevice",
      async (device: Device) => {
        if (!device) {
          // Command invoked from the palette without a tree-item context —
          // fall back to the current device.
          const current = deviceManager.getCurrentDevice();
          if (!current) {
            vscode.window.showErrorMessage(
              "No device selected. Select a device in the Devices panel first."
            );
            return;
          }
          device = current;
        }

        const name = await vscode.window.showInputBox({
          title: "Rename Device",
          prompt:
            "New device name — sets the hostname and mDNS name on the device, and the asset name in Wendy Cloud.",
          value: "wendyos-",
          valueSelection: [8, 8], // position cursor after the pre-filled "wendyos-"
          placeHolder: "wendyos-living-room",
          validateInput: (value) => validateDeviceName(value.trim()) ?? null,
        });

        if (!name) {
          // User cancelled.
          return;
        }

        const trimmedName = name.trim();
        const validationError = validateDeviceName(trimmedName);
        if (validationError) {
          vscode.window.showErrorMessage(`Invalid device name: ${validationError}`);
          return;
        }

        const cli = await WendyCLI.create();
        if (!cli) {
          vscode.window.showErrorMessage("Wendy CLI not found.");
          return;
        }

        try {
          await cli.renameDevice(device.address, trimmedName);
          vscode.window.showInformationMessage(
            `Device renamed to "${trimmedName}" (mDNS: ${trimmedName}.local).`
          );
          devicesProvider.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to rename device: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    )
  );

  // ── Hardware commands ─────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "wendyHardware.watchCamera",
      async (item: { devicePath?: string; deviceAddress?: string }) => {
        const cli = await WendyCLI.create();
        if (!cli) {
          vscode.window.showErrorMessage("Wendy CLI not found.");
          return;
        }

        const address = item?.deviceAddress;
        if (!address) {
          vscode.window.showErrorMessage("No device address available.");
          return;
        }

        const devicePath = item?.devicePath ?? "";
        const idMatch = devicePath.match(/(\d+)$/);
        const args = ["device", "camera", "view", "--device", address];
        if (idMatch) {
          args.push("--id", idMatch[1]);
        }

        const terminal = vscode.window.createTerminal("Wendy Camera");
        terminal.sendText(`${cli.path} ${args.join(" ")}`);
        terminal.show();
      }
    )
  );
}

export function deactivate() {}
