import * as vscode from "vscode";
import { Device } from "./Device";
import { v7 as uuidv7 } from "uuid";
import { execFile } from "child_process";
import { WendyCLI } from "../wendy-cli/wendy-cli";

export interface EthernetDevice {
  displayName: string;
  isWendyOSDevice: boolean;
  macAddress: string;
  name: string;
}

export interface USBDevice {
  isWendyOSDevice: boolean;
  productId: string;
  vendorId: string;
  name: string;
}

export interface LANDevice {
  displayName: string;
  id: string;
  hostname: string;
  port: number;
  agentVersion: string | undefined;
  deviceType?: string;
  interfaceType?: string;
  isWendyDevice?: boolean;
  /**
   * Non-empty when the device is reachable over a USB/Ethernet-gadget interface.
   * Mirrors the `usb` field added to LAN device entries in `wendy discover --json`.
   * Example value: "enp0s20f0u9 480 Mbps"
   */
  usb?: string;
  apps?: LANDeviceApp[];
}

export interface LANDeviceApp {
  name: string;
  version?: string;
  bundleIdentifier?: string;
}

export interface BluetoothDevice {
    id: string;
    displayName: string;
    address: string;
    rssi: number;
    isWendyDevice: boolean;
    agentVersion?: string;
    os?: string;
    osVersion?: string;
    cpuArchitecture?: string;
    featureset?: Set<string>;
    l2capPSM?: number;
}

export interface ExternalDevice {
  id: string;
  displayName: string;
  os?: string;
  cpuArchitecture?: string;
  isWendyDevice?: boolean;
  agentVersion?: string;
  providerKey?: string;
  connectionInfo?: Record<string, string>;
}

export interface DeviceList {
  lanDevices: LANDevice[] | null;
  ethernetDevices: EthernetDevice[] | null;
  usbDevices: USBDevice[] | null;
  bluetoothDevices: BluetoothDevice[] | null;
  externalDevices: ExternalDevice[] | null;
}

export interface WifiNetwork {
  ssid: string;
  signalStrength: number;
}

export interface WifiStatus {
  connected: boolean;
  ssid: string;
}

export interface DeviceInfo {
  currentVersion: string;
  latestVersion: string | undefined;
  deviceType?: string;
  /**
   * GPU architecture identifier (e.g. "sm_87" for NVIDIA Ampere).
   * Vendor-specific format. Present only when the device has a detected GPU.
   */
  gpuArch?: string;
}

export interface WifiConnectionResult {
  success: boolean;
}

export interface DeviceApp {
  name: string;
  version?: string;
  runningState?: string;
  failureCount?: number;
}

export interface HardwareDevice {
  category: string;
  description?: string;
  devicePath?: string;
  properties?: Record<string, string>;
}

export type HardwareCategory = 'gpu' | 'usb' | 'i2c' | 'spi' | 'gpio' | 'camera' | 'audio' | 'input' | 'serial' | 'network' | 'storage';

/**
 * Manages devices stored in VS Code configuration
 */
export class DeviceManager implements vscode.Disposable {
  private static readonly CONFIG_KEY = "wendyos.devices";
  private static readonly CURRENT_DEVICE_KEY = "wendyos.currentDevice";
  private _onDevicesChanged = new vscode.EventEmitter<void>();
  private devices: Device[] = [];
  private deviceIdsCheckedForUpdates: Set<string> = new Set();
  private currentDevice: Device | undefined;
  private lanDeviceDetails: Map<string, LANDevice> = new Map();
  // Discovery is split into a fast loop (LAN — real edge devices, ~1s) and a
  // slow loop (Bluetooth + external providers, which take several seconds and
  // change rarely) so LAN devices appear quickly instead of waiting for the
  // full all-types scan. Results are cached per loop and merged on rebuild.
  private fastDiscoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private slowDiscoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private fastDiscoveredDevices: Device[] = [];
  private slowDiscoveredDevices: Device[] = [];
  private disposed: boolean = false;
  readonly onDevicesChanged = this._onDevicesChanged.event;

  private _onCurrentDeviceChanged = new vscode.EventEmitter<
    string | undefined
  >();
  readonly onCurrentDeviceChanged = this._onCurrentDeviceChanged.event;

  constructor() {
    this.devices = this.getManualDevices();
  }

