import * as vscode from "vscode";
import { Device } from "./Device";
import { v7 as uuidv7 } from "uuid";
import { exec, spawn, ChildProcess } from "child_process";
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
  interfaceType?: string;
  isWendyDevice?: boolean;
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
  providerKey?: string;
  connectionInfo?: Record<string, string>;
}

export interface DeviceList {
  lanDevices: LANDevice[];
  ethernetDevices: EthernetDevice[];
  usbDevices: USBDevice[];
  bluetoothDevices: BluetoothDevice[];
  externalDevices?: ExternalDevice[];
  dockerDesktop: boolean;
  local: boolean;
}

export interface WifiNetwork {
  ssid: string;
  signalStrength: number;
}

export interface WifiStatus {
  connected: boolean;
  ssid: string;
}

export interface AgentUpdateAvailable {
  currentVersion: string;
  latestVersion: string | undefined;
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
  name: string;
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
  private discoverProcess: ChildProcess | undefined;
  private stdoutBuffer: string = "";
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
   * Start streaming device discovery using `wendy discover --json --stream`.
   * Parses each JSONL line and fires change events reactively.
   */
  async startDiscovery(): Promise<void> {
    this.stopDiscovery();

    const cli = await WendyCLI.create();
    if (!cli) {
      return;
    }

    const proc = spawn(cli.path, ['discover', '--json', '--stream']);
    this.discoverProcess = proc;

    proc.stdout?.on('data', (data: Buffer) => {
      this.stdoutBuffer += data.toString();
      const lines = this.stdoutBuffer.split('\n');
      this.stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            const deviceList: DeviceList = JSON.parse(line);
            this.processDeviceList(deviceList);
          } catch (e) {
            console.error('Failed to parse device discovery output:', e);
          }
        }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      console.error('Device discovery stderr:', data.toString());
    });

    proc.on('close', () => {
      this.discoverProcess = undefined;
      if (!this.disposed) {
        setTimeout(() => this.startDiscovery(), 5000);
      }
    });
  }

  private processDeviceList(deviceList: DeviceList): void {
    const manualDevices = this.getManualDevices();
    const nextLanDeviceDetails = new Map<string, LANDevice>();
    let foundDevices: Device[] = [];

    for (const lanDevice of deviceList.lanDevices) {
      nextLanDeviceDetails.set(lanDevice.id, lanDevice);
      foundDevices.push(new Device(
        lanDevice.id,
        lanDevice.hostname,
        lanDevice.displayName,
        lanDevice.agentVersion,
        "LAN"
      ));
    }

    for (const btDevice of deviceList.bluetoothDevices) {
      foundDevices.push(new Device(
        btDevice.id,
        btDevice.address,
        btDevice.displayName,
        btDevice.agentVersion,
        "BLE"
      ));
    }

    if (deviceList.dockerDesktop) {
      foundDevices.push(new Device(
        "docker-desktop",
        "docker",
        "Docker Desktop",
        undefined,
        "Docker"
      ));
    }

    if (deviceList.local) {
      foundDevices.push(new Device(
        "local",
        "local",
        "Local Machine",
        undefined,
        "Local"
      ));
    }

    for (const externalDevice of deviceList.externalDevices || []) {
      foundDevices.push(new Device(
        externalDevice.id,
        externalDevice.id,
        externalDevice.displayName,
        undefined,
        "External"
      ));
    }

    const devices = [...foundDevices, ...manualDevices];
    this.lanDeviceDetails = nextLanDeviceDetails;
    this.devices = devices;
    const currentDevice = this.getCurrentDevice();
    if (currentDevice) {
      this.checkForUpdates(currentDevice);
    }
    this._onDevicesChanged.fire();
  }

  stopDiscovery(): void {
    if (this.discoverProcess) {
      this.discoverProcess.kill();
      this.discoverProcess = undefined;
    }
    this.stdoutBuffer = "";
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
      exec(`${cli.path} device version --device ${device.address} --json --check-updates --prerelease`, (error, stdout) => {
        if (error) {
          reject(error);
        }
        resolve(stdout);
      });
    });

    const updates: AgentUpdateAvailable = JSON.parse(output);
    if (updates.latestVersion) {
      const confirmed = await vscode.window.showInformationMessage(
        `Update available for ${device.name}: ${updates.latestVersion}`,
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
      this.checkForUpdates(device);
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
          exec(`${cli.path} agent update --device ${device.address}`, (error, stdout) => {
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
      exec(`${cli.path} wifi list --device ${device.address} --json`, (error, stdout) => {
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
      exec(`${cli.path} wifi connect \"${network.label}\" --device ${device.address} --password \"${password}\" --json`, (error, stdout, stderr) => {
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
      exec(`${cli.path} --json device apps list --device ${deviceAddress}`, (error, stdout, stderr) => {
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
      exec(`${cli.path} device apps start "${appName}" --device ${deviceAddress}`, (error, stdout, stderr) => {
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
      exec(`${cli.path} device apps stop "${appName}" --device ${deviceAddress}`, (error, stdout, stderr) => {
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

    let args = `device apps remove "${appName}" --device ${deviceAddress}`;
    if (purgeImage) {
      args += ' --purge-image';
    }

    await new Promise<void>((resolve, reject) => {
      exec(`${cli.path} ${args}`, (error, stdout, stderr) => {
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
      exec(`${cli.path} --json device wifi status --device ${deviceAddress}`, (error, stdout, stderr) => {
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
      exec(`${cli.path} device wifi disconnect --device ${deviceAddress}`, (error, stdout, stderr) => {
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

    let args = `--json device hardware --device ${deviceAddress}`;
    if (category) {
      args += ` --category ${category}`;
    }

    const output = await new Promise<string>((resolve, reject) => {
      exec(`${cli.path} ${args}`, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout);
      });
    });

    try {
      // The CLI outputs multiple JSON objects (events first, then data)
      // Find the array in the output
      const lines = output.trim().split('\n');
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (Array.isArray(parsed)) {
            return parsed;
          }
        } catch {
          // Continue to next line
        }
      }

      // Try parsing entire output as JSON
      const result = JSON.parse(output);
      if (Array.isArray(result)) {
        return result;
      }
      if (result.hardware && Array.isArray(result.hardware)) {
        return result.hardware;
      }
      return [];
    } catch {
      // Try to find array in concatenated JSON output
      const arrayMatch = output.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try {
          return JSON.parse(arrayMatch[0]);
        } catch {
          return [];
        }
      }
      return [];
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopDiscovery();
  }
}
