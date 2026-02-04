import * as vscode from "vscode";
import { spawn, ChildProcess } from "child_process";
import { WendyCLI } from "../wendy-cli/wendy-cli";

export interface TelemetryLog {
  type: "log";
  timestamp: string;
  timestampNano?: number;
  service: string;
  severity: string;
  severityNumber: number;
  body: string;
  attributes?: Record<string, string>;
  resource?: Record<string, string>;
}

export interface TelemetryMetric {
  type: "metric";
  timestamp: string;
  service: string;
  name: string;
  value: number;
  metricType: string;
  unit?: string;
  attributes?: Record<string, string>;
}

export interface TelemetrySpan {
  type: "span";
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: string;
  startTime: string;
  endTime: string;
  startTimeNano: number;
  endTimeNano: number;
  durationMs: number;
  status: {
    code: string;
    message?: string;
  };
  service: string;
  events?: Array<{ name: string; timestamp: string; timestampNano?: number }>;
  attributes?: Record<string, string>;
  resource?: Record<string, string>;
}

export interface TelemetryError {
  type: "error";
  timestamp: string;
  message: string;
}

export type TelemetryData = TelemetryLog | TelemetryMetric | TelemetrySpan | TelemetryError;

export class TelemetryDashboardProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private process: ChildProcess | undefined;
  private deviceAddress: string;
  private disposables: vscode.Disposable[] = [];
  private buffer: string = "";

  constructor(
    private readonly extensionUri: vscode.Uri,
    deviceAddress: string
  ) {
    this.deviceAddress = deviceAddress;
  }

  async show(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "wendyTelemetryDashboard",
      `Telemetry: ${this.deviceAddress}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.webview.html = this.getHtmlContent();

    this.panel.onDidDispose(() => {
      this.dispose();
    }, null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "clear":
            // Clear is handled in webview
            break;
          case "pause":
            this.stopStream();
            break;
          case "resume":
            await this.startStream();
            break;
          case "filter":
            // Filters are handled in webview
            break;
        }
      },
      null,
      this.disposables
    );

    await this.startStream();
  }

  private async startStream(): Promise<void> {
    const cli = await WendyCLI.create();
    if (!cli) {
      this.sendError("Wendy CLI not found");
      return;
    }

    // Stop any existing stream
    this.stopStream();

    // Start the telemetry stream
    this.process = spawn(cli.path, [
      "device", "telemetry-stream",
      "--device", this.deviceAddress,
      "--logs",
      "--metrics",
      "--traces"
    ]);

    this.buffer = "";

    this.process.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      console.error("Telemetry stream error:", data.toString());
    });

    this.process.on("close", (code) => {
      if (code !== 0 && code !== null) {
        this.sendError(`Telemetry stream exited with code ${code}`);
      }
    });

    this.process.on("error", (err) => {
      this.sendError(`Failed to start telemetry stream: ${err.message}`);
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    // Keep the last incomplete line in buffer
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        try {
          const data = JSON.parse(line) as TelemetryData;
          this.sendTelemetryData(data);
        } catch (e) {
          // Skip non-JSON lines
        }
      }
    }
  }

  private stopStream(): void {
    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }
  }

  private sendTelemetryData(data: TelemetryData): void {
    this.panel?.webview.postMessage({ type: "telemetry", data });
  }

  private sendError(message: string): void {
    this.panel?.webview.postMessage({ type: "error", message });
  }

  private getHtmlContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Telemetry Dashboard</title>
  <style>
    :root {
      --bg-color: var(--vscode-editor-background, #1e1e1e);
      --text-color: var(--vscode-editor-foreground, #d4d4d4);
      --border-color: var(--vscode-panel-border, #454545);
      --header-bg: var(--vscode-sideBarSectionHeader-background, #383838);
      --input-bg: var(--vscode-input-background, #3c3c3c);
      --input-border: var(--vscode-input-border, #3c3c3c);
      --button-bg: var(--vscode-button-background, #0e639c);
      --button-fg: var(--vscode-button-foreground, #ffffff);
      --button-hover: var(--vscode-button-hoverBackground, #1177bb);
      --log-trace: #808080;
      --log-debug: #6a9955;
      --log-info: #4fc1ff;
      --log-warn: #ce9178;
      --log-error: #f14c4c;
      --log-fatal: #ff0000;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
      font-size: var(--vscode-font-size, 13px);
      background: var(--bg-color);
      color: var(--text-color);
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .toolbar {
      display: flex;
      gap: 8px;
      padding: 8px 12px;
      background: var(--header-bg);
      border-bottom: 1px solid var(--border-color);
      align-items: center;
      flex-wrap: wrap;
    }

    .toolbar-group {
      display: flex;
      gap: 4px;
      align-items: center;
    }

    .toolbar label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
      margin-right: 4px;
    }

    button {
      background: var(--button-bg);
      color: var(--button-fg);
      border: none;
      padding: 4px 12px;
      cursor: pointer;
      font-size: 12px;
      border-radius: 2px;
    }

    button:hover {
      background: var(--button-hover);
    }

    button.secondary {
      background: transparent;
      border: 1px solid var(--border-color);
      color: var(--text-color);
    }

    button.secondary:hover {
      background: var(--header-bg);
    }

    button.active {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
    }

    select, input[type="text"] {
      background: var(--input-bg);
      color: var(--text-color);
      border: 1px solid var(--input-border);
      padding: 4px 8px;
      font-size: 12px;
      border-radius: 2px;
    }

    select:focus, input[type="text"]:focus {
      outline: 1px solid var(--vscode-focusBorder, #007fd4);
    }

    .tabs {
      display: flex;
      background: var(--header-bg);
      border-bottom: 1px solid var(--border-color);
    }

    .tab {
      padding: 8px 16px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      color: var(--vscode-descriptionForeground, #888);
      font-size: 12px;
    }

    .tab:hover {
      color: var(--text-color);
    }

    .tab.active {
      color: var(--text-color);
      border-bottom-color: var(--vscode-focusBorder, #007fd4);
    }

    .content {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .panel {
      display: none;
      flex: 1;
      overflow: hidden;
    }

    .panel.active {
      display: flex;
      flex-direction: column;
    }

    /* Logs Panel */
    .logs-container {
      flex: 1;
      overflow-y: auto;
      font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
      font-size: 12px;
      padding: 8px;
    }

    .log-entry {
      display: flex;
      padding: 2px 4px;
      border-radius: 2px;
      gap: 8px;
      line-height: 1.4;
    }

    .log-entry:hover {
      background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
    }

    .log-timestamp {
      color: var(--vscode-descriptionForeground, #888);
      white-space: nowrap;
      min-width: 90px;
    }

    .log-severity {
      min-width: 50px;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 10px;
    }

    .log-severity.trace { color: var(--log-trace); }
    .log-severity.debug { color: var(--log-debug); }
    .log-severity.info { color: var(--log-info); }
    .log-severity.warn { color: var(--log-warn); }
    .log-severity.error { color: var(--log-error); }
    .log-severity.fatal { color: var(--log-fatal); }

    .log-service {
      color: var(--vscode-textLink-foreground, #3794ff);
      min-width: 100px;
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .log-body {
      flex: 1;
      word-break: break-word;
    }

    .log-attributes {
      color: var(--vscode-descriptionForeground, #888);
      font-size: 11px;
      margin-left: 8px;
    }

    /* Metrics Panel */
    .metrics-container {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }

    .metric-card {
      background: var(--header-bg);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 16px;
      transition: border-color 0.15s ease;
    }

    .metric-card:hover {
      border-color: var(--vscode-focusBorder, #007fd4);
    }

    .metric-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 8px;
    }

    .metric-name {
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #888);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .metric-service {
      font-size: 10px;
      color: var(--vscode-textLink-foreground, #3794ff);
    }

    .metric-value {
      font-size: 32px;
      font-weight: 600;
      color: var(--text-color);
      line-height: 1.1;
    }

    .metric-unit {
      font-size: 14px;
      font-weight: 400;
      color: var(--vscode-descriptionForeground, #888);
      margin-left: 4px;
    }

    .metric-type {
      display: inline-block;
      font-size: 10px;
      color: var(--vscode-descriptionForeground, #888);
      background: var(--vscode-badge-background, rgba(255,255,255,0.1));
      padding: 2px 6px;
      border-radius: 3px;
      margin-top: 6px;
    }

    .metric-sparkline {
      height: 40px;
      margin-top: 8px;
    }

    .metric-sparkline svg {
      width: 100%;
      height: 100%;
    }

    .metric-sparkline polyline {
      fill: none;
      stroke: var(--vscode-charts-blue, #4fc1ff);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .metric-sparkline .area {
      fill: url(#sparkline-gradient);
      opacity: 0.3;
    }

    /* Status bar */
    .status-bar {
      display: flex;
      justify-content: space-between;
      padding: 4px 12px;
      background: var(--header-bg);
      border-top: 1px solid var(--border-color);
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
    }

    .status-indicator {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #888;
    }

    .status-dot.connected {
      background: var(--log-debug);
    }

    .status-dot.disconnected {
      background: var(--log-error);
    }

    .error-message {
      background: rgba(244, 76, 76, 0.1);
      border: 1px solid var(--log-error);
      color: var(--log-error);
      padding: 8px 12px;
      margin: 8px;
      border-radius: 4px;
    }

    /* Traces Panel */
    .traces-container {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
      font-size: 12px;
    }

    .trace-entry {
      border: 1px solid var(--border-color);
      border-radius: 4px;
      margin-bottom: 8px;
      background: var(--header-bg);
    }

    .trace-header {
      display: flex;
      align-items: center;
      padding: 8px 12px;
      gap: 12px;
      cursor: pointer;
    }

    .trace-header:hover {
      background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
    }

    .trace-name {
      font-weight: 600;
      flex: 1;
    }

    .trace-duration {
      color: var(--vscode-charts-yellow, #cca700);
      font-weight: 600;
    }

    .trace-status {
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .trace-status.ok {
      background: rgba(106, 153, 85, 0.2);
      color: var(--log-debug);
    }

    .trace-status.error {
      background: rgba(244, 76, 76, 0.2);
      color: var(--log-error);
    }

    .trace-status.unset {
      background: rgba(128, 128, 128, 0.2);
      color: var(--log-trace);
    }

    .trace-ids {
      font-size: 10px;
      color: var(--vscode-descriptionForeground, #888);
    }

    .trace-details {
      display: none;
      padding: 8px 12px;
      border-top: 1px solid var(--border-color);
    }

    .trace-entry.expanded .trace-details {
      display: block;
    }

    .trace-expand-icon {
      color: var(--vscode-descriptionForeground, #888);
      transition: transform 0.2s;
    }

    .trace-entry.expanded .trace-expand-icon {
      transform: rotate(90deg);
    }

    .trace-events {
      margin-top: 8px;
    }

    .trace-event {
      display: flex;
      gap: 12px;
      padding: 4px 0;
      color: var(--vscode-descriptionForeground, #888);
    }

    .trace-event-name {
      color: var(--text-color);
    }

    .trace-attributes {
      margin-top: 8px;
    }

    .trace-attribute {
      display: flex;
      gap: 8px;
      padding: 2px 0;
    }

    .trace-attribute-key {
      color: var(--vscode-descriptionForeground, #888);
      min-width: 120px;
    }

    .trace-attribute-value {
      color: var(--text-color);
    }

    .trace-service {
      color: var(--vscode-textLink-foreground, #3794ff);
      font-size: 11px;
    }

    .trace-timeline {
      height: 4px;
      background: var(--border-color);
      border-radius: 2px;
      margin-top: 8px;
      position: relative;
      overflow: hidden;
    }

    .trace-timeline-bar {
      height: 100%;
      background: var(--vscode-charts-blue, #4fc1ff);
      border-radius: 2px;
    }

    .trace-timing {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border-color);
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-group">
      <button id="pauseBtn" class="secondary">Pause</button>
      <button id="clearBtn" class="secondary">Clear</button>
    </div>
    <div class="toolbar-group">
      <label>Level:</label>
      <select id="levelFilter">
        <option value="all">All</option>
        <option value="trace">Trace+</option>
        <option value="debug">Debug+</option>
        <option value="info" selected>Info+</option>
        <option value="warn">Warn+</option>
        <option value="error">Error+</option>
      </select>
    </div>
    <div class="toolbar-group">
      <label>Service:</label>
      <select id="serviceFilter">
        <option value="all">All Services</option>
      </select>
    </div>
    <div class="toolbar-group">
      <label>Search:</label>
      <input type="text" id="searchFilter" placeholder="Filter logs...">
    </div>
  </div>

  <div class="tabs">
    <div class="tab active" data-panel="logs">Logs</div>
    <div class="tab" data-panel="metrics">Metrics</div>
    <div class="tab" data-panel="traces">Traces</div>
  </div>

  <div class="content">
    <div id="logsPanel" class="panel active">
      <div id="logsContainer" class="logs-container"></div>
    </div>
    <div id="metricsPanel" class="panel">
      <div class="metrics-container">
        <div id="metricsGrid" class="metrics-grid"></div>
      </div>
    </div>
    <div id="tracesPanel" class="panel">
      <div id="tracesContainer" class="traces-container"></div>
    </div>
  </div>

  <div class="status-bar">
    <div class="status-indicator">
      <span id="statusDot" class="status-dot connected"></span>
      <span id="statusText">Connected</span>
    </div>
    <div id="stats">
      <span id="logCount">0</span> logs | <span id="metricCount">0</span> metrics | <span id="traceCount">0</span> traces
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // State
    let isPaused = false;
    let logs = [];
    let metrics = new Map(); // name -> { data: TelemetryMetric, history: number[] }
    let traces = []; // Array of spans
    let services = new Set();
    const maxLogs = 1000;
    const maxTraces = 500;
    const maxHistory = 50;

    // Severity levels (higher = more severe)
    const severityLevels = {
      'trace': 1,
      'debug': 5,
      'info': 9,
      'warn': 13,
      'error': 17,
      'fatal': 21
    };

    // Elements
    const logsContainer = document.getElementById('logsContainer');
    const metricsGrid = document.getElementById('metricsGrid');
    const tracesContainer = document.getElementById('tracesContainer');
    const pauseBtn = document.getElementById('pauseBtn');
    const clearBtn = document.getElementById('clearBtn');
    const levelFilter = document.getElementById('levelFilter');
    const serviceFilter = document.getElementById('serviceFilter');
    const searchFilter = document.getElementById('searchFilter');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const logCount = document.getElementById('logCount');
    const metricCount = document.getElementById('metricCount');
    const traceCount = document.getElementById('traceCount');

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.panel + 'Panel').classList.add('active');
      });
    });

    // Pause/Resume
    pauseBtn.addEventListener('click', () => {
      isPaused = !isPaused;
      pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
      pauseBtn.classList.toggle('active', isPaused);
      statusDot.classList.toggle('connected', !isPaused);
      statusDot.classList.toggle('disconnected', isPaused);
      statusText.textContent = isPaused ? 'Paused' : 'Connected';
      vscode.postMessage({ command: isPaused ? 'pause' : 'resume' });
    });

    // Clear
    clearBtn.addEventListener('click', () => {
      logs = [];
      metrics.clear();
      traces = [];
      services.clear();
      logsContainer.innerHTML = '';
      metricsGrid.innerHTML = '';
      tracesContainer.innerHTML = '';
      updateServiceFilter();
      updateStats();
    });

    // Filters
    levelFilter.addEventListener('change', renderLogs);
    serviceFilter.addEventListener('change', renderLogs);
    searchFilter.addEventListener('input', renderLogs);

    function updateServiceFilter() {
      const current = serviceFilter.value;
      serviceFilter.innerHTML = '<option value="all">All Services</option>';
      Array.from(services).sort().forEach(service => {
        const opt = document.createElement('option');
        opt.value = service;
        opt.textContent = service;
        serviceFilter.appendChild(opt);
      });
      serviceFilter.value = current;
    }

    function formatTime(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }) + '.' + String(date.getMilliseconds()).padStart(3, '0');
    }

    function getSeverityClass(severity) {
      const s = (severity || 'info').toLowerCase();
      if (s.includes('trace')) return 'trace';
      if (s.includes('debug')) return 'debug';
      if (s.includes('info')) return 'info';
      if (s.includes('warn')) return 'warn';
      if (s.includes('error')) return 'error';
      if (s.includes('fatal')) return 'fatal';
      return 'info';
    }

    function getSeverityNumber(severity) {
      const s = getSeverityClass(severity);
      return severityLevels[s] || 9;
    }

    function shouldShowLog(log) {
      // Level filter
      const minLevel = severityLevels[levelFilter.value] || 0;
      const logLevel = log.severityNumber || getSeverityNumber(log.severity);
      if (minLevel > 0 && logLevel < minLevel) return false;

      // Service filter
      if (serviceFilter.value !== 'all' && log.service !== serviceFilter.value) return false;

      // Search filter
      const search = searchFilter.value.toLowerCase();
      if (search) {
        const searchable = (log.body + ' ' + log.service + ' ' + JSON.stringify(log.attributes || {})).toLowerCase();
        if (!searchable.includes(search)) return false;
      }

      return true;
    }

    function renderLogs() {
      const fragment = document.createDocumentFragment();
      const filteredLogs = logs.filter(shouldShowLog);

      filteredLogs.forEach(log => {
        const entry = document.createElement('div');
        entry.className = 'log-entry';

        const severityClass = getSeverityClass(log.severity);
        const attrs = log.attributes ? Object.entries(log.attributes)
          .filter(([k]) => k !== 'code.namespace')
          .map(([k, v]) => k + '=' + v)
          .join(' ') : '';

        entry.innerHTML = \`
          <span class="log-timestamp">\${formatTime(log.timestamp)}</span>
          <span class="log-severity \${severityClass}">\${severityClass}</span>
          <span class="log-service" title="\${log.service}">\${log.service}</span>
          <span class="log-body">\${escapeHtml(log.body)}\${attrs ? '<span class="log-attributes">' + escapeHtml(attrs) + '</span>' : ''}</span>
        \`;

        fragment.appendChild(entry);
      });

      logsContainer.innerHTML = '';
      logsContainer.appendChild(fragment);

      // Auto-scroll to bottom if not paused
      if (!isPaused) {
        logsContainer.scrollTop = logsContainer.scrollHeight;
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function formatMetricValue(value, unit) {
      if (typeof value !== 'number') return String(value);

      // Handle percentages
      if (unit === '%' || unit === 'percent') {
        return value.toFixed(1);
      }

      // Handle bytes
      if (unit === 'bytes' || unit === 'B') {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0;
        while (value >= 1024 && i < units.length - 1) {
          value /= 1024;
          i++;
        }
        return value.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
      }

      // Handle large numbers
      if (value >= 1000000) {
        return (value / 1000000).toFixed(1) + 'M';
      }
      if (value >= 1000) {
        return (value / 1000).toFixed(1) + 'K';
      }

      // Default formatting
      if (Number.isInteger(value)) {
        return String(value);
      }
      return value.toFixed(2);
    }

    function createSparkline(history) {
      if (history.length < 2) return '';

      const width = 200;
      const height = 40;
      const padding = 4;

      const min = Math.min(...history);
      const max = Math.max(...history);
      const range = max - min || 1;

      const points = history.map((v, i) => {
        const x = padding + (i / (history.length - 1)) * (width - padding * 2);
        const y = height - padding - ((v - min) / range) * (height - padding * 2);
        return \`\${x},\${y}\`;
      }).join(' ');

      const areaPoints = points + \` \${width - padding},\${height - padding} \${padding},\${height - padding}\`;

      return \`
        <svg viewBox="0 0 \${width} \${height}" preserveAspectRatio="none">
          <defs>
            <linearGradient id="sparkline-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" style="stop-color:var(--vscode-charts-blue, #4fc1ff);stop-opacity:0.4"/>
              <stop offset="100%" style="stop-color:var(--vscode-charts-blue, #4fc1ff);stop-opacity:0.05"/>
            </linearGradient>
          </defs>
          <polygon class="area" points="\${areaPoints}"/>
          <polyline points="\${points}"/>
        </svg>
      \`;
    }

    function renderMetrics() {
      const fragment = document.createDocumentFragment();

      const sortedMetrics = Array.from(metrics.entries()).sort((a, b) => a[0].localeCompare(b[0]));

      sortedMetrics.forEach(([name, { data, history }]) => {
        const card = document.createElement('div');
        card.className = 'metric-card';
        card.dataset.name = name;

        const formattedValue = formatMetricValue(data.value, data.unit);
        const displayUnit = data.unit && !formattedValue.includes(data.unit) ? data.unit : '';

        card.innerHTML = \`
          <div class="metric-header">
            <span class="metric-name" title="\${name}">\${name}</span>
            <span class="metric-service">\${data.service}</span>
          </div>
          <div class="metric-value">\${formattedValue}<span class="metric-unit">\${displayUnit}</span></div>
          <div class="metric-type">\${data.metricType || 'gauge'}</div>
          <div class="metric-sparkline">\${createSparkline(history)}</div>
        \`;

        fragment.appendChild(card);
      });

      metricsGrid.innerHTML = '';
      metricsGrid.appendChild(fragment);
    }

    function updateMetricCard(name) {
      const existing = metricsGrid.querySelector(\`[data-name="\${CSS.escape(name)}"]\`);
      const metricData = metrics.get(name);

      if (!metricData) return;

      const { data, history } = metricData;
      const formattedValue = formatMetricValue(data.value, data.unit);
      const displayUnit = data.unit && !formattedValue.includes(data.unit) ? data.unit : '';

      if (existing) {
        existing.querySelector('.metric-value').innerHTML = \`\${formattedValue}<span class="metric-unit">\${displayUnit}</span>\`;
        existing.querySelector('.metric-sparkline').innerHTML = createSparkline(history);
      } else {
        renderMetrics();
      }
    }

    function updateStats() {
      logCount.textContent = logs.length;
      metricCount.textContent = metrics.size;
      traceCount.textContent = traces.length;
    }

    function formatDuration(ms) {
      if (ms < 1) {
        return (ms * 1000).toFixed(0) + 'μs';
      }
      if (ms < 1000) {
        return ms.toFixed(2) + 'ms';
      }
      return (ms / 1000).toFixed(2) + 's';
    }

    function renderTraceEntry(span) {
      const entry = document.createElement('div');
      entry.className = 'trace-entry';
      entry.dataset.spanId = span.spanId;

      // Handle status as object with code property
      const statusCode = span.status?.code || span.status || 'unset';
      const statusClass = statusCode.toLowerCase();
      const statusMessage = span.status?.message;
      const hasEvents = span.events && span.events.length > 0;
      const hasAttributes = span.attributes && Object.keys(span.attributes).length > 0;

      let detailsHtml = '';

      // Add timing info
      detailsHtml += \`<div class="trace-timing">
        <strong>Start:</strong> \${span.startTime ? formatTime(span.startTime) : 'N/A'} |
        <strong>End:</strong> \${span.endTime ? formatTime(span.endTime) : 'N/A'} |
        <strong>Kind:</strong> \${span.kind || 'unspecified'}
      </div>\`;

      if (hasEvents) {
        const eventsHtml = span.events.map(e => \`
          <div class="trace-event">
            <span class="trace-event-time">\${formatTime(e.timestamp)}</span>
            <span class="trace-event-name">\${escapeHtml(e.name)}</span>
          </div>
        \`).join('');
        detailsHtml += \`<div class="trace-events"><strong>Events:</strong>\${eventsHtml}</div>\`;
      }

      if (hasAttributes) {
        const attrsHtml = Object.entries(span.attributes).map(([k, v]) => \`
          <div class="trace-attribute">
            <span class="trace-attribute-key">\${escapeHtml(k)}:</span>
            <span class="trace-attribute-value">\${escapeHtml(String(v))}</span>
          </div>
        \`).join('');
        detailsHtml += \`<div class="trace-attributes"><strong>Attributes:</strong>\${attrsHtml}</div>\`;
      }

      entry.innerHTML = \`
        <div class="trace-header">
          <span class="trace-expand-icon">▶</span>
          <span class="trace-name">\${escapeHtml(span.name)}</span>
          <span class="trace-service">\${escapeHtml(span.service || '')}</span>
          <span class="trace-duration">\${formatDuration(span.durationMs)}</span>
          <span class="trace-status \${statusClass}">\${statusCode}\${statusMessage ? ': ' + escapeHtml(statusMessage) : ''}</span>
        </div>
        <div class="trace-details">
          <div class="trace-ids">
            <strong>Trace ID:</strong> \${span.traceId}<br>
            <strong>Span ID:</strong> \${span.spanId}
            \${span.parentSpanId ? '<br><strong>Parent:</strong> ' + span.parentSpanId : ''}
          </div>
          \${detailsHtml}
        </div>
      \`;

      entry.querySelector('.trace-header').addEventListener('click', () => {
        entry.classList.toggle('expanded');
      });

      return entry;
    }

    // Message handler
    window.addEventListener('message', event => {
      const message = event.data;

      if (message.type === 'telemetry') {
        const data = message.data;

        if (data.type === 'log') {
          // Add service to filter
          if (data.service && !services.has(data.service)) {
            services.add(data.service);
            updateServiceFilter();
          }

          // Add log
          logs.push(data);
          if (logs.length > maxLogs) {
            logs.shift();
          }

          // Render if visible and matches filter
          if (!isPaused && shouldShowLog(data)) {
            const entry = document.createElement('div');
            entry.className = 'log-entry';

            const severityClass = getSeverityClass(data.severity);
            const attrs = data.attributes ? Object.entries(data.attributes)
              .filter(([k]) => k !== 'code.namespace')
              .map(([k, v]) => k + '=' + v)
              .join(' ') : '';

            entry.innerHTML = \`
              <span class="log-timestamp">\${formatTime(data.timestamp)}</span>
              <span class="log-severity \${severityClass}">\${severityClass}</span>
              <span class="log-service" title="\${data.service}">\${data.service}</span>
              <span class="log-body">\${escapeHtml(data.body)}\${attrs ? '<span class="log-attributes">' + escapeHtml(attrs) + '</span>' : ''}</span>
            \`;

            logsContainer.appendChild(entry);

            // Trim rendered logs
            while (logsContainer.children.length > maxLogs) {
              logsContainer.removeChild(logsContainer.firstChild);
            }

            logsContainer.scrollTop = logsContainer.scrollHeight;
          }

          updateStats();
        }

        if (data.type === 'metric') {
          const key = data.name;
          const existing = metrics.get(key);

          if (existing) {
            existing.data = data;
            existing.history.push(data.value);
            if (existing.history.length > maxHistory) {
              existing.history.shift();
            }
          } else {
            metrics.set(key, {
              data: data,
              history: [data.value]
            });
          }

          updateMetricCard(key);
          updateStats();
        }

        if (data.type === 'span') {
          // Add service to filter if present
          if (data.service && !services.has(data.service)) {
            services.add(data.service);
            updateServiceFilter();
          }

          // Add trace
          traces.unshift(data); // Add to beginning (newest first)
          if (traces.length > maxTraces) {
            traces.pop();
          }

          // Render if not paused
          if (!isPaused) {
            const entry = renderTraceEntry(data);
            tracesContainer.insertBefore(entry, tracesContainer.firstChild);

            // Trim rendered traces
            while (tracesContainer.children.length > maxTraces) {
              tracesContainer.removeChild(tracesContainer.lastChild);
            }
          }

          updateStats();
        }
      }

      if (message.type === 'error') {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message.message;
        logsContainer.insertBefore(errorDiv, logsContainer.firstChild);

        statusDot.classList.remove('connected');
        statusDot.classList.add('disconnected');
        statusText.textContent = 'Error';
      }
    });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    this.stopStream();
    this.panel?.dispose();
    this.panel = undefined;
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}
