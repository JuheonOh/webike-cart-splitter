import { createApp, h } from "vue";
import "../design-system.css";
import { PublicNav, resolveCurrentPage } from "../components.js";

const mountEl = document.getElementById("public-nav-root");

if (mountEl) {
  createApp({
    name: "LegacyPageNavShell",
    setup() {
      const current = resolveCurrentPage(mountEl.dataset.page);
      return () => h(PublicNav, { current });
    },
  }).mount(mountEl);
}
