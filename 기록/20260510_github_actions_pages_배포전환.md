# GitHub Actions Pages 배포 전환

## 목적

GitHub Pages의 branch/root 직접 배포 대신 GitHub Actions가 정적 파일 artifact를 배포하도록 전환한다.

## 이유

- 환율 자동 갱신 workflow가 `GITHUB_TOKEN`으로 커밋한 변경은 branch Pages build를 안정적으로 깨우지 못할 수 있다.
- Actions deploy 방식은 같은 workflow 안에서 환율 JSON 갱신과 Pages 배포를 이어서 실행할 수 있다.
- 배포 대상 파일을 명확히 제한할 수 있다.

## 워크플로우

```text
push main
→ 테스트
→ dist artifact 생성
→ GitHub Pages 배포

schedule / workflow_dispatch
→ 테스트
→ forwarder.kr 환율 JSON 갱신
→ 변경 시 data/exchange-rates.json 커밋
→ dist artifact 생성
→ GitHub Pages 배포
```

## 배포 대상

- `index.html`
- `cart_group_calculator.html`
- `.nojekyll`
- `data/exchange-rates.json`

## 운영 필요 작업

GitHub 저장소 `Settings > Pages`에서 Source를 `GitHub Actions`로 변경해야 한다.
