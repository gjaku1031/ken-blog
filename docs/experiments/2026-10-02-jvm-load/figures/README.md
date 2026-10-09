# 그림

[JVM 실서버 부하·메모리 측정](https://gjaku1031.github.io/ken-blog/post/post-489faedf-7dda-4afd-8847-ad20e74fe9e4/) 글에 넣은 그림의 원본. 요청별 원자료는 저장소에 없고, 수치는 인프라 ADR의 요약(`docs/ADR/ADR_infra.md`의 "JVM 실서버 부하·메모리 측정", 커밋 `b768152` 기준)에서 옮겨 HTML에 적음.

| 파일 | 내용 | 데이터 |
| --- | --- | --- |
| `jvm-result.html` | 도착률 10·50·100·200건/초의 p95 지연과 호스트 평균 CPU | ADR 표의 "공개 상태 30% + 배지 70%" 네 행 |
| `jvm-memory.html` | API 메모리(유휴 중앙값·최대)와 컨테이너 한도, 스택 최대와 서버 최소 가용 메모리 | ADR 본문의 메모리 요약 문단 |

```bash
node .claude/skills/ken-blog-experiments/scripts/render-figure.cjs docs/experiments/2026-10-02-jvm-load/figures/jvm-result.html out/jvm-result
```
