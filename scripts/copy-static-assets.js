const fs = require("fs/promises");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

async function copyDirectory(name) {
  const source = path.join(rootDir, name);
  const target = path.join(distDir, name);
  await fs.cp(source, target, { recursive: true, force: true, errorOnExist: false });
}

async function ensureNoJekyll() {
  const source = path.join(rootDir, ".nojekyll");
  const target = path.join(distDir, ".nojekyll");

  try {
    await fs.copyFile(source, target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await fs.writeFile(target, "");
  }
}

async function main() {
  await fs.mkdir(distDir, { recursive: true });
  await copyDirectory("assets");
  await copyDirectory("data");
  await ensureNoJekyll();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
