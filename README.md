## Installation

This scraper is written in **TypeScript**, so you'll need [Node.js](https://nodejs.org/en) installed on your machine.

To install all dependencies:

```sh
npm install
```

---

## Building

This is a [Tauri](https://tauri.app/) desktop application. You'll need [Rust](https://rustup.rs/) installed in addition to Node.js.

### macOS

Build a universal binary (runs on both Intel and Apple Silicon Macs):

```sh
# One-time: add Intel target
rustup target add x86_64-apple-darwin

# Build
npm run build:mac
```

Output: `src-tauri/target/universal-apple-darwin/release/bundle/`

### Windows

Build on a Windows machine with [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) installed:

```sh
npm run build:win
```

Output: `src-tauri/target/release/bundle/`

> **Note**: Cross-compiling from macOS to Windows is not supported. Use GitHub Actions or a Windows VM for Windows builds.

---

## Configuration

All configuration is handled via a `.env` file located in the project root.

Example `.env`:

```env
TAKEALOT_API_VERSION='v-1-16-0'       # Constant Takealot API version
CACHE_DIR_PATH='views.cache'          # Path to where cache will be stored
CACHE_TTL=86400000                    # Cache validity in milliseconds (24 hours)
```

---

## Usage

Run the scraper using the following CLI options:

| Option              | Description                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `--path <string>`   | **(Required)** Full category path in format `<Department>:<Category>[:<Subcategory>]`            |
| `--amount <number>` | **(Required)** Number of products to fetch                                                       |
| `--sort <string>`   | **(Required)** Sorting method to apply                                                           |
| `--exclude <name>`  | Optional subcategory names to exclude from the fetched dataset (can be specified multiple times) |

---

### Sorting Options

The website API supports the following predefined sort options:

- `ReleaseDate+Descending`
- `Rating+Descending`
- `Price+Descending`
- `Price+Ascending`

If one of these is used, sorting is delegated to the API.

For custom sorting, the bot supports:

- `Field:<fieldname>+Descending`
- `Field:<fieldname>+Ascending`

This performs sorting locally on a fetched dataset using the specified `<fieldname>`.

> **Note**: If a sort method is not supported by the API, the bot will fetch the entire dataset and sort it locally. This can take time, especially for large product groups. To mitigate this, a caching system is used so that repeated operations on the same data don't require re-fetching.

---

### Output

Once products are fetched and sorted, they are written to an Excel file (including downloaded images).
The file is saved to the `results/` directory and named using the timestamp of the operation start.

---

### Examples

#### Example: Fetch 200 "DIY Tools & Machinery" products, excluding "Power Tools & Machinery" and "Workwear & PPE", sorted by most reviews

```sh
npm run get-products -- \
  --path 'Garden, Pool & Patio:DIY Tools & Machinery' \
  --amount 200 \
  --sort "Field:reviews+Descending" \
  --exclude "Power Tools & Machinery" \
  --exclude "Workwear & PPE"
```

#### Example: Fetch 100 "Hand Tools" products sorted from most to least expensive

```sh
npm run get-products -- \
  --path 'Garden, Pool & Patio:DIY Tools & Machinery:Hand Tools' \
  --amount 100 \
  --sort "Price+Descending"
```

#### Example: List available departments

```sh
npm run list
```

#### Example: List available categories/subcategories

```sh
npm run list -- --path "Garden, Pool & Patio:DIY Tools & Machinery"
```

---
# takealot-api-scraper-pwa
# takealot-api-scraper-pwa
# takealot-api-scraper-pwa
