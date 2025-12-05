import { fetch } from "@tauri-apps/plugin-http";
import type {
  ProductView,
  ProductTableRow,
  ProductResponse,
  TakealotApiResponseCategories,
  TakealotApiResponseDepartments,
  TakealotCategory,
  TakealotDepartment,
  ProductsViewsResponse,
} from "./types";

/**
 * Browser-compatible Takealot API client using Tauri HTTP plugin
 */
export class TakealotBrowserApi {
  apiEndpoint = "https://api.takealot.com/rest/";

  apiPaths = {
    departments: "/cms/merchandised-departments?display_only=True",
    categories: "/searches/facets",
    tree: "/cms/flyouts?is_published=true&legacy=false",
    views: "/searches/products",
    product: "/product-details/",
  };

  version: string;
  abortController: AbortController | null = null;

  constructor(version: string) {
    this.version = version;
  }

  /**
   * Cancel any in-flight requests
   */
  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Create a new AbortController for the current request chain
   */
  private startRequest(): AbortSignal {
    this.abort(); // Cancel any previous requests
    this.abortController = new AbortController();
    return this.abortController.signal;
  }

  private mapToProductView(
    r: ProductsViewsResponse["sections"]["products"]["results"][0],
    category: string
  ): ProductView {
    const impr =
      r.product_views.enhanced_ecommerce_impression.ecommerce.impressions[0];
    const id = impr.id;
    const url = `https://www.takealot.com/${r.product_views.core.slug}/${id}`;

    return {
      id,
      title: r.product_views.core.title,
      brand: r.product_views.core.brand,
      url,
      price: impr.price,
      rating: r.product_views.core.star_rating,
      reviews: r.product_views.core.reviews,
      image: r.product_views.gallery.images[0]?.replace("{size}", "zoom") || "",
      category,
    };
  }

  async listDepartments(): Promise<TakealotDepartment[]> {
    const apiUrl = new URL(
      `${this.apiEndpoint}${this.version}${this.apiPaths.departments}`
    );

    try {
      const response = await fetch(apiUrl.toString());

      if (!response.ok) throw new Error(`Can't fetch departments`);

      const data: TakealotApiResponseDepartments = await response.json();

      return data.merchandised_departments.map((d) => ({
        slug: d.slug,
        name: d.name,
      }));
    } catch (error) {
      console.error("Failed to fetch departments:", error);
      return [];
    }
  }

  async listDepartmentCategories(
    department: TakealotDepartment,
    category?: TakealotCategory
  ): Promise<TakealotCategory[]> {
    const apiUrl = new URL(
      `${this.apiEndpoint}${this.version}${this.apiPaths.categories}`
    );

    apiUrl.searchParams.append("department_slug", department.slug);
    if (category) {
      apiUrl.searchParams.append("category_slug", category.slug);
    }

    try {
      const response = await fetch(apiUrl.toString());

      if (!response.ok) throw new Error(`Can't fetch categories`);

      const data: TakealotApiResponseCategories = await response.json();

      const categoriesFacet = data.sections.facets.results.find(
        (f) => f.facet.type === "tree_facet"
      );

      if (!categoriesFacet || categoriesFacet.facet.type !== "tree_facet") {
        throw new Error(`Can't find categories`);
      }

      const f = categoriesFacet.facet.tree_facet.entries.map((f) => ({
        department_slug: f.department_slug,
        slug: f.category_slug,
        name: f.display_value,
      }));

      console.log(f);

      return f;
    } catch (error) {
      console.error("Failed to fetch categories:", error);
      return [];
    }
  }

