[0편](/ken-blog/post/post-df978c72-44d3-4e81-b572-8834cd0646c3/)에서 curl로 시간을 재 봤을 때 TLS 핸드셰이크가 TCP 연결보다 몇 배 오래 걸렸다. 자물쇠 하나 채우는 데 무슨 일을 그렇게 하는 걸까. 생각해 보니 주소창의 자물쇠 아이콘이 정확히 무엇을 보증하는지도 설명하지 못했다. 이번 편은 HTTPS의 S, TLS를 따라갔다.

## 지도에서 이번 구간

![0편 지도에서 이번 편이 다루는 구간을 초록으로 표시했다. 브라우저와 처음 만나는 서버 사이에 열린 TCP 연결 위에서 TLS가 자물쇠를 채운다|dark=168|w=100|a=center](attachment:167)

## 학습 목표

- TLS가 지켜 주는 세 가지(기밀성, 무결성, 인증)를 설명할 수 있다
- 인증서 체인을 따라 신뢰 앵커까지 올라가는 검증 과정을 설명할 수 있다
- TLS 1.3과 1.2의 핸드셰이크 왕복 수 차이와 SNI가 하는 일을 설명할 수 있다

## HTTPS는 HTTP를 자물쇠 상자에 넣은 것

HTTPS라고 해서 HTTP 메시지가 달라지는 건 아니다. `GET / HTTP/1.1` 같은 메시지는 그대로이고, 그 메시지를 TCP에 바로 싣지 않고 TLS라는 층에 한 번 넣어서 보낸다.[* TLS(Transport Layer Security): 예전 이름은 SSL. 지금 쓰는 버전은 TLS 1.2(RFC 5246)와 TLS 1.3(RFC 8446)이다. curl 출력에 아직 `SSL connection`이라고 나오는 건 옛 이름이 남은 것이다]

HTTPS는 HTTP 메시지를 자물쇠 달린 상자에 넣어 보내는 것에 비유할 수 있다. 내용물인 메시지는 그대로이고 상자만 바뀐다. 이 상자가 지켜 주는 건 세 가지다.

| 지키는 것 | 비유 | 막는 일 |
| --- | --- | --- |
| 기밀성 | 상자가 잠겨 있음 | 중간에서 내용을 엿보기 |
| 무결성 | 봉인 테이프. 뜯으면 티가 남 | 중간에서 내용을 몰래 바꾸기 |
| 인증 | 받는 사람의 신분증 확인 | 가짜 서버가 진짜인 척하기 |

잠기는 범위도 처음 생각과 달랐다. 경로와 쿼리, 헤더, 쿠키, 본문은 모두 상자 안에 들어간다. 반면 어느 IP의 몇 번 포트로 가는지, 주고받는 양과 시간은 상자 밖에서 보인다. 그리고 뒤에서 볼 SNI 때문에 접속하는 도메인 이름도 보통 보인다.[* ECH(Encrypted Client Hello)라는 확장이 도메인 이름까지 숨기려고 만들어지고 있지만, 모든 브라우저와 서버가 쓰는 단계는 아니다]

### 헷갈렸던 것: 암호화만으로는 안전하지 않다

처음엔 "암호화하면 안전하다"로 이해했다. 그런데 상자를 아무리 단단히 잠가도, 상자를 건네받는 사람이 가짜라면 소용없다. 공격자가 중간에서 나와는 자기 키로, 진짜 서버와는 또 다른 키로 연결을 맺으면 양쪽 모두 암호화돼 있는데도 공격자는 모든 내용을 본다.[* 이런 공격을 중간자 공격(man-in-the-middle, MITM)이라고 한다] 그래서 TLS는 키를 정하기 전에 "상대가 정말 `example.com`인가"를 인증서로 확인한다. 세 가지 중 인증이 빠지면 나머지 둘도 의미가 없다.

## 인증서: 서버의 신분증

