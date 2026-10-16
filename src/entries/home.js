import { createApp, h } from "vue";
import "../design-system.css";
import { Badge, DsButton, PageShell, Panel } from "../components.js";

const App = {
  name: "HomePage",
  setup() {
    return () => h(PageShell, { current: "home" }, {
      default: () => [
        h("header", { class: "wc-hero" }, [
          h("h1", { class: "wc-title" }, "Webike 주문 비용 계산"),
          h("p", { class: "wc-subtitle" }, "상품 금액으로 주문을 나누거나, 배송비를 포함한 총비용을 비교하세요."),
        ]),
        h("section", { class: "wc-layout wc-layout--two" }, [
          h(Panel, { title: "주문 그룹 계산기", description: "장바구니 HTML이나 직접 입력한 상품을 금액과 면세 한도를 기준으로 나눕니다." }, {
            action: () => h(Badge, { label: "배송비 제외" }),
            default: () => h(DsButton, { label: "계산기 열기", href: "cart_group_calculator.html" }),
          }),
          h(Panel, { title: "Webike 주문 마법사", description: "Webike 배송비 견적을 받아 한 번에 주문할 때와 나눌 때의 총비용을 비교합니다." }, {
            action: () => h(Badge, { label: "배송비 포함" }),
            default: () => h(DsButton, { label: "주문 마법사 열기", href: "webike_quote_wizard.html" }),
          }),
        ]),
      ],
    });
  },
};

createApp(App).mount("#app");
