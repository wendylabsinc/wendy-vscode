# Camera Watch Button

## Summary

Add an inline eye icon button to each camera device in the Hardware tab. Clicking it opens a VS Code terminal running `wendy device camera view`, which opens a native video window.

## Architecture

Four files change:

- **`src/sidebar/HardwareProvider.ts`** — `HardwareDeviceTreeItem` gets a `deviceAddress` constructor param and sets `contextValue` to `hardwareDevice-camera` when `hardware.category === 'camera'`, otherwise `hardwareDevice`. `getChildren` passes `currentDevice.address` when building device items.
- **`src/extension.ts`** — Register `wendyHardware.watchCamera` command. Extract the camera ID from `devicePath` (e.g. `/dev/video0` → `0`), build args `['device', 'camera', 'view', '--device', address, '--id', id]`, open a terminal.
- **`package.json` commands** — Add `wendyHardware.watchCamera` with title "Watch Camera" and icon `$(eye)`.
- **`package.json` menus** — Add inline `view/item/context` entry: `when: view == wendyHardware && viewItem == hardwareDevice-camera`.

## Data Flow

1. User expands Camera category → `getChildren` maps each `HardwareDevice` to a `HardwareDeviceTreeItem(hw, currentDevice.address)` with `contextValue = "hardwareDevice-camera"`.
2. VS Code renders the `$(eye)` inline button via the menu contribution.
3. User clicks → `wendyHardware.watchCamera` fires with the tree item.
4. Handler parses ID from `devicePath`, creates terminal, runs `wendy device camera view`.

## Error Handling

- If no device address: error message (shouldn't happen since items only render when a device is selected).
- If Wendy CLI not found: show error message.
- If `devicePath` has no trailing number: omit `--id` flag (CLI uses device default).

## Testing

Manual: select a device, open Hardware tab, expand Camera category, click the eye button — a terminal opens and a video window appears.