  async getProductsViewsPage(
    department: TakealotDepartment,
    category: TakealotCategory,
    sort: string,
    after?: string,
    signal?: AbortSignal
  ): Promise<{ views: ProductView[]; after: string }> {
    const apiUrl = new URL(
      `${this.apiEndpoint}${this.version}${this.apiPaths.views}`
    );

    if (after) apiUrl.searchParams.append("after", after);

    apiUrl.searchParams.append("department_slug", department.slug);
    apiUrl.searchParams.append("category_slug", category.slug);
    apiUrl.searchParams.append("sort", sort.replace("+", " "));

    const response = await fetch(apiUrl.toString(), { signal });

    if (!response.ok) {
      throw new Error(`Can't fetch products views`);
    }

    const data: ProductsViewsResponse = await response.json();

    const categoryPath = category.name;

    return {
      views: data.sections.products.results.map((r) =>
        this.mapToProductView(r, categoryPath)
      ),
      after: data.sections.products.paging.next_is_after,
    };
  }

  async getProduct(id: string, signal?: AbortSignal): Promise<ProductTableRow> {
    const apiUrl = new URL(
      `${this.apiEndpoint}${this.version}${this.apiPaths.product}${id}`
    );

    const response = await fetch(apiUrl.toString(), { signal });

    if (!response.ok) {
      throw new Error(`Can't fetch product`);
    }

    const r: ProductResponse = await response.json();

    let sku = "";
    if (r.data_layer.productlineSku)
      sku = r.data_layer.productlineSku.toString();
    if (r.data_layer.sku) sku = r.data_layer.sku.toString();

    return {
      title: r.title,
      brand: r.core.brand || "",
      sku,
      price: r.data_layer.totalPrice,
      rating: r.core.star_rating,
      reviews: r.core.reviews,
      image: r.gallery.images[0]?.replace("{size}", "zoom") || "",
      "category/subcategory":
        r.product_information.categories.displayable_text.replaceAll(
          /\([^\(\)]+?\)|^-\s*/g,
          ""
        ),
      url: r.desktop_href,
    };
  }