인증서에는 이 서버의 이름(도메인), 공개 키, 유효 기간, 그리고 이 내용을 보증한 발급자의 서명이 들어 있다.[* 이름은 인증서의 SAN(Subject Alternative Name) 항목에 적힌다. 공개 키는 짝이 되는 개인 키를 가진 쪽만 그 키로 서명할 수 있게 해 준다. 서버는 핸드셰이크 중에 개인 키로 서명해서 "이 인증서의 주인이 나"라는 걸 증명한다]

그럼 발급자는 왜 믿을까. 발급자도 자기 인증서가 있고, 그건 또 다른 상위 발급자가 서명했다. 이렇게 올라가다 보면 운영체제나 브라우저에 **처음부터 들어 있는** 루트 인증서에 닿는다. 거기서 멈추고 믿는다. 이 시작점을 신뢰 앵커라고 한다. 신뢰 앵커 목록은 내가 고른 게 아니라 운영체제와 브라우저 회사가 정해서 넣어 둔다.

클라이언트가 확인하는 건 대략 세 가지다.

- 서명 사슬이 신뢰 앵커까지 이어지는가
- 인증서의 이름이 내가 접속하려는 도메인과 같은가
- 유효 기간 안인가[* 이 밖에 인증서가 폐기되지 않았는지도 확인할 수 있지만, 확인 방식(OCSP, CRL 등)과 실제로 확인하는지는 클라이언트마다 다르다]

![example.com의 인증서는 발급자를 따라 두 칸 올라가 이 VM의 신뢰 저장소에 들어 있는 루트에 닿고, 거기서 검증이 멈춘다. 서버가 함께 보낸 3번은 같은 루트의 교차 서명본이라 이번 검증에는 쓰이지 않았다. 이름은 아래 실습의 openssl 출력 그대로다|dark=198|w=100|a=center](attachment:197)

## 핸드셰이크: 자물쇠를 채우는 순서

TLS 1.3 핸드셰이크는 이렇게 흘러간다.

1. **ClientHello**: 클라이언트가 지원하는 암호 방식 목록, 키 교환에 쓸 자기 몫(키 공유 값), 접속하려는 도메인 이름(SNI)을 보낸다.
2. **ServerHello 묶음**: 서버가 고른 방식과 자기 몫의 키 공유 값을 보낸다. 이 시점에 양쪽 모두 같은 비밀 키를 계산할 수 있으므로, 이어서 보내는 인증서와 서명, Finished는 이미 암호화돼 있다.
3. **Finished**: 클라이언트가 인증서를 검증하고 Finished를 보낸다. HTTP 요청도 바로 같이 보낸다.

2단계의 "같은 비밀 키를 계산한다"는 처음에 잘 이해되지 않았다. 키를 직접 주고받지 않는데 양쪽이 같은 키를 갖게 된다. 이 과정은 흔히 물감 섞기에 비유한다. 둘이 공통 색 하나를 정하고, 각자 비밀 색을 섞어 만든 색만 서로 보낸다. 받은 색에 자기 비밀 색을 한 번 더 섞으면 양쪽에 같은 색이 나온다. 중간에서 섞인 색 두 개를 봐도 비밀 색을 빼낼 수는 없다.[* 이 방식을 Diffie-Hellman 키 교환이라고 하고, 지금은 주로 타원 곡선 버전(ECDHE)을 쓴다. 물감 대신 "섞기는 쉽고 되돌리기는 어려운" 수학 연산을 쓴다. 0편 출력의 `X25519MLKEM768`은 타원 곡선 X25519에 양자 컴퓨터에도 버티도록 만든 ML-KEM을 함께 쓰는 방식이다]

TLS 1.2는 같은 일을 하는데 왕복이 한 번 더 든다.

![TLS 1.3은 첫 왕복에서 키 공유 값을 바로 주고받아 한 번 왕복한 뒤 HTTP 요청을 보낸다. TLS 1.2는 키 교환 값을 주고받고 서로 Finished를 확인하느라 두 번 왕복한 뒤에야 요청을 보낸다|dark=178|w=100|a=center](attachment:177)

