import { exec } from "child_process";
import { WendyCLI } from "../wendy-cli/wendy-cli";

export class WendyImager {
  static async listSupportedDevices(): Promise<string[]> {
    const cli = await WendyCLI.create();
    if (!cli) {
      return [];
    }

    const output = await new Promise<string>((resolve, reject) => {
      exec(`${cli.path} os supported-devices --json`, (error, stdout) => {
        if (error) {
          reject(error);
        }
        resolve(stdout);
      });
    });
    const devices = JSON.parse(output);
    return devices.map((device: any) => device.name);
  }
}
