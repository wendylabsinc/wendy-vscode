// Portions of this code taken from the VS Code Swift open source project
// (https://github.com/vscode‑swift), licensed under Apache 2.0.

import * as vscode from "vscode";
import { getFolderAndNameSuffix } from "./buildConfig";
import { WENDY_LAUNCH_CONFIG_TYPE } from "./WendyDebugConfigurationProvider";
import type * as Swift from "swiftlang.swift-vscode";
import { WendyFolderContext } from "../WendyFolderContext";

export async function makeDebugConfigurations(
    context: WendyFolderContext
): Promise<boolean> {
    console.log(`[Wendy] Checking for debug configurations in folder: ${context.folder.fsPath}`);

    // Get the launch configurations for this folder
    const wsLaunchSection = vscode.workspace.getConfiguration("launch", context.folder);
    let configurations = wsLaunchSection.get<any[]>("configurations") || [];
    configurations = configurations.filter(config => config.type !== WENDY_LAUNCH_CONFIG_TYPE);

    console.log(`[Wendy] Found ${configurations.length} existing configurations`);

    // Create Wendy debug configurations for each executable
    const wendyConfigurations = await createExecutableConfigurations(context);
    console.log(`[Wendy] Generated ${wendyConfigurations.length} new Wendy configurations`);

    if (wendyConfigurations.length === 0) {
        console.log(`[Wendy] No executable products found, skipping`);
        return false;
    }

    // Add the new configurations at the beginning of the array
    const newConfigurations = [...wendyConfigurations, ...configurations];

    // Update the launch.json
    console.log(`[Wendy] Updating launch.json with ${wendyConfigurations.length} Wendy configurations`);
    await wsLaunchSection.update("configurations", newConfigurations, vscode.ConfigurationTarget.WorkspaceFolder);
    console.log(`[Wendy] Successfully updated launch.json`);

    return true;
}

async function createExecutableConfigurations(context: WendyFolderContext) {
    console.log(`[Wendy] Generating debug configurations for folder: ${context.folder.fsPath}`);

    // TODO: Debugger attachment to Swift and Python containers is not yet supported
    return [];
}

/**
 * Checks if any folder in the workspace has a Wendy debug configuration
 * @returns true if at least one folder has a Wendy configuration
 */
export async function hasAnyWendyDebugConfiguration(): Promise<boolean> {
    console.log(`[Wendy] Checking if any folder has Wendy debug configurations`);

    if (!vscode.workspace.workspaceFolders) {
        console.log(`[Wendy] No workspace folders found`);
        return false;
    }

    for (const folder of vscode.workspace.workspaceFolders) {
        console.log(`[Wendy] Checking folder: ${folder.name}`);
        const wsLaunchSection = vscode.workspace.getConfiguration("launch", folder.uri);
        const configurations = wsLaunchSection.get<any[]>("configurations") || [];

        if (configurations.some(config => config.type === WENDY_LAUNCH_CONFIG_TYPE)) {
            console.log(`[Wendy] Found Wendy configuration in folder: ${folder.name}`);
            return true;
        }
    }

    console.log(`[Wendy] No Wendy configurations found in any folder`);
    return false;
}
