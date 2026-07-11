import { createApp, h } from "vue";
import "../design-system.css";
import { PublicNav, resolveCurrentPage } from "../components.js";
import { ProductionFeaturePanel } from "../feature-components.js";

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
const featureMountEl = document.getElementById("production-feature-root");

if (featureMountEl) {
  createApp({
    name: "ProductionFeatureMount",
    setup() {
      return () => h(ProductionFeaturePanel, { page: featureMountEl.dataset.page });
    },
  }).mount(featureMountEl);
}
