# Webike Cart Splitter

Webike 장바구니 상품가를 관세청 과세환율 기준으로 나누고, 웹 주문 마법사에서 Webike 배송비 견적 결과를 반영해 단일/분할 주문 비용을 비교하는 정적 웹 도구입니다.

이 프로젝트는 **주문 계획 보조 도구**입니다. Webike 페이지에서 실행할 Console 스크립트는 상품 상세 조회, 배송비 조회, 장바구니 담기 요청까지만 돕습니다. 로그인, 실제 주문, 결제는 자동화하지 않습니다.

## 사용 방법

### 주문 그룹 계산기

1. 로컬에서는 `cart_group_calculator.html`을 브라우저에서 연다. GitHub Pages 배포 후에는 저장소 Pages URL로 접속한다.
2. 입력 방식을 선택한다.
   - `장바구니 HTML`: Webike 장바구니 페이지에서 상품 테이블 HTML을 복사해 붙여넣는다.
   - `직접 입력`: 상품번호, 상품명, 수량, 단가 JPY를 행 단위로 입력한다.
   - 엑셀에서 `상품번호, 수량, 상품명, 단가JPY, 상품URL` 형식으로 복사한 표는 직접 입력의 `CSV/TSV 붙여넣기`에 붙여넣어 한 번에 반영한다. `단가` 자리에는 `금액`, `가격`, `판매가` 헤더도 사용할 수 있다.
3. 면세 기준, USD 수입환율, JPY 수입환율을 확인한다.
   - GitHub Pages에서는 `data/exchange-rates.json`의 자동 갱신 환율이 기본값으로 반영된다.
   - 브라우저에 저장된 설정이 있으면 저장값을 우선 사용한다.
4. `분석하기`를 누르고 추천 주문 그룹을 확인한다.
5. 장바구니 HTML 분석값을 수정해야 하면 `추출된 상품` 표의 수량/단가를 고치고 `수정 반영`을 누른다. 직접 입력 테이블에서 보정하려면 `직접 입력으로 가져오기`를 사용한다.
6. 추천 주문 그룹을 Webike 장바구니에 담을 때는 그룹 카드의 `스크립트 만들기`를 눌러 스크립트를 복사한 뒤 Webike DevTools Console에 붙여넣는다.
7. 주문 그룹별 입력 파일이 필요하면 `그룹 CSV 내보내기`로 그룹별 CSV가 들어 있는 ZIP을 저장한다.
8. 필요하면 `XLSX 내보내기`로 결과를 저장한다. `추출상품` 시트의 `상품URL` 값은 클릭 가능한 링크로 저장된다.

입력한 면세 기준, USD/JPY 수입환율, 최대 주문 수, 수량 분할 설정은 브라우저에 저장되어 다음 실행 때 복원됩니다.

### Webike 주문 마법사

`webike_quote_wizard.html`은 CSV 입력부터 배송비 견적, 단일/분할 총비용 비교, 장바구니 담기까지 순서대로 진행하는 웹 화면입니다.

1. CSV/TSV 또는 엑셀 붙여넣기로 상품번호, 수량, 상품명, 단가 JPY, 상품URL을 입력한다.
2. `Webike 견적 스크립트`를 복사해 `https://www.japan-webike.kr/`의 DevTools Console에서 실행한다.
3. Webike 페이지에서 생성된 견적 결과 JSON을 마법사에 붙여넣는다.
4. 단일 주문과 추천 분할 주문의 상품가, 배송비, 예상 관세/부가세 합산 비용을 비교한다.
5. 선택한 주문 전략의 장바구니 담기 스크립트를 복사해 Webike Console에서 실행한다.

견적 스크립트는 Webike 페이지에서 단독 실행되도록 생성되며, 이 저장소의 스크립트 파일을 Webike 페이지에서 불러오지 않습니다.

## 환율 자동 갱신

- 출처: `https://www.forwarder.kr/curr/index.php?curr=ex_rate`
- 대상: 미국 `USD`, 일본 `JPY`의 수입환율
- 결과 파일: `data/exchange-rates.json`
- GitHub Actions: `.github/workflows/deploy-pages.yml`
- 수동 실행: GitHub Actions의 `deploy-pages` 워크플로우에서 `Run workflow`
- 로컬 갱신:

```bash
node scripts/update-exchange-rates.js
```

## GitHub Pages 배포

- 예상 URL: `https://juheonoh.github.io/webike-cart-splitter/`
- GitHub 저장소 `Settings > Pages`에서 Source를 `GitHub Actions`로 설정한다.
- `deploy-pages` 워크플로우가 Pages artifact를 만들고 배포한다.
- 배포 대상 파일은 `index.html`, `cart_group_calculator.html`, `webike_quote_wizard.html`, `.nojekyll`, `assets/`, `data/exchange-rates.json`이다.
- `push`는 현재 파일을 배포하고, `schedule`/`workflow_dispatch`는 환율 JSON 갱신 후 배포한다.

## 계산 기준

- 장바구니 계산기는 배송비, 포인트, 쿠폰을 계산하지 않는다.
- 주문 마법사는 Webike 견적 결과 JSON의 배송비를 반영해 총비용을 비교한다.
- 장바구니에 표시된 상품가, 직접 입력한 단가 JPY, 또는 Webike 상품 상세에서 읽은 단가 JPY를 기준으로 계산한다.
- 150 USD 한도는 다음 식으로 JPY 환산한다.

