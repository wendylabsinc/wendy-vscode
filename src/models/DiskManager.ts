import * as vscode from "vscode";
import { Disk } from "./Disk";
import { WendyCLI } from "../wendy-cli/wendy-cli";
import { exec } from "child_process";

export class DiskManager {
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  async getDisks(): Promise<Disk[]> {
    const cli = await WendyCLI.create();
    if (!cli) {
      return [];
    }

    // Execute the wendy imager list command
    const output = await new Promise<string>((resolve, reject) => {
      exec(`${cli.path} imager list --json --all`, (error, stdout) => {
        if (error) {
          reject(error);
        }
        resolve(stdout);
      });
    });
    
    // Parse the JSON output
    return JSON.parse(output);
  }

  async flashWendyOS(disk: Disk, image: string): Promise<void> {
    const cli = await WendyCLI.create();
    if (!cli) {
      return;
    }

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: "Flashing WendyOS",
      cancellable: true,
    }, async (progress, token) => {
      this.outputChannel.appendLine(`Flashing WendyOS to disk ${disk.id} with image ${image}`);

      const terminal = vscode.window.createTerminal({
        name: "WendyOS Flasher",
        shellPath: cli.path,
        shellArgs: ["imager", "write-device", image, disk.id, "--force"]
      });

      terminal.show();

      token.onCancellationRequested(() => {
        this.outputChannel.appendLine("Flashing cancelled by user. Closing terminal...");
        terminal.dispose();
      });
    });
  }
}
