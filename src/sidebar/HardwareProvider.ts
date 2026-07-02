import * as vscode from "vscode";
import { WendyCLI } from "../wendy-cli/wendy-cli";

export interface HardwareDevice {
  name: string;
  category: "camera" | "audio" | "other";
  devicePath?: string;
}

/**
 * Tree item representing a hardware device category (Camera, Audio, etc.)
 * or an individual hardware device entry.
 */
export class HardwareDeviceTreeItem extends vscode.TreeItem {
  constructor(
    public readonly hardware: HardwareDevice,
    public readonly deviceAddress: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(hardware.name, collapsibleState);
    this.tooltip = hardware.devicePath ?? hardware.name;
    this.description = hardware.devicePath;

    if (hardware.category === "camera") {
      this.contextValue = "hardwareDevice-camera";
      this.iconPath = new vscode.ThemeIcon("device-camera");
    } else if (hardware.category === "audio") {
      this.contextValue = "hardwareDevice-audio";
      this.iconPath = new vscode.ThemeIcon("mic");
    } else {
      this.contextValue = "hardwareDevice";
      this.iconPath = new vscode.ThemeIcon("circuit-board");
    }
  }
}

/**
 * Tree data provider for the Hardware sidebar panel.
 */
export class HardwareProvider
  implements vscode.TreeDataProvider<HardwareDeviceTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    HardwareDeviceTreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private currentDeviceAddress: string | undefined;
  private hardwareDevices: HardwareDevice[] = [];

  constructor(private readonly outputChannel: vscode.OutputChannel) {}

  setCurrentDevice(address: string | undefined): void {
    this.currentDeviceAddress = address;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: HardwareDeviceTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(
    element?: HardwareDeviceTreeItem
  ): Promise<HardwareDeviceTreeItem[]> {
    if (element) {
      return [];
    }
    if (!this.currentDeviceAddress) {
      return [];
    }
    return this.hardwareDevices.map(
      (hw) =>
        new HardwareDeviceTreeItem(
          hw,
          this.currentDeviceAddress!,
          vscode.TreeItemCollapsibleState.None
        )
    );
  }

  /**
   * Build the CLI arguments for `wendy device audio listen`, honouring
   * the new `--buffer-ms` and `--all` flags introduced in CLI PR #1035.
   */
  buildAudioListenArgs(
    deviceAddress: string,
    deviceId?: number
  ): string[] {
    const config = vscode.workspace.getConfiguration("wendyos");

    // --buffer-ms: playback jitter-buffer target (default 30, floor 10).
    const bufferMs: number = Math.max(
      10,
      config.get<number>("audio.bufferMs", 30)
    );

    // --all: include virtual/dummy capture devices in auto-selection.
    const allDevices: boolean = config.get<boolean>("audio.allDevices", false);

    const args: string[] = [
      "device",
      "audio",
      "listen",
      "--device",
      deviceAddress,
      "--buffer-ms",
      String(bufferMs),
    ];

    if (allDevices) {
      args.push("--all");
    }

    if (deviceId !== undefined) {
      args.push("--id", String(deviceId));
    }

    return args;
  }

  /**
   * Open a terminal and run `wendy device audio listen` for the given tree
   * item. Reads `wendyos.audio.bufferMs` and `wendyos.audio.allDevices` from
   * VS Code settings and forwards them as `--buffer-ms` / `--all`.
   */
  async listenAudioInput(item: HardwareDeviceTreeItem): Promise<void> {
    const cli = await WendyCLI.create();
    if (!cli) {
      vscode.window.showErrorMessage(
        "Wendy CLI not found. Please install it or set wendyos.cliPath."
      );
      return;
    }

    const address = item.deviceAddress;
    if (!address) {
      vscode.window.showErrorMessage(
        "No device address available. Please select a device first."
      );
      return;
    }

    // Extract a numeric device ID from the device path (e.g. "hw:2,0" → no
    // simple integer; use undefined and let the CLI auto-select).
    // If the path ends in a plain integer we forward it as --id.
    let deviceId: number | undefined;
    const pathStr = item.hardware.devicePath ?? "";
    const trailingNum = pathStr.match(/(\d+)$/);
    if (trailingNum) {
      const parsed = parseInt(trailingNum[1], 10);
      if (!isNaN(parsed)) {
        deviceId = parsed;
      }
    }

    const args = this.buildAudioListenArgs(address, deviceId);

    this.outputChannel.appendLine(
      `Executing: ${cli.path} ${args.join(" ")}`
    );

    const terminal = vscode.window.createTerminal({
      name: `Wendy Audio — ${address}`,
      shellPath: cli.path,
      shellArgs: args,
    });
    terminal.show();
  }
}
