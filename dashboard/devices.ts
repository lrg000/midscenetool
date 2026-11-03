import {
  getConnectedDevices,
  getConnectedDevicesWithDetails,
  type AndroidConnectedDevice,
} from '@midscene/android';

export interface DashboardDevice {
  udid: string;
  state: string;
  model?: string;
  brand?: string;
  resolution?: string;
  density?: number;
  label: string;
  usable: boolean;
}

function toDashboardDevice(device: AndroidConnectedDevice | { udid: string; state?: string }): DashboardDevice {
  const state = device.state ?? 'unknown';
  const model = 'model' in device ? device.model : undefined;
  const brand = 'brand' in device ? device.brand : undefined;
  const resolution = 'resolution' in device ? device.resolution : undefined;
  const density = 'density' in device ? device.density : undefined;
  const name = model
    ? brand && !String(model).toLowerCase().includes(String(brand).toLowerCase())
      ? `${brand} ${model}`
      : String(model)
    : device.udid;
  return {
    udid: device.udid,
    state,
    model,
    brand,
    resolution,
    density,
    label: name,
    usable: state === 'device',
  };
}

/** 列出当前 ADB 已连接设备（含机型等详情；失败时回退到简表）。 */
export async function listDashboardDevices(): Promise<DashboardDevice[]> {
  try {
    const detailed = await getConnectedDevicesWithDetails();
    return detailed.map(toDashboardDevice);
  } catch {
    const basic = await getConnectedDevices();
    return basic.map((d) => toDashboardDevice(d));
  }
}
