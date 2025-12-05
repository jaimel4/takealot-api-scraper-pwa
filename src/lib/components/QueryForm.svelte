<script lang="ts">
  import { TakealotBrowserApi } from "$lib/takealot/browser-api";
  import type {
    TakealotDepartment,
    TakealotCategory,
  } from "$lib/takealot/types";
  import { untrack } from "svelte";

  interface Props {
    onQueryChange: (query: QueryParams) => void;
    apiVersion: string;
    onOpenSettings?: () => void;
  }

  export type QueryParams = {
    department: TakealotDepartment | null;
    category: TakealotCategory | null;
    categoryPath: TakealotCategory[];
    excludedCategories: TakealotCategory[];
    /** Categories to query (sibling categories minus excluded ones) - only set when exclusions exist */
    categoriesToQuery: TakealotCategory[];
    sort: string;
    limit: number;
  };

  let { onQueryChange, apiVersion, onOpenSettings }: Props = $props();

  type CategoryLevel = {
    categories: TakealotCategory[];
    selected: TakealotCategory | null;
    loading: boolean;
  };

  let api = $state<TakealotBrowserApi | null>(null);
  let departments = $state<TakealotDepartment[]>([]);
  let categories = $state<TakealotCategory[]>([]);

  let selectedDepartment = $state<TakealotDepartment | null>(null);
  let selectedCategory = $state<TakealotCategory | null>(null);
  let categoryLevels = $state<CategoryLevel[]>([]);
  let excludedCategories = $state<TakealotCategory[]>([]);
  let selectedSort = $state("Price+Descending");
  let limit = $state(10);

  // Custom sort state
  let customSortField = $state("Price");
  let customSortDirection = $state<"Ascending" | "Descending">("Descending");
  let isCustomSort = $derived(selectedSort === "custom");

  let loadingDepartments = $state(false);
  let loadingCategories = $state(false);

  const sortOptions = [
    { value: "Price+Descending", label: "Price (High to Low)" },
    { value: "Price+Ascending", label: "Price (Low to High)" },
    { value: "ReleaseDate+Descending", label: "Release Date (Newest)" },
    { value: "Rating+Descending", label: "Rating (Highest)" },
    { value: "Relevance", label: "Relevance" },
    { value: "custom", label: "Custom Sort" },
  ];

  // All available custom sort fields
  const customSortFields = [
    { value: "Price", label: "Price" },
    { value: "Rating", label: "Rating" },
    { value: "Reviews", label: "Reviews" },
    { value: "ReleaseDate", label: "Release Date" },
    { value: "Title", label: "Title" },
    { value: "Brand", label: "Brand" },
  ];

  $effect(() => {
    const newApi = new TakealotBrowserApi(apiVersion);
    untrack(() => {
      api = newApi;
      loadDepartments();
    });
  });

  async function loadDepartments() {
    if (!api) return;
    loadingDepartments = true;
    try {
      departments = await api.listDepartments();
    } catch (error) {
      console.error("Failed to load departments:", error);
      departments = [];
    } finally {
      loadingDepartments = false;
    }
  }

  async function handleDepartmentChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const slug = select.value;

    selectedDepartment = departments.find((d) => d.slug === slug) || null;
    selectedCategory = null;
    categoryLevels = [];
    excludedCategories = [];
    categories = [];

    if (selectedDepartment && api) {
      loadingCategories = true;
      try {
        categories = await api.listDepartmentCategories(selectedDepartment);
      } catch (error) {
        console.error("Failed to load categories:", error);
        categories = [];
      } finally {
        loadingCategories = false;
      }
    }

    triggerQueryChange();
  }

  async function handleCategoryChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const slug = select.value;

    selectedCategory = categories.find((c) => c.slug === slug) || null;
    categoryLevels = [];
    excludedCategories = [];

    triggerQueryChange();
  }

  async function handleSubcategoryChange(levelIndex: number, event: Event) {
    const select = event.target as HTMLSelectElement;
    const slug = select.value;

    const level = categoryLevels[levelIndex];
    if (!level) return;

    const selectedSubcat =
      level.categories.find((c) => c.slug === slug) || null;

    // Update the selected value immutably and clear all levels after this one
    // Single assignment to avoid multiple reactive updates
    categoryLevels = categoryLevels.slice(0, levelIndex + 1).map((l, i) =>
      i === levelIndex
        ? {
            categories: l.categories,
            selected: selectedSubcat,
            loading: false,
          }
        : l
    );
    excludedCategories = [];

    triggerQueryChange();
  }

  async function addSubcategoryLevel() {
    if (!selectedDepartment || !api) return;

    // Determine the parent category for the new level
    const lastLevel = categoryLevels[categoryLevels.length - 1];
    const parentCategory = lastLevel?.selected || selectedCategory;

    if (!parentCategory) return;

    // Add a new level with loading state
    const newLevelIndex = categoryLevels.length;
    categoryLevels = [
      ...categoryLevels,
      {
        categories: [],
        selected: null,
        loading: true,
      },
    ];

    try {
      const subcats = await api.listDepartmentCategories(
        selectedDepartment,
        parentCategory
      );

      // Check if level still exists (user might have removed it)
      if (
        newLevelIndex < categoryLevels.length &&
        categoryLevels[newLevelIndex]?.loading
      ) {
        categoryLevels = categoryLevels.with(newLevelIndex, {
          categories: subcats,
          selected: null,
          loading: false,
        });
      }
    } catch (error) {
      console.error("Failed to load subcategories:", error);
      // Check if level still exists
      if (
        newLevelIndex < categoryLevels.length &&
        categoryLevels[newLevelIndex]?.loading
      ) {
        categoryLevels = categoryLevels.with(newLevelIndex, {
          categories: [],
          selected: null,
          loading: false,
        });
      }
    }
  }

  function removeSubcategoryLevel(levelIndex: number) {
    categoryLevels = categoryLevels.slice(0, levelIndex);
    excludedCategories = [];
    triggerQueryChange();
  }

  function handleSortChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    selectedSort = select.value;
    // Don't auto-trigger for custom sort - wait for Apply button
    if (selectedSort !== "custom") {
      triggerQueryChange();
    }
  }

  function handleCustomSortFieldChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    customSortField = select.value;
    // Don't auto-trigger - wait for Apply button
  }

  function handleCustomSortDirectionChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    customSortDirection = select.value as "Ascending" | "Descending";
    // Don't auto-trigger - wait for Apply button
  }

  function applyCustomSort() {
    triggerQueryChange();
  }

  function handleLimitChange(event: Event) {
    const input = event.target as HTMLInputElement;
    limit = parseInt(input.value) || 10;
    triggerQueryChange();
  }

  function addExclusion(event: Event) {
    const select = event.target as HTMLSelectElement;
    const slug = select.value;
    if (!slug) return;

    // Get the last level's categories for exclusions
    const lastLevel = categoryLevels[categoryLevels.length - 1];
    const availableCategories = lastLevel?.categories || [];

    const category = availableCategories.find((c) => c.slug === slug);
    if (category && !excludedCategories.some((e) => e.slug === slug)) {
      excludedCategories = [...excludedCategories, category];
      triggerQueryChange();
    }
    select.value = "";
  }

  function removeExclusion(slug: string) {
    excludedCategories = excludedCategories.filter((e) => e.slug !== slug);
    triggerQueryChange();
  }

  function getEffectiveSort(): string {
    if (selectedSort === "custom") {
      return `Field:${customSortField}+${customSortDirection}`;
    }
    return selectedSort;
  }

  function triggerQueryChange() {
    // Build the category path from selectedCategory and all selected levels
    const path: TakealotCategory[] = [];
    if (selectedCategory) {
      path.push(selectedCategory);
      for (const level of categoryLevels) {
        if (level.selected) {
          path.push(level.selected);
        }
      }
    }

    // Compute categories to query: sibling categories minus excluded ones
    let categoriesToQuery: TakealotCategory[] = [];
    if (excludedCategories.length > 0 && categoryLevels.length > 0) {
      const lastLevel = categoryLevels[categoryLevels.length - 1];
      const excludedSlugs = new Set(excludedCategories.map((c) => c.slug));
      categoriesToQuery = lastLevel.categories.filter(
        (c) => !excludedSlugs.has(c.slug)
      );
    }

    console.log(excludedCategories, categoriesToQuery);

    onQueryChange({
      department: selectedDepartment,
      category: selectedCategory,
      categoryPath: path,
      excludedCategories,
      categoriesToQuery,
      sort: getEffectiveSort(),
      limit,
    });
  }
