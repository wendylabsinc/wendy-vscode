import * as vscode from "vscode";
import { DeviceManager, HardwareDevice } from "../models/DeviceManager";

class MessageTreeItem extends vscode.TreeItem {
  constructor(message: string, icon?: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon || "info");
    this.contextValue = "message";
  }
}

export class HardwareCategoryTreeItem extends vscode.TreeItem {
  constructor(
    public readonly category: string,
    public readonly devices: HardwareDevice[]
  ) {
    super(category, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = HardwareCategoryTreeItem.getIconForCategory(category);
    this.contextValue = "hardwareCategory";
    this.description = `(${devices.length})`;
  }

  private static getIconForCategory(category: string): vscode.ThemeIcon {
    switch (category.toLowerCase()) {
      case 'gpu':
        return new vscode.ThemeIcon("circuit-board");
      case 'usb':
        return new vscode.ThemeIcon("plug");
      case 'camera':
        return new vscode.ThemeIcon("device-camera");
      case 'audio':
        return new vscode.ThemeIcon("unmute");
      case 'network':
        return new vscode.ThemeIcon("globe");
      case 'storage':
        return new vscode.ThemeIcon("database");
      case 'input':
        return new vscode.ThemeIcon("keyboard");
      case 'gpio':
        return new vscode.ThemeIcon("symbol-interface");
      case 'i2c':
      case 'spi':
      case 'serial':
        return new vscode.ThemeIcon("symbol-misc");
      default:
        return new vscode.ThemeIcon("extensions");
    }
  }
}

export class HardwareDeviceTreeItem extends vscode.TreeItem {
  constructor(
    public readonly hardware: HardwareDevice,
    public readonly deviceAddress: string
  ) {
    super(hardware.description || hardware.devicePath || '', vscode.TreeItemCollapsibleState.None);
    if (hardware.category === 'camera') {
      this.contextValue = 'hardwareDevice-camera';
    } else if (hardware.category === 'audio') {
      this.contextValue = 'hardwareDevice-audio';
    } else {
      this.contextValue = 'hardwareDevice';
    }
    this.description = hardware.devicePath;
    this.tooltip = this.formatTooltip();
  }

  private formatTooltip(): string {
    const lines = [this.hardware.description || this.hardware.devicePath || ''];
    if (this.hardware.devicePath) {
      lines.push(`Path: ${this.hardware.devicePath}`);
    }
    if (this.hardware.properties) {
      for (const [key, value] of Object.entries(this.hardware.properties)) {
        if (value) {
          lines.push(`${key}: ${value}`);
        }
      }
    }
    return lines.join('\n');
  }
}

type HardwareTreeItem = MessageTreeItem | HardwareCategoryTreeItem | HardwareDeviceTreeItem;

export class HardwareProvider implements vscode.TreeDataProvider<HardwareTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<HardwareTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private hardwareByCategory: Map<string, HardwareDevice[]> | null = null;
  private loadError: string | null = null;

  constructor(private deviceManager: DeviceManager) {
    // Refresh when current device changes
    this.deviceManager.onCurrentDeviceChanged(() => {
      this.hardwareByCategory = null;
      this.loadError = null;
      this.refresh();
    });

    // Also refresh when devices list changes (e.g., after discovery)
    // This ensures the view updates if the current device wasn't loaded yet
    this.deviceManager.onDevicesChanged(() => {
      this.refresh();
    });
  }

  refresh(): void {
    this.hardwareByCategory = null;
    this.loadError = null;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: HardwareTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: HardwareTreeItem): Promise<HardwareTreeItem[]> {
    const currentDevice = this.deviceManager.getCurrentDevice();
    if (!currentDevice) {
      return [new MessageTreeItem("Select a device to view hardware", "vm")];
    }

    // Handle category children
    if (element instanceof HardwareCategoryTreeItem) {
      return element.devices.map(hw => new HardwareDeviceTreeItem(hw, currentDevice.address));
    }

    if (element) {
      return [];
    }

    // Root level - fetch and group hardware by category
    if (!this.hardwareByCategory) {
      try {
        const allHardware = await this.deviceManager.getHardware(currentDevice.address);
        this.hardwareByCategory = new Map();

        for (const hw of allHardware) {
          const category = hw.category || 'other';
          if (!this.hardwareByCategory.has(category)) {
            this.hardwareByCategory.set(category, []);
          }
          this.hardwareByCategory.get(category)!.push(hw);
        }
      } catch (error) {
        this.loadError = error instanceof Error ? error.message : String(error);
        return [new MessageTreeItem("Failed to load hardware", "error")];
      }
    }

    if (this.hardwareByCategory.size === 0) {
      return [new MessageTreeItem("No hardware detected", "info")];
    }

    // Sort categories alphabetically and create tree items
    const categories = Array.from(this.hardwareByCategory.keys()).sort();
    return categories.map(category => {
      const devices = this.hardwareByCategory!.get(category)!;
      const displayName = category.charAt(0).toUpperCase() + category.slice(1);
      return new HardwareCategoryTreeItem(displayName, devices);
    });
  }
}