TLS 1.2에서는 ClientHello에 키 공유 값이 없어서, 서버의 답을 받은 뒤에야 키 교환을 시작한다. TLS 1.3은 클라이언트가 "아마 이 방식을 고를 것"이라 보고 첫 메시지에 자기 몫을 미리 실어 보내서 왕복 하나를 줄였다.[* 서버가 클라이언트가 미리 고른 방식을 받지 않으면 HelloRetryRequest로 다시 요청하고, 이때는 왕복이 하나 늘어난다. 한 번 연결했던 서버라면 세션 재개로 핸드셰이크를 줄이거나, 1.3의 0-RTT로 첫 메시지에 데이터를 실을 수도 있다]

### SNI: 같은 IP에 사이트가 여러 개일 때

CDN 서버 하나의 IP에는 수많은 사이트가 함께 산다. 서버는 인증서를 보내기 전에 "어느 사이트의 인증서를 줘야 하나"를 알아야 하는데, 아직 HTTP 요청의 `Host` 헤더는 오지 않았다. 그래서 클라이언트가 ClientHello에 도메인 이름을 적어 보낸다. 이게 SNI(Server Name Indication)다.

## 직접 확인해 보기

모두 2026-10-23에 Linux VM에서 OpenSSL 3.5.5와 curl 8.18.0으로 실행했다.

### 인증서 체인 보기

```bash
openssl s_client -connect example.com:443 -servername example.com </dev/null
```

```text
Certificate chain
 0 s:CN=example.com
   i:C=US, O=SSL Corporation, CN=Cloudflare TLS Issuing ECC CA 3
   v:NotBefore: Sep 26 22:49:11 2026 GMT; NotAfter: Dec 25 22:56:35 2026 GMT
 1 s:C=US, O=SSL Corporation, CN=Cloudflare TLS Issuing ECC CA 3
   i:C=US, O=SSL Corporation, CN=SSL.com TLS Transit ECC CA R2
 2 s:C=US, O=SSL Corporation, CN=SSL.com TLS Transit ECC CA R2
   i:C=US, O=SSL Corporation, CN=SSL.com TLS ECC Root CA 2022
 3 s:C=US, O=SSL Corporation, CN=SSL.com TLS ECC Root CA 2022
   i:C=GB, ST=Greater Manchester, L=Salford, O=Comodo CA Limited, CN=AAA Certificate Services
---
New, TLSv1.3, Cipher is TLS_AES_256_GCM_SHA384
Verify return code: 0 (ok)
```

검증 과정은 표준 에러로 따로 찍힌다.[* 위 출력에서 키 종류(`a:`)와 일부 유효 기간(`v:`) 줄, 인증서 본문은 생략했다]

```text
depth=3 C=US, O=SSL Corporation, CN=SSL.com TLS ECC Root CA 2022
depth=2 C=US, O=SSL Corporation, CN=SSL.com TLS Transit ECC CA R2
depth=1 C=US, O=SSL Corporation, CN=Cloudflare TLS Issuing ECC CA 3
depth=0 CN=example.com
```

| 출력 | 뜻 |
| --- | --- |
| `0 s:CN=example.com` | 이 서버의 인증서. `s:`는 주인, `i:`는 발급자 |
| `1`, `2`의 `s:`가 바로 위 인증서의 `i:`와 같음 | 발급자를 따라 한 칸씩 올라가는 사슬 |
| `depth=3 … SSL.com TLS ECC Root CA 2022` | 검증이 멈춘 곳. 이 VM의 신뢰 목록(`/etc/ssl/certs`)에 있는 루트 인증서 |
| `Verify return code: 0 (ok)` | 사슬, 이름, 기간 검증을 모두 통과함 |

서버가 보낸 3번 인증서는 이름이 루트와 같은데 발급자가 다른 회사(`AAA Certificate Services`)다. 내 VM은 이미 `SSL.com TLS ECC Root CA 2022`를 믿고 있어서 거기서 멈췄고, 3번의 발급자까지 올라가지 않았다. 새 루트를 아직 모르는 오래된 기기도 예전 루트까지 따라가 검증할 수 있게 하려는 교차 서명 인증서로 보인다.

### SNI를 빼거나 바꾸면

