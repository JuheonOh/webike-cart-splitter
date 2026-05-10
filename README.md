# Webike Cart Splitter

Webike 장바구니 상품가를 관세청 과세환율 기준으로 나눠 보고, 필요하면 Webike 장바구니 배송비를 Node CLI로 실측해 단일/분할 주문 비용을 비교하는 도구입니다.

정적 계산기는 **주문 계획 보조 도구**입니다. 별도 Node CLI는 상품 상세 조회, 배송비 조회, 필요 시 장바구니 담기까지만 자동화하며, 로그인, 주문, 결제는 자동화하지 않습니다.

## 사용 방법

1. 로컬에서는 `cart_group_calculator.html`을 브라우저에서 연다. GitHub Pages 배포 후에는 저장소 Pages URL로 접속한다.
2. 입력 방식을 선택한다.
   - `장바구니 HTML`: Webike 장바구니 페이지에서 상품 테이블 HTML을 복사해 붙여넣는다.
   - `직접 입력`: 상품번호, 상품명, 수량, 단가 JPY를 행 단위로 입력한다.
   - 엑셀에서 `상품번호, 상품명, 수량, 단가JPY` 순서로 복사한 표는 직접 입력의 `CSV/TSV 붙여넣기`에 붙여넣어 한 번에 반영한다.
3. 면세 기준, USD 수입환율, JPY 수입환율을 확인한다.
   - GitHub Pages에서는 `data/exchange-rates.json`의 자동 갱신 환율이 기본값으로 반영된다.
   - 브라우저에 저장된 설정이 있으면 저장값을 우선 사용한다.
4. `분석하기`를 누른다.
5. 추천 주문 그룹을 확인한다.
6. 장바구니 HTML 분석값을 수정해야 하면 `추출된 상품` 표의 수량/단가를 고치고 `수정 반영`을 누른다. 직접 입력 테이블에서 보정하려면 `직접 입력으로 가져오기`를 사용한다.
7. Webike 장바구니에 한 번에 담아 보고 싶으면 `Webike 장바구니 담기`에서 스크립트를 만들고 복사한다.
8. 필요하면 `XLSX 내보내기`로 결과를 저장한다.

입력한 면세 기준, USD/JPY 수입환율, 최대 주문 수, 수량 분할 설정은 브라우저에 저장되어 다음 실행 때 복원됩니다.

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

## Webike 배송비 실측 CLI

Node CLI는 사람이 Webike 장바구니를 반복해서 구성하지 않아도 되도록 단일 주문과 추천 분할 주문 그룹의 배송비를 읽습니다. 기본 방식은 상품 상세 페이지에서 가격/무게/부피를 파싱한 뒤 Webike 배송비 API를 직접 호출하는 `quote-api` 모드입니다. Playwright 장바구니 측정은 Webike 화면 검증이나 API 우회가 필요할 때 쓰는 예비 모드입니다.

```bash
npm install
npm run webike:install
npm run webike:quote -- --mode quote-api --input parts.csv
npm run webike:quote -- --mode cart-script --input parts.csv --output /tmp/webike_add_cart.js
npm run webike:quote -- --mode cart --input parts.csv --headed
```

입력 CSV/TSV 컬럼:

```text
part_number,product_url,quantity,name,unit_jpy
```

