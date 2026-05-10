# 2026-05-10 GitHub Pages 배포 준비 기록

## 목적

정적 계산기를 GitHub Pages 루트 URL에서 바로 열 수 있게 한다.

## 변경 범위

- 루트 `index.html` 진입점 추가
- `index.html`에서 `cart_group_calculator.html`로 이동 처리 추가
- `.nojekyll` 추가
- README에 GitHub Pages 설정 방법 추가

## 제외 범위

- GitHub 저장소 Pages 설정 직접 변경
- 원격 push
- GitHub Actions 배포 workflow
- 환율 자동 갱신

## 검증

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

브라우저에서 `http://127.0.0.1:4173/` 접속 시 계산기 화면으로 이동하는지 확인한다.
