# Camera Watch Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inline eye icon button to each camera device in the Hardware tree view that opens a terminal running `wendy device camera view`.

**Architecture:** `HardwareDeviceTreeItem` gains a `deviceAddress` field and a camera-specific `contextValue`. The package.json menu contribution wires the eye button to a new `wendyHardware.watchCamera` command, which is registered in `extension.ts` and opens a VS Code terminal.

**Tech Stack:** TypeScript, VS Code Extension API, wendy CLI

---

### Task 1: Update `HardwareDeviceTreeItem` to carry device address and camera contextValue

**Files:**
- Modify: `src/sidebar/HardwareProvider.ts`

- [ ] **Step 1: Open `src/sidebar/HardwareProvider.ts` and update the `HardwareDeviceTreeItem` constructor**

  Change the constructor from:
  ```typescript
  export class HardwareDeviceTreeItem extends vscode.TreeItem {
    constructor(
      public readonly hardware: HardwareDevice
    ) {
      super(hardware.description || hardware.devicePath || '', vscode.TreeItemCollapsibleState.None);
      this.contextValue = "hardwareDevice";
      this.description = hardware.devicePath;
      this.tooltip = this.formatTooltip();
    }
  ```
  To:
  ```typescript
  export class HardwareDeviceTreeItem extends vscode.TreeItem {
    constructor(
      public readonly hardware: HardwareDevice,
      public readonly deviceAddress: string
    ) {
      super(hardware.description || hardware.devicePath || '', vscode.TreeItemCollapsibleState.None);
      this.contextValue = hardware.category === 'camera' ? 'hardwareDevice-camera' : 'hardwareDevice';
      this.description = hardware.devicePath;
      this.tooltip = this.formatTooltip();
    }
  ```

- [ ] **Step 2: Update `getChildren` in `HardwareProvider` to pass `currentDevice.address`**

  Change the category children branch from:
  ```typescript
  if (element instanceof HardwareCategoryTreeItem) {
    return element.devices.map(hw => new HardwareDeviceTreeItem(hw));
  }
  ```
  To:
  ```typescript
  if (element instanceof HardwareCategoryTreeItem) {
    return element.devices.map(hw => new HardwareDeviceTreeItem(hw, currentDevice.address));
  }
  ```

- [ ] **Step 3: Verify TypeScript compiles with no errors**

  ```bash
  cd /Users/joannisorlandos/git/wendy/wendy-vscode && npm run compile 2>&1
  ```
  Expected: no errors (exit 0).

- [ ] **Step 4: Commit**

  ```bash
  git add src/sidebar/HardwareProvider.ts
  git commit -m "feat: add deviceAddress and camera contextValue to HardwareDeviceTreeItem"
  ```

---

### Task 2: Add `wendyHardware.watchCamera` command and inline menu entry to `package.json`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the command entry to the `contributes.commands` array in `package.json`**

  Find the existing `wendyHardware.refresh` command entry:
  ```json
  {
    "command": "wendyHardware.refresh",
    "title": "Refresh",
    "icon": "$(refresh)"
  }
  ```
  Add a new entry immediately after it:
  ```json
  {
    "command": "wendyHardware.watchCamera",
    "title": "Watch Camera",
    "icon": "$(eye)"
  }
  ```

- [ ] **Step 2: Add the inline menu entry to `contributes.menus.view/item/context`**

  Find the last entry in the `view/item/context` array (currently the `wendyDisks.flashDisk` entry or similar), and append:
  ```json
  {
    "command": "wendyHardware.watchCamera",
    "when": "view == wendyHardware && viewItem == hardwareDevice-camera",
    "group": "inline"
  }
  ```

- [ ] **Step 3: Verify the extension compiles and the JSON is valid**

  ```bash
  cd /Users/joannisorlandos/git/wendy/wendy-vscode && npm run compile 2>&1
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add package.json
  git commit -m "feat: register wendyHardware.watchCamera command and inline menu entry"
  ```

---

### Task 3: Register the `wendyHardware.watchCamera` command handler in `extension.ts`

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Add the import for `HardwareDeviceTreeItem` at the top of `extension.ts`**

  Find the existing import:
  ```typescript
  import { HardwareProvider } from "./sidebar/HardwareProvider";
  ```
  Change it to:
  ```typescript
  import { HardwareProvider, HardwareDeviceTreeItem } from "./sidebar/HardwareProvider";
  ```

- [ ] **Step 2: Register the command handler inside the `context.subscriptions.push(...)` block in `extension.ts`**

  Find the existing hardware refresh command registration:
  ```typescript
  // Hardware refresh command
  vscode.commands.registerCommand("wendyHardware.refresh", () => {
    hardwareProvider.refresh();
  }),
  ```
  Add this new command immediately after it (inside the same `context.subscriptions.push(...)` call, separated by a comma):
  ```typescript
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
  ```

- [ ] **Step 3: Compile to confirm no TypeScript errors**

  ```bash
  cd /Users/joannisorlandos/git/wendy/wendy-vscode && npm run compile 2>&1
  ```
  Expected: no errors (exit 0).

- [ ] **Step 4: Commit**

  ```bash
  git add src/extension.ts
  git commit -m "feat: implement watchCamera command handler to open camera terminal"
  ```

---

### Task 4: Manual smoke test

- [ ] **Step 1: Launch the extension in debug mode**

  Press `F5` in VS Code with the `wendy-vscode` workspace open, or run the "Run Extension" launch configuration. A new Extension Development Host window opens.

- [ ] **Step 2: Select a connected Wendy device in the Devices panel**

  In the Extension Development Host, open the WendyOS sidebar, select a device that has cameras.

- [ ] **Step 3: Open the Hardware tab and expand "Camera"**

  Confirm that each camera item now shows an eye icon button inline on the right side of the row.

- [ ] **Step 4: Click the eye button on a camera item**

  A new terminal named `Camera: <description>` should open and immediately run `wendy device camera view --device <addr> --id <n>`. A native video window should appear.

- [ ] **Step 5: Verify devices without cameras show no eye button**

  Expand another category (e.g., "Audio" or "Usb") and confirm those items have no eye button.
