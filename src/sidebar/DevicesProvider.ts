import * as vscode from "vscode";
import { Device } from "../models/Device";
import { DeviceManager, DeviceApp } from "../models/DeviceManager";

function formatDeviceType(raw: string): string {
  const s = raw.toLowerCase();
  if (s.startsWith("raspberrypi5")) { return "Raspberry Pi 5"; }
  if (s.startsWith("raspberrypi4")) { return "Raspberry Pi 4"; }
  if (s.startsWith("raspberrypi3")) { return "Raspberry Pi 3"; }
  if (s.startsWith("jetson-agx-thor")) { return "Jetson AGX Thor"; }
  if (s.startsWith("jetson-agx-orin")) { return "Jetson AGX Orin"; }
  if (s.startsWith("jetson-orin-nx")) { return "Jetson Orin NX"; }
  if (s.startsWith("jetson-orin-nano")) { return "Jetson Orin Nano"; }
  if (s.startsWith("jetson-orin")) { return "Jetson Orin"; }
  return raw;
}

export class DeviceTreeItem extends vscode.TreeItem {
  constructor(
    public readonly device: Device,
    private readonly isCurrentDevice: boolean
  ) {
    super(device.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.tooltip = `Agent Version: ${device.agentVersion || 'unknown'}`;
    this.iconPath = new vscode.ThemeIcon("vm");
    const rawType = device.deviceType ?? device.connectionType;
    const displayType = device.deviceType ? formatDeviceType(rawType) : rawType;
    this.description = isCurrentDevice ? `Active (${displayType})` : `(${displayType})`;

    let contextValue = "device";

    if (isCurrentDevice) {
      contextValue += "-current";
    }

    contextValue += `-${device.connectionType}`;

    this.contextValue = contextValue;
    this.id = device.id;
  }
}

export class AppTreeItem extends vscode.TreeItem {
  public readonly isRunning: boolean;

  constructor(
    public readonly app: DeviceApp,
    public readonly deviceAddress: string
  ) {
    super(app.name, vscode.TreeItemCollapsibleState.None);
    const state = app.runningState?.toLowerCase() || 'unknown';
    const version = app.version || '';
    this.isRunning = state === 'running';
    this.tooltip = `${app.name}\nVersion: ${version}\nState: ${app.runningState || 'Unknown'}`;
    this.iconPath = new vscode.ThemeIcon(this.isRunning ? "play" : "debug-stop");
    this.description = `${version} (${state})`;
    // Include running state in contextValue for conditional menus
    this.contextValue = this.isRunning ? "app-running" : "app-stopped";
  }
}


type DevicesTreeItem = DeviceTreeItem | AppTreeItem;

export class DevicesProvider
  implements vscode.TreeDataProvider<DevicesTreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    DevicesTreeItem | undefined | null | void
  > = new vscode.EventEmitter<DevicesTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    DevicesTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private appsCache: Map<string, DeviceApp[]> = new Map();

  constructor(private deviceManager: DeviceManager) {
    // Listen for device changes
    this.deviceManager.onDevicesChanged(() => {
      this.appsCache.clear();
      this.refresh();
    });

    // Listen for current device changes
    this.deviceManager.onCurrentDeviceChanged(() => {
      this.refresh();
    });
  }

  refresh(): void {
    this.appsCache.clear();
    this._onDidChangeTreeData.fire();
  }

  autorefresh(): void {
    this.deviceManager.startDiscovery();
  }

  getTreeItem(element: DevicesTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: DevicesTreeItem): Promise<DevicesTreeItem[]> {
    if (!element) {
      // Return devices at root level, sorted alphabetically by name/address
      const devices = await this.deviceManager.getDevices();
      const currentDeviceId = this.deviceManager.getCurrentDeviceId();

      const sortedDevices = [...devices].sort((a, b) => {
        const nameA = (a.name || a.address).toLowerCase();
        const nameB = (b.name || b.address).toLowerCase();
        return nameA.localeCompare(nameB);
      });

      return sortedDevices.map(
        (device) => new DeviceTreeItem(device, device.id === currentDeviceId)
      );
    }

    if (element instanceof DeviceTreeItem) {
      // Return apps for this device
      const deviceAddress = element.device.address;

      // Check cache first
      let apps = this.appsCache.get(deviceAddress);
      if (!apps) {
        try {
          apps = await this.deviceManager.listApps(deviceAddress);
          this.appsCache.set(deviceAddress, apps);
        } catch {
          apps = [];
        }
      }

      // Sort apps alphabetically by name
      const sortedApps = [...apps].sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      );

      return sortedApps.map(app => new AppTreeItem(app, deviceAddress));
    }

    return [];
  }
}
