import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  build: {
    // Preserve the browser support of the previous Vite build.
    target: ["es2020", "edge88", "firefox78", "chrome87", "safari14"],
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        cart_group_calculator: resolve(__dirname, "cart_group_calculator.html"),
        webike_quote_wizard: resolve(__dirname, "webike_quote_wizard.html"),
      },
    },
  },
});
