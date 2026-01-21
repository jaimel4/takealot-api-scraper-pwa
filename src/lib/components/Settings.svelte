<script lang="ts">
  import { defaultSettings, type SettingsData } from "$lib/settings";
  import { loadSettings, saveSettings } from "$lib/storage";

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSave: (settings: SettingsData) => void;
  }

  let { isOpen, onClose, onSave }: Props = $props();

  let apiVersion = $state(defaultSettings.apiVersion);
  let cacheDirPath = $state(defaultSettings.cacheDirPath);
  let cacheTtl = $state(defaultSettings.cacheTtl);
  let logLevel = $state(defaultSettings.logLevel);
  let proxyUrl = $state(defaultSettings.proxyUrl);

  let saving = $state(false);
  let error = $state<string | null>(null);
  let success = $state(false);

  const logLevelOptions = ["trace", "debug", "info", "warn", "error", "fatal"];

  $effect(() => {
    if (isOpen) {
      loadSettingsFromStorage();
    }
  });

  async function loadSettingsFromStorage() {
    const saved = await loadSettings();
    if (!saved) {
      apiVersion = defaultSettings.apiVersion;
      cacheDirPath = defaultSettings.cacheDirPath;
      cacheTtl = defaultSettings.cacheTtl;
      logLevel = defaultSettings.logLevel;
      proxyUrl = defaultSettings.proxyUrl;
      return;
    }
    apiVersion = saved.apiVersion || defaultSettings.apiVersion;
    cacheDirPath = saved.cacheDirPath || defaultSettings.cacheDirPath;
    cacheTtl = saved.cacheTtl || defaultSettings.cacheTtl;
    logLevel = saved.logLevel || defaultSettings.logLevel;
    proxyUrl = saved.proxyUrl || defaultSettings.proxyUrl;
  }

  async function handleSave() {
    saving = true;
    error = null;
    success = false;

    try {
      const settings: SettingsData = {
        apiVersion,
        cacheDirPath,
        cacheTtl,
        logLevel,
        proxyUrl,
      };

      await saveSettings(settings);

      onSave(settings);
      success = true;

      setTimeout(() => {
        success = false;
      }, 2000);
    } catch (err) {
      console.error("Failed to save settings:", err);
      error = err instanceof Error ? err.message : "Failed to save settings";
    } finally {
      saving = false;
    }
  }

  function handleClose() {
    error = null;
    success = false;
    onClose();
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      handleClose();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      handleClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" onclick={handleBackdropClick}>
    <div class="settings-panel">
      <div class="settings-header">
        <h2>Settings</h2>
        <button
          class="close-button"
          onclick={handleClose}
          aria-label="Close settings"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="settings-body">
        <div class="form-group">
          <label for="apiVersion">Takealot API Version</label>
          <input
            type="text"
            id="apiVersion"
            bind:value={apiVersion}
            placeholder="e.g., v-1-16-0"
          />
          <span class="hint"
            >The API version string used for Takealot requests</span
          >
        </div>

        <div class="form-group">
          <label for="cacheDirPath">Cache Directory Path</label>
          <input
            type="text"
            id="cacheDirPath"
            bind:value={cacheDirPath}
            placeholder="e.g., views.cache"
          />
          <span class="hint">Directory where cached product data is stored</span
          >
        </div>

        <div class="form-group">
          <label for="cacheTtl">Cache TTL (milliseconds)</label>
          <input
            type="number"
            id="cacheTtl"
            bind:value={cacheTtl}
            min="0"
            placeholder="e.g., 86400000 (24 hours)"
          />
          <span class="hint"
            >How long cached data remains valid (86400000 = 24 hours)</span
          >
        </div>

        <div class="form-group">
          <label for="logLevel">Log Level</label>
          <div class="select-wrapper">
            <select id="logLevel" bind:value={logLevel}>
              {#each logLevelOptions as level}
                <option value={level}>{level}</option>
              {/each}
            </select>
            <span class="select-arrow"></span>
          </div>
          <span class="hint">Logging verbosity level</span>
        </div>

        <div class="form-group">
          <label for="proxyUrl">Proxy URL (optional)</label>
          <input
            type="text"
            id="proxyUrl"
            bind:value={proxyUrl}
            placeholder="e.g., http://user:pass@proxy.example.com:80"
          />
          <span class="hint"
            >HTTP/HTTPS proxy URL for image fetching (leave empty to disable)</span
          >
        </div>

        {#if error}
          <div class="message error-message">{error}</div>
        {/if}

        {#if success}
          <div class="message success-message">
            Settings saved successfully!
          </div>
        {/if}
      </div>

      <div class="settings-footer">
        <button class="cancel-button" onclick={handleClose}>Cancel</button>
        <button class="save-button" onclick={handleSave} disabled={saving}>
          {#if saving}
            Saving...
          {:else}
            Save
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 0.15s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .settings-panel {
    background: var(--bg-secondary);
    border-radius: 8px;
    border: 1px solid var(--border-color);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    width: 90%;
    max-width: 400px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    animation: slideIn 0.15s ease-out;
  }

  @keyframes slideIn {
    from {
      transform: translateY(-10px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color);
  }

  .settings-header h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .close-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-secondary);
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .close-button:hover {
    background: var(--row-hover);
    color: var(--text-primary);
  }

  .close-button svg {
    width: 14px;
    height: 14px;
  }

  .settings-body {
    padding: 16px;
    overflow-y: auto;
    flex: 1;
  }

  .form-group {
    margin-bottom: 12px;
  }

  .form-group:last-of-type {
    margin-bottom: 0;
  }

  label {
    display: block;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.02em;
    margin-bottom: 4px;
  }

  .select-wrapper {
    position: relative;
  }

  .select-wrapper select {
    width: 100%;
    padding-right: 24px;
  }

  .select-arrow {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    width: 0;
    height: 0;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 4px solid var(--text-secondary);
  }

  input,
  select {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    font-size: 13px;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
    box-sizing: border-box;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
  }

  input[type="number"] {
    appearance: textfield;
    -moz-appearance: textfield;
  }

  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  input:focus,
  select:focus {
    outline: none;
    border-color: var(--accent-color);
    box-shadow: 0 0 0 2px var(--accent-bg);
  }

  .hint {
    display: block;
    font-size: 10px;
    color: var(--text-disabled);
    margin-top: 3px;
  }

  .message {
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 12px;
    margin-top: 12px;
  }

  .error-message {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.2);
  }

  .success-message {
    background: rgba(34, 197, 94, 0.1);
    color: #22c55e;
    border: 1px solid rgba(34, 197, 94, 0.2);
  }

  .settings-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--border-color);
  }

  .cancel-button,
  .save-button {
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .cancel-button {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
  }

  .cancel-button:hover {
    background: var(--row-hover);
  }

  .save-button {
    background: var(--accent-color);
    border: 1px solid var(--accent-color);
    color: white;
  }

  .save-button:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .save-button:disabled {
    background: var(--bg-tertiary);
    border-color: var(--border-color);
    color: var(--text-disabled);
    cursor: not-allowed;
  }
</style>