  async getProductsWithDetails(
    department: TakealotDepartment,
    category: TakealotCategory,
    sort: string,
    limit: number,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<ProductTableRow[]> {
    const signal = this.startRequest();

    // Fetch product views pages until we have enough
    const allViews: ProductView[] = [];
    let cursorAfter: string | undefined = undefined;

    while (allViews.length < limit) {
      if (signal.aborted) {
        throw new DOMException("Request cancelled", "AbortError");
      }

      const { views, after } = await this.getProductsViewsPage(
        department,
        category,
        sort,
        cursorAfter,
        signal
      );

      allViews.push(...views);

      if (!after || after.length === 0) {
        break; // No more pages
      }
      cursorAfter = after;
    }

    const limitedViews = allViews.slice(0, limit);

    // Fetch full details for each product
    const products: ProductTableRow[] = [];
    for (let i = 0; i < limitedViews.length; i++) {
      // Check if aborted
      if (signal.aborted) {
        throw new DOMException("Request cancelled", "AbortError");
      }

      try {
        const product = await this.getProduct(limitedViews[i].id, signal);
        products.push(product);
      } catch (error) {
        // Re-throw abort errors
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        // Fallback to view data if product details fail
        console.error(
          `Failed to fetch product ${limitedViews[i].id}, using view data:`,
          error
        );
        const view = limitedViews[i];
        products.push({
          title: view.title,
          brand: view.brand || "",
          sku: view.id,
          price: view.price,
          rating: view.rating,
          reviews: view.reviews,
          image: view.image,
          "category/subcategory": view.category,
          url: view.url,
        });
      }
      onProgress?.(i + 1, limitedViews.length);
    }

    return products;
  }

  /**
   * Fetch ALL product views for a category (for custom sorting/caching)
   * This fetches all pages of products
   */
  async getAllProductViews(
    department: TakealotDepartment,
    category: TakealotCategory,
    onProgress?: (loaded: number) => void
  ): Promise<ProductView[]> {
    const signal = this.startRequest();
    const allViews: ProductView[] = [];
    let cursorAfter: string | undefined = undefined;

    while (true) {
      // Check if aborted
      if (signal.aborted) {
        throw new DOMException("Request cancelled", "AbortError");
      }

      const { views, after } = await this.getProductsViewsPage(
        department,
        category,
        "Relevance", // Use relevance for fetching all, we'll sort locally
        cursorAfter,
        signal
      );

      allViews.push(...views);
      onProgress?.(allViews.length);

      if (!after || after.length === 0) {
        break;
      }
      cursorAfter = after;
    }

    return allViews;
  }

  /**
   * Fetch ALL product views for multiple categories (excluding some)
   * Queries each included category and combines results
   */
  async getAllProductViewsForCategories(
    department: TakealotDepartment,
    categories: TakealotCategory[],
    onProgress?: (loaded: number) => void
  ): Promise<ProductView[]> {
    const signal = this.startRequest();
    const allViews: ProductView[] = [];

    for (const category of categories) {
      let cursorAfter: string | undefined = undefined;

      while (true) {
        if (signal.aborted) {
          throw new DOMException("Request cancelled", "AbortError");
        }

        const { views, after } = await this.getProductsViewsPage(
          department,
          category,
          "Relevance",
          cursorAfter,
          signal
        );

        allViews.push(...views);
        onProgress?.(allViews.length);

        if (!after || after.length === 0) {
          break;
        }
        cursorAfter = after;
      }
    }

    return allViews;
  }

  /**
   * Fetch products with details for multiple categories
   * Queries each category and combines results up to the limit
   */
  async getProductsWithDetailsForCategories(
    department: TakealotDepartment,
    categories: TakealotCategory[],
    sort: string,
    limit: number,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<ProductTableRow[]> {
    const signal = this.startRequest();
    const allViews: ProductView[] = [];

    // Fetch views from all categories
    for (const category of categories) {
      let cursorAfter: string | undefined = undefined;

      while (allViews.length < limit) {
        if (signal.aborted) {
          throw new DOMException("Request cancelled", "AbortError");
        }

        const { views, after } = await this.getProductsViewsPage(
          department,
          category,
          sort,
          cursorAfter,
          signal
        );

        allViews.push(...views);

        if (!after || after.length === 0) {
          break;
        }
        cursorAfter = after;
      }

      if (allViews.length >= limit) {
        break;
      }
    }

    const limitedViews = allViews.slice(0, limit);

    // Fetch full details for each product
    const products: ProductTableRow[] = [];
    for (let i = 0; i < limitedViews.length; i++) {
      if (signal.aborted) {
        throw new DOMException("Request cancelled", "AbortError");
      }

      try {
        const product = await this.getProduct(limitedViews[i].id, signal);
        products.push(product);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        console.error(
          `Failed to fetch product ${limitedViews[i].id}, using view data:`,
          error
        );
        const view = limitedViews[i];
        products.push({
          title: view.title,
          brand: view.brand || "",
          sku: view.id,
          price: view.price,
          rating: view.rating,
          reviews: view.reviews,
          image: view.image,
          "category/subcategory": view.category,
          url: view.url,
        });
      }
      onProgress?.(i + 1, limitedViews.length);
    }

    return products;
  }

  /**
   * Get full product details for a list of product views
   */
  async getProductDetailsForViews(
    views: ProductView[],
    onProgress?: (loaded: number, total: number) => void
  ): Promise<ProductTableRow[]> {
    const signal = this.startRequest();
    const products: ProductTableRow[] = [];

    for (let i = 0; i < views.length; i++) {
      // Check if aborted
      if (signal.aborted) {
        throw new DOMException("Request cancelled", "AbortError");
      }

      try {
        const product = await this.getProduct(views[i].id, signal);
        products.push(product);
      } catch (error) {
        // Re-throw abort errors
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        // Fallback to view data if product details fail
        console.error(
          `Failed to fetch product ${views[i].id}, using view data:`,
          error
        );
        const view = views[i];
        products.push({
          title: view.title,
          brand: view.brand || "",
          sku: view.id,
          price: view.price,
          rating: view.rating,
          reviews: view.reviews,
          image: view.image,
          "category/subcategory": view.category,
          url: view.url,
        });
      }
      onProgress?.(i + 1, views.length);
    }

    return products;
  }
}
