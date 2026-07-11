# Webike Cart Splitter

Webike 장바구니 상품가를 관세청 과세환율 기준으로 나누고, 브라우저에서 단일/분할 주문 비용을 비교하는 Vue + Vite 기반 MPA 도구입니다.

모든 사용자 기능은 계산기와 주문 마법사 웹 화면에서 제공합니다. 로그인, 주문, 결제는 자동화하지 않으며 공개 URL은 기존 `index.html`, `cart_group_calculator.html`, `webike_quote_wizard.html` 경로를 유지합니다.


## 사용 방법

1. 로컬에서는 `cart_group_calculator.html`을 브라우저에서 연다. GitHub Pages 배포 후에는 저장소 Pages URL로 접속한다.
2. 입력 방식을 선택한다.
   - `장바구니 HTML`: Webike 장바구니 페이지에서 상품 테이블 HTML을 복사해 붙여넣는다.
   - `직접 입력`: 상품번호, 상품명, 수량, 단가 JPY를 행 단위로 입력한다.
   - 엑셀에서 `상품번호, 수량, 상품명, 단가JPY, 상품URL` 형식으로 복사한 표는 직접 입력의 `CSV/TSV 붙여넣기`에 붙여넣어 한 번에 반영한다. `단가` 자리에는 `금액`, `가격`, `판매가` 헤더도 사용할 수 있다.
3. 면세 기준, USD 수입환율, JPY 수입환율을 확인한다.
   - GitHub Pages에서는 `data/exchange-rates.json`의 자동 갱신 환율이 기본값으로 반영된다.
   - 브라우저에 저장된 설정이 있으면 저장값을 우선 사용한다.
4. `분석하기`를 누른다.
5. 추천 주문 그룹을 확인한다.
6. 장바구니 HTML 분석값을 수정해야 하면 `추출된 상품` 표의 수량/단가를 고치고 `수정 반영`을 누른다. 직접 입력 테이블에서 보정하려면 `직접 입력으로 가져오기`를 사용한다.
7. Webike 장바구니에 담을 때는 추천 주문 그룹의 `스크립트 만들기`를 눌러 해당 그룹 스크립트를 클립보드에 복사한 뒤 Webike DevTools Console에 붙여넣는다. 입력값, 분석 결과, 그룹 카드의 복사/최종 금액 확인/주문 완료 상태는 브라우저 `localStorage`에 자동 저장되어 새로고침 후에도 복원된다.
8. 주문 그룹별 자동화 입력 파일이 필요하면 `그룹 CSV 내보내기`로 그룹별 CSV가 들어 있는 ZIP을 저장한다.
9. 추출된 상품의 수량/단가를 고치면 내보내기와 스크립트 복사가 잠기며, `수정 반영`을 눌러 주문 그룹을 다시 계산해야 한다.
10. 필요하면 `XLSX 내보내기`로 결과를 저장한다. `추출상품` 시트의 `상품URL` 값은 클릭 가능한 링크로 저장된다.

입력한 면세 기준, USD/JPY 수입환율, 최대 주문 수, 수량 분할 설정은 브라우저에 저장되어 다음 실행 때 복원됩니다.

## 환율 자동 갱신

- 출처: `https://www.forwarder.kr/curr/index.php?curr=ex_rate`
- 대상: 미국 `USD`, 일본 `JPY`의 수입환율
- 결과 파일: `data/exchange-rates.json`
- GitHub Actions: `.github/workflows/deploy-pages.yml`
- 수동 실행: GitHub Actions의 `deploy-pages` 워크플로우에서 `Run workflow`

## GitHub Pages 배포

- 예상 URL: `https://juheonoh.github.io/webike-cart-splitter/`
- GitHub 저장소 `Settings > Pages`에서 Source를 `GitHub Actions`로 설정한다.
- `deploy-pages` 워크플로우는 `npm ci`로 잠금 파일 기준 의존성을 설치하고, `schedule`/`workflow_dispatch`에서는 환율 JSON을 갱신한 뒤 전체 검증을 통과한 데이터만 커밋·배포한다.
- 배포 대상은 `npm run build`가 생성한 Vite `dist/` 산출물이다. 수동 static-copy artifact 구성은 사용하지 않는다.
- 배포 전 `npm test`, `npm run build`, `npm run test:artifact`, `npm run test:e2e:install`, `npm run test:e2e`를 순서대로 실행한다. `npm run test:e2e`는 빌드된 `dist/` 산출물을 대상으로 한다.


