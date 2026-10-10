package com.vowser.backend.infrastructure.mcp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.vowser.backend.application.service.ControlService;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

/**
 * 실제 agent 서버처럼 한 연결의 요청을 받은 순서대로 하나씩 처리해 답하는 가짜 서버로,
 * 응답이 요청 식별자 없이 pendingRequests의 "첫 키"에 배달될 때 섞이는지 확인
 * voiceCommandWhileApiRequestPending은 운영 코드가 호출하지 않는 sendVoiceCommand를 쓰므로 참고용임
 */
class McpResponseMixupTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private MockWebServer server;
    private McpWebSocketClient client;
    private ControlService controlService;
    private final List<String> received = new CopyOnWriteArrayList<>();
    private volatile CountDownLatch gate = new CountDownLatch(0);

    @BeforeEach
    void setUp() throws Exception {
        server = new MockWebServer();
        server.enqueue(new MockResponse().withWebSocketUpgrade(new WebSocketListener() {
            private final ExecutorService serial = Executors.newSingleThreadExecutor();
            @Override public void onMessage(WebSocket ws, String text) {
                received.add(text);
                serial.submit(() -> {
                    try {
                        gate.await(5, TimeUnit.SECONDS);
                        JsonNode req = mapper.readTree(text);
                        if ("save_contribution_path".equals(req.path("type").asText())) {
                            String sid = req.path("data").path("sessionId").asText();
                            ws.send("{\"type\":\"contribution_save_result\",\"answer_for\":\"contribution:" + sid + "\"}");
                        } else {
                            String query = req.path("data").path("query").asText();
                            ws.send("{\"type\":\"search_path_result\",\"answer_for\":\"" + query + "\"}");
                        }
                    } catch (Exception e) { throw new RuntimeException(e); }
                    return null;
                });
            }
        }));
        server.start();
        controlService = mock(ControlService.class);
        client = new McpWebSocketClient(controlService, mapper);
        ReflectionTestUtils.setField(client, "mcpServerUrl", server.url("/ws").toString().replaceFirst("^http", "ws"));
        ReflectionTestUtils.setField(client, "reconnectDelayMs", 60_000L);
        client.connect();
        for (int i = 0; i < 100 && !client.isConnected(); i++) Thread.sleep(50);
    }

    @AfterEach
    void tearDown() throws Exception {
        client.disconnect();
        try { server.shutdown(); } catch (java.io.IOException ignored) { }
    }

    private String answerFor(CompletableFuture<String> f) throws Exception {
        return mapper.readTree(f.get(5, TimeUnit.SECONDS)).path("answer_for").asText();
    }

    @RepeatedTest(10)
    void twoConcurrentSearchesAfterNineRequests() throws Exception {
        // 앞선 요청 9건을 하나씩 끝내 요청 번호를 10·11로 맞춤
        for (int i = 1; i <= 9; i++) {
            assertThat(answerFor(client.searchPath("warmup-" + i, 3, null))).isEqualTo("warmup-" + i);
        }
        gate = new CountDownLatch(1);
        CompletableFuture<String> weather = client.searchPath("날씨 알려줘", 3, null);   // requestId 10
        CompletableFuture<String> webtoon = client.searchPath("웹툰 보여줘", 3, null);   // requestId 11
        for (int i = 0; i < 100 && received.size() < 11; i++) Thread.sleep(20);
        gate.countDown();   // 서버가 받은 순서대로 답함
        // 키 "11"이 해시 순서상 "10"보다 앞서 응답이 서로 바뀜
        assertThat(answerFor(weather)).isEqualTo("웹툰 보여줘");
        assertThat(answerFor(webtoon)).isEqualTo("날씨 알려줘");
    }

    @RepeatedTest(10)
    void contributionBatchWhileSearchPending() throws Exception {
        // 운영 경로: ControlWebSocketHandler가 기록 모드의 5단계 배치를 sendContributionData로 넘김(대기 목록에 넣지 않음)
        gate = new CountDownLatch(1);
        var step = new com.vowser.backend.api.dto.ControlDto.ContributionStep("https://example.com", "t", "click", "#a", java.util.Map.of(), 1L);
        var batch = new com.vowser.backend.api.dto.ControlDto.ContributionMessage("save_contribution_path", "rec-1", "기록 중인 작업", java.util.List.of(step), true, false, 5);
        client.sendContributionData(batch);                                    // 사용자 A의 기록 배치
        CompletableFuture<String> search = client.searchPath("날씨 알려줘", 3, null); // 사용자 B의 검색
        for (int i = 0; i < 100 && received.size() < 2; i++) Thread.sleep(20);
        gate.countDown();
        // 검색 요청이 기록 배치의 결과를 받아 감
        assertThat(answerFor(search)).isEqualTo("contribution:rec-1");
        Thread.sleep(500);
        var captor = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(controlService, atLeast(0)).relayMcpResponse(captor.capture());
        List<String> relayed = new ArrayList<>();
        for (String r : captor.getAllValues()) relayed.add(mapper.readTree(r).path("answer_for").asText());
        // 검색 결과는 마지막에 연결된 앱으로 중계됨
        assertThat(relayed).containsExactly("날씨 알려줘");
    }

    @RepeatedTest(10)
    void voiceCommandWhileApiRequestPending() throws Exception {
        gate = new CountDownLatch(1);
        client.sendVoiceCommand("뉴스 보여줘", "session-voice");                    // 응답은 사용자 화면으로 중계되어야 함
        CompletableFuture<String> api = client.searchPath("관리자 경로 조회", 3, null); // 같은 연결의 API 요청
        for (int i = 0; i < 100 && received.size() < 2; i++) Thread.sleep(20);
        gate.countDown();
        // 대기 중인 API 요청이 음성 명령의 응답을 가로챔
        assertThat(answerFor(api)).isEqualTo("뉴스 보여줘");
        Thread.sleep(500);
        var captor = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(controlService, atLeast(0)).relayMcpResponse(captor.capture());
        List<String> relayed = new ArrayList<>();
        for (String r : captor.getAllValues()) relayed.add(mapper.readTree(r).path("answer_for").asText());
        // API 요청의 응답이 음성 사용자의 화면으로 중계됨
        assertThat(relayed).containsExactly("관리자 경로 조회");
    }
}