  private getManualDevices(): Device[] {
    const config = vscode.workspace.getConfiguration();
    const devices =
      config.get<Array<{ id: string; address: string }>>(
        DeviceManager.CONFIG_KEY
      ) || [];
    return devices.map((d) => new Device(
      d.id,
      d.address,
      d.address,
      undefined,
      "Custom"
    ));
  }

  /**
   * Start periodic device discovery using `wendy discover --json`.
   *
   * Two independent loops run concurrently so the common case is fast: a
   * fast loop scans LAN (real edge devices, ~1s) and a slow loop scans
   * Bluetooth + external providers (several seconds, and they change rarely).
   * Each loop caches its own results; the merged list is rebuilt and emitted
   * after every scan, so LAN devices show up without waiting on Bluetooth.
   */
  async startDiscovery(): Promise<void> {
    this.stopDiscovery();

    const cli = await WendyCLI.create();
    if (!cli) {
      return;
    }

    void this.runFastDiscovery(cli);
    void this.runSlowDiscovery(cli);
  }

  private async runFastDiscovery(cli: WendyCLI): Promise<void> {
    const list = await this.scanType(cli, "lan", "1s");
    if (list) {
      const nextLanDeviceDetails = new Map<string, LANDevice>();
      const devices: Device[] = [];
      for (const lanDevice of list.lanDevices || []) {
        nextLanDeviceDetails.set(lanDevice.id, lanDevice);
        const device = new Device(
          lanDevice.id,
          lanDevice.hostname,
          lanDevice.displayName,
          lanDevice.agentVersion,
          "LAN"
        );
        if (lanDevice.deviceType) {
          device.deviceType = lanDevice.deviceType;
        }
        devices.push(device);
      }
      this.lanDeviceDetails = nextLanDeviceDetails;
      this.fastDiscoveredDevices = devices;
      this.rebuildDevices();
    }

    if (!this.disposed) {
      this.fastDiscoveryTimer = setTimeout(
        () => void this.runFastDiscovery(cli),
        2000
      );
    }
  }

  private async runSlowDiscovery(cli: WendyCLI): Promise<void> {
    const [bluetooth, external] = await Promise.all([
      this.scanType(cli, "bluetooth", "5s"),
      this.scanType(cli, "external", "2s"),
    ]);

    if (bluetooth || external) {
      const devices: Device[] = [];
      for (const btDevice of bluetooth?.bluetoothDevices || []) {
        devices.push(new Device(
          btDevice.id,
          btDevice.address,
          btDevice.displayName,
          btDevice.agentVersion,
          "BLE"
        ));
      }
      for (const externalDevice of external?.externalDevices || []) {
        const connectionType = this.connectionTypeForExternalDevice(externalDevice);
        devices.push(new Device(
          externalDevice.id,
          externalDevice.id,
          externalDevice.displayName,
          externalDevice.agentVersion,
          connectionType
        ));
      }
      this.slowDiscoveredDevices = devices;
      this.rebuildDevices();
    }

    if (!this.disposed) {
      this.slowDiscoveryTimer = setTimeout(
        () => void this.runSlowDiscovery(cli),
        10000
      );
    }
  }

  /**
   * Runs a single `wendy discover` scan for one device type and returns the
   * parsed result, or null if the scan failed or produced no usable output.
   */
  private scanType(
    cli: WendyCLI,
    type: string,
    timeout: string
  ): Promise<DeviceList | null> {
    return new Promise((resolve) => {
      execFile(
        cli.path,
        ["discover", "--json", "--type", type, "--timeout", timeout],
        (error, stdout, stderr) => {
          if (stderr) {
            console.error(`Device discovery (${type}) stderr:`, stderr);
          }
          if (!error && stdout.trim()) {
            try {
              resolve(JSON.parse(stdout) as DeviceList);
              return;
            } catch (e) {
              console.error(`Failed to parse ${type} discovery output:`, e);
            }
          }
          resolve(null);
        }
      );
    });
  }

  /**
   * Merges the fast (LAN) and slow (Bluetooth/external) discovery caches with
   * manually configured devices, de-duplicating by id, and notifies listeners.
   */
  private rebuildDevices(): void {
    const merged: Device[] = [];
    const seen = new Set<string>();
    for (const device of [
      ...this.fastDiscoveredDevices,
      ...this.slowDiscoveredDevices,
      ...this.getManualDevices(),
    ]) {
      if (seen.has(device.id)) {
        continue;
      }
      seen.add(device.id);
      merged.push(device);
    }
    this.devices = merged;

    const currentDevice = this.getCurrentDevice();
    if (currentDevice) {
      this.checkForUpdates(currentDevice).catch((error) => {
        console.error('Failed to check for updates:', error);
      });
    }
    this._onDevicesChanged.fire();
  }

