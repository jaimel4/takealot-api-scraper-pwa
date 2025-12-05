export type CliArguments = {
  path: string;
  exclude?: string[];
  amount: number;
  sort: string;
};

export enum SortBy {
  RELEASE_DATE = "ReleaseDate", // only desc
  RATING = "Rating", // only desc
  PRICE = "Price", // price goes both ways
  RELEVANCE = "Relevance", // don't have order
  FIELD = "Field",
}

export const isSortBy = (value: string): value is SortBy => {
  return Object.values(SortBy).includes(value as SortBy);
};

export enum SortOrder {
  DESC = "Descending",
  ASC = "Ascending",
}

export type SortOptions = {
  by:
    | SortBy.RELEASE_DATE
    | SortBy.RATING
    | SortBy.PRICE
    | SortBy.RELEVANCE
    | SortBy.FIELD;
  order: SortOrder.DESC | SortOrder.ASC;
  field?: string;
};

export type RunningArguments = {
  sortOptions: SortOptions;
  amount: number;
  department: TakealotDepartment;
  categories: TakealotCategory[];
  excludedCategories: TakealotCategory[];
};

export type TakealotDepartment = {
  slug: string;
  name: string;
};

export type TakealotCategory = {
  department_slug: string;
  slug: string;
  name: string;
};

export type TakealotApiResponseDepartments = {
  merchandised_departments: Array<{
    department_id: number;
    is_displayed: boolean;
    name: string;
    slug: string;
  }>;
};

export type GenericDiscrete = {
  type: "discrete_facet" | "range_facet";
};

export type FacetTree = {
  type: "tree_facet";
  tree_facet: {
    entries: Array<{
      display_value: string;
      department_slug: string;
      category_slug: string;
    }>;
  };
};

export type Facet = {
  type: "facet";
  facet: FacetTree | GenericDiscrete;
};

export type TakealotApiResponseCategories = {
  sections: {
    facets: {
      results: Array<Facet>;
    };
  };
};

export type ProductView = {
  id: string;
  title: string;
  brand: string | null;
  url: string;
  price: number;
  rating: number;
  reviews: number;
  image: string;
  category: string;
};

export type ProductTableRow = {
  title: string;
  brand: string;
  sku: string;
  price: number;
  rating: number;
  reviews: number;
  image: string;
  "category/subcategory": string;
  url: string;
};

export type RawProductView = {
  type: "product_views";
  product_views: {
    core: {
      title: string;
      slug: string;
      brand: null | string;
      star_rating: number;
      reviews: number;
    };
    gallery: {
      images: string[];
    };
    enhanced_ecommerce_impression: {
      ecommerce: {
        impressions: Array<{
          id: string;
          price: number;
        }>;
      };
    };
  };
};

export type ProductsViewsResponse = {
  sections: {
    products: {
      results: RawProductView[];
      paging: {
        next_is_after: string;
        previous_is_before: string;
      };
    };
  };
};

export type ProductResponse = {
  title: string;
  desktop_href: string;
  core: {
    brand: string;
    star_rating: number;
    reviews: number;
  };
  data_layer: {
    sku: null | number;
    productlineSku: null | number;
    totalPrice: number;
  };
  gallery: {
    images: string[];
  };
  product_information: {
    categories: {
      displayable_text: string;
    };
  };
};

export type Product = {
  title: string;
  brand: string;
  sku: string;
  price: number;
  rating: number;
  reviews: number;
  image: string;
  "category/subcategory": string;
  url: string;
};
