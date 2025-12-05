import { gotScraping } from "got-scraping";
import type {
  Product,
  ProductResponse,
  ProductsViewsResponse,
  ProductView,
  TakealotApiResponseCategories,
  TakealotApiResponseDepartments,
  TakealotCategory,
  TakealotDepartment,
} from "./types";
import { logger } from "./../logger";
import { mapToProduct, mapToProductView } from "./../utils";

export class TakealotApi {
  apiEndpoint = "https://api.takealot.com/rest/";

  apiPaths = {
    departments: "/cms/merchandised-departments?display_only=True",
    categories: "/searches/facets",
    tree: "/cms/flyouts?is_published=true&legacy=false",
    views: "/searches/products",
    product: "/product-details/",
  };

  version: string;

  constructor(version: string) {
    this.version = version;
  }

  async listDepartments(): Promise<TakealotDepartment[]> {
    const apiUrl = new URL(
      `${this.apiEndpoint}${this.version}${this.apiPaths.departments}`
    );

    try {
      const response = await gotScraping<TakealotApiResponseDepartments>(
        apiUrl.toString(),
        {
          responseType: "json",
        }
      );

      if (response.statusCode !== 200)
        throw new Error(`Can't fetch departments`);

      return response.body.merchandised_departments.map((d) => ({
        slug: d.slug,
        name: d.name,
      }));
    } catch (error) {
      logger.error(error);
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
      const response = await gotScraping<TakealotApiResponseCategories>(
        apiUrl.toString(),
        {
          responseType: "json",
        }
      );

      if (response.statusCode !== 200)
        throw new Error(`Can't fetch departments`);

      const categoriesFacet = response.body.sections.facets.results.find(
        (f) => f.facet.type === "tree_facet"
      );

      if (!categoriesFacet || categoriesFacet.facet.type !== "tree_facet")
        throw new Error(`Can't find categories`);

      const f = categoriesFacet.facet.tree_facet.entries.map((f) => ({
        department_slug: f.department_slug,
        slug: f.category_slug,
        name: f.display_value,
      }));

      console.log(f);

      return f;
    } catch (error) {
      logger.error(error);
      return [];
    }
  }

  async getDepartmentByName(name: string): Promise<TakealotDepartment> {
    const departments = await this.listDepartments();

    const matched = departments.find((d) =>
      d.name.toLowerCase().includes(name.toLowerCase())
    );
    if (!matched) throw new Error(`Can't find department by name:${name}`);

    return matched;
  }

  async getDepartmentCategoryByName(
    department: TakealotDepartment,
    name: string,
    parentCategory?: TakealotCategory
  ): Promise<TakealotCategory> {
    const categories = await this.listDepartmentCategories(
      department,
      parentCategory
    );

    const matched = categories.find((c) =>
      c.name.toLowerCase().includes(name.toLowerCase())
    );
    if (!matched) throw new Error(`Can't find category by name:${name}`);

    return matched;
  }

  async getProductsViewsPage(
    department: TakealotDepartment,
    category: TakealotCategory,
    sort: string,
    after?: string
  ): Promise<{ views: ProductView[]; after: string }> {
    const apiUrl = new URL(
      `${this.apiEndpoint}${this.version}${this.apiPaths.views}`
    );

    if (after) apiUrl.searchParams.append("after", after);

    apiUrl.searchParams.append("department_slug", department.slug);
    apiUrl.searchParams.append("category_slug", category.slug);
    apiUrl.searchParams.append("sort", sort.replace("+", " "));

    const response = await gotScraping<ProductsViewsResponse>(
      apiUrl.toString(),
      {
        responseType: "json",
      }
    );

    if (response.statusCode !== 200) {
      throw new Error(`Can't fetch products views`);
    }

    const categoryPath = category.name;

    return {
      views: response.body.sections.products.results.map((r) =>
        mapToProductView(r, categoryPath)
      ),
      after: response.body.sections.products.paging.next_is_after,
    };
  }

  async getProduct(id: string): Promise<Product> {
    const apiUrl = new URL(
      `${this.apiEndpoint}${this.version}${this.apiPaths.product}${id}`
    );

    const response = await gotScraping<ProductResponse>(apiUrl.toString(), {
      responseType: "json",
    });

    if (response.statusCode !== 200) {
      throw new Error(`Can't fetch product`);
    }

    return mapToProduct(response.body);
  }
}
