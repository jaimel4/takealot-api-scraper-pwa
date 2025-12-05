import {
  isSortBy,
  SortBy,
  SortOrder,
  type Product,
  type ProductResponse,
  type ProductView,
  type RawProductView,
  type SortOptions,
  type TakealotCategory,
  type TakealotDepartment,
} from "./takealot/types";
import { TakealotApi } from "./takealot/api";
import {
  appendFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path, { parse } from "node:path";
import { pipeline } from "node:stream/promises";
import { appendFile, stat } from "node:fs/promises";
import { logger } from "./logger";
import * as readline from "node:readline/promises";
import ExcelJS from "exceljs";
import { gotScraping } from "got-scraping";

/**
 *
 * --path "Garden, Pool & Patio:DIY Tools & Machinery:Workwear & PPE" --exclude "Power Tools & Machinery" --exclude "Workwear & PPE"
 */
export const parsePath = async (
  api: TakealotApi,
  path: string,
  exclude: string[] = []
): Promise<{
  department: TakealotDepartment;
  categories: TakealotCategory[];
  excludedCategories: TakealotCategory[];
}> => {
  const [depName, catName, supCatName] = path.split(":");

  console.log(path);

  const department = await api.getDepartmentByName(depName);
  const categories: TakealotCategory[] = [];
  const excludedCategories: TakealotCategory[] = [];

  let rootCategory: TakealotCategory | undefined = undefined;

  if (!catName) throw new Error(`Failed to parse category name`);
  rootCategory = await api.getDepartmentCategoryByName(
    department,
    catName,
    rootCategory
  );

  if (supCatName) {
    rootCategory = await api.getDepartmentCategoryByName(
      department,
      supCatName,
      rootCategory
    );
  }

  const catsOnRoot = await api.listDepartmentCategories(
    department,
    rootCategory
  );

  if (catsOnRoot.length === 0 || exclude.length === 0) {
    categories.push(rootCategory);
  } else {
    for (const cat of catsOnRoot) {
      const isExcluded =
        exclude.find((exCatName) =>
          exCatName.toLowerCase().includes(cat.name.toLowerCase())
        ) !== undefined;

      if (isExcluded) excludedCategories.push(cat);
      else categories.push(cat);
    }
  }

  return { department, categories, excludedCategories };
};

/**
 *
 * --sort "Field:price+Ascending"
 * --sort "ReleaseDate+Descending"
 */
const parseSort = (query: string): SortOptions => {
  const [by, order] = query.split("+");

  if (order !== SortOrder.ASC && order !== SortOrder.DESC) {
    throw new Error(
      `Failed to parse sorting order from: ${order}; Valid value is ${SortOrder.ASC} or ${SortOrder.DESC}`
    );
  }

  if (by.startsWith(SortBy.FIELD)) {
    const [, field] = by.split(":");

    return {
      field,
      by: SortBy.FIELD,
      order,
    };
  } else {
    if (!isSortBy(by)) throw new Error(`Failed to parse sort type from: ${by}`);

    return {
      by,
      order,
    };
  }
};

// export const getRunningArguments = async (
//   api: TakealotApi
// ): Promise<RunningArguments> => {
//   const args = parse<CliArguments>({
//     path: String,
//     exclude: { type: String, multiple: true, optional: true },
//     amount: Number,
//     sort: String,
//   });

//   const sortOptions = parseSort(args.sort);
//   const { department, categories, excludedCategories } = await parsePath(
//     api,
//     args.path,
//     args.exclude
//   );

//   console.log("department", department);
//   console.log("categories", categories);
//   console.log("excludedCategories", excludedCategories);

//   return {
//     sortOptions,
//     department,
//     categories,
//     amount: args.amount,
//     excludedCategories,
//   };
// };

export const isSortApiSupported = (options: SortOptions): boolean => {
  if (
    (options.by === SortBy.RELEASE_DATE && options.order === SortOrder.DESC) ||
    (options.by === SortBy.RATING && options.order === SortOrder.DESC) ||
    options.by === SortBy.PRICE
  ) {
    return true;
  } else return false;
};

export const mapToProduct = (r: ProductResponse): Product => {
  let sku = "";

  if (r.data_layer.productlineSku)
    sku = r.data_layer.productlineSku?.toString();
  if (r.data_layer.sku) sku = r.data_layer.sku.toString();

  return {
    title: r.title,
    brand: r.core.brand || "",
    sku,
    price: r.data_layer.totalPrice,
    rating: r.core.star_rating,
    reviews: r.core.reviews,
    image: r.gallery.images[0].replace("{size}", "zoom"),
    "category/subcategory":
      r.product_information.categories.displayable_text.replaceAll(
        /\([^\(\)]+?\)|^-\s*/g,
        ""
      ),
    url: r.desktop_href,
  };
};

export const mapToProductView = (r: RawProductView, category: string = ''): ProductView => {
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
    image: r.product_views.gallery.images[0].replace("{size}", "zoom"),
    category,
  };
};

export const createDirIfNotExists = (path: string) => {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
};

export const flashToCache = (catSlug: string, record: any) => {
  if (!process.env.CACHE_DIR_PATH)
    throw new Error(`Variable 'CACHE_DIR_PATH' is missing`);

  if (!existsSync(process.env.CACHE_DIR_PATH)) {
    mkdirSync(process.env.CACHE_DIR_PATH);
  }

  const path = `${process.env.CACHE_DIR_PATH}/${catSlug}`;
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf-8");
};

const copyFileStream = async (src: string, dest: string) => {
  await pipeline(
    createReadStream(src),
    createWriteStream(dest, { flags: "a" })
  );
};