```text
JPY 한도 = 면세 기준 USD * USD 수입환율 / JPY 수입환율
```

- 같은 상품 수량 분할 허용을 켜면 수량 4개 상품은 1개 단위로 다른 주문 그룹에 배치될 수 있다.

## 현재 파일

- `index.html`: GitHub Pages 진입점
- `cart_group_calculator.html`: 주문 그룹 계산기
- `webike_quote_wizard.html`: 웹 주문 마법사
- `assets/css/cart-group-calculator.css`: 계산기 스타일
- `assets/js/calculator-core.js`: 계산, 파싱, XLSX 생성 로직
- `assets/js/calculator-grouping.js`: 주문 그룹 추천 알고리즘
- `assets/js/cart-group-calculator.js`: 계산기 화면 동작과 이벤트 연결
- `assets/js/cost-comparison-core.js`: 단일/분할 주문 비용 비교와 견적 배송비 비교 로직
- `assets/js/webike-quote-core.js`: 주문 마법사의 Webike 견적 helper와 self-contained 견적 스크립트 생성 로직
- `data/exchange-rates.json`: GitHub Pages에서 읽는 USD/JPY 수입환율 데이터
- `scripts/update-exchange-rates.js`: forwarder.kr 고시환율 HTML 파서
- `.github/workflows/deploy-pages.yml`: 환율 JSON 자동 갱신과 GitHub Pages 배포 워크플로우
- `tests/cart_group_calculator.test.js`: 계산 그룹, XLSX 생성, 직접 입력 정규화, CSV/TSV 붙여넣기, 결과 HTML escape 검증
- `tests/cost_comparison.test.js`: 비용 비교와 견적 배송비 비교 로직 검증
- `tests/webike_quote_core.test.js`: Webike 상품 상세 파싱, 검색 결과 추출, 배송비 API 정규화, 견적 스크립트 생성 검증
- `tests/e2e_cart_group_calculator.test.js`: Playwright 기반 직접 입력, 그룹 스크립트 복사, 수정 반영 필요 UI 검증
- `tests/update_exchange_rates.test.js`: forwarder.kr 고시환율 HTML 파싱 검증
- `기록/20260506_webike_주문그룹_자동화_설계안.md`: 향후 자동화 설계안

## 검증

별도 패키지 설치 없이 Node.js 단위 테스트를 실행한다.

```bash
node tests/cart_group_calculator.test.js
node tests/update_exchange_rates.test.js
node tests/cost_comparison.test.js
node tests/webike_quote_core.test.js
```

`package.json` 기반으로 실행할 때는 다음 명령을 사용한다.

```bash
npm test
```

브라우저 E2E는 Playwright 브라우저 설치 후 별도로 실행한다.

```bash
npm install
npm run test:e2e:install
npm run test:e2e
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
- 그룹 CSV ZIP 출력이 상품번호, 수량, 상품명, 단가, 상품URL 컬럼을 유지하는지 확인
- 환율과 주문 설정이 저장값으로 정규화되는지 확인
- 자동 환율 JSON 값이 계산기 입력용 데이터로 정규화되는지 확인
- 장바구니 행에서 JPY/円/￥ 가격 표기를 파싱하는지 확인
- Webike 장바구니 HTML fixture가 상품 목록으로 파싱되는지 확인
- 붙여넣은 상품명/품번이 결과 영역에서 HTML로 실행되지 않도록 escape되는지 확인
- forwarder.kr 고시환율 HTML에서 USD/JPY 수입환율을 파싱하는지 확인
- 단일/분할 주문 비교에서 고정 배송비와 견적 배송비가 각각 계산되는지 확인
- Webike 상품 상세 fixture에서 가격/무게/부피를 파싱하는지 확인
- Webike 검색 결과에서 상품 상세 URL을 추출하는지 확인
- Webike 배송비 API 응답을 서비스 후보와 배송비로 정규화하는지 확인
- 주문 마법사가 생성하는 견적 스크립트가 self-contained이며 문법 오류 없이 생성되는지 확인
- Playwright에서 직접 입력, 그룹별 스크립트 복사, 수정 반영 필요 알림이 동작하는지 확인

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

- 주문 마법사 입력/결과 UX 개선
- 테스트 케이스 확장

### v2

- 가격 조회 없는 완전한 주문 그룹 플래너
- 입력/출력 포맷 고정
- 계산 로직 모듈화

## 한계

- Webike 장바구니 DOM 구조가 크게 바뀌면 HTML 파싱이 실패할 수 있다.
- Webike 상품 상세 페이지의 JS 변수나 배송비 API 파라미터가 바뀌면 주문 마법사의 견적 스크립트가 실패할 수 있다.
- Webike 사이트 DOM 구조가 바뀌면 상품 검색, 장바구니 담기, 배송비 조회가 실패할 수 있다.
- 3개 이상 그룹은 휴리스틱으로 계산하므로 전역 최적해를 항상 보장하지 않는다.
- 통관 결과나 합산과세 회피를 보장하지 않는다.
- 실제 주문과 결제는 사용자가 직접 확인하고 진행해야 한다.
