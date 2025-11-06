import * as vscode from "vscode";
import { Device } from "../models/Device";
import { DeviceManager } from "../models/DeviceManager";
import { Refresher } from "./Refresher";

export class DeviceTreeItem extends vscode.TreeItem {
  constructor(
    public readonly device: Device,
    private readonly isCurrentDevice: boolean
  ) {
    super(device.address, vscode.TreeItemCollapsibleState.None);
    this.tooltip = `Agent Version: ${device.agentVersion || 'unknown'}`;
    this.iconPath = new vscode.ThemeIcon("vm");
    this.description = isCurrentDevice ? `Active (${device.connectionType})` : `(${device.connectionType})`;

    let contextValue = "device";

    if (isCurrentDevice) {
      contextValue += "-current";
    }

    contextValue += `-${device.connectionType}`;

    this.contextValue = contextValue;
    this.id = device.id;
    // Add a command to select this device when clicked
    this.command = {
      command: "wendyDevices.selectDevice",
      title: "Select Device",
      arguments: [this],
    };
  }
}


export class DevicesProvider
  implements vscode.TreeDataProvider<DeviceTreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    DeviceTreeItem | undefined | null | void
  > = new vscode.EventEmitter<DeviceTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    DeviceTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  constructor(private deviceManager: DeviceManager) {
    // Listen for device changes
    this.deviceManager.onDevicesChanged(() => {
      this.refresh();
    });

    // Listen for current device changes
    this.deviceManager.onCurrentDeviceChanged(() => {
      this.refresh();
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  autorefresh(): void {
    const autorefresh = new Refresher<Device[]>(() => {
      this._onDidChangeTreeData.fire();
    }, (devices1, devices2) => {
      return devices1.length === devices2.length && devices1.every((device, index) => device.id === devices2[index].id);
    });
    autorefresh.autorefresh(() => this.deviceManager.getDevices());
  }

  getTreeItem(element: DeviceTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: DeviceTreeItem): Promise<DeviceTreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    } else {
      const devices = await this.deviceManager.getDevices();
      const currentDeviceId = this.deviceManager.getCurrentDeviceId();

      return devices.map(
        (device) => new DeviceTreeItem(device, device.id === currentDeviceId)
      );
    }
  }
}
