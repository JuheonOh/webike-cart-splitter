import { createApp, h } from "vue";
import "../design-system.css";
import { Badge, DsButton, PageShell, Panel } from "../components.js";

const App = {
  name: "HomePage",
  setup() {
    return () => h(PageShell, { current: "home" }, {
      default: () => [
        h("section", { class: "wc-hero" }, [
          h(Panel, { title: "Webike 주문 비용 계산", description: "관세청 과세환율과 배송비를 기준으로 주문 전에 비용을 확인합니다." }, {
            default: () => [
              h("h1", { class: "wc-title" }, "면세 한도에 맞는 주문 방법을 찾으세요"),
              h("p", { class: "wc-subtitle" }, "빠른 분할 계산부터 실제 배송비를 포함한 총비용 비교까지, 필요한 방식으로 시작할 수 있습니다."),
              h("div", { class: "wc-actions" }, [
                h(DsButton, { label: "빠르게 분할 계산", href: "cart_group_calculator.html" }),
                h(DsButton, { label: "배송비까지 비교", href: "webike_quote_wizard.html", variant: "secondary" }),
              ]),
            ],
          }),
          h(Panel, { title: "어떤 도구를 선택할까요?", description: "현재 준비된 자료와 확인하려는 범위에 따라 고르세요." }, {
            default: () => h("div", { class: "wc-choice-list" }, [
              h("div", { class: "wc-choice" }, [
                h(Badge, { label: "빠른 계산", tone: "success" }),
                h("p", null, "장바구니 HTML이나 상품 가격이 있고, 면세 한도에 맞게 주문만 나누고 싶을 때"),
              ]),
              h("div", { class: "wc-choice" }, [
                h(Badge, { label: "정밀 비교", tone: "warn" }),
                h("p", null, "Webike 배송비 견적까지 반영해 한 번에 주문할지 나눌지 비교하고 싶을 때"),
              ]),
            ]),
          }),
        ]),
        h("section", { class: "wc-layout wc-layout--two" }, [
          h(Panel, { title: "빠른 주문 분할", description: "장바구니 HTML 또는 직접 입력한 가격으로 면세 한도 내 주문 그룹을 만듭니다." }, {
            action: () => h(Badge, { label: "약 1분", tone: "success" }),
            default: () => h(DsButton, { label: "분할 계산 시작", href: "cart_group_calculator.html" }),
          }),
          h(Panel, { title: "배송비 포함 총비용 비교", description: "상품 확인, 배송비 견적, 단일·분할 주문 비교, 장바구니 담기를 순서대로 진행합니다." }, {
            action: () => h(Badge, { label: "5단계", tone: "warn" }),
            default: () => h(DsButton, { label: "정밀 비교 시작", href: "webike_quote_wizard.html" }),
          }),
        ]),
      ],
    });
  },
};

createApp(App).mount("#app");
