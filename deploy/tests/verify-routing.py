"""운영 Caddy 허용 목록을 로컬 HTTP upstream으로 검증하는 격리 검사."""
import http.server
import json
import pathlib
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid


class Upstream(http.server.BaseHTTPRequestHandler):
    """전달된 요청의 안전한 테스트 헤더만 반환하는 가상 API."""

    def do_GET(self):
        """경로와 전달 경계 검사를 위한 고정 응답 반환."""
        body = json.dumps({"path": self.path, "source": self.headers.get("X-Ken-Blog-Client-IP"),
                           "key": self.headers.get("X-Ken-Blog-Proxy-Key"),
                           "forwarded": self.headers.get("Forwarded")}).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    do_HEAD = do_GET
    do_POST = do_GET

    def log_message(self, *_):
        """검사 요청별 로그 생략."""


def main():
    """TLS 구문 검증을 마친 실제 라우팅 설정으로 성공·거부 경로 대조."""
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with socket.socket() as port:
        port.bind(("127.0.0.1", 0))
        listen = port.getsockname()[1]
    name = "ken-routing-" + uuid.uuid4().hex[:12]
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with tempfile.TemporaryDirectory() as directory:
        source = pathlib.Path("deploy/Caddyfile").read_text()
        source = source.replace("{\n", "{\n\tadmin off\n", 1)
        source = source.replace("reverse_proxy api:8080", f"reverse_proxy 127.0.0.1:{server.server_port}")
        source = source.replace("{$KEN_BLOG_PUBLIC_IP} {", f"http://127.0.0.1:{listen} {{")
        start = source.index("\ttls {")
        end = source.index("\n\t# 공개 읽기", start)
        source = source[:start] + source[end:]
        config = pathlib.Path(directory, "Caddyfile")
        config.write_text(source)
        try:
            subprocess.run(["docker", "run", "-d", "--name", name, "--network", "host", "-e", "KEN_BLOG_PUBLIC_IP=192.0.2.1",
                            "-e", "AUTH_PROXY_KEY=routing-test-shared-key-32-characters", "--mount",
                            f"type=bind,source={config},target=/etc/caddy/Caddyfile,readonly", "caddy:2.11.4-alpine"], check=True, stdout=subprocess.DEVNULL)
            for attempt in range(60):
                try:
                    with opener.open(f"http://127.0.0.1:{listen}/actuator/health", timeout=1):
                        break
                except (OSError, urllib.error.URLError):
                    if attempt == 59:
                        raise
                    time.sleep(0.1)
            for path in ["/api/v1/pages/snapshot", "/api/v1/posts/1/attachments/2/content", "/api/v1/stack-badges/1/image", "/actuator/health"]:
                for method in ["GET", "HEAD", "POST"]:
                    request = urllib.request.Request(f"http://127.0.0.1:{listen}{path}", method=method,
                        headers={"Forwarded": "for=evil", "X-Ken-Blog-Client-IP": "203.0.113.9", "X-Ken-Blog-Proxy-Key": "evil"})
                    try:
                        with opener.open(request, timeout=3) as response:
                            assert method != "POST" and response.status == 200
                            if method == "GET":
                                body = json.load(response)
                                assert body["source"] == "127.0.0.1" and body["forwarded"] is None
                                assert body["key"] == "routing-test-shared-key-32-characters"
                    except urllib.error.HTTPError as error:
                        assert method == "POST" and error.code == 404
            for path in ["/admin", "/api/v1/unknown", "/internal", "/actuator/env"]:
                try:
                    opener.open(f"http://127.0.0.1:{listen}{path}", timeout=3)
                    raise AssertionError("Unexpected route allowed")
                except urllib.error.HTTPError as error:
                    assert error.code == 404
        finally:
            subprocess.run(["docker", "rm", "-f", "-v", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            server.shutdown()
    print("Caddy routing: GET/HEAD allowed, other public methods rejected, proxy headers replaced.")


if __name__ == "__main__":
    main()
