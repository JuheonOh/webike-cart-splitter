# 위바이크 장바구니 자동화

Webike Korea에서 부품번호 CSV를 입력하면 상품을 찾고 장바구니에 담는 Chrome Extension입니다.

## 기능

- Webike 페이지 우측 상단에 플로팅 패널 표시
- CSV 붙여넣기 또는 CSV 파일 업로드
- 부품번호 기준 Webike 상품 검색
- 검색 결과가 여러 개면 후보 상품 선택
- 중고 상품 제외
- 찾은 상품 장바구니 담기
- 장바구니 페이지에서 전체 비우기
- 링크 이동 후 패널 입력값과 검색 결과 복원
- 실패 CSV 복사

## CSV 양식

```csv
[부품번호],[수량],부품명
16016MAS670,1,파일럿스크류
```

- 첫 번째 컬럼은 부품번호입니다.
- 두 번째 컬럼은 수량입니다. 비우면 `1`로 처리합니다.
- 세 번째 컬럼은 사용자가 구분하기 위한 부품명입니다. 검색에는 사용하지 않습니다.
- 헤더는 `품번`, `상품번호`, `부품번호`, `파츠번호`를 모두 인식합니다.

## 빌드

```bash
npm run build
```

빌드 결과는 `dist/`에 생성됩니다. Chrome에서 압축 해제된 확장 프로그램으로 등록할 때는 `dist/` 폴더를 선택합니다.

## 파일 구조

```text
src/extension/        Chrome Extension 원본
src/extension/content 패널, 파서, Webike 조회, 장바구니 처리 소스
src/extension/styles  패널 스타일 소스
docs/                 사용 설명서 HTML
examples/             CSV 양식과 샘플 데이터
tests/                익스텐션 검증 테스트
scripts/              빌드 스크립트
dist/                 빌드 결과
```

## Chrome 등록

1. Chrome 주소창에서 `chrome://extensions`를 엽니다.
2. 우측 상단 `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램을 로드합니다`를 누릅니다.
4. 이 프로젝트의 `dist/` 폴더를 선택합니다.
5. Webike Korea 페이지에서 확장 프로그램 아이콘을 눌러 패널을 엽니다.

코드를 수정했다면 다시 `npm run build`를 실행한 뒤, Chrome 확장 프로그램 화면에서 해당 확장 프로그램의 새로고침 버튼을 눌러야 반영됩니다.

## 배포 파일

사장님께 전달할 때는 빌드된 `dist/` 폴더 전체를 전달합니다.

`dist/` 안에는 다음 파일이 있어야 합니다.

```text
dist/manifest.json
dist/extension/content-script.js
dist/extension/content-style.css
dist/extension/service-worker.js
dist/extension/icons/icon16.png
dist/extension/icons/icon32.png
dist/extension/icons/icon48.png
dist/extension/icons/icon128.png
dist/extension/fonts/D2Coding.woff2
```

## 검증

```bash
npm test
npm run build
```

`npm test`는 Chrome Extension manifest, 주요 UI/문구/빌드 전제 조건, CSV 입력 파서, Webike 검색/후보/장바구니 보조 로직을 확인합니다.
