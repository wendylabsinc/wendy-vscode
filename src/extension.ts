// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { getErrorDescription } from "./utilities/utilities";
import { WendyCLI } from "./wendy-cli/wendy-cli";
import type { SwiftExtensionApi } from "swiftlang.swift-vscode";
import { WendyWorkspaceContext } from "./WendyWorkspaceContext";
import { WendyTaskProvider } from "./tasks/WendyTaskProvider";
import * as path from "path";
import * as fs from "fs/promises";
import { DevicesProvider, DeviceTreeItem, AppTreeItem } from "./sidebar/DevicesProvider";
import { DeviceManager, LANDevice } from "./models/DeviceManager";
import { ProjectManager, EntitlementType } from "./models/ProjectManager";
import { HardwareProvider, HardwareDeviceTreeItem } from "./sidebar/HardwareProvider";
import { DiskManager } from "./models/DiskManager";
import { WendyDebugConfigurationProvider, WENDY_LAUNCH_CONFIG_TYPE } from "./debugger/WendyDebugConfigurationProvider";
import { DisksProvider } from "./sidebar/DisksProvider";
import { WendyImager } from "./utilities/Imager";
import { WendyProjectDetector } from "./utilities/WendyProjectDetector";
import { makeDebugConfigurations, hasAnyWendyDebugConfiguration } from "./debugger/launch";
import { EntitlementsEditorProvider } from "./editors/EntitlementsEditorProvider";
import { TelemetryDashboardProvider } from "./telemetry/TelemetryDashboardProvider";

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  try {
    const outputChannel = vscode.window.createOutputChannel("WendyOS");
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine(
      "Activating WendyOS extension for Visual Studio Code..."
    );

    // If we're developing the extension, focus the output channel
    if (context.extensionMode === vscode.ExtensionMode.Development) {
      outputChannel.show();
    }

    // Create the DeviceManager
    const deviceManager = new DeviceManager();
    context.subscriptions.push(deviceManager);
    const diskManager = new DiskManager(outputChannel);
    const projectManager = new ProjectManager(outputChannel);

    // Register the devices provider
    const devicesProvider = new DevicesProvider(deviceManager);
    const devicesTreeView = vscode.window.createTreeView("wendyDevices", {
      treeDataProvider: devicesProvider,
    });
    context.subscriptions.push(devicesTreeView);

    // Register the disks provider
    const disksProvider = new DisksProvider(diskManager);
    vscode.window.registerTreeDataProvider("wendyDisks", disksProvider);

    // Register the hardware provider
    const hardwareProvider = new HardwareProvider(deviceManager);
    vscode.window.registerTreeDataProvider("wendyHardware", hardwareProvider);

    const getTargetDeviceTreeItem = (
      item?: DeviceTreeItem
    ): DeviceTreeItem | undefined => {
      if (item) {
        return item;
      }

      const selected = devicesTreeView.selection?.[0];
      if (selected instanceof DeviceTreeItem) {
        return selected;
      }
      return undefined;
    };

    const copyDeviceValue = async (
      item: DeviceTreeItem | undefined,
      valueFactory: (device: DeviceTreeItem["device"]) => string | undefined,
      label: string
    ): Promise<void> => {
      const targetItem = getTargetDeviceTreeItem(item);

      if (!targetItem) {
        return;
      }

      const value = valueFactory(targetItem.device);

      if (!value) {
        void vscode.window.showWarningMessage(
          `No ${label.toLowerCase()} available for ${targetItem.device.name}.`
        );
        return;
      }

      await vscode.env.clipboard.writeText(value);
      vscode.window.setStatusBarMessage(`Copied ${label}`, 2000);
    };

    const createDeviceInfoHtml = (
      deviceItem: DeviceTreeItem,
      deviceDetails: LANDevice | undefined
    ): string => {
      const escapeHtml = (value: string): string =>
        value
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");

      const attrEscape = (value: string): string =>
        escapeHtml(value).replace(/`/g, "&#96;");

      const displayName =
        deviceDetails?.displayName ?? deviceItem.device.name ?? "Unknown";
      const hostname = deviceDetails?.hostname ?? deviceItem.device.address;
      const rows: Array<[string, string]> = [];

      rows.push(["Display Name", displayName]);
      rows.push(["Hostname", hostname]);
      if (deviceDetails?.port) {
        rows.push(["Port", `${deviceDetails.port}`]);
      }
      rows.push(["Device ID", deviceItem.device.id]);

      if (deviceItem.device.agentVersion) {
        rows.push(["Agent Version", deviceItem.device.agentVersion]);
      }

      if (deviceDetails?.interfaceType) {
        rows.push(["Interface Type", deviceDetails.interfaceType]);
      } else {
        rows.push(["Interface Type", deviceItem.device.connectionType]);
      }

      if (deviceDetails?.isWendyDevice !== undefined) {
        rows.push([
          "Is Wendy Device",
          deviceDetails.isWendyDevice ? "Yes" : "No",
        ]);
      }

      const tableRowsHtml = rows
        .filter(([, value]) => value !== undefined && value !== "")
        .map(([label, value]) => {
          const escapedLabel = escapeHtml(label);
          const escapedValue = escapeHtml(value);
          const attrValue = attrEscape(value);
          const attrLabel = attrEscape(label);
          return `<tr>
              <th>${escapedLabel}</th>
              <td>
                <span class="value-text">${escapedValue}</span>
                <button class="copy-button" data-value="${attrValue}" data-label="${attrLabel}" title="Copy ${escapedLabel}" aria-label="Copy ${escapedLabel}">
                  <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M4 4l1-1h5.414L14 6.586V14l-1 1H5l-1-1V4zm9 3l-3-3H5v10h8V7z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M3 1L2 2v10l1 1V2h6.414l-1-1H3z"/></svg>
                </button>
              </td>
            </tr>`;
        })
        .join("");

      const subtitle = hostname
        ? `${hostname}${deviceDetails?.port ? `:${deviceDetails.port}` : ""}`
        : deviceItem.device.address;

      const appsSection = (() => {
        const apps = deviceDetails?.apps ?? [];
        if (apps.length === 0) {
          return `<p>No apps were discovered.</p>`;
        }

        const appRows = apps
          .map((app) => {
            const name = app?.name ?? "";
            const version = app?.version ?? "";
            const bundle = app?.bundleIdentifier ?? "";
            const nameEscaped = escapeHtml(name);
            const versionEscaped = escapeHtml(version);
            const bundleEscaped = escapeHtml(bundle);
            const copyButton = (value: string, label: string): string => {
              if (!value) {
                return "";
              }
              return `<button class="copy-button" data-value="${attrEscape(
                value
              )}" data-label="${attrEscape(label)}" title="Copy ${escapeHtml(
                label
              )}" aria-label="Copy ${escapeHtml(label)}">
                  <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M4 4l1-1h5.414L14 6.586V14l-1 1H5l-1-1V4zm9 3l-3-3H5v10h8V7z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M3 1L2 2v10l1 1V2h6.414l-1-1H3z"/></svg>
                </button>`;
            };

            return `<tr>
              <td>
                <span class="value-text">${nameEscaped || "&nbsp;"}</span>
                ${copyButton(name, "App Name")}
              </td>
              <td>
                <span class="value-text">${versionEscaped || "&nbsp;"}</span>
                ${copyButton(version, "App Version")}
              </td>
              <td>
                <span class="value-text">${bundleEscaped || "&nbsp;"}</span>
                ${copyButton(bundle, "Bundle Identifier")}
              </td>
            </tr>`;
          })
          .join("");

        return `<table class="info-table apps-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Version</th>
              <th>Bundle Identifier</th>
            </tr>
          </thead>
          <tbody>${appRows}</tbody>
        </table>`;
      })();

      const script = `
        const vscode = acquireVsCodeApi();
        document.querySelectorAll('.copy-button').forEach((button) => {
          button.addEventListener('click', () => {
            const value = button.getAttribute('data-value') ?? '';
            const label = button.getAttribute('data-label') ?? 'value';
            vscode.postMessage({ command: 'copy', value, label });
          });
        });
      `;

      return `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>${escapeHtml(displayName)}</title>
            <style>
              body {
                margin: 16px;
                font-family: var(--vscode-font-family, sans-serif);
                color: var(--vscode-editor-foreground, inherit);
                background-color: var(--vscode-editor-background, inherit);
              }

              .copy-button {
                border: none;
                background: transparent;
                cursor: pointer;
                padding: 2px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                color: var(--vscode-icon-foreground, inherit);
                margin-left: auto;
              }

              .copy-button:hover {
                background-color: var(--vscode-toolbar-hoverBackground, rgba(0,0,0,0.05));
              }

              .copy-button:active {
                background-color: var(--vscode-toolbar-activeBackground, rgba(0,0,0,0.1));
              }

              h1 {
                margin-bottom: 4px;
              }

              .subtitle {
                margin-top: 0;
                color: var(--vscode-descriptionForeground, inherit);
              }

              .info-table {
                width: 100%;
                border-collapse: collapse;
                border: 1px solid var(--vscode-panel-border, rgba(0,0,0,0.2));
                margin-bottom: 16px;
              }

              .info-table th,
              .info-table td {
                padding: 8px 12px;
                border-bottom: 1px solid var(--vscode-panel-border, rgba(0,0,0,0.2));
                text-align: left;
                vertical-align: middle;
              }

              .info-table th {
                width: 28%;
                color: var(--vscode-descriptionForeground, inherit);
              }

              .info-table tr:last-child th,
              .info-table tr:last-child td {
                border-bottom: none;
              }

              .info-table td {
                display: flex;
                align-items: center;
                gap: 8px;
              }

              .value-text {
                flex: 1;
                margin-right: 0;
                min-width: 0;
              }

              .apps-table th {
                width: auto;
              }
            </style>
          </head>
          <body>
            <h1>${escapeHtml(displayName)}</h1>
            <p class="subtitle">${escapeHtml(subtitle ?? "")}</p>
            <table class="info-table">
              <tbody>
                ${tableRowsHtml}
              </tbody>
            </table>
            <h2>Apps</h2>
            ${appsSection}
            <script>${script}</script>
          </body>
        </html>
      `;
    };

    const showDeviceInfo = (item?: DeviceTreeItem): void => {
      const targetItem = getTargetDeviceTreeItem(item);

      if (!targetItem) {
        return;
      }

      const details = deviceManager.getLanDeviceDetails(targetItem.device.id);
      const panel = vscode.window.createWebviewPanel(
        "wendyDeviceInfo",
        `${targetItem.device.name}`,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
        }
      );

      panel.webview.html = createDeviceInfoHtml(targetItem, details);

      const disposable = panel.webview.onDidReceiveMessage(async (message) => {
        if (message?.command === "copy" && typeof message.value === "string") {
          await vscode.env.clipboard.writeText(message.value);
          const label =
            typeof message.label === "string" && message.label
              ? message.label
              : "value";
          vscode.window.setStatusBarMessage(`Copied ${label}`, 2000);
        }
      });

      panel.onDidDispose(() => {
        disposable.dispose();
      });
    };

    devicesProvider.autorefresh();
    disksProvider.autorefresh();

    // Register device-related commands
    context.subscriptions.push(
      vscode.commands.registerCommand("wendyDevices.refreshDevices", () => {
        devicesProvider.autorefresh();
      }),

      vscode.commands.registerCommand("wendyDevices.addDevice", async () => {
        const address = await vscode.window.showInputBox({
          placeHolder: "hostname or hostname:port",
          prompt: "Enter the address of the Wendy device",
        });

        if (address) {
          try {
            await deviceManager.addDevice(address);
            vscode.window.showInformationMessage(
              `Device ${address} added successfully`
            );
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to add device: ${getErrorDescription(error)}`
            );
          }
        }
      }),

      vscode.commands.registerCommand(
        "wendyDevices.deleteDevice",
        async (item) => {
          if (item?.device) {
            const confirmed = await vscode.window.showWarningMessage(
              `Are you sure you want to remove device ${item.device.address}?`,
              { modal: true },
              "Remove"
            );

            if (confirmed === "Remove") {
              try {
                await deviceManager.deleteDevice(item.device.id);
                vscode.window.showInformationMessage(
                  `Device ${item.device.address} removed`
                );
              } catch (error) {
                vscode.window.showErrorMessage(
                  `Failed to remove device: ${getErrorDescription(error)}`
                );
              }
            }
          }
        }
      ),

      vscode.commands.registerCommand(
        "wendyDevices.connectWifi",
        async (item) => {
          if (item?.device) {
            try {
              await deviceManager.connectWifi(item.device.id);
            } catch (error) {
              vscode.window.showErrorMessage(
                `Failed to connect to WiFi: ${getErrorDescription(error)}`
              );
            }
          }
        }
      ),

      vscode.commands.registerCommand(
        "wendyDevices.updateAgent",
        async (item) => {
          if (item?.device) {
            await deviceManager.updateAgent(item.device.id);
          }
        }
      ),

      vscode.commands.registerCommand(
        "wendyDevices.showInfo",
        (item: DeviceTreeItem | undefined) => {
          showDeviceInfo(item);
        }
      ),

      vscode.commands.registerCommand(
        "wendyDevices.copyHostname",
        async (item: DeviceTreeItem | undefined) => {
          await copyDeviceValue(
            item,
            (device) => device.address,
            "Hostname"
          );
        }
      ),

      vscode.commands.registerCommand(
        "wendyDevices.copyAgentVersion",
        async (item: DeviceTreeItem | undefined) => {
          await copyDeviceValue(
            item,
            (device) => device.agentVersion,
            "Wendy Agent Version"
          );
        }
      ),

      vscode.commands.registerCommand(
        "wendyDevices.selectDevice",
        async (item) => {
          if (item?.device) {
            try {
              await deviceManager.setCurrentDevice(item.device.id);
              vscode.window.showInformationMessage(
                `${item.device.address} set as current device`
              );
            } catch (error) {
              vscode.window.showErrorMessage(
                `Failed to set current device: ${getErrorDescription(error)}`
              );
            }
          }
        }
      ),

      // WiFi status command
      vscode.commands.registerCommand(
        "wendyDevices.wifiStatus",
        async (item: DeviceTreeItem | undefined) => {
          const targetItem = getTargetDeviceTreeItem(item);
          if (!targetItem) {
            return;
          }
          try {
            const status = await deviceManager.getWifiStatus(targetItem.device.address);
            if (status.connected) {
              vscode.window.showInformationMessage(
                `Connected to WiFi network: ${status.ssid}`
              );
            } else {
              vscode.window.showInformationMessage("Not connected to WiFi");
            }
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to get WiFi status: ${getErrorDescription(error)}`
            );
          }
        }
      ),

      // WiFi disconnect command
      vscode.commands.registerCommand(
        "wendyDevices.disconnectWifi",
        async (item: DeviceTreeItem | undefined) => {
          const targetItem = getTargetDeviceTreeItem(item);
          if (!targetItem) {
            return;
          }
          try {
            await deviceManager.disconnectWifi(targetItem.device.address);
            vscode.window.showInformationMessage("Disconnected from WiFi");
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to disconnect WiFi: ${getErrorDescription(error)}`
            );
          }
        }
      ),

      // Show logs command
      vscode.commands.registerCommand(
        "wendyDevices.showLogs",
        async (item: DeviceTreeItem | undefined) => {
          const targetItem = getTargetDeviceTreeItem(item);
          if (!targetItem) {
            return;
          }

          const cli = await WendyCLI.create();
          if (!cli) {
            vscode.window.showErrorMessage("Wendy CLI not found");
            return;
          }

          // Ask for optional app filter
          const apps = await deviceManager.listApps(targetItem.device.address).catch(() => []);
          let appFilter: string | undefined;

          if (apps.length > 0) {
            const appChoice = await vscode.window.showQuickPick(
              [{ label: "All Apps", value: undefined }, ...apps.map(a => ({ label: a.name, value: a.name }))],
              { placeHolder: "Filter logs by app (optional)" }
            );
            appFilter = appChoice?.value;
          }

          // Ask for log level
          const levelChoice = await vscode.window.showQuickPick(
            ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].map(l => ({ label: l, value: l })),
            { placeHolder: "Minimum log level (optional)" }
          );

          const terminal = vscode.window.createTerminal({
            name: `Logs: ${targetItem.device.address}`,
            shellPath: cli.path,
            shellArgs: [
              'device', 'logs',
              '--device', targetItem.device.address,
              ...(appFilter ? ['--app', appFilter] : []),
              ...(levelChoice ? ['--level', levelChoice.value] : [])
            ]
          });
          terminal.show();
        }
      ),

      // Show logs for a specific app
      vscode.commands.registerCommand(
        "wendyApps.showLogs",
        async (item: AppTreeItem) => {
          if (!item) {
            return;
          }

          const cli = await WendyCLI.create();
          if (!cli) {
            vscode.window.showErrorMessage("Wendy CLI not found");
            return;
          }

          // Ask for log level
          const levelChoice = await vscode.window.showQuickPick(
            ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].map(l => ({ label: l, value: l })),
            { placeHolder: "Minimum log level (optional)" }
          );

          const terminal = vscode.window.createTerminal({
            name: `Logs: ${item.app.name}`,
            shellPath: cli.path,
            shellArgs: [
              'device', 'logs',
              '--device', item.deviceAddress,
              '--app', item.app.name,
              ...(levelChoice ? ['--level', levelChoice.value] : [])
            ]
          });
          terminal.show();
        }
      ),

      // Show dashboard command
      vscode.commands.registerCommand(
        "wendyDevices.showDashboard",
        async (item: DeviceTreeItem | undefined) => {
          const targetItem = getTargetDeviceTreeItem(item);
          if (!targetItem) {
            return;
          }

          const dashboard = new TelemetryDashboardProvider(
            context.extensionUri,
            targetItem.device.address
          );
          context.subscriptions.push(dashboard);
          await dashboard.show();
        }
      ),

      // Show hardware command
      vscode.commands.registerCommand(
        "wendyDevices.showHardware",
        async (item: DeviceTreeItem | undefined) => {
          const targetItem = getTargetDeviceTreeItem(item);
          if (!targetItem) {
            return;
          }

          // Set current device and focus hardware view
          await deviceManager.setCurrentDevice(targetItem.device.id);
          vscode.commands.executeCommand("wendyHardware.focus");
        }
      ),

      // Device setup command
      vscode.commands.registerCommand(
        "wendyDevices.deviceSetup",
        async (item: DeviceTreeItem | undefined) => {
          const targetItem = getTargetDeviceTreeItem(item);
          if (!targetItem) {
            return;
          }

          const cli = await WendyCLI.create();
          if (!cli) {
            vscode.window.showErrorMessage("Wendy CLI not found");
            return;
          }

          const terminal = vscode.window.createTerminal({
            name: `Setup: ${targetItem.device.address}`,
            shellPath: cli.path,
            shellArgs: ['device', 'setup', '--device', targetItem.device.address]
          });
          terminal.show();
        }
      ),

      // Start app command
      vscode.commands.registerCommand(
        "wendyApps.startApp",
        async (item: AppTreeItem) => {
          if (!item) {
            return;
          }
          try {
            await deviceManager.startApp(item.deviceAddress, item.app.name);
            vscode.window.showInformationMessage(`App "${item.app.name}" started`);
            devicesProvider.refresh();
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to start app: ${getErrorDescription(error)}`
            );
          }
        }
      ),

      // Stop app command
      vscode.commands.registerCommand(
        "wendyApps.stopApp",
        async (item: AppTreeItem) => {
          if (!item) {
            return;
          }
          const confirmed = await vscode.window.showWarningMessage(
            `Stop app "${item.app.name}"?`,
            { modal: true },
            "Stop"
          );
          if (confirmed === "Stop") {
            try {
              await deviceManager.stopApp(item.deviceAddress, item.app.name);
              vscode.window.showInformationMessage(`App "${item.app.name}" stopped`);
              devicesProvider.refresh();
            } catch (error) {
              vscode.window.showErrorMessage(
                `Failed to stop app: ${getErrorDescription(error)}`
              );
            }
          }
        }
      ),

      // Remove app command
      vscode.commands.registerCommand(
        "wendyApps.removeApp",
        async (item: AppTreeItem) => {
          if (!item) {
            return;
          }
          const choice = await vscode.window.showWarningMessage(
            `Remove app "${item.app.name}"? This will stop the app and remove it from the device.`,
            { modal: true },
            "Remove",
            "Remove & Purge Image"
          );
          if (choice === "Remove" || choice === "Remove & Purge Image") {
            try {
              await deviceManager.removeApp(
                item.deviceAddress,
                item.app.name,
                choice === "Remove & Purge Image"
              );
              vscode.window.showInformationMessage(`App "${item.app.name}" removed`);
              devicesProvider.refresh();
            } catch (error) {
              vscode.window.showErrorMessage(
                `Failed to remove app: ${getErrorDescription(error)}`
              );
            }
          }
        }
      ),

      // Hardware refresh command
      vscode.commands.registerCommand("wendyHardware.refresh", () => {
        hardwareProvider.refresh();
      }),

      // Watch camera command
      vscode.commands.registerCommand("wendyHardware.watchCamera", async (item: HardwareDeviceTreeItem) => {
        if (!item) {
          return;
        }

        const cli = await WendyCLI.create();
        if (!cli) {
          vscode.window.showErrorMessage("Wendy CLI not found");
          return;
        }

        const args = ['device', 'camera', 'view', '--device', item.deviceAddress];
        const match = item.hardware.devicePath?.match(/(\d+)$/);
        if (match) {
          args.push('--id', match[1]);
        }

        const label = item.hardware.description || item.hardware.devicePath || 'Camera';
        const terminal = vscode.window.createTerminal({
          name: `Camera: ${label}`,
          shellPath: cli.path,
          shellArgs: args
        });
        terminal.show();
      }),

      // Listen to audio input command
      vscode.commands.registerCommand("wendyHardware.listenAudioInput", async (item: HardwareDeviceTreeItem) => {
        if (!item) {
          return;
        }

        const cli = await WendyCLI.create();
        if (!cli) {
          vscode.window.showErrorMessage("Wendy CLI not found");
          return;
        }

        const args = ['device', 'audio', 'listen', '--device', item.deviceAddress];
        const match = item.hardware.devicePath?.match(/(\d+)$/);
        if (match) {
          args.push('--id', match[1]);
        }

        const label = item.hardware.description || item.hardware.devicePath || 'Audio';
        const terminal = vscode.window.createTerminal({
          name: `Audio: ${label}`,
          shellPath: cli.path,
          shellArgs: args
        });
        terminal.show();
      }),

      // Hardware terminal command
      vscode.commands.registerCommand("wendyHardware.openTerminal", async (deviceAddress?: string) => {
        const address = deviceAddress || deviceManager.getCurrentDevice()?.address;
        if (!address) {
          vscode.window.showErrorMessage("No device selected");
          return;
        }

        const cli = await WendyCLI.create();
        if (!cli) {
          vscode.window.showErrorMessage("Wendy CLI not found");
          return;
        }

        const terminal = vscode.window.createTerminal({
          name: `Hardware: ${address}`,
          shellPath: cli.path,
          shellArgs: ['device', 'hardware', '--device', address]
        });
        terminal.show();
      }),

      // Project init command
      vscode.commands.registerCommand("wendy.initProject", async () => {
        const language = await vscode.window.showQuickPick(
          [
            { label: "Swift", value: "swift" as const },
            { label: "Python", value: "python" as const }
          ],
          { placeHolder: "Select project language" }
        );
        if (!language) {
          return;
        }

        const folderUri = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          openLabel: "Select Project Location"
        });
        if (!folderUri || folderUri.length === 0) {
          return;
        }

        try {
          await projectManager.initProject(folderUri[0].fsPath, language.value);
          vscode.window.showInformationMessage(
            `Wendy ${language.label} project initialized successfully`
          );
          // Offer to open the folder
          const openChoice = await vscode.window.showInformationMessage(
            "Would you like to open the new project?",
            "Open Folder"
          );
          if (openChoice === "Open Folder") {
            vscode.commands.executeCommand("vscode.openFolder", folderUri[0]);
          }
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to initialize project: ${getErrorDescription(error)}`
          );
        }
      }),

      // Project build command
      vscode.commands.registerCommand("wendy.buildProject", async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          vscode.window.showErrorMessage("No workspace folder open");
          return;
        }

        const currentDevice = deviceManager.getCurrentDevice();

        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "Building Wendy project...",
              cancellable: false
            },
            async () => {
              await projectManager.buildProject(
                workspaceFolder.uri.fsPath,
                undefined,
                currentDevice?.address
              );
            }
          );
          vscode.window.showInformationMessage("Project built successfully");
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to build project: ${getErrorDescription(error)}`
          );
        }
      }),

      // Manage entitlements command
      vscode.commands.registerCommand("wendy.manageEntitlements", async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          vscode.window.showErrorMessage("No workspace folder open");
          return;
        }

        const action = await vscode.window.showQuickPick(
          [
            { label: "List Entitlements", value: "list" },
            { label: "Add Entitlement", value: "add" },
            { label: "Remove Entitlement", value: "remove" }
          ],
          { placeHolder: "Select action" }
        );
        if (!action) {
          return;
        }

        const projectPath = workspaceFolder.uri.fsPath;

        if (action.value === "list") {
          try {
            const entitlements = await projectManager.listEntitlements(projectPath, true);
            if (entitlements.length === 0) {
              vscode.window.showInformationMessage("No entitlements configured");
            } else {
              const items = entitlements.map(e => ({
                label: e.type,
                description: e.enabled ? "Enabled" : "Disabled",
                detail: e.mode ? `Mode: ${e.mode}` : undefined
              }));
              await vscode.window.showQuickPick(items, { placeHolder: "Project entitlements" });
            }
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to list entitlements: ${getErrorDescription(error)}`
            );
          }
        } else if (action.value === "add") {
          const entitlementTypes: EntitlementType[] = ['network', 'video', 'audio', 'bluetooth', 'gpu', 'persist'];
          const type = await vscode.window.showQuickPick(
            entitlementTypes.map(t => ({ label: t, value: t })),
            { placeHolder: "Select entitlement type" }
          );
          if (!type) {
            return;
          }

          try {
            await projectManager.addEntitlement(projectPath, type.value);
            vscode.window.showInformationMessage(`Entitlement "${type.value}" added`);
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to add entitlement: ${getErrorDescription(error)}`
            );
          }
        } else if (action.value === "remove") {
          try {
            const entitlements = await projectManager.listEntitlements(projectPath);
            if (entitlements.length === 0) {
              vscode.window.showInformationMessage("No entitlements to remove");
              return;
            }
            const toRemove = await vscode.window.showQuickPick(
              entitlements.map(e => ({ label: e.type, value: e.type as EntitlementType })),
              { placeHolder: "Select entitlement to remove" }
            );
            if (!toRemove) {
              return;
            }
            await projectManager.removeEntitlement(projectPath, toRemove.value);
            vscode.window.showInformationMessage(`Entitlement "${toRemove.value}" removed`);
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to remove entitlement: ${getErrorDescription(error)}`
            );
          }
        }
      }),

      // Analytics status command
      vscode.commands.registerCommand("wendy.analyticsStatus", async () => {
        const cli = await WendyCLI.create();
        if (!cli) {
          vscode.window.showErrorMessage("Wendy CLI not found");
          return;
        }

        const terminal = vscode.window.createTerminal({
          name: "Wendy Analytics",
          shellPath: cli.path,
          shellArgs: ['analytics', 'status', '--verbose']
        });
        terminal.show();
      }),

      vscode.commands.registerCommand(
        "wendyDisks.refreshDisks",
        () => {
          disksProvider.refresh();
        }
      ),

      vscode.commands.registerCommand(
        "wendyDisks.flashDisk",
        async (item) => {
          if (!item || !item.disk) {
            return;
          }

          const confirmed = await vscode.window.showWarningMessage(
            "This feature will erase all data on the disk. Are you sure you want to continue?",
            { modal: true },
            "No",
            "Yes"
          ) === "Yes";

          if (!confirmed) {
            return;
          }

          const supportedDevices = await WendyImager.listSupportedDevices();
          const selectedImage = await vscode.window.showQuickPick(
            supportedDevices,
            {
              placeHolder: "Select the device type you're flashing",
              canPickMany: false
            }
          );

          if (!selectedImage) {
            return;
          }

          try {
            await diskManager.flashWendyOS(item.disk, selectedImage);
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to flash WendyOS: ${getErrorDescription(error)}`
            );
          }
        }
      ),

    );

    // Register the entitlements editor provider
    context.subscriptions.push(
      ...EntitlementsEditorProvider.register(context)
    );

    // Listen for configuration changes to the CLI path
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("wendyos.cliPath")) {
          const message =
            "WendyOS: CLI path has been changed. Reload window for changes to take effect.";
          vscode.window
            .showInformationMessage(message, "Reload Window")
            .then((selection) => {
              if (selection === "Reload Window") {
                vscode.commands.executeCommand("workbench.action.reloadWindow");
              }
            });
        }
      })
    );

    const pythonExtension = vscode.extensions.getExtension("ms-python.debugpy");
    if (pythonExtension) {
      outputChannel.appendLine(`Python extension version: ${pythonExtension.packageJSON.version}`);
      await pythonExtension.activate();
    } else {
      outputChannel.appendLine("Python extension not found");
    }

    const swiftExtension = vscode.extensions.getExtension<SwiftExtensionApi>(
      "swiftlang.swift-vscode"
    )!;
    outputChannel.appendLine(`Swift extension version: ${swiftExtension.packageJSON.version}`);
    let swiftAPI: SwiftExtensionApi;

    try {
      swiftAPI = await swiftExtension.activate();
      outputChannel.appendLine("Swift extension activated.");
    } catch (error) {
      outputChannel.appendLine(`Failed to activate Swift extension: ${getErrorDescription(error)}`);
      throw error;
    }

    const swiftWorkspaceContext = swiftAPI.workspaceContext!;

    const wendyCLI = await WendyCLI.create();
    if (!wendyCLI) {
      const config = vscode.workspace.getConfiguration("wendyos");
      const configuredPath = config.get<string>("cliPath");

      const options = ["Configure Path", "View Installation Instructions"];
      const choice = await vscode.window.showErrorMessage(
        configuredPath && configuredPath.trim() !== ""
          ? `The configured Wendy CLI path "${configuredPath}" is not accessible or executable.`
          : "Unable to automatically discover your Wendy CLI installation.",
        ...options
      );

      if (choice === "Configure Path") {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "wendyos.cliPath"
        );
      } else if (choice === "View Installation Instructions") {
        vscode.env.openExternal(
          vscode.Uri.parse(
            "https://github.com/wendylabsinc/wendy-agent/blob/main/README.md"
          )
        );
      }
      return;
    }

    outputChannel.appendLine(`Discovered Wendy CLI at path: ${wendyCLI.path}`);
    outputChannel.appendLine(`Wendy CLI version: ${wendyCLI.version}`);

    // Refresh the wendy.json schema from the CLI so validation always matches the installed version
    try {
      const schema = await wendyCLI.getJsonSchema();
      const schemaPath = path.join(context.extensionPath, "schemas", "wendy-schema.json");
      await fs.writeFile(schemaPath, schema, "utf-8");
      outputChannel.appendLine("Updated wendy.json schema from CLI.");
    } catch (error) {
      outputChannel.appendLine(`Failed to update wendy.json schema: ${getErrorDescription(error)}`);
    }

    // Create the WendyWorkspaceContext with all the necessary components
    const wendyWorkspaceContext = new WendyWorkspaceContext(
      context,
      outputChannel,
      wendyCLI,
      swiftWorkspaceContext,
      !!pythonExtension
    );

    // Store the WendyWorkspaceContext in the extension context for later use
    context.subscriptions.push(wendyWorkspaceContext);

    // Subscribe to folder changes in the Swift workspace context
    const folderChangeDisposable = swiftWorkspaceContext.onDidChangeFolders(
      async ({ folder, operation }) => {
        outputChannel.appendLine(`Swift folder change detected: ${operation}`);
        if (folder && operation === "add") {
          outputChannel.appendLine(`Folder added: ${folder.folder.fsPath}`);

          // Check if this is a Wendy project
          const isWendyProject = await WendyProjectDetector.isWendyProject(
            folder.folder.fsPath
          );
          if (isWendyProject) {
            // Find the corresponding WendyFolderContext
            for (const wendyFolder of wendyWorkspaceContext.folders) {
              if (wendyFolder.swift === folder) {
                // Check if there are already Wendy configurations for this folder
                const wsLaunchSection = vscode.workspace.getConfiguration(
                  "launch",
                  folder.folder
                );
                const configurations =
                  wsLaunchSection.get<any[]>("configurations") || [];
                const hasWendyConfigurations = configurations.some(
                  (config) => config.type === WENDY_LAUNCH_CONFIG_TYPE
                );

                if (!hasWendyConfigurations) {
                  await makeDebugConfigurations(wendyFolder);
                  await wendyWorkspaceContext.promptRefreshDebugConfigurations();
                  outputChannel.appendLine(
                    `Added Wendy debug configurations to new folder ${folder.folder.fsPath}`
                  );
                }
                break;
              }
            }
          }
        }
      }
    );
    context.subscriptions.push(folderChangeDisposable);
    outputChannel.appendLine("Listening for Swift folder changes...");

    // Register the task provider
    context.subscriptions.push(
      WendyTaskProvider.register(wendyWorkspaceContext, deviceManager, {
        hasPythonExtension: !!pythonExtension
      })
    );

    // Register the debug configuration providers
    const debugProviders = WendyDebugConfigurationProvider.register(
      wendyWorkspaceContext,
      outputChannel,
      deviceManager
    );
    context.subscriptions.push(...debugProviders);

    // Add command to refresh debug configurations
    const refreshDebugConfigsCommand = vscode.commands.registerCommand(
      "wendy.refreshDebugConfigurations",
      () => {
        vscode.commands.executeCommand("workbench.action.debug.configure");
      }
    );
    context.subscriptions.push(refreshDebugConfigsCommand);

    // Note: Launch configuration generation is now handled directly in WendyWorkspaceContext
    // The configurations will be generated automatically when all folders are ready
    console.log(`[Wendy] Configuration generation handled by WendyWorkspaceContext`);

    outputChannel.appendLine("WendyOS extension activated successfully.");
  } catch (error) {
    const errorMessage = getErrorDescription(error);
    vscode.window.showErrorMessage(
      `Activating Wendy extension failed: ${errorMessage}`
    );
  }
}

// This method is called when your extension is deactivated
export function deactivate() { }
