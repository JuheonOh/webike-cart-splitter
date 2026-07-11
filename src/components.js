import { h, useId } from "vue";

export const pages = [
  { key: "home", label: "홈", href: "./" },
  { key: "calculator", label: "주문 그룹 계산기", href: "cart_group_calculator.html" },
  { key: "wizard", label: "Webike 주문 마법사", href: "webike_quote_wizard.html" },
];

export function resolveCurrentPage(explicitPage) {
  if (explicitPage) return explicitPage;
  const pathname = window.location.pathname;
  if (pathname.endsWith("/cart_group_calculator.html")) return "calculator";
  if (pathname.endsWith("/webike_quote_wizard.html")) return "wizard";
  return "home";
}

export const PublicNav = {
  name: "PublicNav",
  props: {
    current: { type: String, default: "" },
  },
  setup(props) {
    return () => {
      const current = resolveCurrentPage(props.current);
      return h("nav", { class: "wc-public-nav", "aria-label": "공개 페이지", "data-public-nav": "" }, [
        h("div", { class: "wc-container wc-public-nav__inner" }, [
          h("a", { class: "wc-public-nav__brand", href: "./" }, "Webike Cart Splitter"),
          h("div", { class: "wc-public-nav__links" }, pages.map((page) => h("a", {
            class: "wc-public-nav__link",
            href: page.href,
            "data-nav-link": page.key,
            "aria-current": page.key === current ? "page" : null,
          }, page.label))),
        ]),
      ]);
    };
  },
};

export const PageShell = {
  name: "PageShell",
  props: {
    current: { type: String, default: "" },
  },
  setup(props, { slots }) {
    return () => h("div", { class: "wc-page" }, [
      h(PublicNav, { current: props.current }),
      h("main", { class: "wc-container wc-main" }, slots.default?.()),
    ]);
  },
};

export const Panel = {
  name: "Panel",
  props: {
    title: { type: String, required: true },
    description: { type: String, default: "" },
  },
  setup(props, { slots }) {
    return () => h("section", { class: "wc-panel" }, [
      h("div", { class: "wc-panel__head" }, [
        h("div", null, [
          h("h2", { class: "wc-panel__title" }, props.title),
          props.description ? h("p", { class: "wc-panel__description" }, props.description) : null,
        ]),
        slots.action?.(),
      ]),
      slots.default?.(),
    ]);
  },
};

export const DsButton = {
  name: "DsButton",
  props: {
    label: { type: String, required: true },
    variant: { type: String, default: "primary" },
    href: { type: String, default: "" },
    disabled: { type: Boolean, default: false },
  },
  setup(props) {
    return () => {
      const attrs = {
        class: ["wc-button", `wc-button--${props.variant}`],
        "aria-disabled": props.disabled ? "true" : null,
      };
      return props.href
        ? h("a", { ...attrs, href: props.disabled ? null : props.href }, props.label)
        : h("button", { ...attrs, type: "button", disabled: props.disabled }, props.label);
    };
  },
};

export const Badge = {
  name: "Badge",
  props: {
    label: { type: String, required: true },
    tone: { type: String, default: "neutral" },
  },
  setup(props) {
    return () => h("span", { class: ["wc-badge", `wc-badge--${props.tone}`] }, props.label);
  },
};

export const MetricCard = {
  name: "MetricCard",
  props: {
    label: { type: String, required: true },
    value: { type: String, required: true },
  },
  setup(props) {
    return () => h("div", { class: "wc-metric" }, [
      h("div", { class: "wc-metric__label" }, props.label),
      h("div", { class: "wc-metric__value" }, props.value),
    ]);
  },
};

export const StatusLine = {
  name: "StatusLine",
  props: {
    message: { type: String, required: true },
    tone: { type: String, default: "info" },
  },
  setup(props) {
    return () => h("div", { class: ["wc-status", `wc-status--${props.tone}`], role: "status" }, props.message);
  },
};

export const EmptyState = {
  name: "EmptyState",
  props: {
    message: { type: String, required: true },
  },
  setup(props) {
    return () => h("div", { class: "wc-empty" }, props.message);
  },
};

export const DirtyNotice = {
  name: "DirtyNotice",
  props: {
    message: { type: String, required: true },
  },
  setup(props) {
    return () => h("div", { class: "wc-dirty" }, [
      h(Badge, { label: "변경됨", tone: "warn" }),
      h("span", props.message),
    ]);
  },
};

export const NextAction = {
  name: "NextAction",
  props: {
    title: { type: String, required: true },
    text: { type: String, required: true },
    action: { type: String, required: true },
  },
  setup(props) {
    return () => h("div", { class: "wc-next-action" }, [
      h("div", null, [h("strong", props.title), h("p", { class: "wc-panel__description" }, props.text)]),
      h(DsButton, { label: props.action, variant: "primary" }),
    ]);
  },
};

export const Field = {
  name: "Field",
  props: {
    label: { type: String, required: true },
    value: { type: String, default: "" },
    type: { type: String, default: "text" },
    id: { type: String, default: "" },
  },
  setup(props) {
    const generatedId = useId();
    return () => {
      const controlId = props.id || generatedId;
      return h("div", { class: "wc-field" }, [
        h("label", { for: controlId }, props.label),
        props.type === "textarea"
          ? h("textarea", { id: controlId, value: props.value, readonly: true })
          : h("input", { id: controlId, type: props.type, value: props.value, readonly: true }),
      ]);
    };
  },
};

export const DataTable = {
  name: "DataTable",
  props: {
    columns: { type: Array, required: true },
    rows: { type: Array, required: true },
  },
  setup(props) {
    return () => h("div", { class: "wc-table-wrap" }, [
      h("table", { class: "wc-table" }, [
        h("thead", [h("tr", props.columns.map((column) => h("th", column)))]),
        h("tbody", props.rows.map((row) => h("tr", row.map((cell) => h("td", cell))))),
      ]),
    ]);
  },
};
