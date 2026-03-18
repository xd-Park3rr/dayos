import { DeviceEventEmitter, NativeModules, type EmitterSubscription } from 'react-native';
import { getDb } from '../../db/client';
import { bus } from '../../events/bus';

type BluetoothDeviceEvent = {
  device?: {
    name?: string;
    address?: string;
  };
};

type NativeBluetoothModule = {
  isBluetoothAvailable: () => Promise<boolean>;
  getBondedDevices: () => Promise<any[]>;
};

type BluetoothModule = NativeBluetoothModule & {
  onDeviceConnected: (listener: (event: BluetoothDeviceEvent) => void) => EmitterSubscription;
  onDeviceDisconnected: (listener: (event: BluetoothDeviceEvent) => void) => EmitterSubscription;
};

const loadBluetoothModule = (): BluetoothModule | null => {
  const nativeModule = NativeModules.RNBluetoothClassic as NativeBluetoothModule | undefined;
  if (!nativeModule || typeof nativeModule.isBluetoothAvailable !== 'function') {
    console.warn('[BT Context] Bluetooth native module is unavailable in this runtime.');
    return null;
  }

  return {
    ...nativeModule,
    onDeviceConnected: (listener) => DeviceEventEmitter.addListener('deviceConnected', listener),
    onDeviceDisconnected: (listener) =>
      DeviceEventEmitter.addListener('deviceDisconnected', listener),
  };
};

export const bluetoothContext = {
  startMonitoring: async () => {
    try {
      const RNBluetoothClassic = loadBluetoothModule();
      if (!RNBluetoothClassic) {
        return;
      }

      const available = await RNBluetoothClassic.isBluetoothAvailable();
      if (!available) {
        console.warn('[BT Context] Bluetooth is not available on this device');
        return;
      }

      RNBluetoothClassic.onDeviceConnected((event: any) => {
        console.log(`[BT Context] Connected: ${event.device.name} (${event.device.address})`);
        
        const db = getDb();
        const mapping = db.getFirstSync<{target_activity_id: string, target_music_uri: string, auto_dnd: number}>(
          'SELECT * FROM bluetooth_device_map WHERE mac_address = ?',
          [event.device.address]
        );

        if (mapping) {
          bus.emit('context.updated', undefined);
          console.log('[BT Context] Recognized mapped device. Emitted context change.');
          
          // The contextEngine handles the actual transition, but we can also fire DND directly if needed,
          // though it's better to let contextEngine synthesize all signals.
        }
      });

      RNBluetoothClassic.onDeviceDisconnected((event: any) => {
        console.log(`[BT Context] Disconnected: ${event.device.name}`);
        bus.emit('context.updated', undefined);
      });
      
      console.log('[BT Context] Monitoring started.');
    } catch (e) {
      console.error('[BT Context] Failed to start:', e);
    }
  },
  
  getBondedDevices: async () => {
    try {
      const RNBluetoothClassic = loadBluetoothModule();
      if (!RNBluetoothClassic) {
        return [];
      }

      const devices = await RNBluetoothClassic.getBondedDevices();
      return devices;
    } catch (e) {
      console.error('Failed to get bonded devices', e);
      return [];
    }
  }
};