같은 명령을 SNI만 바꿔 세 번 실행하고, 인증서 주인과 연결 결과 줄만 남겼다.

```bash
openssl s_client -connect example.com:443 -servername example.com
```

```text
 0 s:CN=example.com
New, TLSv1.3, Cipher is TLS_AES_256_GCM_SHA384
```

```bash
openssl s_client -connect example.com:443 -noservername
```

```text
...:error:0A000410:SSL routines:ssl3_read_bytes:ssl/tls alert handshake failure:...:SSL alert number 40
New, (NONE), Cipher is (NONE)
```

```bash
openssl s_client -connect 104.20.23.154:443 -servername www.cloudflare.com
```

```text
 0 s:CN=www.cloudflare.com
New, TLSv1.3, Cipher is TLS_AES_256_GCM_SHA384
```

SNI를 빼자 서버가 핸드셰이크 자체를 거절했다. 어느 사이트의 인증서를 줄지 모르니 답할 수가 없는 것이다. 그리고 example.com과 **같은 IP**로 접속하면서 SNI만 `www.cloudflare.com`으로 바꾸니 전혀 다른 인증서가 왔다. 한 IP에 여러 사이트가 살고, 서버가 SNI를 보고 인증서를 고른다는 게 그대로 보였다.[* 이 IP는 0편에서 DNS가 example.com에 대해 알려 준 주소다. CDN 구성에 따라 같은 IP에서 다른 도메인을 받지 않을 수도 있다]

### 인증서 검증이 실패하는 경우

내 컴퓨터에 `localhost`라는 이름으로 자체 서명 인증서를 만들고, `openssl s_server`로 HTTPS 서버를 띄워 세 가지로 접속해 봤다.

```bash
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
    -keyout key.pem -out cert.pem -days 1 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost"
openssl s_server -accept 18401 -cert cert.pem -key key.pem -www
```

```bash
curl -sS -o /dev/null https://localhost:18401/
```

```text
curl: (60) SSL certificate OpenSSL verify result: self-signed certificate (18)
```

```bash
curl -sS -o /dev/null -w '%{http_code}\n' --cacert cert.pem https://localhost:18401/
```

```text
200
```

```bash
curl -sS -o /dev/null --cacert cert.pem --resolve wrong.example:18401:127.0.0.1 https://wrong.example:18401/
```

```text
curl: (60) SSL: no alternative certificate subject name matches target hostname 'wrong.example'
```

| 경우 | 결과 | 걸린 검사 |
| --- | --- | --- |
| 그냥 접속 | 실패: `self-signed certificate` | 사슬이 신뢰 앵커에 닿지 않음. 스스로 서명한 인증서라 보증해 줄 발급자가 없음 |
| `--cacert`로 이 인증서를 믿게 함 | 200 | 이 인증서 자체를 신뢰 앵커로 넣었으니 통과 |
| 믿게 한 채로 다른 이름으로 접속 | 실패: `no alternative certificate subject name matches` | 사슬은 통과했지만 이름이 다름 |

세 번째 결과처럼, 믿는 인증서라도 이름이 다르면 거절한다. 클라이언트는 "믿을 수 있는 발급자가 보증했나"와 "접속한 도메인의 인증서인가"를 따로 확인한다.

### TLS 1.3과 1.2의 시간 차이

`time_appconnect - time_connect`로 핸드셰이크 시간만 떼어, 세 가지를 번갈아 10번씩 쟀다. 처음엔 1.3과 1.2를 그냥 비교했는데 차이가 1ms 남짓이라 이상했다. 확인해 보니 1.3은 `X25519MLKEM768`, 1.2는 `x25519`로 키 교환 방식이 달랐다. 그래서 1.3도 `--curves X25519`로 방식을 맞춘 경우를 더했다.

```bash
curl -s -o /dev/null --tlsv1.3 --curves X25519 -w '%{time_connect} %{time_appconnect}\n' https://example.com/
curl -s -o /dev/null --tlsv1.2 --tls-max 1.2 -w '%{time_connect} %{time_appconnect}\n' https://example.com/
curl -s -o /dev/null --tlsv1.3 -w '%{time_connect} %{time_appconnect}\n' https://example.com/
```