  private connectionTypeForExternalDevice(device: ExternalDevice): Device["connectionType"] {
    switch (device.providerKey) {
      case "local": return "Local";
      case "docker": return "Docker";
      default: return "External";
    }
  }

  stopDiscovery(): void {
    if (this.fastDiscoveryTimer) {
      clearTimeout(this.fastDiscoveryTimer);
      this.fastDiscoveryTimer = undefined;
    }
    if (this.slowDiscoveryTimer) {
      clearTimeout(this.slowDiscoveryTimer);
      this.slowDiscoveryTimer = undefined;
    }
  }

  /**
   * Get all configured devices (returns cached results from streaming discovery)
   */
  getDevices(): Device[] {
    return this.devices;
  }

  getLanDeviceDetails(deviceId: string): LANDevice | undefined {
    return this.lanDeviceDetails.get(deviceId);
  }

  /**
   * Get the current active device ID
   */
  getCurrentDeviceId(): string | undefined {
    const config = vscode.workspace.getConfiguration();
    return config.get<string>(DeviceManager.CURRENT_DEVICE_KEY);
  }

  /**
   * Get the current active device
   */
  getCurrentDevice(): Device | undefined {
    const currentId = this.getCurrentDeviceId();
    if (!currentId) {
      return undefined;
    }

    const device = this.devices.find((d) => d.id === currentId);
    this.currentDevice = device;
    return device;
  }

  async checkForUpdates(device: Device): Promise<void> {
    if (this.deviceIdsCheckedForUpdates.has(device.id)) {
      return;
    }
    this.deviceIdsCheckedForUpdates.add(device.id);

    const cli = await WendyCLI.create();
    if (!cli) {
      throw new Error("Failed to create Wendy CLI");
    }

    const output = await new Promise<string>((resolve, reject) => {
      execFile(cli.path, ['device', 'info', '--device', device.address, '--json', '--check-updates', '--prerelease'], (error, stdout) => {
        if (error) {
          reject(error);
        }
        resolve(stdout);
      });
    });

    const info: DeviceInfo = JSON.parse(output);
    let changed = false;

    if (info.deviceType) {
      device.deviceType = info.deviceType;
      changed = true;
    }
    if (info.gpuArch) {
      device.gpuArch = info.gpuArch;
      changed = true;
    }
    if (changed) {
      this._onDevicesChanged.fire();
    }

    if (info.latestVersion) {
      const confirmed = await vscode.window.showInformationMessage(
        `Update available for ${device.name}: ${info.latestVersion}`,
        "Update"
      );

      if (confirmed === "Update") {
        await this.updateAgent(device.id);
      }
    }
  }

  /**
   * Set the current active device
   */
  async setCurrentDevice(deviceId: string | undefined): Promise<void> {
    const config = vscode.workspace.getConfiguration();

    // If trying to set a device, make sure it exists
    if (deviceId) {
      const device = this.devices.find((d) => d.id === deviceId);
      if (!device) {
        throw new Error(`Device with ID ${deviceId} not found`);
      }
      this.currentDevice = device;
      this.checkForUpdates(device).catch((error) => {
        console.error('Failed to check for updates:', error);
      });
    }

    await config.update(
      DeviceManager.CURRENT_DEVICE_KEY,
      deviceId,
      vscode.ConfigurationTarget.Global
    );

    this._onCurrentDeviceChanged.fire(deviceId);
    this._onDevicesChanged.fire();
  }

  /**
   * Add a new device
   * @param address The device address (hostname or hostname:port)
   */
  async addDevice(address: string): Promise<Device> {
    const config = vscode.workspace.getConfiguration();
    const devices =
      config.get<Array<{ id: string; address: string }>>(
        DeviceManager.CONFIG_KEY
      ) || [];

    // Check for duplicate addresses
    if (devices.some((d) => d.address === address)) {
      throw new Error(`Device with address ${address} already exists`);
    }

    const newDevice = { id: uuidv7(), address };
    devices.push(newDevice);

    await config.update(
      DeviceManager.CONFIG_KEY,
      devices,
      vscode.ConfigurationTarget.Global
    );

    // If this is the first device, automatically set it as current
    if (devices.length === 1) {
      await this.setCurrentDevice(newDevice.id);
    } else {
      this._onDevicesChanged.fire();
    }

    return new Device(newDevice.id, newDevice.address, "Wendy Agent", undefined, "Custom");
  }

