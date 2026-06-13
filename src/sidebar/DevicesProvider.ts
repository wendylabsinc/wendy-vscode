import * as vscode from "vscode";
import { Device } from "../models/Device";
import { DeviceManager } from "../models/DeviceManager";
import { WendyCLI } from "../wendy-cli/wendy-cli";

/**
 * Tree data provider for the Wendy Devices sidebar view.
 * Manages the display and interaction with Wendy devices.
 */
export class DevicesProvider implements vscode.TreeDataProvider<DeviceTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    DeviceTreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly deviceManager: DeviceManager,
    private readonly cli: WendyCLI | undefined
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DeviceTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: DeviceTreeItem): DeviceTreeItem[] {
    if (element) {
      return [];
    }
    return this.deviceManager.devices.map(
      (d) => new DeviceTreeItem(d, this.deviceManager.currentDeviceId === d.id)
    );
  }

  /**
   * Registers all device-related commands with the extension context.
   */
  registerCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "wendyDevices.unenrollDevice",
        async (item: DeviceTreeItem | undefined) => {
          await this.unenrollDevice(item);
        }
      )
    );
  }

  /**
   * Prompts the user for confirmation and then unenrolls the given device,
   * resetting it to an unprovisioned state and removing it from Wendy Cloud.
   */
  private async unenrollDevice(
    item: DeviceTreeItem | undefined
  ): Promise<void> {
    if (!this.cli) {
      vscode.window.showErrorMessage(
        "Wendy CLI is not available. Please check your installation."
      );
      return;
    }

    const device = item?.device;
    if (!device) {
      vscode.window.showErrorMessage("No device selected for unenrollment.");
      return;
    }

    const confirmed = await vscode.window.showWarningMessage(
      `Unenroll "${device.name}" (${device.address})?\n\nThis will reset the device to an unprovisioned state and delete its asset record from Wendy Cloud. This action cannot be undone.`,
      { modal: true },
      "Unenroll"
    );

    if (confirmed !== "Unenroll") {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Unenrolling device "${device.name}"…`,
        cancellable: false,
      },
      async () => {
        try {
          await this.cli!.unenrollDevice(device.address);
          vscode.window.showInformationMessage(
            `Device "${device.name}" has been unenrolled and its cloud asset removed.`
          );
          this.refresh();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(
            `Failed to unenroll device "${device.name}": ${message}`
          );
        }
      }
    );
  }
}

export class DeviceTreeItem extends vscode.TreeItem {
  constructor(
    public readonly device: Device,
    public readonly isCurrent: boolean
  ) {
    super(device.name, vscode.TreeItemCollapsibleState.None);

    this.description = device.address;
    this.tooltip = [
      `Name: ${device.name}`,
      `Address: ${device.address}`,
      `Type: ${device.connectionType}`,
      device.agentVersion ? `Agent: ${device.agentVersion}` : undefined,
      device.deviceType ? `Hardware: ${device.deviceType}` : undefined,
    ]
      .filter(Boolean)
      .join("\n");

    // Build the contextValue so menu `when` clauses can match on it.
    // Format: "device/LAN/current" or "device/LAN" etc.
    const parts = ["device", device.connectionType];
    if (isCurrent) {
      parts.push("current");
    }
    this.contextValue = parts.join("/");
  }
}
