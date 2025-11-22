import * as vscode from "vscode";
import type * as Swift from "swiftlang.swift-vscode";
import { WendyWorkspaceContext } from "../WendyWorkspaceContext";
import { WendyFolderContext } from "../WendyFolderContext";
import { DeviceManager } from "../models/DeviceManager";
import { WendyCLI } from "../wendy-cli/wendy-cli";
import * as cp from "child_process";

export const WENDY_TASK_TYPE = "wendy";

// This should match the TaskConfig interface in package.json
interface TaskConfig extends vscode.TaskDefinition {
  cwd: vscode.Uri;
  args: string[];
}

/**
 * Custom terminal for executing Wendy CLI tasks
 */
class WendyTaskTerminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  onDidWrite: vscode.Event<string> = this.writeEmitter.event;

  private closeEmitter = new vscode.EventEmitter<number>();
  onDidClose: vscode.Event<number> = this.closeEmitter.event;

  private process: cp.ChildProcess | undefined;

  constructor(
    private readonly cli: WendyCLI,
    private readonly args: string[],
    private readonly cwd: string
  ) { }

  open(): void {
    this.writeEmitter.fire(
      `> Executing: ${this.cli.path} ${this.args.join(" ")}\r\n`
    );

    this.process = cp.spawn(this.cli.path, this.args, {
      cwd: this.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (data) => {
      this.writeEmitter.fire(data.toString());
    });

    this.process.stderr?.on("data", (data) => {
      this.writeEmitter.fire(data.toString());
    });

    this.process.on("close", (code) => {
      this.writeEmitter.fire(`\r\nWendy process exited with code ${code}\r\n`);
      this.closeEmitter.fire(code || 0);
    });

    this.process.on("error", (err) => {
      this.writeEmitter.fire(`\r\nError: ${err.message}\r\n`);
      this.closeEmitter.fire(1);
    });
  }

  close(): void {
    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }
  }
}

export class WendyTaskProvider implements vscode.TaskProvider {
  private deviceManager: DeviceManager;
  private wendyCLI: WendyCLI;
  private hasPythonExtension: boolean;

  constructor(
    private workspaceContext: WendyWorkspaceContext,
    deviceManager?: DeviceManager,
    _options?: { hasPythonExtension: boolean }
  ) {
    // The device manager can be injected for testing, or we'll create one
    this.deviceManager = deviceManager || new DeviceManager();
    this.wendyCLI = workspaceContext.cli;
    this.hasPythonExtension =
      _options?.hasPythonExtension ?? workspaceContext.hasPythonExtension;
  }

  async provideTasks(token: vscode.CancellationToken): Promise<vscode.Task[]> {
    const tasks: vscode.Task[] = [];

    for (const folderContext of this.workspaceContext.folders) {
      if (folderContext.swift) {
        const executableProducts = await folderContext.swift.swiftPackage
          .executableProducts;
        for (const product of executableProducts) {
          tasks.push(...this.createSwiftRunTasks(product, folderContext));
        }
      } else if (this.hasPythonExtension) {
        tasks.push(...this.createPythonRunTask(folderContext));
      }
    }

    return tasks;
  }

  createRunTasks(
    config: TaskConfig,
    name: string
  ): vscode.Task[] {
    const task = new vscode.Task(
      config,
      vscode.TaskScope.Workspace,
      `Run ${name}`,
      "wendy",
      new vscode.CustomExecution(
        async (
          resolvedDefinition: vscode.TaskDefinition
        ): Promise<vscode.Pseudoterminal> => {
          // Clone the args array
          const args = [...config.args];

          // Add --agent parameter if there's a current device
          const currentDevice = await this.deviceManager.getCurrentDevice();
          if (currentDevice) {
            args.push("--agent", currentDevice.address);
          }

          const runtime = vscode.workspace.getConfiguration("wendyos").get<string>("runtime");
          if (runtime) {
            args.push("--runtime", runtime);
          }

          // Add --debug parameter for debugging
          args.push("--debug");

          return new WendyTaskTerminal(this.wendyCLI, args, config.cwd.fsPath);
        }
      )
    );

    return [task];
  }

  createPythonRunTask(folderContext: WendyFolderContext): vscode.Task[] {
    const config: TaskConfig = {
      type: WENDY_TASK_TYPE,
      args: ["run", "--detach"],
      cwd: folderContext.folder,
    };

    return this.createRunTasks(config, "Python App");
  }

  createSwiftRunTasks(
    product: Swift.Product,
    folderContext: WendyFolderContext
  ): vscode.Task[] {
    if (!folderContext.swift) {
      return [];
    }

    const config: TaskConfig = {
      type: WENDY_TASK_TYPE,
      args: ["run", "--detach", product.name],
      cwd: folderContext.swift.folder,
    };

    return this.createRunTasks(config, product.name);
  }

  async resolveTask(
    task: vscode.Task,
    token: vscode.CancellationToken
  ): Promise<vscode.Task> {
    // Only handle our own task type
    if (task.definition.type !== WENDY_TASK_TYPE) {
      return task;
    }

    const definition = task.definition as TaskConfig;

    return new vscode.Task(
      definition,
      task.scope || vscode.TaskScope.Workspace,
      task.name,
      task.source,
      new vscode.CustomExecution(
        async (
          resolvedDefinition: vscode.TaskDefinition
        ): Promise<vscode.Pseudoterminal> => {
          // Clone the args array
          const args = [...definition.args];

          // Add --agent parameter if there's a current device
          const currentDevice = await this.deviceManager.getCurrentDevice();
          if (currentDevice) {
            args.push("--agent", currentDevice.address);
          }

          // Add --debug parameter for debugging
          args.push("--debug");

          return new WendyTaskTerminal(
            this.wendyCLI,
            args,
            definition.cwd.fsPath
          );
        }
      ),
      task.problemMatchers
    );
  }

  /**
   * Registers the Wendy task provider with VS Code.
   * @param context
   */
  public static register(
    context: WendyWorkspaceContext,
    deviceManager?: DeviceManager,
    _options?: { hasPythonExtension: boolean }
  ): vscode.Disposable {
    const provider = new WendyTaskProvider(context, deviceManager, _options);
    return vscode.tasks.registerTaskProvider(WENDY_TASK_TYPE, provider);
  }
}
