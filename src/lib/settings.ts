export type SettingsData = {
  apiVersion: string;
  cacheDirPath: string;
  cacheTtl: number;
  logLevel: string;
  proxyUrl: string;
};

export const defaultSettings: SettingsData = {
  apiVersion: "v-1-16-0",
  cacheDirPath: "views.cache",
  cacheTtl: 86400000,
  logLevel: "info",
  proxyUrl: "",
};