</script>

<div class="query-form">
  <div class="form-header">
    <div class="form-grid">
      <div class="form-group">
        <label for="department">Department</label>
        <div class="select-wrapper">
          <select
            id="department"
            onchange={handleDepartmentChange}
            disabled={loadingDepartments}
          >
            <option value="">
              {loadingDepartments ? "Loading..." : "Select a department"}
            </option>
            {#each departments as dept}
              <option value={dept.slug}>{dept.name}</option>
            {/each}
          </select>
          <span class="select-arrow"></span>
        </div>
      </div>

      <div class="form-group">
        <label for="category">Category</label>
        <div class="category-row">
          <div class="select-wrapper">
            <select
              id="category"
              onchange={handleCategoryChange}
              disabled={!selectedDepartment || loadingCategories}
            >
              <option value="">
                {#if loadingCategories}
                  Loading...
                {:else if !selectedDepartment}
                  Select department first
                {:else}
                  Select a category
                {/if}
              </option>
              {#each categories as cat}
                <option value={cat.slug}>{cat.name}</option>
              {/each}
            </select>
            <span class="select-arrow"></span>
          </div>
          {#if selectedCategory && categoryLevels.length === 0}
            <button
              type="button"
              class="add-level-btn"
              onclick={addSubcategoryLevel}
              title="Add subcategory level"
            >
              <span class="plus-icon">+</span>
            </button>
          {/if}
        </div>
      </div>

      {#each categoryLevels as level, index (index)}
        <div class="form-group subcategory-group">
          <label for="subcategory-{index}">Subcategory {index + 1}</label>
          <div class="subcategory-row">
            <div class="select-wrapper">
              <select
                id="subcategory-{index}"
                value={level.selected?.slug ?? ""}
                onchange={(e) => handleSubcategoryChange(index, e)}
                disabled={level.loading || level.categories.length === 0}
              >
                <option value="">
                  {#if level.loading}
                    Loading...
                  {:else if level.categories.length === 0}
                    No subcategories
                  {:else}
                    Select subcategory (optional)
                  {/if}
                </option>
                {#each level.categories as subcat (subcat.slug)}
                  <option value={subcat.slug}>
                    {subcat.name}
                  </option>
                {/each}
              </select>
              <span class="select-arrow"></span>
            </div>
            <button
              type="button"
              class="remove-level-btn"
              onclick={() => removeSubcategoryLevel(index)}
              aria-label="Remove level"
              title="Remove this level"
            >
              &times;
            </button>
            {#if index === categoryLevels.length - 1 && level.selected}
              <button
                type="button"
                class="add-level-btn"
                onclick={addSubcategoryLevel}
                title="Add subcategory level"
              >
                <span class="plus-icon">+</span>
              </button>
            {/if}
          </div>
        </div>
      {/each}

      <div class="form-group">
        <label for="sort">Sort By</label>
        <div class="select-wrapper">
          <select id="sort" value={selectedSort} onchange={handleSortChange}>
            {#each sortOptions as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
          <span class="select-arrow"></span>
        </div>
      </div>

      <div class="form-group">
        <label for="limit">Limit</label>
        <input
          type="number"
          id="limit"
          value={limit}
          min="1"
          max="1000"
          onchange={handleLimitChange}
        />
      </div>
    </div>
    {#if onOpenSettings}
      <button
        class="settings-button"
        onclick={onOpenSettings}
        aria-label="Open settings"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
          />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    {/if}
  </div>

  {#if isCustomSort}
    <div class="custom-sort-section">
      <div class="custom-sort-header">
        <label>Custom Sort</label>
        <span
          class="custom-sort-warning"
          title="Custom sort requires fetching ALL products in the category first, which can take a long time for large categories. Results are cached for future use."
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          May take time
        </span>
      </div>
      <div class="custom-sort-row">
        <span class="custom-sort-prefix">Field:</span>
        <div class="select-wrapper">
          <select
            value={customSortField}
            onchange={handleCustomSortFieldChange}
          >
            {#each customSortFields as field}
              <option value={field.value}>{field.label}</option>
            {/each}
          </select>
          <span class="select-arrow"></span>
        </div>
        <span class="custom-sort-separator">+</span>
        <div class="select-wrapper">
          <select
            value={customSortDirection}
            onchange={handleCustomSortDirectionChange}
          >
            <option value="Ascending">Ascending</option>
            <option value="Descending">Descending</option>
          </select>
          <span class="select-arrow"></span>
        </div>
        <button class="apply-sort-button" onclick={applyCustomSort}>
          Apply Sort
        </button>
        <span class="custom-sort-preview">{getEffectiveSort()}</span>
      </div>
    </div>
  {/if}

  {#if categoryLevels.length > 0 && categoryLevels[categoryLevels.length - 1]?.categories.length > 0}
    <div class="exclusions-section">
      <div class="exclusions-header">
        <label for="add-exclusion">Exclude Subcategories</label>
        <div class="select-wrapper">
          <select id="add-exclusion" onchange={addExclusion}>
            <option value="">Add exclusion...</option>
            {#each categoryLevels[categoryLevels.length - 1].categories.filter((s) => !excludedCategories.some((e) => e.slug === s.slug)) as subcat}
              <option value={subcat.slug}>{subcat.name}</option>
            {/each}
          </select>
          <span class="select-arrow"></span>
        </div>
      </div>

      {#if excludedCategories.length > 0}
        <div class="exclusion-tags">
          {#each excludedCategories as excluded}
            <span class="exclusion-tag">
              {excluded.name}
              <button
                type="button"
                class="remove-btn"
                onclick={() => removeExclusion(excluded.slug)}
                aria-label="Remove {excluded.name}"
              >
                &times;
              </button>
            </span>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .query-form {
    padding: 10px 12px;
    background: var(--bg-secondary);
  }

  .form-header {
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }

  .form-grid {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  label {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.02em;
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

  .select-wrapper select:disabled + .select-arrow {
    border-top-color: var(--text-disabled);
  }

  select,
  input[type="number"] {
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    font-size: 13px;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
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

  select:focus,
  input[type="number"]:focus {
    outline: none;
    border-color: var(--accent-color);
    box-shadow: 0 0 0 2px var(--accent-bg);
  }

  select:disabled {
    background: var(--bg-secondary);
    color: var(--text-disabled);
    cursor: not-allowed;
  }

  .custom-sort-section {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border-color);
  }

  .custom-sort-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .custom-sort-header label {
    margin-bottom: 0;
  }

  .custom-sort-warning {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: #f59e0b;
    background: rgba(245, 158, 11, 0.1);
    padding: 2px 6px;
    border-radius: 3px;
    cursor: help;
  }

  .custom-sort-warning svg {
    flex-shrink: 0;
  }

  .custom-sort-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .custom-sort-prefix {
    font-size: 12px;
    color: var(--text-secondary);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
      monospace;
  }

  .custom-sort-separator {
    font-size: 12px;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .custom-sort-row .select-wrapper {
    min-width: 100px;
  }

  .apply-sort-button {
    padding: 5px 12px;
    background: var(--accent-color);
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: filter 0.15s;
  }

  .apply-sort-button:hover {
    filter: brightness(1.1);
  }

  .custom-sort-preview {
    font-size: 11px;
    color: var(--text-secondary);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
      monospace;
    background: var(--bg-tertiary);
    padding: 4px 8px;
    border-radius: 3px;
  }

  .exclusions-section {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border-color);
  }

  .exclusions-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .exclusions-header .select-wrapper {
    flex: 1;
    min-width: 140px;
    max-width: 220px;
  }

  .exclusion-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }

  .exclusion-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    background: var(--accent-bg);
    border-radius: 3px;
    font-size: 12px;
    color: var(--accent-color);
  }

  .remove-btn {
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

  .remove-btn:hover {
    opacity: 1;
  }

  .settings-button {
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
    flex-shrink: 0;
  }

  .settings-button:hover {
    background: var(--row-hover);
    color: var(--text-primary);
  }

  .subcategory-group {
    position: relative;
  }

  .category-row,
  .subcategory-row {
    display: flex;
    gap: 4px;
    align-items: stretch;
  }

  .category-row .select-wrapper,
  .subcategory-row .select-wrapper {
    flex: 1;
  }

  .remove-level-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    padding: 0;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .remove-level-btn:hover {
    background: #ef4444;
    color: white;
    border-color: #ef4444;
  }

  .add-level-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    padding: 0;
    background: var(--bg-tertiary);
    border: 1px dashed var(--border-color);
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 13px;
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s,
      border-color 0.15s;
  }

  .add-level-btn:hover:not(:disabled) {
    background: var(--accent-bg);
    color: var(--accent-color);
    border-color: var(--accent-color);
  }

  .add-level-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .plus-icon {
    font-size: 16px;
    font-weight: bold;
    line-height: 1;
  }
</style>