export const mergeFromCache = async (
  catSlug: string,
  toPath: string
): Promise<boolean | undefined> => {
  if (!process.env.CACHE_DIR_PATH)
    throw new Error(`Variable 'CACHE_DIR_PATH' is missing`);

  if (!process.env.CACHE_TTL)
    throw new Error(`Variable 'CACHE_TTL' is missing`);

  createDirIfNotExists(process.env.CACHE_DIR_PATH);

  const pathToCacheFile = path.join(process.env.CACHE_DIR_PATH, catSlug);

  if (!existsSync(pathToCacheFile)) return undefined;
  const stats = statSync(pathToCacheFile);

  // cache still valid
  if (
    stats.birthtimeMs <
    new Date().getTime() + parseInt(process.env.CACHE_TTL)
  ) {
    try {
      await copyFileStream(pathToCacheFile, toPath);
      return true;
    } catch (error) {
      return undefined;
    }
  } else {
    return false;
  }
};

export const fetchViewsForCategory = async (
  api: TakealotApi,
  department: TakealotDepartment,
  category: TakealotCategory,
  sort: string,
  path: string,
  amount: number | undefined = undefined
): Promise<void> => {
  let vCounter = 0;
  let cursorAfter: string | undefined = undefined;

  while (true) {
    const { views, after } = await api.getProductsViewsPage(
      department,
      category,
      sort,
      cursorAfter
    );

    for (const view of views) {
      ++vCounter;
      await appendFile(path, JSON.stringify(view) + "\n");

      // cache only updated on full product list gathering
      if (!amount) {
        flashToCache(category.slug, view);
      }

      if (amount && amount === vCounter) {
        logger.info({ slug: category.slug, amount }, `Reached desired amount`);

        return;
      }
    }

    if (after.length === 0) {
      logger.info(
        { slug: category.slug, amount: vCounter },
        `Fetched products for category`
      );
      break;
    } else cursorAfter = after;
  }
};

export const getNSortedFromFile = async (
  fromPath: string,
  sortOptions: SortOptions,
  amount: number
): Promise<Array<[string, any]>> => {
  const readStream = createReadStream(fromPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: readStream });

  const objects: Array<[string, string | number]> = [];

  for await (const line of rl) {
    if (line.trim()) {
      try {
        const obj = JSON.parse(line.trim()) as ProductView;
        if (sortOptions.field && sortOptions.field in obj) {
          const value = obj[sortOptions.field as keyof ProductView];
          if (value !== null) objects.push([obj.id, value]);
        }
      } catch (err) {
        console.warn(`Skipping invalid JSON line: ${line}`);
      }
    }
  }

  objects.sort((a, b) => {
    const aField = a[1];
    const bField = b[1];

    if (aField < bField) return sortOptions.order === SortOrder.ASC ? -1 : 1;
    if (aField > bField) return sortOptions.order === SortOrder.ASC ? 1 : -1;
    return 0;
  });

  return objects.slice(0, amount);
};

export const getNFromFile = async (
  fromPath: string,
  amount: number
): Promise<string[]> => {
  const readStream = createReadStream(fromPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: readStream });

  const objects: string[] = [];

  let counter = 0;
  for await (const line of rl) {
    if (line.trim() && counter < amount) {
      counter++;
      try {
        const obj = JSON.parse(line.trim()) as ProductView;
        objects.push(obj.id);
      } catch (err) {
        console.warn(`Skipping invalid JSON line: ${line}`);
      }
    }
  }

  return objects;
};

export const wrapExcelInsertImages = async (
  data: Product[],
  outputPath: string
): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Products");

  // Add header row based on object keys
  const headers = Object.keys(data[0]);
  worksheet.addRow(headers);

  // Add data rows
  for (const item of data) {
    const rowValues = headers.map((key) =>
      key === "image" ? "" : item[key as keyof Product]
    );
    const row = worksheet.addRow(rowValues);

    // Insert image if available
    if (item.image) {
      try {
        const imageBuffer = await downloadImage(item.image);
        const imageId = workbook.addImage({
          buffer: imageBuffer,
          extension: "png",
        });

        const rowIndex = row.number;
        const colIndex = headers.indexOf("image") + 1;

        worksheet.addImage(imageId, {
          tl: { col: colIndex - 1, row: rowIndex - 1 },
          ext: { width: 100, height: 100 },
          editAs: "oneCell",
        });

        // Adjust row height
        worksheet.getRow(rowIndex).height = 80;
      } catch (error) {
        console.warn(
          `Failed to insert image for product sku: ${item.sku} - ${error}`
        );
      }
    }
  }

  // Auto-size columns
  worksheet.columns.forEach((column) => {
    let maxLength = 10;
    // @ts-ignore
    column.eachCell({ includeEmpty: true }, (cell) => {
      const len = cell.value?.toString().length ?? 0;
      if (len > maxLength) maxLength = len;
    });
    column.width = maxLength + 2;
  });

  await workbook.xlsx.writeFile(outputPath);

  logger.info({ path: outputPath }, `Products written to file`);
};

const downloadImage = async (image: string): Promise<Buffer> => {
  const response = await gotScraping(image, {
    responseType: "buffer",
  });

  if (response.statusCode === 200) return response.body;
  else throw new Error(`Can't download image: ${image}`);
};

export const deleteIfExists = (targetPath: string): void => {
  if (existsSync(targetPath)) {
    const stats = statSync(targetPath);

    if (stats.isDirectory()) {
      rmSync(targetPath, { recursive: true, force: true });
    } else {
      unlinkSync(targetPath);
    }
  }
};
