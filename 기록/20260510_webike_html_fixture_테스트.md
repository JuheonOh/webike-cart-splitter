# 2026-05-10 Webike HTML fixture 테스트 기록

## 목적

장바구니 HTML 파싱 안정성을 실제 화면 구조에 가까운 HTML fixture 단위로 검증한다.

## 변경 범위

- `table-cart` 기반 장바구니 fixture 추가
- data attribute 기반 장바구니 fixture 추가
- fixture 파일을 `parseProducts()`로 직접 파싱하는 테스트 추가
- README 검증 항목 갱신

## 참고

현재 저장소에는 사용자가 실제 Webike 장바구니에서 캡처한 원본 HTML이 없다.
따라서 이번 fixture는 현재 파서가 지원하는 Webike 장바구니 구조를 보존하는 테스트 샘플이다.

실제 장바구니 HTML을 확보하면 `tests/fixtures/webike-cart/`에 추가해 같은 방식으로 검증한다.

## 검증

```bash
node tests/cart_group_calculator.test.js
```