- `quote-api` 모드: `product_url`이 있으면 상세 페이지를 바로 읽고, 없으면 `part_number`로 Webike 검색 API에서 상품 상세 URL을 1개로 확정한 뒤 진행한다.
- `quote-api` 모드는 상세 페이지의 `priceYen`, `productWeight`, `productVolume`, `currentCountryIso2`, `shopCode`, `API_SHIPPING_URL` 값을 읽고, 단일/분할 그룹별로 `wp`, `vl`, `amount`를 합산해 배송비 API를 호출한다.
- 배송 서비스는 기본적으로 API 응답 중 최저가를 사용한다. 특정 서비스를 고정하려면 `--shipping-service STD`처럼 지정한다.
- `cart-script` 모드: `part_number` 또는 `product_url`로 상품 상세를 확인한 뒤 Webike DevTools Console에 붙여넣을 JS 파일을 생성한다. Webike 페이지에서 실행하면 현재 브라우저 세션 장바구니에 상품을 빠르게 담고, 모두 성공했을 때 `/shopping_cart.html`로 이동한다.
- `cart` 모드: `part_number`, `quantity`가 필요하다. 먼저 전체 상품을 한 번에 담아 실제 상품가와 배송비를 읽고, 그 상품가로 분할 그룹을 만든 뒤 각 그룹을 새 browser context에서 다시 담아 배송비를 측정한다.
- `plan-only` 모드: Webike에 접속하지 않고 입력된 `unit_jpy`, `--single-shipping-jpy`, `--split-shipping-jpy` 값으로만 비교한다.
- 결과 JSON은 기본적으로 `reports/webike_quote_YYYYMMDD_HHMM.json`에 저장된다.
- 상품 상세 파싱, 배송비 API 호출, 장바구니 배송비 읽기, 상품 담기 중 하나라도 실패하면 성공 보고서를 만들지 않고 실패한다.
- `quote-api` 실행 중에는 검색, 상세 조회, 배송비 조회 진행 상황이 터미널에 출력된다. 숨기려면 `--quiet`를 붙인다.
- Webike DOM 구조가 바뀌면 `--headed`로 실제 화면을 보며 selector 보정이 필요할 수 있다.

예상 배송비만 넣어 비교:

```bash
npm run webike:quote -- --mode plan-only --input parts.csv --single-shipping-jpy 5000 --split-shipping-jpy 2500
```

## GitHub Pages 배포

- 예상 URL: `https://juheonoh.github.io/webike-cart-splitter/`
- GitHub 저장소 `Settings > Pages`에서 Source를 `GitHub Actions`로 설정한다.
- `deploy-pages` 워크플로우가 Pages artifact를 만들고 배포한다.
- 배포 대상 파일은 `index.html`, `cart_group_calculator.html`, `.nojekyll`, `assets/`, `data/exchange-rates.json`이다.
- `push`는 현재 파일을 배포하고, `schedule`/`workflow_dispatch`는 환율 JSON 갱신 후 배포한다.

## 계산 기준

- 배송비, 포인트, 쿠폰은 계산하지 않는다.
- 장바구니에 표시된 상품가 또는 직접 입력한 단가 JPY 기준으로만 계산한다.
- 150 USD 한도는 다음 식으로 JPY 환산한다.

```text
JPY 한도 = 면세 기준 USD * USD 수입환율 / JPY 수입환율
```

- 같은 상품 수량 분할 허용을 켜면 수량 4개 상품은 1개 단위로 다른 주문 그룹에 배치될 수 있다.

## 현재 파일

- `index.html`: GitHub Pages 진입점
- `cart_group_calculator.html`: 실제 계산기
- `assets/css/cart-group-calculator.css`: 계산기 스타일
- `assets/js/calculator-core.js`: 계산, 파싱, XLSX 생성 로직
- `assets/js/cart-group-calculator.js`: 계산기 화면 동작과 이벤트 연결
- `assets/js/cost-comparison-core.js`: 단일/분할 주문 비용 비교와 실측 배송비 비교 로직
- `data/exchange-rates.json`: GitHub Pages에서 읽는 USD/JPY 수입환율 데이터
- `scripts/update-exchange-rates.js`: forwarder.kr 고시환율 HTML 파서
- `scripts/webike-quote.js`: Webike 장바구니 배송비 실측/비용 비교 Node CLI
- `.github/workflows/deploy-pages.yml`: 환율 JSON 자동 갱신과 GitHub Pages 배포 워크플로우
- `tests/cart_group_calculator.test.js`: 계산 그룹, XLSX 생성, 직접 입력 정규화, CSV/TSV 붙여넣기, 결과 HTML escape 검증
- `tests/cost_comparison.test.js`: 비용 비교, 실측 배송비 비교, Node CLI 입력/검증 로직 검증
- `tests/update_exchange_rates.test.js`: forwarder.kr 고시환율 HTML 파싱 검증
- `기록/20260506_webike_주문그룹_자동화_설계안.md`: 향후 자동화 설계안