## 계산 기준

- 배송비, 포인트, 쿠폰은 계산하지 않는다.
- 장바구니에 표시된 상품가 또는 직접 입력한 단가 JPY 기준으로만 계산한다.
- 150 USD 한도는 다음 식으로 JPY 환산한다.

```text
JPY 한도 = 면세 기준 USD * USD 수입환율 / JPY 수입환율
```

- 같은 상품 수량 분할 허용을 켜면 수량 4개 상품은 1개 단위로 다른 주문 그룹에 배치될 수 있다.
- 안전한 브라우저 계산을 위해 상품 500개, 상품별 수량 1,000개, 분할 계산 단위 10,000개, 최대 주문 20개로 제한한다.

## 현재 파일

- `index.html`: GitHub Pages 진입점이며 Vite MPA 빌드 입력
- `cart_group_calculator.html`: 공개 계산기 URL
- `webike_quote_wizard.html`: 공개 Webike 견적 마법사 URL
- `styleguide.html`: 개발자용 디자인 시스템/컴포넌트 확인 직접 경로. 공개 메인 메뉴에는 노출하지 않는다.
- `src/`: Vue/Vite 화면, 공유 내비게이션, 디자인 시스템 소스
- `assets/css/cart-group-calculator.css`: 계산기 스타일과 기존 공개 asset 경로 호환 레이어
- `assets/js/delimited-core.js`: 계산기와 마법사가 공유하는 CSV/TSV 파서
- `assets/js/calculator-core.js`: 계산, 파싱, XLSX 생성 로직
- `assets/js/calculator-grouping.js`: 주문 그룹 추천 알고리즘
- `assets/js/cart-group-calculator.js`: 계산기 화면 동작과 이벤트 연결
- `assets/js/cost-comparison-core.js`: 단일/분할 주문 비용 비교와 실측 배송비 비교 로직
- `assets/js/quote-result-core.js`: 견적 결과 버전, 상품 ID, 배송 그룹 일치 검증
- `data/exchange-rates.json`: GitHub Pages에서 읽는 USD/JPY 수입환율 데이터
- `scripts/update-exchange-rates.js`: forwarder.kr 고시환율 HTML 파서
- `package.json`: npm 검증/빌드/배포 보조 명령
- `package-lock.json`: `npm ci`가 사용하는 결정적 의존성 잠금 파일
- `.github/workflows/deploy-pages.yml`: 환율 JSON 자동 갱신, Vite `dist/` 빌드, Pages 배포 워크플로우
- `tests/cart_group_calculator.test.js`: 계산 그룹, XLSX 생성, 직접 입력 정규화, CSV/TSV 붙여넣기, 결과 HTML escape 검증
- `tests/cost_comparison.test.js`: 브라우저 주문 마법사가 사용하는 단일/분할 비용 비교 검증
- `tests/e2e_cart_group_calculator.test.js`: Playwright 기반 직접 입력, 그룹 스크립트 복사, 수정 반영 필요 UI 검증
- `tests/update_exchange_rates.test.js`: forwarder.kr 고시환율 HTML 파싱 검증
- `tests/quote_result.test.js`: 마법사 견적 결과와 측정/추천 그룹 일치 검증
- `tests/artifact_audit.test.js`: 배포 파일, 참조 경로, 환율 스키마·최신성 검증
- `tests/e2e_dist.test.js`: 빌드된 공개 화면, Vue 브리지, 계산기와 마법사 흐름 검증
- `기록/20260506_webike_주문그룹_자동화_설계안.md`: 향후 자동화 설계안


## 검증

의존성은 `package-lock.json` 기준으로 설치한다.

```bash
npm ci
```

기본 단위/Node 검증:

```bash
npm test
```

Vite 빌드와 배포 산출물 감사:

```bash
npm run build
npm run test:artifact
```

