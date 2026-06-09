/**
 * Represents a Wendy device that can be connected to.
 */
export class Device {
  /**
   * Hardware/product type reported by `wendy device info` (e.g. "Jetson Nano", "Raspberry Pi 4").
   * Populated asynchronously after the device is discovered.
   */
  public deviceType: string | undefined;

  /**
   * Root filesystem bytes currently used on the device.
   * Only present when the agent can inspect disk usage (field added in CLI PR #919).
   */
  public diskUsedBytes: number | undefined;

  /**
   * Root filesystem total bytes on the device.
   * Only present when the agent can inspect disk usage (field added in CLI PR #919).
   */
  public diskTotalBytes: number | undefined;

  constructor(
    /**
     * Unique identifier for the device
     */
    public readonly id: string,

    /**
     * Network address in hostname or hostname:port format
     */
    public readonly address: string,

    /**
     * Name of the device
     */
    public readonly name: string,

    /**
     * Version of the WendyOS agent running on the device
     */
    public readonly agentVersion: string | undefined,

    /**
     * Connection mechanism — used for context-menu routing (LAN, BLE, Custom, …)
     */
    public readonly connectionType: "Ethernet" | "USB" | "LAN" | "BLE" | "Docker" | "Local" | "External" | "Custom"
  ) {}

  /**
   * Returns a human-readable disk usage string in the same format as the CLI
   * human output: e.g. "2.34 GB / 120 GB".
   * Returns undefined when either byte count is not available.
   */
  get diskUsageLabel(): string | undefined {
    if (this.diskUsedBytes === undefined || this.diskTotalBytes === undefined) {
      return undefined;
    }
    return `${formatGigabytes(this.diskUsedBytes)} / ${formatGigabytes(this.diskTotalBytes)}`;
  }
}

/**
 * Formats a byte count as a compact gigabyte string using SI units (powers of 1000),
 * mirroring the `formatGigabytes` helper used by the CLI (go/internal/cli/commands/bytes_format.go).
 * Trailing zeros after the decimal point are trimmed (e.g. "120.00 GB" → "120 GB").
 */
function formatGigabytes(bytes: number): string {
  const gb = (bytes / 1_000_000_000).toFixed(2).replace(/\.?0+$/, "");
  return `${gb} GB`;
}
