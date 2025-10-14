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
    const configurations = wsLaunchSection.get<any[]>("configurations") || [];
    console.log(`[Wendy] Found ${configurations.length} existing configurations`);
    
    // Check if there are already Wendy configurations
    const hasWendyConfigurations = configurations.some(
        config => config.type === WENDY_LAUNCH_CONFIG_TYPE
    );
    
    // If there are already Wendy configurations, don't add more
    if (hasWendyConfigurations) {
        console.log(`[Wendy] Wendy configurations already exist, skipping`);
        return false;
    }
    
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

    if (context.swift === undefined) {
        return [
            {
                type: WENDY_LAUNCH_CONFIG_TYPE,
                name: `Debug Python App on WendyOS`,
                request: "attach",
                target: context.folder.toString(),
                cwd: context.folder.fsPath,
                preLaunchTask: `wendy: Run Python App`
            }
        ];
    }
    
    const executableProducts = await context.swift.swiftPackage.executableProducts;
    console.log(`[Wendy] Found ${executableProducts.length} executable products`);
    
    if (executableProducts.length === 0) {
        return [];
    }

    // Windows understand the forward slashes, so make the configuration unified as posix path
    // to make it easier for users switching between platforms.
    const { folder } = getFolderAndNameSuffix(context.swift, undefined, "posix");
    console.log(`[Wendy] Using folder path: ${folder}`);

    return executableProducts.map(product => {
        console.log(`[Wendy] Creating configuration for product: ${product.name}`);
        return {
            type: WENDY_LAUNCH_CONFIG_TYPE,
            name: `Debug ${product.name} on WendyOS`,
            request: "attach",
            target: product.name,
            cwd: folder,
            preLaunchTask: `wendy: Run ${product.name}`
        };
    });
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
