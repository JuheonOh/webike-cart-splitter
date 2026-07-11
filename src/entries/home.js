import { createApp, h } from "vue";
import "../design-system.css";
import { Badge, DsButton, MetricCard, PageShell, Panel, pages } from "../components.js";

const App = {
  name: "HomePage",
  setup() {
    return () => h(PageShell, { current: "home" }, {
      default: () => [
        h("section", { class: "wc-hero" }, [
          h(Panel, { title: "Webike 장바구니 주문 분할 도구", description: "면세 기준, 관세청 과세환율, 배송비 견적을 기준으로 주문 그룹을 안전하게 검토합니다." }, {
            default: () => [
              h("h1", { class: "wc-title" }, "Webike 주문을 계산하고 비교하세요"),
              h("p", { class: "wc-subtitle" }, "기존 계산기는 장바구니 HTML 또는 직접 입력으로 주문 그룹을 산출하고, 주문 마법사는 견적 스크립트부터 장바구니 담기까지 단계별로 안내합니다."),
              h("div", { class: "wc-actions" }, [
                h(DsButton, { label: "주문 그룹 계산기", href: "cart_group_calculator.html" }),
                h(DsButton, { label: "주문 마법사", href: "webike_quote_wizard.html", variant: "secondary" }),
              ]),
            ],
          }),
          h(Panel, { title: "현재 제공 도구" }, {
            default: () => h("div", { class: "wc-grid" }, [
              h(MetricCard, { label: "공개 화면", value: `${pages.length}개` }),
              h(Badge, { label: "styleguide는 개발자 전용", tone: "neutral" }),
              h("p", { class: "wc-panel__description" }, "상단 공개 메뉴에는 홈, 계산기, 마법사만 노출됩니다."),
            ]),
          }),
        ]),
        h("section", { class: "wc-layout wc-layout--two" }, [
          h(Panel, { title: "주문 그룹 계산기", description: "장바구니 HTML 또는 직접 입력 데이터를 분석해 면세 한도 내 주문 그룹을 만듭니다." }, {
            action: () => h(Badge, { label: "기존 로직 유지", tone: "success" }),
            default: () => h(DsButton, { label: "계산기 열기", href: "cart_group_calculator.html" }),
          }),
          h(Panel, { title: "Webike 주문 마법사", description: "CSV 입력, 견적 스크립트, 결과 JSON, 총비용 비교, 장바구니 담기 스크립트를 단계별로 진행합니다." }, {
            action: () => h(Badge, { label: "5단계", tone: "warn" }),
            default: () => h(DsButton, { label: "마법사 열기", href: "webike_quote_wizard.html" }),
          }),
        ]),
      ],
    });
  },
};

createApp(App).mount("#app");