| 경우 | 키 교환 | 핸드셰이크 중앙값 | 범위 |
| --- | --- | --- | --- |
| TLS 1.3 | X25519 | 12.6ms | 12.1\~13.5ms |
| TLS 1.2 | x25519 | 14.5ms | 13.7\~16.0ms |
| TLS 1.3 기본 | X25519MLKEM768 | 13.4ms | 12.5\~14.5ms |

같은 키 교환끼리 비교하면 1.2가 1.9ms 더 걸렸다. 같은 시각에 TCP 연결만 따로 잰 시간이 중앙값 1.67ms였으니, 그림에서 본 "왕복 한 번 더"와 거의 맞는다.[* TCP 연결 시간은 `time_connect - time_namelookup`을 10번 잰 중앙값이다. TCP 연결은 왕복 한 번이면 끝나므로 이 VM에서 CDN 서버까지의 왕복 시간으로 보았다] 서버가 가까워 왕복이 2ms도 안 되는 환경이라 차이가 작았고, 왕복이 수십 ms인 먼 서버라면 그만큼 차이가 커질 것이다. 그리고 1.3 기본값이 X25519만 쓸 때보다 0.8ms쯤 느렸는데, 양자 내성 키를 함께 계산하고 더 큰 키를 주고받는 비용으로 보인다.

> HTTPS는 HTTP 메시지를 TLS라는 자물쇠 상자에 넣어 보내는 것이다. 자물쇠보다 먼저 중요한 건 상자를 건네받는 상대가 진짜인지 인증서로 확인하는 일이고, TLS 1.3은 그 과정을 왕복 한 번으로 줄였다.

## 확인 질문

**1. HTTPS로 접속하면 중간에서 볼 수 없는 것과 볼 수 있는 것은 무엇일까?**

<details><summary>답</summary>

경로, 쿼리, 헤더, 쿠키, 본문은 암호화돼서 볼 수 없다. 접속하는 IP와 포트, 주고받는 양과 시간은 보이고, SNI 때문에 도메인 이름도 보통 보인다.

</details>

**2. 암호화만 하고 인증서 검증을 건너뛰면 무엇이 위험할까?**

<details><summary>답</summary>

중간자가 나와 서버 사이에 끼어들어 양쪽과 각각 암호화된 연결을 맺을 수 있다. 연결은 암호화돼 있지만 그 상대가 공격자이므로 내용을 모두 볼 수 있다. 인증서 검증이 "상대가 진짜인가"를 막아 준다.

</details>

**3. 브라우저는 처음 보는 사이트의 인증서를 어떻게 믿을까?**

<details><summary>답</summary>

인증서의 발급자를 따라 한 칸씩 올라가 운영체제나 브라우저에 미리 들어 있는 루트 인증서(신뢰 앵커)에 닿는지 본다. 사슬의 서명이 맞고, 인증서 이름이 접속한 도메인과 같고, 유효 기간 안이면 믿는다.

</details>

**4. TLS 1.3이 1.2보다 왕복을 한 번 줄일 수 있는 이유는 무엇일까?**

<details><summary>답</summary>

클라이언트가 첫 메시지(ClientHello)에 키 교환에 쓸 자기 몫을 미리 실어 보내기 때문이다. 서버는 답장 한 번으로 자기 몫과 인증서, Finished를 보낼 수 있고, 클라이언트는 그다음 메시지에 바로 HTTP 요청을 실을 수 있다.

</details>

**5. SNI가 없으면 CDN 서버가 인증서를 고를 수 없는 이유는 무엇일까?**

<details><summary>답</summary>

한 IP에 여러 사이트가 함께 있고, 인증서는 HTTP 요청(과 `Host` 헤더)이 오기 전 핸드셰이크 중에 보내야 하기 때문이다. 클라이언트가 ClientHello에 도메인 이름을 적어 줘야 서버가 그 사이트의 인증서를 고를 수 있다.

</details>
