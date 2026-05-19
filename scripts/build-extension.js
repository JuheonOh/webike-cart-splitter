const { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const projectRoot = join(__dirname, "..");
const sourceDir = join(projectRoot, "src", "extension");
const distDir = join(projectRoot, "dist");
const distExtensionDir = join(distDir, "extension");
const stylesDir = join(sourceDir, "styles", "content");
const iconsDir = join(sourceDir, "icons");

const contentScriptFiles = [
  "00-bootstrap.js",
  "panel.js",
  "find-parts.js",
  "cart-actions.js",
  "renderer.js",
  "progress-state.js",
  "cart-page.js",
  "input-parser.js",
  "webike-product.js",
  "errors-utils.js",
];

const contentStyleFiles = [
  "00-base.css",
  "10-layout.css",
  "20-buttons.css",
  "30-feedback.css",
  "40-cards.css",
  "90-responsive.css",
];

assertReadableFiles([
  join(sourceDir, "manifest.json"),
  join(sourceDir, "service-worker.js"),
  join(sourceDir, "fonts", "D2Coding.woff2"),
  join(iconsDir, "icon16.png"),
  join(iconsDir, "icon32.png"),
  join(iconsDir, "icon48.png"),
  join(iconsDir, "icon128.png"),
  ...contentScriptFiles.map((fileName) => join(sourceDir, "content", fileName)),
  ...contentStyleFiles.map((fileName) => join(stylesDir, fileName)),
]);

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distExtensionDir, { recursive: true });

cpSync(join(sourceDir, "manifest.json"), join(distDir, "manifest.json"));
cpSync(join(sourceDir, "service-worker.js"), join(distExtensionDir, "service-worker.js"));
cpSync(join(sourceDir, "fonts"), join(distExtensionDir, "fonts"), { recursive: true });
mkdirSync(join(distExtensionDir, "icons"), { recursive: true });
[16, 32, 48, 128].forEach((size) => {
  cpSync(join(iconsDir, `icon${size}.png`), join(distExtensionDir, "icons", `icon${size}.png`));
});

const contentScript = contentScriptFiles
  .map((fileName) => readFileSync(join(sourceDir, "content", fileName), "utf8").trimEnd())
  .join("\n\n");
writeFileSync(join(distExtensionDir, "content-script.js"), `${contentScript}\n`);

const contentStyle = contentStyleFiles
  .map((fileName) => readFileSync(join(stylesDir, fileName), "utf8").trimEnd())
  .join("\n\n");
writeFileSync(join(distExtensionDir, "content-style.css"), `${contentStyle}\n`);

removeDotStoreFiles(distDir);

function assertReadableFiles(filePaths) {
  const missing = filePaths.filter((filePath) => {
    try {
      return !statSync(filePath).isFile();
    } catch {
      return true;
    }
  });
  if (missing.length) {
    throw new Error(`빌드 소스 파일을 찾지 못했습니다:\n${missing.map((filePath) => `- ${filePath}`).join("\n")}`);
  }
}

function removeDotStoreFiles(directory) {
  readdirSync(directory).forEach((name) => {
    const filePath = join(directory, name);
    if (name === ".DS_Store") {
      rmSync(filePath, { force: true });
      return;
    }
    if (statSync(filePath).isDirectory()) removeDotStoreFiles(filePath);
  });
}
