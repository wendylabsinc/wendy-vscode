import * as vscode from "vscode";
import * as path from "path";

interface Entitlement {
  type: string;
  mode?: string;
  name?: string;
  path?: string;
}

interface WendyConfig {
  appId?: string;
  version?: string;
  language?: string;
  entitlements?: Entitlement[];
}

export class EntitlementsEditorProvider {
  private static panels: Map<string, vscode.WebviewPanel> = new Map();

  static register(context: vscode.ExtensionContext): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // Command to open the entitlements editor
    disposables.push(
      vscode.commands.registerCommand("wendy.openEntitlementsEditor", async (uri?: vscode.Uri) => {
        const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
        if (!targetUri || path.basename(targetUri.fsPath) !== "wendy.json") {
          vscode.window.showErrorMessage("Please open a wendy.json file first");
          return;
        }

        await EntitlementsEditorProvider.openEditor(context, targetUri);
      })
    );

    // Watch for file changes to update the webview
    disposables.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (path.basename(document.uri.fsPath) === "wendy.json") {
          const panel = EntitlementsEditorProvider.panels.get(document.uri.fsPath);
          if (panel) {
            EntitlementsEditorProvider.updateWebview(panel, document.uri);
          }
        }
      })
    );

    return disposables;
  }

  private static async openEditor(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
    const existingPanel = EntitlementsEditorProvider.panels.get(uri.fsPath);
    if (existingPanel) {
      existingPanel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "wendyEntitlements",
      "Entitlements: " + path.basename(path.dirname(uri.fsPath)),
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    EntitlementsEditorProvider.panels.set(uri.fsPath, panel);

    panel.onDidDispose(() => {
      EntitlementsEditorProvider.panels.delete(uri.fsPath);
    });

    panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case "save":
          await EntitlementsEditorProvider.saveEntitlements(uri, message.entitlements);
          break;
        case "addEntitlement":
          await EntitlementsEditorProvider.addEntitlement(uri, message.entitlement);
          break;
        case "removeEntitlement":
          await EntitlementsEditorProvider.removeEntitlement(uri, message.index);
          break;
        case "updateEntitlement":
          await EntitlementsEditorProvider.updateEntitlement(uri, message.index, message.entitlement);
          break;
      }
    });

    await EntitlementsEditorProvider.updateWebview(panel, uri);
  }

  private static async updateWebview(panel: vscode.WebviewPanel, uri: vscode.Uri): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const config: WendyConfig = JSON.parse(document.getText());
      panel.webview.html = EntitlementsEditorProvider.getWebviewContent(config, uri);
    } catch (error) {
      panel.webview.html = EntitlementsEditorProvider.getErrorContent(String(error));
    }
  }

  private static async saveEntitlements(uri: vscode.Uri, entitlements: Entitlement[]): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const config: WendyConfig = JSON.parse(document.getText());
    config.entitlements = entitlements;

    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), JSON.stringify(config, null, 2));
    await vscode.workspace.applyEdit(edit);
    await document.save();
  }

  private static async addEntitlement(uri: vscode.Uri, entitlement: Entitlement): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const config: WendyConfig = JSON.parse(document.getText());
    config.entitlements = config.entitlements || [];
    config.entitlements.push(entitlement);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), JSON.stringify(config, null, 2));
    await vscode.workspace.applyEdit(edit);
    await document.save();

    const panel = EntitlementsEditorProvider.panels.get(uri.fsPath);
    if (panel) {
      await EntitlementsEditorProvider.updateWebview(panel, uri);
    }
  }

  private static async removeEntitlement(uri: vscode.Uri, index: number): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const config: WendyConfig = JSON.parse(document.getText());
    if (config.entitlements && index >= 0 && index < config.entitlements.length) {
      config.entitlements.splice(index, 1);

      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), JSON.stringify(config, null, 2));
      await vscode.workspace.applyEdit(edit);
      await document.save();

      const panel = EntitlementsEditorProvider.panels.get(uri.fsPath);
      if (panel) {
        await EntitlementsEditorProvider.updateWebview(panel, uri);
      }
    }
  }

  private static async updateEntitlement(uri: vscode.Uri, index: number, entitlement: Entitlement): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const config: WendyConfig = JSON.parse(document.getText());
    if (config.entitlements && index >= 0 && index < config.entitlements.length) {
      config.entitlements[index] = entitlement;

      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), JSON.stringify(config, null, 2));
      await vscode.workspace.applyEdit(edit);
      await document.save();

      const panel = EntitlementsEditorProvider.panels.get(uri.fsPath);
      if (panel) {
        await EntitlementsEditorProvider.updateWebview(panel, uri);
      }
    }
  }

  private static getErrorContent(error: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: var(--vscode-font-family);
              padding: 20px;
              color: var(--vscode-errorForeground);
            }
          </style>
        </head>
        <body>
          <h2>Error loading wendy.json</h2>
          <p>${error}</p>
        </body>
      </html>
    `;
  }

  private static getWebviewContent(config: WendyConfig, uri: vscode.Uri): string {
    const entitlements = config.entitlements || [];

    const icons = {
      network: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM2 8a6 6 0 0 1 .93-3.2l1.57.93a4.5 4.5 0 0 0 0 4.54l-1.57.93A6 6 0 0 1 2 8zm6 6a6 6 0 0 1-3.2-.93l.93-1.57a4.5 4.5 0 0 0 4.54 0l.93 1.57A6 6 0 0 1 8 14zm3.2-.93a6 6 0 0 0 0-10.14l-.93 1.57a4.5 4.5 0 0 1 0 7l.93 1.57zM8 2c1.2 0 2.3.35 3.2.93l-.93 1.57a4.5 4.5 0 0 0-4.54 0l-.93-1.57A6 6 0 0 1 8 2z"/></svg>',
      video: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M14 3.5v9a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5zM3 4v8h10V4H3z"/><circle cx="8" cy="8" r="2.5"/></svg>',
      audio: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-1 0v-13A.5.5 0 0 1 8 1zm2 3a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7A.5.5 0 0 1 10 4zm2 2a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0v-3a.5.5 0 0 1 .5-.5zM6 4a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7A.5.5 0 0 1 6 4zM4 6a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0v-3A.5.5 0 0 1 4 6z"/></svg>',
      bluetooth: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8.5 1v5.793L11.146 4.5l.708.707L8.707 8l3.147 2.793-.708.707L8.5 9.207V15h-.293l-3.853-3.854.707-.707L7.5 12.878V9.207L4.354 11.5l-.708-.707L6.793 8 3.646 5.207l.708-.707L7.5 6.793V3.122L5.061 5.561l-.707-.707L8.207 1H8.5z"/></svg>',
      gpu: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3h14v10H1V3zm1 1v8h12V4H2zm2 2h2v1H4V6zm3 0h2v1H7V6zm3 0h2v1h-2V6zM4 9h2v1H4V9zm3 0h2v1H7V9zm3 0h2v1h-2V9z"/></svg>',
      persist: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1c-3.5 0-6 1.12-6 2.5v9C2 13.88 4.5 15 8 15s6-1.12 6-2.5v-9C14 2.12 11.5 1 8 1zM3 4.21c.86.54 2.35 1.04 4.25 1.04h1.5c1.9 0 3.39-.5 4.25-1.04v2.29c0 .86-2.24 1.75-5 1.75S3 7.36 3 6.5V4.21zM8 14c-2.76 0-5-.89-5-1.75v-2.46c.86.54 2.35 1.04 4.25 1.04h1.5c1.9 0 3.39-.5 4.25-1.04v2.46c0 .86-2.24 1.75-5 1.75z"/></svg>',
      shield: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L2 3v4c0 3.87 2.55 7.47 6 8.47 3.45-1 6-4.6 6-8.47V3L8 1zm0 1.08l5 1.67v3.75c0 3.16-2.16 6.12-5 7-2.84-.88-5-3.84-5-7V3.75l5-1.67z"/></svg>',
      edit: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.23 1a1.75 1.75 0 0 1 1.24.51l.52.52a1.75 1.75 0 0 1 0 2.47L5.46 14H1v-4.46L10.53 1.5A1.75 1.75 0 0 1 13.23 1zM2 13h2.59L13 4.59 11.41 3 3 11.41V13h-.59l-.41.41V13z"/></svg>',
      trash: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M6 2V1h4v1h4v1H2V2h4zm1 0h2V1H7v1zM3 4h10l-.9 10.1a1 1 0 0 1-1 .9H4.9a1 1 0 0 1-1-.9L3 4zm2 1v8h1V5H5zm2.5 0v8h1V5h-1zm2.5 0v8h1V5h-1z"/></svg>',
      add: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3.5a.5.5 0 0 1 .5.5v3.5H12a.5.5 0 0 1 0 1H8.5V12a.5.5 0 0 1-1 0V8.5H4a.5.5 0 0 1 0-1h3.5V4a.5.5 0 0 1 .5-.5z"/></svg>'
    };

    const entitlementTypes = [
      { value: "network", label: "Network", icon: "network", hasMode: true },
      { value: "video", label: "Video/Camera", icon: "video" },
      { value: "audio", label: "Audio", icon: "audio" },
      { value: "bluetooth", label: "Bluetooth", icon: "bluetooth" },
      { value: "gpu", label: "GPU", icon: "gpu" },
      { value: "persist", label: "Persistent Storage", icon: "persist", hasNamePath: true }
    ];

    const entitlementRows = entitlements.map((ent, index) => {
      const typeInfo = entitlementTypes.find(t => t.value === ent.type) || { label: ent.type, icon: "shield" };
      let details = "";
      if (ent.type === "network" && ent.mode) {
        details = `<span class="badge">${ent.mode}</span>`;
      } else if (ent.type === "persist") {
        details = `<span class="detail">${ent.name || "unnamed"} → ${ent.path || "/"}</span>`;
      } else {
        details = `<span class="detail dim">—</span>`;
      }

      return `
        <tr data-index="${index}">
          <td>
            <div class="type-cell">
              <span class="icon">${icons[typeInfo.icon as keyof typeof icons] || icons.shield}</span>
              <span>${typeInfo.label}</span>
            </div>
          </td>
          <td><div class="details-cell">${details}</div></td>
          <td>
            <div class="actions-cell">
              <button class="icon-button edit-btn" data-index="${index}" title="Edit">
                ${icons.edit}
              </button>
              <button class="icon-button delete-btn" data-index="${index}" title="Remove">
                ${icons.trash}
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    const typeOptions = entitlementTypes.map(t =>
      `<option value="${t.value}">${t.label}</option>`
    ).join("");

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: var(--vscode-font-family);
              padding: 16px;
              color: var(--vscode-foreground);
              background: var(--vscode-editor-background);
            }

            h2 {
              margin-top: 0;
              font-weight: 500;
              display: flex;
              align-items: center;
              gap: 8px;
            }

            .app-info {
              background: var(--vscode-textBlockQuote-background);
              padding: 12px;
              border-radius: 4px;
              margin-bottom: 16px;
              border-left: 3px solid var(--vscode-textLink-foreground);
            }

            .app-info-row {
              display: flex;
              gap: 24px;
              flex-wrap: wrap;
            }

            .app-info-item {
              display: flex;
              flex-direction: column;
            }

            .app-info-label {
              font-size: 11px;
              color: var(--vscode-descriptionForeground);
              text-transform: uppercase;
            }

            .app-info-value {
              font-weight: 500;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 16px;
            }

            th {
              text-align: left;
              padding: 8px 12px;
              background: var(--vscode-editor-lineHighlightBackground);
              border-bottom: 1px solid var(--vscode-panel-border);
              font-weight: 500;
              height: 36px;
            }

            td {
              padding: 0 12px;
              border-bottom: 1px solid var(--vscode-panel-border);
              vertical-align: middle;
              height: 44px;
            }

            tr:hover {
              background: var(--vscode-list-hoverBackground);
            }

            .type-cell {
              display: flex;
              align-items: center;
              gap: 8px;
              height: 44px;
            }

            .details-cell {
              color: var(--vscode-descriptionForeground);
              height: 44px;
              display: flex;
              align-items: center;
            }

            .details-cell .dim {
              opacity: 0.4;
            }

            .actions-cell {
              display: flex;
              align-items: center;
              justify-content: flex-end;
              gap: 4px;
              height: 44px;
            }

            .icon {
              display: flex;
              align-items: center;
              justify-content: center;
              width: 20px;
              height: 20px;
            }

            .icon svg {
              width: 16px;
              height: 16px;
            }

            .badge {
              background: var(--vscode-badge-background);
              color: var(--vscode-badge-foreground);
              padding: 2px 8px;
              border-radius: 10px;
              font-size: 12px;
            }

            .detail {
              font-family: var(--vscode-editor-font-family);
              font-size: 12px;
            }

            .icon-button {
              background: transparent;
              border: none;
              color: var(--vscode-foreground);
              cursor: pointer;
              padding: 6px;
              border-radius: 4px;
              display: flex;
              align-items: center;
              justify-content: center;
            }

            .icon-button svg {
              width: 16px;
              height: 16px;
            }

            .icon-button:hover {
              background: var(--vscode-toolbar-hoverBackground);
            }

            .add-button {
              background: var(--vscode-button-background);
              color: var(--vscode-button-foreground);
              border: none;
              padding: 8px 16px;
              border-radius: 4px;
              cursor: pointer;
              display: inline-flex;
              align-items: center;
              gap: 6px;
              font-size: 13px;
            }

            .add-button svg {
              width: 16px;
              height: 16px;
            }

            .add-button:hover {
              background: var(--vscode-button-hoverBackground);
            }

            .empty-state {
              text-align: center;
              padding: 40px;
              color: var(--vscode-descriptionForeground);
            }

            .empty-state svg {
              width: 48px;
              height: 48px;
              margin-bottom: 16px;
              opacity: 0.5;
            }

            h2 svg {
              width: 20px;
              height: 20px;
            }

            /* Modal */
            .modal-overlay {
              display: none;
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background: rgba(0, 0, 0, 0.5);
              z-index: 1000;
              align-items: center;
              justify-content: center;
            }

            .modal-overlay.active {
              display: flex;
            }

            .modal {
              background: var(--vscode-editor-background);
              border: 1px solid var(--vscode-panel-border);
              border-radius: 8px;
              padding: 20px;
              min-width: 350px;
              max-width: 450px;
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            }

            .modal h3 {
              margin-top: 0;
              margin-bottom: 16px;
            }

            .form-group {
              margin-bottom: 14px;
            }

            .form-group label {
              display: block;
              margin-bottom: 4px;
              font-size: 12px;
              color: var(--vscode-descriptionForeground);
            }

            .form-group select,
            .form-group input {
              width: 100%;
              padding: 6px 10px;
              background: var(--vscode-input-background);
              color: var(--vscode-input-foreground);
              border: 1px solid var(--vscode-input-border);
              border-radius: 4px;
              font-size: 13px;
              box-sizing: border-box;
            }

            .form-group select:focus,
            .form-group input:focus {
              outline: none;
              border-color: var(--vscode-focusBorder);
            }

            .modal-actions {
              display: flex;
              justify-content: flex-end;
              gap: 8px;
              margin-top: 20px;
            }

            .modal-actions button {
              padding: 6px 14px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 13px;
            }

            .btn-primary {
              background: var(--vscode-button-background);
              color: var(--vscode-button-foreground);
              border: none;
            }

            .btn-primary:hover {
              background: var(--vscode-button-hoverBackground);
            }

            .btn-secondary {
              background: var(--vscode-button-secondaryBackground);
              color: var(--vscode-button-secondaryForeground);
              border: none;
            }

            .btn-secondary:hover {
              background: var(--vscode-button-secondaryHoverBackground);
            }

            .hidden {
              display: none !important;
            }
          </style>
        </head>
        <body>
          <h2>${icons.shield} Entitlements</h2>

          <div class="app-info">
            <div class="app-info-row">
              <div class="app-info-item">
                <span class="app-info-label">App ID</span>
                <span class="app-info-value">${config.appId || "Not set"}</span>
              </div>
              <div class="app-info-item">
                <span class="app-info-label">Version</span>
                <span class="app-info-value">${config.version || "Not set"}</span>
              </div>
              ${config.language ? `
              <div class="app-info-item">
                <span class="app-info-label">Language</span>
                <span class="app-info-value">${config.language}</span>
              </div>
              ` : ""}
            </div>
          </div>

          ${entitlements.length > 0 ? `
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Configuration</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${entitlementRows}
              </tbody>
            </table>
          ` : `
            <div class="empty-state">
              ${icons.shield}
              <p>No entitlements configured</p>
              <p style="font-size: 12px;">Entitlements grant your app access to device capabilities</p>
            </div>
          `}

          <button class="add-button" id="addBtn">
            ${icons.add}
            Add Entitlement
          </button>

          <!-- Add/Edit Modal -->
          <div class="modal-overlay" id="modal">
            <div class="modal">
              <h3 id="modalTitle">Add Entitlement</h3>

              <div class="form-group">
                <label for="entType">Type</label>
                <select id="entType">
                  ${typeOptions}
                </select>
              </div>

              <div class="form-group hidden" id="modeGroup">
                <label for="entMode">Mode</label>
                <select id="entMode">
                  <option value="host">Host (full network access)</option>
                  <option value="none">None (no network access)</option>
                </select>
              </div>

              <div class="form-group hidden" id="nameGroup">
                <label for="entName">Volume Name</label>
                <input type="text" id="entName" placeholder="e.g., app-data">
              </div>

              <div class="form-group hidden" id="pathGroup">
                <label for="entPath">Mount Path</label>
                <input type="text" id="entPath" placeholder="e.g., /app/data">
              </div>

              <div class="modal-actions">
                <button class="btn-secondary" id="cancelBtn">Cancel</button>
                <button class="btn-primary" id="saveBtn">Save</button>
              </div>
            </div>
          </div>

          <script>
            const vscode = acquireVsCodeApi();
            const entitlements = ${JSON.stringify(entitlements)};
            let editIndex = -1;

            const modal = document.getElementById('modal');
            const modalTitle = document.getElementById('modalTitle');
            const entType = document.getElementById('entType');
            const entMode = document.getElementById('entMode');
            const entName = document.getElementById('entName');
            const entPath = document.getElementById('entPath');
            const modeGroup = document.getElementById('modeGroup');
            const nameGroup = document.getElementById('nameGroup');
            const pathGroup = document.getElementById('pathGroup');

            function updateFormFields() {
              const type = entType.value;
              modeGroup.classList.toggle('hidden', type !== 'network');
              nameGroup.classList.toggle('hidden', type !== 'persist');
              pathGroup.classList.toggle('hidden', type !== 'persist');
            }

            entType.addEventListener('change', updateFormFields);

            document.getElementById('addBtn').addEventListener('click', () => {
              editIndex = -1;
              modalTitle.textContent = 'Add Entitlement';
              entType.value = 'network';
              entMode.value = 'host';
              entName.value = '';
              entPath.value = '';
              updateFormFields();
              modal.classList.add('active');
            });

            document.getElementById('cancelBtn').addEventListener('click', () => {
              modal.classList.remove('active');
            });

            document.getElementById('saveBtn').addEventListener('click', () => {
              const entitlement = { type: entType.value };

              if (entType.value === 'network') {
                entitlement.mode = entMode.value;
              } else if (entType.value === 'persist') {
                entitlement.name = entName.value || 'data';
                entitlement.path = entPath.value || '/data';
              }

              if (editIndex >= 0) {
                vscode.postMessage({ command: 'updateEntitlement', index: editIndex, entitlement });
              } else {
                vscode.postMessage({ command: 'addEntitlement', entitlement });
              }

              modal.classList.remove('active');
            });

            document.querySelectorAll('.edit-btn').forEach(btn => {
              btn.addEventListener('click', () => {
                editIndex = parseInt(btn.dataset.index);
                const ent = entitlements[editIndex];
                modalTitle.textContent = 'Edit Entitlement';
                entType.value = ent.type;
                entMode.value = ent.mode || 'host';
                entName.value = ent.name || '';
                entPath.value = ent.path || '';
                updateFormFields();
                modal.classList.add('active');
              });
            });

            document.querySelectorAll('.delete-btn').forEach(btn => {
              btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                vscode.postMessage({ command: 'removeEntitlement', index });
              });
            });

            // Close modal on overlay click
            modal.addEventListener('click', (e) => {
              if (e.target === modal) {
                modal.classList.remove('active');
              }
            });
          </script>
        </body>
      </html>
    `;
  }
}
