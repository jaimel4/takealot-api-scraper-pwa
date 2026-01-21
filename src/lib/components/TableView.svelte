<script lang="ts">
  import type { ProductTableRow } from "$lib/takealot/types";
  import { isTauri } from "$lib/platform";
  import ExcelJS from "exceljs";

  export interface RequestInfo {
    path: string;
    excluded: string[];
    sort: string;
    limit: number;
  }

  interface Props {
    products: ProductTableRow[];
    loading: boolean;
    error: string | null;
    loadingProgress?: { loaded: number; total: number; slug?: string } | null;
    requestInfo?: RequestInfo | null;
    proxyUrl?: string;
    onCancel?: () => void;
  }

  let {
    products,
    loading,
    error,
    loadingProgress = null,
    requestInfo = null,
    proxyUrl = '',
    onCancel,
  }: Props = $props();

  let exporting = $state(false);
  let exportError = $state<string | null>(null);
  let exportProgress = $state<{ current: number; total: number } | null>(null);
  let exportSuccess = $state(false);

  // Cache for loaded images (base64 data URLs)
  // Limited to prevent unbounded memory growth
  const MAX_IMAGE_CACHE_SIZE = 200;
  let imageCache = $state<Record<string, string>>({});
  let imageCacheOrder: string[] = []; // Track insertion order for LRU eviction

  // Flag to pause preview image loading during export
  let pauseImageLoading = $state(false);

  // Flag to prevent multiple simultaneous loads
  let isLoadingImages = $state(false);

  // Track the products array reference to detect actual changes
  let previousProductsRef: ProductTableRow[] | null = null;

  async function fetchPreviewImage(url: string): Promise<string | null> {
    if (!url) return null;
    if (!isTauri) {
      return url;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("fetch_image", {
      url,
      proxyUrl: proxyUrl || null,
    });
  }

  async function fetchImageBuffer(url: string): Promise<Uint8Array | null> {
    if (!url) return null;
    if (!isTauri) {
      const response = await fetch(
        `/api/image?url=${encodeURIComponent(url)}`
      );
      if (!response.ok) {
        return null;
      }
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    }
    const { invoke } = await import("@tauri-apps/api/core");
    const buffer = await invoke<number[]>("fetch_image_buffer", {
      url,
      proxyUrl: proxyUrl || null,
    });
    if (buffer.length === 0) {
      return null;
    }
    return new Uint8Array(buffer);
  }

  // Load images via Tauri when products change
  $effect(() => {
    // Only react to actual products array changes, not other state
    const currentProducts = products;

    // Skip if it's the same array reference (no actual change)
    if (currentProducts === previousProductsRef) {
      return;
    }
    previousProductsRef = currentProducts;

    // Clear cache when products array is empty (new query starting)
    if (currentProducts.length === 0) {
      imageCache = {};
      imageCacheOrder = [];
      isLoadingImages = false;
    } else if (!pauseImageLoading && !isLoadingImages) {
      // Only load images if not currently exporting and not already loading
      loadImages();
    }
  });

  async function loadImages() {
    if (isLoadingImages) {
      console.log('[loadImages] Already loading, skipping...');
      return;
    }

    isLoadingImages = true;

    const concurrency = 2; // Reduced to 2 concurrent downloads
    const delay = 1000; // Increased delay to 1 second between batches

    const imagesToLoad = products.filter(
      (p) => p.image && !imageCache[p.image]
    );

    console.log(`[loadImages] Starting image load. Total products: ${products.length}`);
    console.log(`[loadImages] Images to load: ${imagesToLoad.length}`);
    console.log(`[loadImages] Current cache size: ${Object.keys(imageCache).length}`);
    console.log(`[loadImages] Proxy URL type:`, typeof proxyUrl);
    console.log(`[loadImages] Proxy URL value:`, proxyUrl);
    console.log(`[loadImages] Proxy URL (fallback):`, proxyUrl || 'none');
    console.log(`[loadImages] pauseImageLoading: ${pauseImageLoading}`);

    for (let i = 0; i < imagesToLoad.length; i += concurrency) {
      // Stop loading if export started
      if (pauseImageLoading) {
        console.log("[loadImages] Image loading paused due to export");
        break;
      }

      const batch = imagesToLoad.slice(i, i + concurrency);
      console.log(`[loadImages] Batch ${Math.floor(i / concurrency) + 1}: Loading ${batch.length} images`);

      const results = await Promise.allSettled(
        batch.map(async (product, idx) => {
          const batchIdx = i + idx;
          console.log(`[loadImages] [${batchIdx}] Fetching: ${product.image}`);

          try {
            const previewImage = await fetchPreviewImage(product.image);
            if (!previewImage) {
              return null;
            }
            console.log(`[loadImages] [${batchIdx}] SUCCESS: ${product.image.substring(0, 50)}...`);
            return { url: product.image, data: previewImage };
          } catch (err) {
            const errorMsg = String(err);
            console.error(`[loadImages] [${batchIdx}] FAILED: ${product.image}`);
            console.error(`[loadImages] [${batchIdx}] Error:`, err);

            // Don't retry 429 errors here, just log and skip
            if (errorMsg.includes("429")) {
              console.warn(`[loadImages] [${batchIdx}] Rate limited (429)`);
            }
            return null;
          }
        })
      );

      // Update cache with successful results
      let successCount = 0;
      let failedCount = 0;
      results.forEach((result) => {
        if (result.status === "fulfilled" && result.value) {
          const url = result.value.url;

          // Evict oldest entries if cache is full
          while (imageCacheOrder.length >= MAX_IMAGE_CACHE_SIZE) {
            const oldestUrl = imageCacheOrder.shift();
            if (oldestUrl) {
              delete imageCache[oldestUrl];
            }
          }

          imageCache[url] = result.value.data;
          imageCacheOrder.push(url);
          successCount++;
        } else {
          failedCount++;
        }
      });

      console.log(`[loadImages] Batch complete: ${successCount} success, ${failedCount} failed. Cache size: ${imageCacheOrder.length}`);

      // Trigger reactivity once per batch
      imageCache = { ...imageCache };

      // Delay between batches to avoid rate limiting and port exhaustion
      if (i + concurrency < imagesToLoad.length) {
        console.log(`[loadImages] Waiting ${delay}ms before next batch...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    console.log(`[loadImages] FINISHED. Final cache size: ${Object.keys(imageCache).length}`);
    isLoadingImages = false;
  }

  async function downloadImage(
    url: string,
    maxRetries = 3,
    initialDelay = 3000
  ): Promise<Uint8Array | null> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Add a small delay before each attempt to spread out requests
        if (attempt > 0) {
          const delay = initialDelay * Math.pow(2, attempt - 1);
          console.warn(`Retrying image download in ${delay}ms... (${attempt}/${maxRetries})`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        const buffer = await fetchImageBuffer(url);
        if (!buffer || buffer.length === 0) {
          console.warn("Empty buffer received for:", url);
          return null;
        }
        return buffer;
      } catch (err) {
        const errorMsg = String(err);

        // Only retry on specific errors, and only if we have retries left
        const shouldRetry = (errorMsg.includes("429") || errorMsg.includes("os error 49")) && attempt < maxRetries;

        if (!shouldRetry) {
          console.error("Failed to download image:", url, errorMsg);
          return null;
        }
      }
    }
    return null;
  }

  // Helper to limit concurrent async operations
  async function limitConcurrency<T>(
    items: T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<void>,
    delay = 100
  ): Promise<void> {
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      await Promise.all(batch.map((item, idx) => fn(item, i + idx)));

      // Small delay between batches
      if (i + concurrency < items.length) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async function handleExport() {
    if (products.length === 0) return;

    // Pause preview image loading during export
    pauseImageLoading = true;
    exporting = true;
    exportError = null;
    exportProgress = { current: 0, total: products.length };

    try {
      let filePath: string | null = null;
      if (isTauri) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        filePath = await save({
          defaultPath: "takealot-products.xlsx",
          filters: [
            {
              name: "Excel",
              extensions: ["xlsx"],
            },
          ],
        });

        if (!filePath) {
          exporting = false;
          exportProgress = null;
          return;
        }
      }

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Products");

      // Define columns matching the target format
      worksheet.columns = [
        { header: "title", key: "title", width: 50 },
        { header: "brand", key: "brand", width: 20 },
        { header: "sku", key: "sku", width: 15 },
        { header: "price", key: "price", width: 12 },
        { header: "rating", key: "rating", width: 10 },
        { header: "reviews", key: "reviews", width: 10 },
        { header: "image", key: "image", width: 15 },
        { header: "category/subcategory", key: "category", width: 40 },
        { header: "url", key: "url", width: 60 },
      ];

      // Style header row
      worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      worksheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF396CD8" },
      };
      worksheet.getRow(1).height = 25;
      worksheet.getRow(1).alignment = { vertical: "middle" };

      // Add data rows with images
      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        const rowIndex = i + 2; // +2 because row 1 is header

        worksheet.addRow({
          title: product.title,
          brand: product.brand,
          sku: product.sku,
          price: product.price,
          rating: product.rating,
          reviews: product.reviews,
          image: "",
          category: product["category/subcategory"],
          url: product.url,
        });

        // Set row height for images
        worksheet.getRow(rowIndex).height = 80;
        worksheet.getRow(rowIndex).alignment = { vertical: "middle" };

        // Use cached image or download if not cached
        if (product.image) {
          try {
            let imageBuffer: Uint8Array | null = null;
            const cachedImage = imageCache[product.image];

            if (cachedImage && cachedImage.startsWith("data:")) {
              console.log(`Using cached image for row ${rowIndex}`);
              const base64Data = cachedImage.split(",")[1];
              const binaryString = atob(base64Data);
              const bytes = new Uint8Array(binaryString.length);
              for (let j = 0; j < binaryString.length; j++) {
                bytes[j] = binaryString.charCodeAt(j);
              }
              imageBuffer = bytes;
            } else {
              const downloadUrl = cachedImage || product.image;
              console.log(`Downloading image for row ${rowIndex}`);
              imageBuffer = await downloadImage(downloadUrl);
            }

            if (imageBuffer && imageBuffer.length > 0) {
              console.log(
                `Adding image for row ${rowIndex}, buffer size: ${imageBuffer.length}`
              );
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const imageId = workbook.addImage({
                buffer: imageBuffer as any,
                extension: "jpeg",
              });

              // Image column is index 6 (0-based)
              worksheet.addImage(imageId, {
                tl: { col: 6, row: rowIndex - 1 },
                ext: { width: 100, height: 100 },
                editAs: "oneCell",
              });
              console.log(`Image added successfully for row ${rowIndex}`);
            }
          } catch (imgErr) {
            console.error(`Failed to add image for row ${rowIndex}:`, imgErr);
          }
        }

        exportProgress = { current: i + 1, total: products.length };
      }

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();

      if (isTauri) {
        const { writeFile } = await import("@tauri-apps/plugin-fs");
        await writeFile(filePath as string, new Uint8Array(buffer));
      } else {
        const blob = new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "takealot-products.xlsx";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      }

      exportError = null;
      exportSuccess = true;

      // Hide success notification after 3 seconds
      setTimeout(() => {
        exportSuccess = false;
      }, 3000);
    } catch (err) {
      console.error("Export failed:", err);
      exportError = err instanceof Error ? err.message : "Export failed";
    } finally {
      exporting = false;
      exportProgress = null;
      pauseImageLoading = false;

      // Resume preview image loading if there are still images to load
      if (products.some((p) => p.image && !imageCache[p.image])) {
        loadImages();
      }
    }
  }
</script>

<div class="table-view">
  {#if exportSuccess}
    <div class="export-success">✓ Export successful!</div>
  {/if}

  <div class="table-header">
    <h2>Results</h2>
    <span class="count">{products.length} products</span>
    {#if loadingProgress}
      <span class="progress">
        {#if loadingProgress.total === 0}
          Fetching all products{#if loadingProgress.slug}
            ({loadingProgress.slug}){/if}... {loadingProgress.loaded}
        {:else}
          Loading {loadingProgress.loaded}/{loadingProgress.total}
        {/if}
        {#if onCancel}
          <button
            type="button"
            class="cancel-btn"
            onclick={onCancel}
            title="Cancel"
          >&times;</button>
        {/if}
      </span>
    {/if}
    {#if products.length > 0}
      <button
        class="export-button"
        onclick={handleExport}
        disabled={exporting || products.length === 0}
      >
        {#if exporting}
          <span class="export-spinner"></span>
          {#if exportProgress}
            Exporting ({exportProgress.current}/{exportProgress.total})
          {:else}
            Exporting...
          {/if}
        {:else}
          Download as xlsx
        {/if}
      </button>
    {/if}
  </div>

  {#if requestInfo}
    <div class="request-info">
      <span class="request-item"><strong>Path:</strong> {requestInfo.path}</span
      >
      {#if requestInfo.excluded.length > 0}
        <span class="request-item"
          ><strong>Excluded:</strong> {requestInfo.excluded.join(", ")}</span
        >
      {/if}
      <span class="request-item"><strong>Sort:</strong> {requestInfo.sort}</span
      >
      <span class="request-item"
        ><strong>Limit:</strong> {requestInfo.limit}</span
      >
    </div>
  {/if}

  {#if loading}
    <div class="loading">
      <div class="spinner"></div>
      <p>Loading products...</p>
    </div>
  {:else if error}
    <div class="error">
      <p>{error}</p>
    </div>
  {:else if products.length === 0 && requestInfo && !loading}
    <div class="empty">
      <p>
        No products found for the selected category.
      </p>
    </div>
  {:else if products.length === 0 && !loading}
    <div class="empty">
      <p>
        Select a department and category to fetch products.
      </p>
    </div>
  {:else}
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Brand</th>
            <th>SKU</th>
            <th>Price</th>
            <th>Rating</th>
            <th>Reviews</th>
            <th>Image</th>
            <th>Category/Subcategory</th>
            <th>URL</th>
          </tr>
        </thead>
        <tbody>
          {#each products as product}
            <tr>
              <td class="title-cell">
                <a href={product.url} target="_blank" rel="noopener noreferrer">
                  {product.title}
                </a>
              </td>
              <td>{product.brand || ""}</td>
              <td class="sku-cell">{product.sku}</td>
              <td class="price-cell">{product.price}</td>
              <td class="rating-cell">{product.rating}</td>
              <td class="reviews-cell">{product.reviews}</td>
              <td class="image-cell">
                {#if imageCache[product.image]}
                  <img src={imageCache[product.image]} alt={product.title} />
                {:else if product.image}
                  <div class="image-loading"></div>
                {/if}
              </td>
              <td class="category-cell">{product["category/subcategory"]}</td>
              <td class="url-cell">
                <a href={product.url} target="_blank" rel="noopener noreferrer">
                  {product.url}
                </a>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if exportError}
      <p class="export-error">{exportError}</p>
    {/if}
  {/if}
</div>

<style>
  .table-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
    overflow: hidden;
  }

  .table-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .table-header h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .count {
    font-size: 11px;
    color: var(--text-secondary);
    background: var(--bg-tertiary);
    padding: 2px 8px;
    border-radius: 10px;
  }

  .request-info {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding: 6px 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
    font-size: 11px;
    color: var(--text-secondary);
  }

  .request-item {
    display: inline-flex;
    gap: 4px;
  }

  .request-item strong {
    color: var(--text-primary);
    font-weight: 500;
  }

  .loading,
  .empty,
  .error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--text-secondary);
    font-size: 13px;
  }

  .error {
    color: #ef4444;
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--border-color);
    border-top-color: var(--accent-color);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-bottom: 8px;
  }

  .spinner-small {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-right: 6px;
  }

  .export-spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-right: 6px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .table-container {
    flex: 1;
    overflow: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  thead {
    position: sticky;
    top: 0;
    background: var(--bg-tertiary);
    z-index: 1;
  }

  th {
    text-align: left;
    padding: 6px 10px;
    font-weight: 500;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--text-secondary);
    white-space: nowrap;
    border-bottom: 1px solid var(--border-color);
  }

  td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-color);
    vertical-align: middle;
  }

  tbody tr:hover {
    background: var(--row-hover);
  }

  .image-cell {
    width: 44px;
  }

  .image-cell img {
    width: 36px;
    height: 36px;
    object-fit: contain;
    border-radius: 3px;
    background: var(--bg-tertiary);
  }

  .title-cell {
    max-width: 280px;
  }

  .title-cell a {
    color: var(--accent-color);
    text-decoration: none;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .title-cell a:hover {
    text-decoration: underline;
  }

  .category-cell {
    color: var(--text-secondary);
    font-size: 11px;
  }

  .price-cell {
    font-weight: 600;
    white-space: nowrap;
  }

  .rating-cell {
    text-align: center;
  }

  .reviews-cell {
    color: var(--text-secondary);
    text-align: center;
  }

  .sku-cell {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
      monospace;
    font-size: 11px;
  }

  .url-cell {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .url-cell a {
    color: var(--accent-color);
    text-decoration: none;
    font-size: 11px;
  }

  .url-cell a:hover {
    text-decoration: underline;
  }

  .image-loading {
    width: 36px;
    height: 36px;
    background: var(--bg-tertiary);
    border-radius: 3px;
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .progress {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--accent-color);
    background: var(--accent-bg);
    padding: 2px 8px;
    border-radius: 10px;
  }

  .cancel-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--accent-color);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    border-radius: 2px;
    opacity: 0.7;
    transition: opacity 0.15s;
  }

  .cancel-btn:hover {
    opacity: 1;
  }

  .export-error {
    color: #ef4444;
    font-size: 12px;
    margin: 8px 12px;
  }

  .export-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: auto;
    padding: 5px 12px;
    background: #22c55e;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .export-button:hover:not(:disabled) {
    background: #16a34a;
  }

  .export-button:disabled {
    background: var(--bg-tertiary);
    color: var(--text-disabled);
    cursor: not-allowed;
  }

  .export-success {
    position: absolute;
    top: 16px;
    left: 16px;
    z-index: 1000;
    display: flex;
    align-items: center;
    padding: 10px 16px;
    background: rgba(34, 197, 94, 0.95);
    color: white;
    border: 1px solid rgba(34, 197, 94, 1);
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    animation: slideInFromTop 0.3s ease-out;
  }

  @keyframes slideInFromTop {
    from {
      opacity: 0;
      transform: translateY(-20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
