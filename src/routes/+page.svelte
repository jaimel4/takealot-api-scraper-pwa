<script lang="ts">
  import QueryForm, {
    type QueryParams,
  } from "$lib/components/QueryForm.svelte";
  import TableView, {
    type RequestInfo,
  } from "$lib/components/TableView.svelte";
  import Settings from "$lib/components/Settings.svelte";
  import { defaultSettings, type SettingsData } from "$lib/settings";
  import { loadSettings, loadCacheEntry, saveCacheEntry } from "$lib/storage";
  import { TakealotBrowserApi } from "$lib/takealot/browser-api";
  import type { ProductTableRow, ProductView } from "$lib/takealot/types";
  let settingsOpen = $state(false);
  let apiVersion = $state(defaultSettings.apiVersion);
  let cacheTtl = $state(defaultSettings.cacheTtl); // Default 24 hours in ms
  let proxyUrl = $state(defaultSettings.proxyUrl);

  let products = $state<ProductTableRow[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let loadingProgress = $state<{
    loaded: number;
    total: number;
    slug?: string;
  } | null>(null);
  let requestInfo = $state<RequestInfo | null>(null);

  // Keep API instance to support request cancellation
  let currentApi: TakealotBrowserApi | null = null;

  // In-memory cache for product views (keyed by category slug)
  // Limited to prevent unbounded memory growth
  const MAX_VIEWS_CACHE_SIZE = 10;
  type CacheEntry = { views: ProductView[]; timestamp: number };
  let viewsCache = $state<Record<string, CacheEntry>>({});
  let viewsCacheOrder: string[] = []; // Track insertion order for LRU eviction

  const CACHE_DIR = "views-cache";

  // Load settings on mount
  $effect(() => {
    loadInitialSettings();
  });

  async function loadInitialSettings() {
    const saved = await loadSettings();
    if (!saved) {
      return;
    }
    if (saved.apiVersion) {
      apiVersion = saved.apiVersion;
    }
    if (saved.cacheTtl) {
      cacheTtl = saved.cacheTtl;
    }
    if (saved.proxyUrl !== undefined) {
      proxyUrl = saved.proxyUrl;
    }
  }

  async function loadCacheForCategory(
    slug: string
  ): Promise<CacheEntry | null> {
    // Check in-memory cache first
    if (viewsCache[slug]) {
      return viewsCache[slug];
    }

    // Try to load from disk
    try {
      const entry = await loadCacheEntry<CacheEntry>(CACHE_DIR, slug);
      if (!entry) {
        return null;
      }
      // Store in memory cache
      viewsCache[slug] = entry;
      return entry;
    } catch {
      // Cache file doesn't exist
      return null;
    }
  }

  async function saveCacheForCategory(slug: string, entry: CacheEntry) {
    // Evict oldest entries if cache is full
    while (viewsCacheOrder.length >= MAX_VIEWS_CACHE_SIZE) {
      const oldestSlug = viewsCacheOrder.shift();
      if (oldestSlug && oldestSlug !== slug) {
        delete viewsCache[oldestSlug];
      }
    }

    // Update in-memory cache
    viewsCache[slug] = entry;
    if (!viewsCacheOrder.includes(slug)) {
      viewsCacheOrder.push(slug);
    }
    viewsCache = { ...viewsCache }; // Trigger reactivity

    // Save to disk
    try {
      await saveCacheEntry(CACHE_DIR, slug, entry);
    } catch (err) {
      console.error(`Failed to save cache for ${slug}:`, err);
    }
  }

  function isCacheValid(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp < cacheTtl;
  }

  function isCustomSort(sort: string): boolean {
    return sort.startsWith("Field:");
  }

  function parseCustomSort(sort: string): {
    field: string;
    order: "Ascending" | "Descending";
  } {
    // Format: Field:<fieldname>+<direction>
    const match = sort.match(/^Field:(\w+)\+(Ascending|Descending)$/);
    if (!match) {
      throw new Error(`Invalid custom sort format: ${sort}`);
    }
    return { field: match[1], order: match[2] as "Ascending" | "Descending" };
  }

  function sortProductViews(
    views: ProductView[],
    field: string,
    order: "Ascending" | "Descending"
  ): ProductView[] {
    const fieldLower = field.toLowerCase() as keyof ProductView;

    return [...views].sort((a, b) => {
      const aVal = a[fieldLower];
      const bVal = b[fieldLower];

      // Handle null/undefined values
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return order === "Ascending" ? -1 : 1;
      if (bVal == null) return order === "Ascending" ? 1 : -1;

      // Compare values
      if (aVal < bVal) return order === "Ascending" ? -1 : 1;
      if (aVal > bVal) return order === "Ascending" ? 1 : -1;
      return 0;
    });
  }

  async function handleQueryChange(query: QueryParams) {
    if (!query.department || !query.category) {
      products = [];
      requestInfo = null;
      return;
    }

    // Cancel any in-flight requests
    if (currentApi) {
      currentApi.abort();
    }

    loading = true;
    error = null;
    loadingProgress = null;
    products = [];
    requestInfo = null;

    // Build request info for display
    // Use the deepest category in the path, or fall back to the main category
    const category =
      query.categoryPath.length > 0
        ? query.categoryPath[query.categoryPath.length - 1]
        : query.category;

    const pathParts = query.categoryPath.map((c) => c.name);

    requestInfo = {
      path: pathParts.join(" / "),
      excluded: query.excludedCategories.map((c) => c.name),
      sort: query.sort,
      limit: query.limit,
    };

    try {
      const api = new TakealotBrowserApi(apiVersion);
      currentApi = api;

      // Determine if we're querying multiple categories (when exclusions exist)
      const hasExclusions = query.categoriesToQuery.length > 0;

      if (isCustomSort(query.sort)) {
        // Custom sort: fetch all products, cache them, sort locally
        const { field, order } = parseCustomSort(query.sort);
        const cacheKey = hasExclusions
          ? query.categoriesToQuery.map((c) => c.slug).sort().join("+")
          : category.slug;

        let allViews: ProductView[];

        // Check cache first (must exist and not be expired)
        const cachedEntry = await loadCacheForCategory(cacheKey);
        if (cachedEntry && isCacheValid(cachedEntry)) {
          allViews = cachedEntry.views;
        } else {
          // Fetch all product views for the category/categories
          if (hasExclusions) {
            allViews = await api.getAllProductViewsForCategories(
              query.department,
              query.categoriesToQuery,
              (loaded) => {
                loadingProgress = { loaded, total: 0, slug: cacheKey };
              }
            );
          } else {
            allViews = await api.getAllProductViews(
              query.department,
              category,
              (loaded) => {
                loadingProgress = { loaded, total: 0, slug: cacheKey };
              }
            );
          }
          // Cache the results with timestamp and save to disk
          await saveCacheForCategory(cacheKey, {
            views: allViews,
            timestamp: Date.now(),
          });
        }

        // Sort locally
        const sortedViews = sortProductViews(allViews, field, order);

        // Take only the limited amount
        const limitedViews = sortedViews.slice(0, query.limit);

        // Fetch full details for the limited views
        products = await api.getProductDetailsForViews(
          limitedViews,
          (loaded, total) => {
            loadingProgress = { loaded, total };
          }
        );
      } else {
        // API-supported sort
        if (hasExclusions) {
          // Query multiple categories when exclusions exist
          products = await api.getProductsWithDetailsForCategories(
            query.department,
            query.categoriesToQuery,
            query.sort,
            query.limit,
            (loaded, total) => {
              loadingProgress = { loaded, total };
            }
          );
        } else {
          // Single category query
          products = await api.getProductsWithDetails(
            query.department,
            category,
            query.sort,
            query.limit,
            (loaded, total) => {
              loadingProgress = { loaded, total };
            }
          );
        }
      }
    } catch (err) {
      // On abort, just stop loading but keep requestInfo (new request will update it)
      if (err instanceof DOMException && err.name === "AbortError") {
        // Don't clear products or requestInfo - new request is taking over
        return;
      }
      console.error("Failed to fetch products:", err);
      error = err instanceof Error ? err.message : "Failed to fetch products";
      products = [];
    } finally {
      loading = false;
      loadingProgress = null;
    }
  }

  function handleSettingsSave(settings: SettingsData) {
    apiVersion = settings.apiVersion;
    cacheTtl = settings.cacheTtl;
    proxyUrl = settings.proxyUrl;
  }

  function openSettings() {
    settingsOpen = true;
  }

  function closeSettings() {
    settingsOpen = false;
  }

  function handleCancel() {
    if (currentApi) {
      currentApi.abort();
    }
    loading = false;
    loadingProgress = null;
  }
</script>

<main class="app">
  <div class="content">
    <QueryForm
      onQueryChange={handleQueryChange}
      {apiVersion}
      onOpenSettings={openSettings}
    />
    <TableView
      {products}
      {loading}
      {error}
      {loadingProgress}
      {requestInfo}
      {proxyUrl}
      onCancel={handleCancel}
    />
  </div>

  <Settings
    isOpen={settingsOpen}
    onClose={closeSettings}
    onSave={handleSettingsSave}
  />
</main>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.4;
    color: var(--text-primary);
    background-color: var(--bg-primary);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  .app {
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow: hidden;
    background: var(--border-color);
  }

  @media (prefers-color-scheme: dark) {
    :global(body) {
      --text-primary: #e4e4e7;
      --text-secondary: #a1a1aa;
      --text-disabled: #71717a;
      --bg-primary: #18181b;
      --bg-secondary: #27272a;
      --bg-tertiary: #3f3f46;
      --border-color: #3f3f46;
      --row-hover: #323238;
      --accent-color: #60a5fa;
      --accent-bg: rgba(96, 165, 250, 0.1);
    }
  }

  @media (prefers-color-scheme: light) {
    :global(body) {
      --text-primary: #18181b;
      --text-secondary: #71717a;
      --text-disabled: #a1a1aa;
      --bg-primary: #f4f4f5;
      --bg-secondary: #ffffff;
      --bg-tertiary: #fafafa;
      --border-color: #e4e4e7;
      --row-hover: #f4f4f5;
      --accent-color: #3b82f6;
      --accent-bg: rgba(59, 130, 246, 0.1);
    }
  }
</style>
