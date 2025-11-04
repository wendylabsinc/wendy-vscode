// Portions of this code taken from the VS Code Swift open source project
// (https://github.com/vscode‑swift), licensed under Apache 2.0.

import * as vscode from "vscode";
import { getFolderAndNameSuffix } from "./buildConfig";
import { EDGE_LAUNCH_CONFIG_TYPE } from "./EdgeDebugConfigurationProvider";
import type * as Swift from "swiftlang.swift-vscode";

export async function makeDebugConfigurations(
    context: Swift.FolderContext
): Promise<boolean> {
    console.log(`[Edge] Checking for debug configurations in folder: ${context.folder.fsPath}`);
    
    // Get the launch configurations for this folder
    const wsLaunchSection = vscode.workspace.getConfiguration("launch", context.folder);
    const configurations = wsLaunchSection.get<any[]>("configurations") || [];
    console.log(`[Edge] Found ${configurations.length} existing configurations`);
    
    // Check if there are already Edge configurations
    const hasEdgeConfigurations = configurations.some(
        config => config.type === EDGE_LAUNCH_CONFIG_TYPE
    );
    
    // If there are already Edge configurations, don't add more
    if (hasEdgeConfigurations) {
        console.log(`[Edge] Edge configurations already exist, skipping`);
        return false;
    }
    
    // Create Edge debug configurations for each executable
    const edgeConfigurations = await createExecutableConfigurations(context);
    console.log(`[Edge] Generated ${edgeConfigurations.length} new Edge configurations`);
    
    if (edgeConfigurations.length === 0) {
        console.log(`[Edge] No executable products found, skipping`);
        return false;
    }
    
    // Add the new configurations at the beginning of the array
    const newConfigurations = [...edgeConfigurations, ...configurations];
    
    // Update the launch.json
    console.log(`[Edge] Updating launch.json with ${edgeConfigurations.length} Edge configurations`);
    await wsLaunchSection.update("configurations", newConfigurations, vscode.ConfigurationTarget.WorkspaceFolder);
    console.log(`[Edge] Successfully updated launch.json`);
    
    return true;
}

async function createExecutableConfigurations(context: Swift.FolderContext) {
    console.log(`[Edge] Generating debug configurations for folder: ${context.folder.fsPath}`);
    
    const executableProducts = await context.swiftPackage.executableProducts;
    console.log(`[Edge] Found ${executableProducts.length} executable products`);
    
    if (executableProducts.length === 0) {
        return [];
    }

    // Windows understand the forward slashes, so make the configuration unified as posix path
    // to make it easier for users switching between platforms.
    const { folder, nameSuffix } = getFolderAndNameSuffix(context, undefined, "posix");
    console.log(`[Edge] Using folder path: ${folder}`);

    return executableProducts.map(product => {
        console.log(`[Edge] Creating configuration for product: ${product.name}`);
        return {
            type: EDGE_LAUNCH_CONFIG_TYPE,
            name: `Debug ${product.name} on EdgeOS`,
            request: "attach",
            target: product.name,
            cwd: folder,
            preLaunchTask: `edge: Run ${product.name}`
        };
    });
}

/**
 * Checks if any folder in the workspace has an Edge debug configuration
 * @returns true if at least one folder has an Edge configuration
 */
export async function hasAnyEdgeDebugConfiguration(): Promise<boolean> {
    console.log(`[Edge] Checking if any folder has Edge debug configurations`);
    
    if (!vscode.workspace.workspaceFolders) {
        console.log(`[Edge] No workspace folders found`);
        return false;
    }
    
    for (const folder of vscode.workspace.workspaceFolders) {
        console.log(`[Edge] Checking folder: ${folder.name}`);
        const wsLaunchSection = vscode.workspace.getConfiguration("launch", folder.uri);
        const configurations = wsLaunchSection.get<any[]>("configurations") || [];
        
        if (configurations.some(config => config.type === EDGE_LAUNCH_CONFIG_TYPE)) {
            console.log(`[Edge] Found Edge configuration in folder: ${folder.name}`);
            return true;
        }
    }
    
    console.log(`[Edge] No Edge configurations found in any folder`);
    return false;
}
