import { createApp, h } from "vue";
import "../design-system.css";
import {
  Badge,
  DataTable,
  DirtyNotice,
  DsButton,
  EmptyState,
  Field,
  MetricCard,
  NextAction,
  PageShell,
  Panel,
  StatusLine,
} from "../components.js";
import { CalculatorStatePreview, WizardStatePreview } from "../feature-components.js";

const tableRows = [
  ["34901-KY2-702", "2", "¥1,980", "분할 A"],
  ["06455-MGS-D31", "1", "¥4,300", "분할 B"],
];
function fixtureId(name) {
  return name.replace(/\s+/g, "-");
}


function section(name, children) {
  const id = fixtureId(name);
  return h("section", {
    id: `fixture-${id}`,
    class: "wc-styleguide-section",
    "data-fixture": name,
    "data-styleguide-section": id,
  }, [
    h(Panel, { title: name, description: `fixture:${name}` }, {
      default: () => children,
    }),
  ]);
}


const App = {
  name: "StyleguidePage",
  setup() {
    return () => h(PageShell, { current: "styleguide" }, {
      default: () => [
        h("section", { class: "wc-hero" }, [
          h(Panel, { title: "개발자 스타일가이드", description: "공개 메뉴에 노출하지 않는 Vue 컴포넌트 카탈로그입니다." }, {
            default: () => [
              h("h1", { class: "wc-title" }, "Webike UI Catalog"),
              h("p", { class: "wc-subtitle" }, "홈/내비게이션/셸과 같은 실제 Vue primitives를 재사용해 상태별 화면 조각을 확인합니다."),
            ],
          }),
          h(Panel, { title: "Catalog markers" }, {
            default: () => h("p", { class: "wc-panel__description" }, "각 섹션은 data-fixture 속성과 제목으로 식별됩니다."),
          }),
        ]),
        h("div", { class: "wc-layout" }, [
          section("layout", h("div", { class: "wc-layout wc-layout--two" }, [
            h(EmptyState, { message: "왼쪽 레이아웃 슬롯" }),
            h(EmptyState, { message: "오른쪽 레이아웃 슬롯" }),
          ])),
          section("panel", h(Panel, { title: "중첩 패널", description: "Panel primitive preview" }, { default: () => "패널 본문" })),
          section("form", h("div", { class: "wc-grid wc-grid--three" }, [
            h(Field, { label: "면세 기준 USD", value: "150", type: "number" }),
            h(Field, { label: "배송 서비스", value: "STD" }),
            h(Field, { label: "메모", value: "CSV/TSV 입력", type: "textarea" }),
          ])),
          section("buttons", h("div", { class: "wc-actions" }, [
            h(DsButton, { label: "Primary" }),
            h(DsButton, { label: "Secondary", variant: "secondary" }),
            h(DsButton, { label: "Danger", variant: "danger" }),
            h(DsButton, { label: "Disabled", disabled: true }),
          ])),
          section("table", h(DataTable, { columns: ["상품번호", "수량", "단가", "그룹"], rows: tableRows })),
          section("badge", h("div", { class: "wc-actions" }, [
            h(Badge, { label: "완료", tone: "success" }),
            h(Badge, { label: "주의", tone: "warn" }),
            h(Badge, { label: "오류", tone: "danger" }),
            h(Badge, { label: "대기", tone: "neutral" }),
          ])),
          section("metric", h("div", { class: "wc-grid wc-grid--three" }, [
            h(MetricCard, { label: "총 상품가", value: "¥18,420" }),
            h(MetricCard, { label: "예상 원화", value: "172,044원" }),
            h(MetricCard, { label: "추천 주문", value: "2개" }),
          ])),
          section("status", h("div", { class: "wc-grid" }, [
            h(StatusLine, { message: "CSV 2건을 반영했습니다.", tone: "success" }),
            h(StatusLine, { message: "견적 JSON을 기다리는 중입니다.", tone: "warn" }),
          ])),
          section("empty", h(EmptyState, { message: "분석 결과가 아직 없습니다." })),
          section("dirty", h(DirtyNotice, { message: "입력값이 바뀌어 다시 분석해야 합니다." })),
          section("next-action", h(NextAction, { title: "다음 단계", text: "견적 결과 JSON을 붙여넣어 총비용 비교로 이동하세요.", action: "다음 보기" })),
          section("calculator initial", h(CalculatorStatePreview, { state: "initial" })),
          section("calculator manual", h(CalculatorStatePreview, { state: "manual" })),
          section("calculator analyzed", h(CalculatorStatePreview, { state: "analyzed" })),
          section("calculator dirty-disabled", h(CalculatorStatePreview, { state: "dirty-disabled" })),
          section("wizard steps 1-5", h(WizardStatePreview, { state: "steps" })),
          section("wizard status", h(WizardStatePreview, { state: "status" })),
          section("wizard script", h(WizardStatePreview, { state: "script" })),
          section("wizard preview", h(WizardStatePreview, { state: "preview" })),
          section("wizard comparison", h(WizardStatePreview, { state: "comparison" })),
          section("wizard cart group states", h(WizardStatePreview, { state: "cart-group" })),
        ]),
      ],
    });
  },
};

createApp(App).mount("#app");
