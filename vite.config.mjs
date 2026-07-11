import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [vue()],
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        cart_group_calculator: resolve(__dirname, "cart_group_calculator.html"),
        webike_quote_wizard: resolve(__dirname, "webike_quote_wizard.html"),
        styleguide: resolve(__dirname, "styleguide.html"),
      },
    },
  },
});
