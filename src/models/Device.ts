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
}
