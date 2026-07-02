/**
 * A single network interface reported by `wendy device info`.
 */
export interface NetworkInterface {
  /** Interface name (e.g. "eth0", "wlan0"). */
  name: string;
  /** Routable IPv4 and IPv6 addresses assigned to the interface. */
  ipAddresses: string[];
}

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
   * GPU architecture identifier reported by `wendy device info` (e.g. "sm_87" for NVIDIA Ampere).
   * Vendor-specific format. Populated asynchronously after the device is discovered.
   */
  public gpuArch: string | undefined;

  /**
   * Routable network interfaces reported by `wendy device info`.
   * Loopback, down, and container/virtual bridge interfaces are omitted.
   * Populated asynchronously after the device is discovered. Empty or undefined
   * when the agent does not support network interface enumeration.
   */
  public networkInterfaces: NetworkInterface[] | undefined;

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
   * Returns the best routable IP address for this device, preferring IPv4 over
   * IPv6, across all reported network interfaces. Returns undefined when no
   * routable address is known. Mirrors the `bestReachableIP` logic in the CLI.
   */
  public bestReachableIP(): string | undefined {
    if (!this.networkInterfaces || this.networkInterfaces.length === 0) {
      return undefined;
    }
    let firstAny: string | undefined;
    for (const iface of this.networkInterfaces) {
      for (const addr of iface.ipAddresses) {
        // Simple IPv4 detection: contains a dot and no colon.
        if (addr.includes(".") && !addr.includes(":")) {
          return addr;
        }
        if (firstAny === undefined) {
          firstAny = addr;
        }
      }
    }
    return firstAny;
  }
}
