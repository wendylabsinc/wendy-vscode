import * as vscode from "vscode";
import { Device } from "./Device";
import { v7 as uuidv7 } from "uuid";
import { exec } from "child_process";
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
}

export interface DeviceList {
  lanDevices: LANDevice[];
  ethernetDevices: EthernetDevice[];
  usbDevices: USBDevice[];
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

/**
 * Manages devices stored in VS Code configuration
 */
export class DeviceManager {
  private static readonly CONFIG_KEY = "wendyos.devices";
  private static readonly CURRENT_DEVICE_KEY = "wendyos.currentDevice";
  private _onDevicesChanged = new vscode.EventEmitter<void>();
  private devices: Device[] = [];
  private deviceIdsCheckedForUpdates: Set<string> = new Set();
  private currentDevice: Device | undefined;
  readonly onDevicesChanged = this._onDevicesChanged.event;

  private _onCurrentDeviceChanged = new vscode.EventEmitter<
    string | undefined
  >();
  readonly onCurrentDeviceChanged = this._onCurrentDeviceChanged.event;

  constructor() { }

  /**
   * Get all configured devices
   */
  async getDevices(): Promise<Device[]> {
    const config = vscode.workspace.getConfiguration();
    let devices =
      config.get<Array<{ id: string; address: string }>>(
        DeviceManager.CONFIG_KEY
      ) || [];

    const manuallyAddedDevices = devices.map((d) => new Device(
      d.id,
      d.address,
      d.address,
      undefined,
      "Custom"
    ));

    try {
      const cli = await WendyCLI.create();
      if (!cli) {
        return manuallyAddedDevices;
      }
  
      // Execute the wendy discover command with a single --json output flag
      const output = await new Promise<string>((resolve, reject) => {
        exec(`${cli.path} discover --json`, (error, stdout) => {
          if (error) {
            reject(error);
          }
          resolve(stdout);
        });
      });

      // Parse the JSON output
      const deviceList: DeviceList = JSON.parse(output);

      let foundDevices: Device[] = [];

      // TODO: Add ethernet and usb devices

      for (const lanDevice of deviceList.lanDevices) {
        foundDevices.push(new Device(
          lanDevice.id,
          lanDevice.hostname,
          lanDevice.displayName,
          lanDevice.agentVersion,
          "LAN"
        ));
      }

      const devices = [...foundDevices, ...manuallyAddedDevices];
      this.devices = devices;
      const currentDevice = this.getCurrentDevice();
      if (currentDevice) {
        this.checkForUpdates(currentDevice);
      }
      return devices;
    } catch (error) {
      console.error(error);
      this.devices = manuallyAddedDevices;
      const currentDevice = this.getCurrentDevice();
      if (currentDevice) {
        this.checkForUpdates(currentDevice);
      }
      return manuallyAddedDevices;
    }
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
      exec(`${cli.path} agent version --agent ${device.address} --json --check-updates --prerelease`, (error, stdout) => {
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
          exec(`${cli.path} agent update --agent ${device.address}`, (error, stdout) => {
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
      exec(`${cli.path} wifi list --agent ${device.address} --json`, (error, stdout) => {
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
      exec(`${cli.path} wifi connect \"${network.label}\" --agent ${device.address} --password \"${password}\" --json`, (error, stdout, stderr) => {
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
}