브라우저 E2E는 Playwright Chromium 설치 후 빌드된 `dist/` 산출물을 대상으로 실행한다.

```bash
npm run test:e2e:install
npm run test:e2e
```

기존 소스 HTML을 직접 여는 file-url E2E가 필요할 때만 별도 호환 명령을 사용한다.

```bash
npm run test:e2e:source
```


검증 항목:

- 샘플 상품 합계가 `42,699 JPY`인지 확인
- 기본 환율 기준 JPY 한도가 `23,539 JPY`인지 확인
- 추천 그룹이 `21,350 / 21,349 JPY` 두 그룹으로 나뉘는지 확인
- XLSX 바이트가 생성되는지 확인
- XLSX `추출상품` 시트의 `상품URL` 셀이 클릭 가능한 하이퍼링크로 생성되는지 확인
- 직접 입력 행이 계산용 상품 데이터로 정규화되는지 확인
- 장바구니 HTML에서 추출한 상품URL이 결과 표, XLSX, 그룹 CSV, 스크립트 데이터에 유지되는지 확인
- 분석 결과 상품이 직접 입력 행으로 변환되는지 확인
- 분석 결과 상품 표가 수량/단가 편집 입력을 렌더링하는지 확인
- 계산기 화면에서 추천 주문 그룹별 Webike DevTools 장바구니 담기 스크립트 버튼과 실행 상태 체크를 렌더링하는지 확인
- CSV/TSV 붙여넣기가 직접 입력 행으로 변환되는지 확인
- 그룹 CSV ZIP 출력 형식이 올바른지 확인
- 환율과 주문 설정이 저장값으로 정규화되는지 확인
- 자동 환율 JSON 값이 계산기 입력용 데이터로 정규화되는지 확인
- 환율 적용기간 만료를 감지하고 배포 시 허용 기간을 초과하지 않는지 확인
- 장바구니 행에서 JPY/円/￥ 가격 표기를 파싱하는지 확인
- Webike 장바구니 HTML fixture가 상품 목록으로 파싱되는지 확인
- 붙여넣은 상품명/품번이 결과 영역에서 HTML로 실행되지 않도록 escape되는지 확인
- forwarder.kr 고시환율 HTML에서 USD/JPY 수입환율을 파싱하는지 확인
- 단일/분할 주문 비교에서 고정 배송비와 실측 배송비가 각각 계산되는지 확인
- Playwright에서 직접 입력, 그룹별 스크립트 복사, 수정 반영 필요 알림이 동작하는지 확인
- 견적 결과의 출처/버전/상품 ID/측정 그룹이 다르면 마법사 다음 단계를 차단하는지 확인

## cleanup / AI-slop 승인 게이트

- 이번 Vue/Vite MPA 마이그레이션에서는 후보별 명시 승인이 없는 AI-slop 정리 후보를 action하지 않는다.
- standalone 생성 스크립트 중복 로직은 기존 출력/저장/복사 동작 보존을 우선해 sync-risk hold로 남긴다.
- 삭제는 참조가 없다는 증거와 전체 검증이 모두 있을 때만 strict deletion으로 진행한다.

## 방향

### v0

- 현재 정적 계산기 유지
- 자동 기본 환율 + 수동 환율 입력
- 장바구니 HTML 붙여넣기
- 직접 품목 입력
- CSV/TSV 붙여넣기 입력
- 주문 그룹 추천
- XLSX 출력

### v1

- 결과표 수정 편의성 개선
- 테스트 케이스 확장

### v2

- 가격 조회 없는 완전한 주문 그룹 플래너
- 입력/출력 포맷 고정
- 계산 로직 모듈화

### v3 이후

- 브라우저 주문 마법사의 단계별 안내와 오류 복구 개선
- 접근성 및 모바일 입력 흐름 보강

## 한계

- Webike 장바구니 DOM 구조가 크게 바뀌면 HTML 파싱이 실패할 수 있다.
- 3개 이상 그룹은 휴리스틱으로 계산하므로 전역 최적해를 항상 보장하지 않는다.
- 통관 결과나 합산과세 회피를 보장하지 않는다.
- 실제 주문과 결제는 사용자가 직접 확인하고 진행해야 한다.
