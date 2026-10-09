# Vowser 경로 검색 정확도 실험 방법

## 측정 대상

`vowser-agent-server` 커밋 `d94eaf5f30f734952838528d7045e0eab8891509`의 WebSocket `save_new_path`와 `search_new_path`를 사용한다. 검색은 `app/main.py`에서 `search_with_langgraph()`로 이어지고, 등록은 `save_path_to_neo4j()`로 이어진다. 원본 서비스의 `text-embedding-3-small` 임베딩, `gpt-4o-mini` 의도 분석, Neo4j 벡터 관계 검색, 유사도 임계값 0.43, 재탐색 분기를 유지한다. `serve_traced.py`는 원본 `ChatOpenAI.ainvoke()`의 시작·성공·예외 사실과 경과 시간만 기록하며 요청과 응답을 변경하지 않는다.

원본의 `create_vector_indexes()`는 `intent_embeddings` 관계 인덱스를 생성하지 않지만 실제 검색은 그 인덱스를 호출한다. 빈 평가 DB에서 `run_eval.py bootstrap`이 `HAS_STEP.intentEmbedding`에 1536차원 cosine 관계 인덱스를 만든다. 이것은 평가 DB의 필수 준비이며 원본 코드는 변경하지 않는다. 원본의 LLM 호출이 실패하거나 폴백되면 추적 결과에 표시하고 성공한 원본 AI 검색으로 해석하지 않는다.

## 입력과 정답

`registered_paths.jsonl`은 16개 작업 의도 및 2단계씩의 **합성 등록 경로**이다. URL과 CSS 선택자는 검색 자료의 구조를 채우는 자리표시자이며 사이트 탐색이나 브라우저 자동화 검증에 사용할 수 없다. `taskDescription`과 `submission.taskIntent`, 단계 `description`을 공개해 등록 표현을 검토할 수 있도록 한다.

`gold.jsonl`은 에이전트가 직접 작성한 합성 한국어 요청 96개이다. 실제 이용자 발화, STT 전사, 음성인식 정확도 표본이 아니다. 등록 자료와 평가 문장을 같은 작성자가 함께 설계했으므로 표본 대표성과 독립성에 한계가 있다. 직접 표현 16개는 의도명에 근접하고 정확도를 높일 수 있어 별도 집계한다. 바꿔 말하기 32개, 간접 표현 16개, 비슷한 작업을 명시적으로 구별하는 표현 16개도 분리한다. 마지막 유형은 다른 작업을 배제하는 말을 포함하므로 자연적인 오인 표현의 난도를 대변하지 않는다.

정답형 80개는 각 문장에 사전 지정된 등록 경로 하나가 있다. 검색 응답의 `(domain, taskIntent)`를 등록 ID로 변환해 Top1 및 Top3에서 일치 여부를 본다. 예를 들어 열차 시간표 조회를 요구한 문장에 기존 예약 내역 조회가 나오면 오답이다. 다의 문장 8개는 여러 후보가 타당하므로 주정확도 분모에서 빼고 허용 후보가 Top1/Top3에 있는지를 별도 기록한다. 등록 범위 밖 요청 8개는 경로를 반환하지 않을 때만 무응답 성공으로 센다. 검색 실패·타임아웃·빈 결과는 정답형 분모 80에 포함한 실패다.

`freeze_manifest.json`에 등록 자료와 정답 파일의 SHA-256을 실행 전에 고정했다. 런너는 단계마다 해시를 검사한다. 검색 응답을 본 뒤 등록 문구, 문장, 정답, 임계값 또는 후보 검색법을 수정하지 않는다. 이 자료로 튜닝한 모델의 성능을 같은 자료로 다시 보고하지 않는다.

## 실행 조건과 순서

평가는 프로젝트 전용 OpenAI API 키와 격리된 Neo4j가 준비된 뒤 사용자 VM에서 수행한다. 키 값은 결과·로그·저장소에 기록하지 않는다. Neo4j에 다른 실험 데이터가 있으면 `bootstrap`이 거부한다. 다른 DB 실험이 완료되어 데이터 보존·정리가 확인되기 전에는 DB를 쓰지 않는다.

1. 원본 Python 의존성을 평가용 임시 환경에 설치하고 `run_eval.py validate`로 16경로·96문장·해시 확인.
2. 전용 빈 Neo4j에서 `run_eval.py bootstrap`으로 누락된 인덱스 생성 및 ONLINE 확인.
3. 원본 서버 프로젝트를 현재 작업 디렉터리로 하여 `serve_traced.py` 실행. 평가 서버는 `127.0.0.1:19429`에만 바인딩하며 추적 파일은 `VOWSER_EVAL_LLM_TRACE`에 지정. 기존 운영 서버에는 연결하거나 종료 명령을 보내지 않음.
4. `run_eval.py register`로 16경로 등록 후 원본 `check_graph` 응답에서 HAS_STEP 16개 확인.
5. `run_eval.py search --trace-file <추적 파일>`로 동결된 96문장을 순서대로 한 차례 실행. 각 요청은 `limit=3`, `domain_hint` 없음. 재시도 없이 실패를 원시 결과에 포함.
6. `run_eval.py report`로 전체·표현 유형별 Top1/Top3, 다의 후보 적중, 미등록 요청 무응답, 실패, 지연, LLM 호출 관측, Wilson 95% 구간 생성.

모든 요청의 WebSocket 왕복 지연과 원본 `performance.search_time`을 원시 응답에 보존한다. 지연에는 localhost WebSocket 및 OpenAI 네트워크 변동이 포함된다. `run/environment.json`에 Python·패키지 버전과 실행 주소, `run/graph_stats.json`에 실제 등록 관계 수가 기록된다. `run/search_raw.jsonl`에는 질문, 반환 경로 순서, 원본 응답, LLM 호출 시도·성공 관측이 기록된다. 관측 도구가 없는 경우 LLM 호출 여부를 `unknown`으로 남긴다.

## 예상 API 비용

원본 코드의 기본 검색은 질의 임베딩 두 번과 `gpt-4o-mini` 의도 분석 한 번을 병렬 실행한다. 낮은 유사도의 재탐색은 추가 임베딩을 만들 수 있다. 16경로 등록에서 대략 55회, 96문장 기본 검색에서 192회, 재탐색을 포함해 총 약 250~400회 임베딩과 96회 LLM 호출을 예상한다. 공식 가격은 [`text-embedding-3-small` $0.02/백만 입력 토큰](https://developers.openai.com/api/docs/models/text-embedding-3-small), [`gpt-4o-mini` $0.15/백만 입력 및 $0.60/백만 출력 토큰](https://developers.openai.com/api/docs/models/gpt-4o-mini)이다. LLM 호출마다 500입력·150출력 토큰, 임베딩마다 30입력 토큰이라는 가정이면 약 $0.016이며 실제 프롬프트 길이와 재시도에 따라 달라진다.
