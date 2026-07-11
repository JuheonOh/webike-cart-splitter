import { h, onBeforeUnmount, onMounted, ref } from "vue";
import {
  Badge,
  DataTable,
  DirtyNotice,
  DsButton,
  EmptyState,
  Field,
  MetricCard,
  StatusLine,
} from "./components.js";

function wrapFeature(name, state, children) {
  return h("div", {
    class: "wc-feature-state",
    "data-production-component": name,
    "data-state": state,
  }, children);
}
function liveState(initialState, eventName, enabled) {
  const cachedState = enabled && typeof window !== "undefined"
    ? window.__webikeFeatureState?.[eventName]
    : null;
  const current = ref(cachedState || initialState);
  if (enabled && typeof window !== "undefined") {
    const update = (event) => {
      if (event.detail?.state) current.value = event.detail.state;
    };
    onMounted(() => {
      if (window.__webikeFeatureState?.[eventName]) current.value = window.__webikeFeatureState[eventName];
      window.addEventListener(eventName, update);
    });
    onBeforeUnmount(() => window.removeEventListener(eventName, update));
  }
  return current;
}


export const CalculatorStatePreview = {
  name: "CalculatorStatePreview",
  props: {
    state: { type: String, default: "initial" },
    live: { type: Boolean, default: false },
  },
  setup(props) {
    const currentState = liveState(props.state, "webike:calculator-state", props.live);
    return () => {
      const state = props.live ? currentState.value : props.state;
      if (state === "manual") {
        return wrapFeature("calculator-state", state, h("div", { class: "wc-grid" }, [
          props.live
            ? h(StatusLine, { message: "직접 입력 모드가 활성화되었습니다.", tone: "success" })
            : h(Field, { id: "calculator-manual-code", label: "상품번호", value: "34901KY2702" }),
          props.live
            ? h(StatusLine, { message: "상품 행을 입력하거나 붙여넣은 뒤 분석합니다.", tone: "warn" })
            : h(Field, { id: "calculator-manual-quantity", label: "수량", value: "2", type: "number" }),
        ]));
      }

      if (state === "analyzed") {
        return wrapFeature("calculator-state", state, h("div", { class: "wc-grid wc-grid--three" }, [
          props.live
            ? h(MetricCard, { label: "분석 상태", value: "준비됨" })
            : h(MetricCard, { label: "그룹 A", value: "USD 123.40" }),
          props.live
            ? h(MetricCard, { label: "내보내기", value: "활성" })
            : h(MetricCard, { label: "그룹 B", value: "USD 94.10" }),
          h(Badge, { label: props.live ? "분석 완료" : "면세 한도 내", tone: "success" }),
        ]));
      }

      if (state === "dirty-disabled") {
        return wrapFeature("calculator-state", state, h("div", { class: "wc-grid" }, [
          h(DirtyNotice, { message: "기준값 변경으로 내보내기가 비활성화되었습니다." }),
          h(DsButton, { label: "XLSX 내보내기", disabled: true }),
        ]));
      }

      return wrapFeature("calculator-state", "initial", h(EmptyState, { message: "계산기 초기 상태: 결과 영역 대기" }));
    };
  },
};

function wizardStep(step, title, tone = "neutral") {
  return h("div", { class: "wc-mini-step", "data-fixture": `wizard step ${step}` }, [
    h("span", { class: "wc-mini-step__number" }, String(step)),
    h("strong", title),
    h(Badge, { label: step === 1 ? "현재" : "대기", tone }),
  ]);
}

export const WizardStatePreview = {
  name: "WizardStatePreview",
  props: {
    state: { type: String, default: "steps" },
    live: { type: Boolean, default: false },
  },
  setup(props) {
    const currentState = liveState(props.state, "webike:wizard-state", props.live);
    return () => {
      const state = props.live ? currentState.value : props.state;
      if (state === "status") {
        return wrapFeature("wizard-state", state, h(StatusLine, { message: "마법사 상태: 3단계 입력 대기", tone: "warn" }));
      }

      if (state === "script") {
        return wrapFeature("wizard-state", state, props.live
          ? h(StatusLine, { message: "견적 스크립트 복사 준비가 완료되었습니다.", tone: "success" })
          : h(Field, { id: "wizard-generated-script", label: "생성 스크립트", value: "(() => window.__WEBIKE_QUOTE__ = true)();", type: "textarea" }));
      }

      if (state === "preview") {
        return wrapFeature("wizard-state", state, h(DataTable, { columns: ["상품", "수량", "상태"], rows: [[props.live ? "견적 결과" : "헤드라이트 밸브", props.live ? "-" : "2", props.live ? "반영됨" : "미리보기"]] }));
      }

      if (state === "comparison") {
        return wrapFeature("wizard-state", state, h("div", { class: "wc-grid wc-grid--three" }, [
          props.live
            ? h(MetricCard, { label: "총비용 비교", value: "준비됨" })
            : h(MetricCard, { label: "단일 주문", value: "231,000원" }),
          props.live
            ? h(MetricCard, { label: "장바구니 스크립트", value: "생성 가능" })
            : h(MetricCard, { label: "분할 주문", value: "214,000원" }),
          h(Badge, { label: props.live ? "비교 완료" : "분할 추천", tone: "success" }),
        ]));
      }

      if (state === "cart-group") {
        return wrapFeature("wizard-state", state, h("div", { class: "wc-grid" }, [
          props.live
            ? h(StatusLine, { message: "선택한 전략의 장바구니 스크립트를 복사할 수 있습니다.", tone: "success" })
            : h(StatusLine, { message: "그룹 A 스크립트 복사 가능", tone: "success" }),
          props.live
            ? h(StatusLine, { message: "Webike 페이지에서 실행 후 결과를 확인하세요.", tone: "warn" })
            : h(StatusLine, { message: "그룹 B는 Webike 페이지에서 실행 대기", tone: "warn" }),
        ]));
      }

      return wrapFeature("wizard-state", "steps", h("div", { class: "wc-mini-step-list" }, [
        wizardStep(1, "상품 입력", "success"),
        wizardStep(2, "견적 스크립트"),
        wizardStep(3, "견적 결과"),
        wizardStep(4, "총비용 비교"),
        wizardStep(5, "장바구니 담기"),
      ]));
    };
  },
};

export const ProductionFeaturePanel = {
  name: "ProductionFeaturePanel",
  props: {
    page: { type: String, required: true },
  },
  setup(props) {
    return () => {
      if (props.page === "calculator") {
        return h("section", { class: "wc-production-bridge", "data-production-component": "calculator-bridge" }, [
          h("strong", "계산기 상태"),
          h("p", { class: "wc-panel__description" }, "기존 계산기 컨트랙트를 유지하면서 실제 입력/분석/수정 상태를 Vue 디자인 시스템 컴포넌트로 반영합니다."),
          h(CalculatorStatePreview, { state: "initial", live: true }),
        ]);
      }

      if (props.page === "wizard") {
        return h("section", { class: "wc-production-bridge", "data-production-component": "wizard-bridge" }, [
          h("strong", "주문 마법사 상태"),
          h("p", { class: "wc-panel__description" }, "기존 Webike 주문 마법사의 단계/스크립트/비교 상태를 Vue 디자인 시스템 컴포넌트로 반영합니다."),
          h(WizardStatePreview, { state: "steps", live: true }),
        ]);
      }

      return null;
    };
  },
};
