import * as vscode from "vscode";

export class DocumentationItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly url: string,
    public readonly iconId: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.tooltip = `Open ${label}`;
    this.command = {
      command: "vscode.open",
      title: "Open Documentation",
      arguments: [vscode.Uri.parse(url)],
    };
    this.iconPath = new vscode.ThemeIcon(iconId);
    this.contextValue = "documentationLink";
  }
}

export class DocumentationProvider
  implements vscode.TreeDataProvider<DocumentationItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    DocumentationItem | undefined | null | void
  > = new vscode.EventEmitter<DocumentationItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    DocumentationItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private documentationLinks: DocumentationItem[] = [
    new DocumentationItem(
      "Visit Website",
      "https://wendy.sh",
      "globe"
    ),
    new DocumentationItem(
      "Visit Docs",
      "https://wendy.sh/docs",
      "book"
    ),
    new DocumentationItem(
      "Visit GitHub",
      "https://github.com/wendylabsinc",
      "github"
    ),
  ];

  constructor() {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DocumentationItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: DocumentationItem): Thenable<DocumentationItem[]> {
    if (element) {
      return Promise.resolve([]);
    } else {
      return Promise.resolve(this.documentationLinks);
    }
  }
}
