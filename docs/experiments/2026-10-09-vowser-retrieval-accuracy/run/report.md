# Vowser 실제 표현별 경로 검색 평가

## 범위와 정답 기준

- 등록 합성 경로: Neo4j HAS_STEP 관계 16개, 등록 응답 성공 16/16개. 클릭 URL과 선택자는 검색 구조 검사용이며 실제 웹 작업의 동작 검증 자료가 아님.
- 문장: 에이전트가 직접 작성한 합성 한국어 96개. 실제 사용자 발화나 STT 정확도 표본이 아님.
- 정답: answerable에서는 등록된 `(domain, taskIntent)` 하나와 일치하면 정답. 중복 도메인의 다른 작업은 오답. 검색 실패·빈 결과는 분모에 포함한 오답.
- ambiguous 8개는 복수 허용 후보를 별도 측정하며 Top1 주분모에서 제외. unanswerable 8개는 경로 미반환을 별도 측정.
- 정답·등록 데이터 SHA-256은 실행 전 freeze_manifest.json에 고정. 결과 관찰 후 변경하지 않음.

## 결과

- 정답형 Top1: **46/80 (57.5%)**, Wilson 95% CI [0.4657, 0.6774].
- 정답형 Top3: **66/80 (82.5%)**, Wilson 95% CI [0.7274, 0.8928].
- 다의 문장 허용 후보 Top1: 7/8 (87.5%); Top3: 8/8 (100.0%).
- 미등록 요청 무응답: 0/8 (0.0%).
- 검색 실패: 0/96. 원시 왕복 지연 중앙값 1347.86 ms, p95 1983.7 ms.
- LLM 호출 시도 관측 96/96, 성공 관측 96/96, 관측 불가 0/96.

| 표현 유형 | Top1 | Top3 |
| --- | ---: | ---: |
| confusable | 4/16 (25.0%) | 16/16 (100.0%) |
| direct | 15/16 (93.8%) | 16/16 (100.0%) |
| indirect | 7/16 (43.8%) | 8/16 (50.0%) |
| paraphrase | 20/32 (62.5%) | 26/32 (81.2%) |

## Top1 오답·실패

| ID | 질문 | 정답 | Top1 | 상태 |
| --- | --- | --- | --- | --- |
| weather_today-2 | 지금 바깥 기온이 몇 도야? | weather_today | train_book | 응답 |
| weather_today-4 | 외출할 때 우산 챙겨야 할지 보고 싶어 | weather_today | 없음 | 응답 |
| weather_today-5 | 내일 말고 오늘 날씨만 보여줘 | weather_today | weather_tomorrow | 응답 |
| weather_tomorrow-5 | 오늘 말고 내일 예보를 열어 줘 | weather_tomorrow | weather_today | 응답 |
| news_headlines-3 | 오늘의 속보 제목들을 보고 싶어 | news_headlines | weather_today | 응답 |
| news_headlines-4 | 세상에 무슨 일이 있는지 첫 화면 기사부터 훑고 싶어 | news_headlines | news_topic_search | 응답 |
| news_headlines-5 | 특정 주제 검색 말고 주요 뉴스만 보여줘 | news_headlines | news_topic_search | 응답 |
| news_topic_search-3 | 전기차 기사만 검색해서 보여줘 | news_topic_search | train_reservation | 응답 |
| news_topic_search-4 | 관심 있는 사건에 관한 보도를 모아서 읽고 싶어 | news_topic_search | 없음 | 응답 |
| train_book-1 | 서울에서 부산 가는 기차표 예매해 줘 | train_book | train_cancel | 응답 |
| train_book-2 | KTX 좌석을 새로 예약하고 싶어 | train_book | 없음 | 응답 |
| train_book-3 | 이번 주말 열차 승차권 구매 화면 열어 줘 | train_book | train_schedule | 응답 |
| train_book-4 | 고향 내려갈 자리를 미리 확보해야 해 | train_book | 없음 | 응답 |
| train_book-5 | 기존 예약 조회 말고 새 기차표를 잡아 줘 | train_book | train_reservation | 응답 |
| train_schedule-2 | 오늘 KTX 출발 시간들을 보여줘 | train_schedule | weather_today | 응답 |
| train_schedule-3 | 대전행 기차가 몇 시에 있는지 알아봐 줘 | train_schedule | train_reservation | 응답 |
| train_reservation-2 | 내가 예매한 KTX 표를 보여줘 | train_reservation | train_book | 응답 |
| train_reservation-5 | 열차 시간표 말고 내 예약 기록을 열어 줘 | train_reservation | train_schedule | 응답 |
| train_cancel-2 | KTX 예약을 취소하고 싶어 | train_cancel | order_cancel | 응답 |
| train_cancel-3 | 열차 승차권 환불 화면으로 가 줘 | train_cancel | train_reservation | 응답 |
| train_cancel-4 | 여행을 안 가게 돼서 잡아 둔 자리를 반납해야 해 | train_cancel | map_route | 응답 |
| train_cancel-5 | 예약 조회에서 끝내지 말고 표 취소 절차를 열어 줘 | train_cancel | train_reservation | 응답 |
| resident_copy-4 | 은행에 낼 가족이 함께 적힌 거주 증명서를 떼야 해 | resident_copy | family_certificate | 응답 |
| resident_copy-5 | 초본 말고 주민등록등본을 신청해 줘 | resident_copy | resident_extract | 응답 |
| resident_extract-3 | 내 주소 변동 기록이 있는 주민등록 서류 떼 줘 | resident_extract | resident_copy | 응답 |
| resident_extract-4 | 이사 이력을 증빙할 개인 서류가 필요해 | resident_extract | 없음 | 응답 |
| family_certificate-5 | 주민등록등본이 아니라 가족관계증명서를 발급해 줘 | family_certificate | resident_copy | 응답 |
| youtube_search-5 | 좋아요 누르지 말고 영상 검색만 해 줘 | youtube_search | youtube_like | 응답 |
| order_track-3 | 구매한 물건의 도착 예정일 확인해 줘 | order_track | weather_tomorrow | 응답 |
| order_track-5 | 주문 취소 말고 배송 상태를 알려줘 | order_track | order_cancel | 응답 |
| order_cancel-4 | 잘못 산 물건을 받기 전에 돌려야 해 | order_cancel | 없음 | 응답 |
| order_cancel-5 | 배송 조회 말고 주문 취소 화면 열어 줘 | order_cancel | order_track | 응답 |
| map_route-4 | 약속 장소까지 어떻게 가야 빨리 도착할까? | map_route | train_reservation | 응답 |
| map_route-5 | 열차 시간표 말고 지금 위치에서 서울역 가는 길 알려줘 | map_route | train_schedule | 응답 |

## 재현 자료

- `registered_paths.jsonl`, `gold.jsonl`, `freeze_manifest.json`: 입력과 사전 정답
- `run/registration_raw.jsonl`, `run/search_raw.jsonl`: 모든 원시 응답·지연·LLM 추적
- `run/environment.json`, `run/summary.json`: 도구 버전과 결과 집계
- `run_eval.py`, `serve_traced.py`: 등록·검색·관측 재현 코드
