import { Linking, NativeModules } from 'react-native';

export type InstalledApp = {
  packageName: string;
  label: string;
};

type NativeAppControlModule = {
  listLaunchableApps(): Promise<InstalledApp[]>;
  launchApp(packageName: string): Promise<boolean>;
  getForegroundApp(): Promise<string | null>;
  openUsageAccessSettings(): Promise<boolean>;
  hasUsageAccess(): Promise<boolean>;
  openOverlaySettings(): Promise<boolean>;
  hasOverlayPermission(): Promise<boolean>;
  openAppSettings(packageName: string): Promise<boolean>;
};

const nativeModule = NativeModules.DayOSAppControl as NativeAppControlModule | undefined;

export const appControlService = {
  isAvailable: (): boolean => !!nativeModule,

  listInstalledApps: async (): Promise<InstalledApp[]> => {
    if (!nativeModule) {
      return [];
    }
    return nativeModule.listLaunchableApps();
  },

  searchInstalledApps: async (query: string): Promise<InstalledApp[]> => {
    const apps = await appControlService.listInstalledApps();
    const normalized = query.trim().toLowerCase();
    return apps.filter(
      (app) =>
        app.label.toLowerCase().includes(normalized) ||
        app.packageName.toLowerCase().includes(normalized)
    );
  },

  launchApp: async (packageName: string): Promise<boolean> => {
    if (!nativeModule) {
      return false;
    }
    return nativeModule.launchApp(packageName);
  },

  getForegroundApp: async (): Promise<string | null> => {
    if (!nativeModule) {
      return null;
    }
    return nativeModule.getForegroundApp();
  },

  hasUsageAccess: async (): Promise<boolean> => {
    if (!nativeModule) {
      return false;
    }
    return nativeModule.hasUsageAccess();
  },

  openUsageAccessSettings: async (): Promise<boolean> => {
    if (!nativeModule) {
      return false;
    }
    return nativeModule.openUsageAccessSettings();
  },

  hasOverlayPermission: async (): Promise<boolean> => {
    if (!nativeModule) {
      return false;
    }
    return nativeModule.hasOverlayPermission();
  },

  openOverlaySettings: async (): Promise<boolean> => {
    if (!nativeModule) {
      return false;
    }
    return nativeModule.openOverlaySettings();
  },

  openAppSettings: async (packageName: string): Promise<boolean> => {
    if (nativeModule) {
      return nativeModule.openAppSettings(packageName);
    }

    try {
      await Linking.openSettings();
      return true;
    } catch {
      return false;
    }
  },
};