## 검증

별도 패키지 설치 없이 Node.js로 실행한다.

```bash
node tests/cart_group_calculator.test.js
node tests/update_exchange_rates.test.js
node tests/cost_comparison.test.js
```

`package.json` 기반으로 실행할 때는 다음 명령을 사용한다.

```bash
npm test
```

검증 항목:

- 샘플 상품 합계가 `42,699 JPY`인지 확인
- 기본 환율 기준 JPY 한도가 `23,539 JPY`인지 확인
- 추천 그룹이 `21,350 / 21,349 JPY` 두 그룹으로 나뉘는지 확인
- XLSX 바이트가 생성되는지 확인
- 직접 입력 행이 계산용 상품 데이터로 정규화되는지 확인
- 분석 결과 상품이 직접 입력 행으로 변환되는지 확인
- 분석 결과 상품 표가 수량/단가 편집 입력을 렌더링하는지 확인
- 계산기 화면에서 Webike DevTools 장바구니 담기 스크립트를 생성하는지 확인
- CSV/TSV 붙여넣기가 직접 입력 행으로 변환되는지 확인
- 환율과 주문 설정이 저장값으로 정규화되는지 확인
- 자동 환율 JSON 값이 계산기 입력용 데이터로 정규화되는지 확인
- 장바구니 행에서 JPY/円/￥ 가격 표기를 파싱하는지 확인
- Webike 장바구니 HTML fixture가 상품 목록으로 파싱되는지 확인
- 붙여넣은 상품명/품번이 결과 영역에서 HTML로 실행되지 않도록 escape되는지 확인
- forwarder.kr 고시환율 HTML에서 USD/JPY 수입환율을 파싱하는지 확인
- 단일/분할 주문 비교에서 고정 배송비와 실측 배송비가 각각 계산되는지 확인
- Node CLI가 CSV/TSV 입력을 병합하고 장바구니 측정 실패를 성공으로 처리하지 않는지 확인
- Node CLI가 Webike 상품 상세 fixture에서 가격/무게/부피를 파싱하고 배송비 API 응답으로 실측 비교를 만드는지 확인
- Node CLI가 Webike 검색 결과로 DevTools 장바구니 일괄 담기 스크립트를 생성하는지 확인

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

- XLSX 파일 입력 지원
- 결과표 수정 편의성 개선
- 테스트 케이스 확장

### v2

- 가격 조회 없는 완전한 주문 그룹 플래너
- 입력/출력 포맷 고정
- 계산 로직 모듈화

### v3 이후

- Webike 배송비 API 직접 견적 CLI 안정화
- Playwright 장바구니 측정 검증 모드 보강
- 필요 시 실제 Webike DOM selector 보정과 리포트 포맷 개선

## 한계

- Webike 장바구니 DOM 구조가 크게 바뀌면 HTML 파싱이 실패할 수 있다.
- Webike 상품 상세 페이지의 JS 변수나 배송비 API 파라미터가 바뀌면 `quote-api` 모드가 실패할 수 있다.
- Webike 사이트 DOM 구조가 바뀌면 Node CLI의 검색, 상품 담기, 배송비 읽기가 실패할 수 있다.
- 3개 이상 그룹은 휴리스틱으로 계산하므로 전역 최적해를 항상 보장하지 않는다.
- 통관 결과나 합산과세 회피를 보장하지 않는다.
- 실제 주문과 결제는 사용자가 직접 확인하고 진행해야 한다.
