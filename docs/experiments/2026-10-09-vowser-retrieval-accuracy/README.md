# Vowser 의도 검색 정확도 탐색적 평가 (2026-10-09 실행)

원본 agent 서버(커밋 d94eaf5)와 원본 모델로, 합성 작업 16개를 등록하고 합성 질의 96개를 한 번씩 보낸 탐색적 평가. 질의와 정답은 2026-09-28에 `freeze_manifest.json`으로 고정했고, 가설과 판정 기준은 미리 정하지 않음. 이 결과에서 세운 가설은 [임계값 확증 실험](../2026-10-09-vowser-intent-threshold/)에서 새 질의로 확인함.

| 파일 | 내용 |
| --- | --- |
| `METHOD.md` | 평가 방법과 정답 기준 |
| `gold.jsonl`, `registered_paths.jsonl`, `freeze_manifest.json` | 질의 96개·사전 정답, 등록 작업 16개, 실행 전 해시 |
| `run_eval.py`, `serve_traced.py`, `build_gold.py` | 등록·검색·집계, LLM 호출 관측, 질의 생성 기록 |
| `run/` | 등록·검색 원자료, LLM 호출 기록, 집계(`summary.json`, `report.md`) |
| `run-attempts/` | 첫 실행 실패 기록. 평가용 Neo4j에 APOC가 없어 원본 코드가 DB에 연결하지 못함. APOC를 넣어 다시 실행함 |

결과: 정답형 80개 중 1위 정답 46(57.5%, Wilson 95% 46.6~67.7%), 3위 안 66(82.5%). 미등록 요청 8개는 모두 다른 작업을 반환함. 지연 중앙값 1,348ms(p95 1,984ms).
