import type { SettingsData } from "$lib/settings";
import { isTauri } from "$lib/platform";

const SETTINGS_KEY = "takealot.settings";
const CACHE_PREFIX = "takealot.cache";

export async function loadSettings(): Promise<SettingsData | null> {
  if (!isTauri) {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? (JSON.parse(raw) as SettingsData) : null;
    } catch {
      return null;
    }
  }

  try {
    const { BaseDirectory, readTextFile } = await import(
      "@tauri-apps/plugin-fs"
    );
    const content = await readTextFile("settings.json", {
      baseDir: BaseDirectory.AppData,
    });
    return JSON.parse(content) as SettingsData;
  } catch {
    return null;
  }
}

export async function saveSettings(settings: SettingsData): Promise<void> {
  if (!isTauri) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return;
  }

  const { BaseDirectory, writeTextFile, mkdir, exists } = await import(
    "@tauri-apps/plugin-fs"
  );
  const appDataExists = await exists("", { baseDir: BaseDirectory.AppData });
  if (!appDataExists) {
    await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
  }
  await writeTextFile("settings.json", JSON.stringify(settings, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

export async function loadCacheEntry<T>(
  cacheDir: string,
  key: string
): Promise<T | null> {
  if (!isTauri) {
    try {
      const raw = localStorage.getItem(`${CACHE_PREFIX}:${cacheDir}:${key}`);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  try {
    const { BaseDirectory, readTextFile } = await import(
      "@tauri-apps/plugin-fs"
    );
    const content = await readTextFile(`${cacheDir}/${key}.json`, {
      baseDir: BaseDirectory.AppData,
    });
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export async function saveCacheEntry<T>(
  cacheDir: string,
  key: string,
  entry: T
): Promise<void> {
  if (!isTauri) {
    try {
      localStorage.setItem(
        `${CACHE_PREFIX}:${cacheDir}:${key}`,
        JSON.stringify(entry)
      );
    } catch {
      // Ignore storage failures in the browser.
    }
    return;
  }

  try {
    const { BaseDirectory, writeTextFile, mkdir, exists } = await import(
      "@tauri-apps/plugin-fs"
    );
    const dirExists = await exists(cacheDir, {
      baseDir: BaseDirectory.AppData,
    });
    if (!dirExists) {
      await mkdir(cacheDir, {
        baseDir: BaseDirectory.AppData,
        recursive: true,
      });
    }
    await writeTextFile(`${cacheDir}/${key}.json`, JSON.stringify(entry), {
      baseDir: BaseDirectory.AppData,
    });
  } catch (err) {
    console.error(`Failed to save cache for ${key}:`, err);
  }
}
