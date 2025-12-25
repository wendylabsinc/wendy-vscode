# Wendy for VS Code

A Visual Studio Code extension for building, running, and debugging applications on WendyOS devices.

## Overview

The Wendy extension provides comprehensive integration with the Wendy platform, allowing developers to build, run, and debug Swift applications for WendyOS devices directly from Visual Studio Code. This extension streamlines the development workflow by managing device connections, providing convenient debugging configurations, and offering direct access to Wendy documentation.

## Features

### Device Management
- **Device Explorer**: View and manage your WendyOS devices in the sidebar
- **One-Click Device Selection**: Easily switch between multiple devices for deployment and debugging (Note: currently only 1 device is supported)
- **Auto Discovery**: Automatically detect WendyOS devices on your network

![Device Management](images/devices.png)

### Swift Integration
- **Project Detection**: Automatic detection of Swift package projects
- **Build and Run**: Build and deploy your Swift packages to WendyOS devices with one command
- **Task Integration**: WendyOS tasks are fully integrated with VS Code's task system

![Swift Integration](images/swift-integration.png)

### Debugging
- **Swift Debugging**: Automatically creates appropriate debug configurations for your Swift targets
- **Python Debugging**: Full support for Python debugging using debugpy 
- **Remote Debugging**: Connect to remote WendyOS devices for debugging
- **LLDB Integration**: Full Swift debugging support using LLDB with breakpoints, variable inspection, and more
- **Multi-Language Support**: Debug both Swift and Python applications on WendyOS

![Debugging](images/debugging.png)

### Documentation
- **Quick Access**: Access WendyOS documentation directly from the extension
- **Integrated Help**: Find answers to common questions without leaving your development environment

## Requirements

- Visual Studio Code 1.96.0 or newer
- Swift for Visual Studio Code extension (for Swift development)
- Python extension for Visual Studio Code (for Python development)
- Wendy CLI installed and accessible
- Swift SDK for WendyOS (for Swift debugging)
- debugpy installed in Python applications (for Python debugging)

## Installation

1. Install the extension from the VS Code Marketplace
2. Ensure the Wendy CLI is installed (`wendy --version` should work in your terminal)
3. Configure the Swift SDK path if needed for debugging

## Extension Settings

This extension contributes the following settings:

* `wendyos.cliPath`: Path to the Wendy CLI executable. Leave empty for automatic detection.
* `wendyos.swiftSdkPath`: Path to the WendyOS Swift SDK artifact bundle (required for debugging).
* `wendyos.devices`: List of Wendy devices (managed by the extension).
* `wendyos.currentDevice`: ID of the currently selected Wendy device (managed by the extension).

## Getting Started

1. Open a Swift package project
2. Add a WendyOS device using the "+" button in the Wendy Devices panel
3. Select the device as your current device
4. Use the Run or Debug buttons to deploy and run your application on the device

## Debugging Your Applications

### Swift Applications
1. Make sure you've configured your Swift SDK path via the settings
2. Select your target device in the Devices panel
3. Open the Debug panel and select "Debug [Target] on WendyOS"
4. Start debugging to deploy and connect to your application

### Python Applications
1. Install debugpy in your Python application: `pip install debugpy`
2. Add debugpy server code to your application entry point
3. Deploy your application to WendyOS
4. Select your target device in the Devices panel
5. Open the Debug panel and select "Debug Python on WendyOS"
6. Start debugging to connect to your running Python application

For detailed Python debugging setup instructions, see [Python Debugging Guide](docs/python-debugging.md).

## Known Issues

- Swift SDK path must be configured manually for debugging
- Debugging requires port 4242 to be accessible on the target device

## Release Notes

### 0.0.6

- wifi configuration

### 0.0.5

- Added automated release process via GitHub Actions

### 0.0.1

- Initial release with basic device management, build and debugging support

---

## Development

### Local Testing

You can test the extension in both VS Code (Marketplace) and Cursor (Open VSX) using the extension development host:

```bash
code --extensionDevelopmentPath=/Users/maximilianalexander/wendylabsinc/wendy-vscode
```

```bash
cursor --extensionDevelopmentPath=/Users/maximilianalexander/wendylabsinc/wendy-vscode
```

If you want to test a packaged VSIX instead:

```bash
npm run package
npx vsce package --out release/wendy-vscode.vsix
```

```bash
code --install-extension release/wendy-vscode.vsix
```

```bash
cursor --install-extension release/wendy-vscode.vsix
```

### Release Process

This extension uses an automated release process via GitHub Actions. For details on how to release new versions, see [Release Process Documentation](docs/release-process.md).

## Feedback and Contributions

Found a bug or have a feature request? Please open an issue on our [GitHub repository](https://github.com/wendylabsinc/wendy-vscode).

**Enjoy building with WendyOS!**
