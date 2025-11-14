import * as vscode from "vscode";
import { WendyWorkspaceContext } from "./WendyWorkspaceContext";
import type * as Swift from "swiftlang.swift-vscode";

export class WendyFolderContext implements vscode.Disposable {
  constructor(
    public readonly swift: Swift.FolderContext | undefined,
    public readonly workspaceContext: WendyWorkspaceContext,
    public readonly folder: vscode.Uri
  ) {}

  dispose() {}
}