  async updateAgent(deviceId: string): Promise<void> {
    const device = this.devices.find((d) => d.id === deviceId);
    if (!device) {
      throw new Error(`Device with ID ${deviceId} not found`);
    }

    const cli = await WendyCLI.create();
    if (!cli) {
      throw new Error("Failed to create Wendy CLI");
    }

    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Updating WendyOS Agent on ${device.name}`,
      cancellable: false,
    }, async () => {
      try {
        await new Promise<string>((resolve, reject) => {
          execFile(cli.path, ['device', 'update', '--device', device.address], (error, stdout) => {
            if (error) {
              reject(error);
            }
            resolve(stdout);
          });
        });

        this._onDevicesChanged.fire();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to update agent: ${error}`);
      }
    });
  }

  /**
   * Connect to WiFi
   * @param deviceId ID of the device to connect to
   */
  async connectWifi(deviceId: string): Promise<void> {
    const config = vscode.workspace.getConfiguration();
    const devices =
      config.get<Array<{ id: string; address: string }>>(
        DeviceManager.CONFIG_KEY
      ) || [];

    const device = devices.find((d) => d.id === deviceId);

    if (!device) {
      throw new Error(`Device with ID ${deviceId} not found`);
    }

    const cli = await WendyCLI.create();
    if (!cli) {
      throw new Error("Failed to create Wendy CLI");
    }

    let output = await new Promise<string>((resolve, reject) => {
      execFile(cli.path, ['wifi', 'list', '--device', device.address, '--json'], (error, stdout) => {
        if (error) {
          reject(error);
        }
        resolve(stdout);
      });
    });

    const networks: WifiNetwork[] = JSON.parse(output);

    const network = await vscode.window.showQuickPick(
      networks.map((network) => (
        { label: network.ssid, description: `Signal Strength: ${network.signalStrength}` }
      )),
      { placeHolder: "Select a WiFi network" }
    );

    if (!network) {
      return;
    }

    const password = await vscode.window.showInputBox({
      prompt: "Enter the password for the WiFi network",
      password: true,
    });

    if (!password) {
      return;
    }

    output = await new Promise<string>((resolve, reject) => {
      execFile(cli.path, ['wifi', 'connect', network.label, '--device', device.address, '--password', password, '--json'], (error, stdout, stderr) => {
        if (error) {
          reject(error);
        }
        resolve(stdout);
      });
    });

    const status: WifiConnectionResult = JSON.parse(output);

    if (!status.success) {
      throw new Error("Failed to connect to WiFi");
    }

    vscode.window.showInformationMessage(`Connected to ${network.label}`);
  }

  /**
   * Delete a device by ID
   * @param deviceId ID of the device to remove
   */
  async deleteDevice(deviceId: string): Promise<void> {
    const config = vscode.workspace.getConfiguration();
    const devices =
      config.get<Array<{ id: string; address: string }>>(
        DeviceManager.CONFIG_KEY
      ) || [];

    const updatedDevices = devices.filter((d) => d.id !== deviceId);

    if (updatedDevices.length === devices.length) {
      throw new Error(`Device with ID ${deviceId} not found`);
    }

    await config.update(
      DeviceManager.CONFIG_KEY,
      updatedDevices,
      vscode.ConfigurationTarget.Global
    );

    // If we deleted the current device, clear the current device
    const currentDeviceId = this.getCurrentDeviceId();
    if (currentDeviceId === deviceId) {
      // Set to another device if available, otherwise clear it
      if (updatedDevices.length > 0) {
        await this.setCurrentDevice(updatedDevices[0].id);
      } else {
        await this.setCurrentDevice(undefined);
      }
    } else {
      this._onDevicesChanged.fire();
    }
  }

  /**
   * List apps on a device
   */
  async listApps(deviceAddress: string): Promise<DeviceApp[]> {
    const cli = await WendyCLI.create();
    if (!cli) {
      throw new Error("Failed to create Wendy CLI");
    }

    const output = await new Promise<string>((resolve, reject) => {
      execFile(cli.path, ['--json', 'device', 'apps', 'list', '--device', deviceAddress], (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout);
      });
    });

    try {
      const result = JSON.parse(output);
      if (Array.isArray(result)) {
        return result;
      }
      if (result.apps && Array.isArray(result.apps)) {
        return result.apps;
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Start an app on a device
   */
  async startApp(deviceAddress: string, appName: string): Promise<void> {
    const cli = await WendyCLI.create();
    if (!cli) {
      throw new Error("Failed to create Wendy CLI");
    }

    await new Promise<void>((resolve, reject) => {
      execFile(cli.path, ['device', 'apps', 'start', appName, '--device', deviceAddress], (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve();
      });
    });

    this._onDevicesChanged.fire();
  }

  /**
   * Stop an app on a device
   */
  async stopApp(deviceAddress: string, appName: string): Promise<void> {
    const cli = await WendyCLI.create();
    if (!cli) {
      throw new Error("Failed to create Wendy CLI");
    }

    await new Promise<void>((resolve, reject) => {
      execFile(cli.path, ['device', 'apps', 'stop', appName, '--device', deviceAddress], (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve();
      });
    });

    this._onDevicesChanged.fire();
  }

  /**
   * Remove an app from a device
   */
  async removeApp(deviceAddress: string, appName: string, purgeImage: boolean = false): Promise<void> {
    const cli = await WendyCLI.create();
    if (!cli) {
      throw new Error("Failed to create Wendy CLI");
    }

    const args = ['device', 'apps', 'remove', appName, '--device', deviceAddress, '--force'];
    if (purgeImage) {
      args.push('--cleanup');
    }

    await new Promise<void>((resolve, reject) => {
      execFile(cli.path, args, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve();
      });
    });

    this._onDevicesChanged.fire();
  }

  /**
   * Get WiFi connection status
   */
  async getWifiStatus(deviceAddress: string): Promise<WifiStatus> {
    const cli = await WendyCLI.create();
    if (!cli) {
      throw new Error("Failed to create Wendy CLI");
    }

    const output = await new Promise<string>((resolve, reject) => {
      execFile(cli.path, ['--json', 'device', 'wifi', 'status', '--device', deviceAddress], (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout);
      });
    });

    // The CLI outputs multiple JSON objects - find the WiFi status one
    const lines = output.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]);
        // Look for the WiFi status object (has 'connected' field)
        if ('connected' in parsed) {
          return parsed;
        }
      } catch {
        // Continue to next line
      }
    }

    throw new Error("Failed to parse WiFi status");
  }

  /**
   * Disconnect from WiFi
   */
  async disconnectWifi(deviceAddress: string): Promise<void> {
    const cli = await WendyCLI.create();
    if (!cli) {
      throw new Error("Failed to create Wendy CLI");
    }

    await new Promise<void>((resolve, reject) => {
      execFile(cli.path, ['device', 'wifi', 'disconnect', '--device', deviceAddress], (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve();
      });
    });
  }

  /**
   * Get hardware information for a device
   */
  async getHardware(deviceAddress: string, category?: HardwareCategory): Promise<HardwareDevice[]> {
    const cli = await WendyCLI.create();
    if (!cli) {
      throw new Error("Failed to create Wendy CLI");
    }

    const cliArgs = ['--json', 'device', 'hardware', 'list', '--device', deviceAddress];
    if (category) {
      cliArgs.push('--category', category);
    }

    const output = await new Promise<string>((resolve, reject) => {
      execFile(cli.path, cliArgs, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout);
      });
    });

    try {
      const result = JSON.parse(output.trim());
      if (!Array.isArray(result)) {
        return [];
      }
      return result.map((raw: Record<string, string>) => ({
        category: raw.category,
        description: raw.description,
        devicePath: raw.device_path,
        properties: raw.properties as unknown as Record<string, string> | undefined,
      }));
    } catch {
      return [];
    }
  }

  async listenAudioInput(deviceAddress: string, devicePath?: string): Promise<{ cliPath: string; args: string[] }> {
    const cli = await WendyCLI.create();
    if (!cli) {
      throw new Error("Failed to create Wendy CLI");
    }

    const args = ['device', 'audio', 'listen', '--device', deviceAddress];
    if (devicePath) {
      args.push('--input', devicePath);
    }

    return { cliPath: cli.path, args };
  }

  dispose(): void {
    this.disposed = true;
    this.stopDiscovery();
  }
}
