"""ken.blog의 확인된 인프라·시스템 도면 생성.

실행: node /home/ubuntu/Develop/infra/infra-diagrams/scripts/render.mjs
  --source <이 파일> --icons <같은 폴더의 icons> --output <이 폴더>
Diagrams의 노드·간선을 Graphviz neato 고정 좌표로 렌더링한다.
"""

from pathlib import Path
from html import escape
from itertools import count
import argparse
import json
import math
import xml.etree.ElementTree as ET

from diagrams import Cluster, Diagram, Edge, Node


FONT = "Noto Sans CJK KR"
PALETTES = {
    "light": dict(bg="#ffffff", text="#202a35", muted="#5c6b79", line="#c8d3de",
                  group="#f7fafc", vm="#f0f7fc", cloud="#f4f9f5", edge="#567085",
                  deploy="#278564", control="#8555a9"),
    "dark": dict(bg="#0b0f14", text="#e8edf2", muted="#a4b2bf", line="#425161",
                 group="#121a22", vm="#122434", cloud="#14241d", edge="#9eb5c8",
                 deploy="#81d6af", control="#cca0eb"),
}


class GridDiagram(Diagram):
    """라이트·다크 도면에 동일 좌표와 선 경로 적용."""

    def render(self):
        self.dot.engine = "neato"
        rendered = Path(self.dot.render(format="png", renderer="cairo", neato_no_op=2, quiet=True))
        rendered.replace(Path(f"{self.filename}.png"))


def svg_file(diagram, output, stem):
    svg = diagram.dot.pipe(format="svg", renderer="cairo", neato_no_op=2)
    root = ET.fromstring(svg)
    assert not list(root.iter("{http://www.w3.org/2000/svg}text"))
    for item in root.iter("{http://www.w3.org/2000/svg}image"):
        assert item.get("{http://www.w3.org/1999/xlink}href", "").startswith("data:")
    (output / (stem + ".svg")).write_bytes(svg)


def draw(output, icons, kind, theme):
    color = PALETTES[theme]
    ids = count()
    stem = kind + (".dark" if theme == "dark" else "")
    graph = dict(fontname=FONT, fontsize="12", pad="0.22", bgcolor=color["bg"],
                 splines="ortho", overlap="true", notranslate="true", dpi="120")
    node = dict(fontname=FONT, shape="plain", fixedsize="false", margin="0", width="0", height="0")
    edge = dict(fontname=FONT, fontsize="10", color=color["edge"],
                fontcolor=color["muted"], penwidth="1.3", arrowsize="0.68")

    def region(title, bounds, fill="group"):
        left, bottom, right, top = bounds
        return Cluster(title, graph_attr=dict(
            bb=",".join(map(str, bounds)), lp=f"{(left + right) / 2},{top - 16}",
            fontname=FONT, fontsize="13", fontcolor=color["muted"], style="rounded",
            pencolor=color["line"], bgcolor=color[fill], penwidth="0.9"))

    def card(title, detail, icon, x, y):
        # 제품 로고가 확인되지 않은 논리 역할은 글자 카드로 표시한다.
        if icon:
            image = escape(str(icons / (icon + ".png")), quote=True)
            first = f'<TD WIDTH="42" HEIGHT="42" FIXEDSIZE="TRUE" ROWSPAN="2" BGCOLOR="#ffffff"><IMG SRC="{image}" SCALE="TRUE"/></TD><TD WIDTH="12" ROWSPAN="2"></TD>'
        else:
            first = '<TD WIDTH="8" ROWSPAN="2"></TD>'
        detail = escape(detail).replace("\n", "<BR/>")
        label = f'''<<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="0">
          <TR>{first}<TD ALIGN="LEFT"><FONT FACE="{FONT}" COLOR="{color['text']}" POINT-SIZE="15"><B>{escape(title)}</B></FONT></TD></TR>
          <TR><TD ALIGN="LEFT"><FONT FACE="{FONT}" COLOR="{color['muted']}" POINT-SIZE="11">{detail}</FONT></TD></TR>
        </TABLE>>'''
        return Node(label, nodeid=f"n{next(ids)}", pos=f"{x},{y}!", pin="true")

    def note(label, x, y, shade="muted", size="10"):
        return Node(escape(label), nodeid=f"t{next(ids)}", pos=f"{x},{y}!", pin="true",
                    fontsize=size, fontcolor=color[shade])

    def port(x, y):
        # 경계 연결점일 뿐 별도 서버나 컨테이너가 아님.
        return Node("", nodeid=f"p{next(ids)}", pos=f"{x},{y}!", pin="true",
                    shape="point", width="0.01", height="0.01", style="invis")

    def link(style="request", **attrs):
        styles = {
            "request": dict(color=color["edge"]),
            "delivery": dict(color=color["deploy"], fontcolor=color["deploy"], style="dashed"),
            "control": dict(color=color["control"], fontcolor=color["control"], style="dotted", penwidth="1.6"),
            "reference": dict(color=color["muted"], style="dashed"),
        }
        return Edge(**(styles[style] | attrs))

    with GridDiagram("", filename=str(output / stem), show=False,
                     graph_attr=graph, node_attr=node, edge_attr=edge) as diagram:
        if kind == "infrastructure":
            with region("GitHub · 독립된 두 워크플로", (28, 690, 990, 950)):
                source = card("GitHub main", "push · 수동 실행", "github", 145, 825)
                ci = card("CI", "API Gradle build · 임시 MySQL/HTTP\n웹 typecheck · test · 정적 검사", "actions", 445, 825)
                pages_job = card("Pages 빌드", "공개 API·저장소 Markdown 수집\nThymeleaf 정적 생성·내용 재검증", "actions", 785, 825)

            operator = card("운영자", "VM에서 Docker 이미지 빌드\nCompose 교체 · health 확인", "user", 1230, 825)
            browser = card("독자·관리자 브라우저", "읽기 · 로그인 · 메타데이터 관리", "user", 145, 505)
            pages = card("GitHub Pages", "정적 HTML 화면 · 공개 본문", None, 445, 505)
            with region("OCI VM · Docker Compose", (650, 180, 1135, 625), "vm"):
                proxy = card("Spring 직접 HTTPS", "내장 Tomcat · 공개 /mcp 차단", "spring", 775, 505)
                api = card("Spring Boot API", "Kotlin · Security · JDBC 세션", "spring", 1000, 505)
                mcp = card("로컬 작성 클라이언트", "VM 내부 또는 SSH 터널 · /mcp", "user", 805, 300)
                deploy_port = port(1100, 625)
            with region("데이터 저장소", (1170, 345, 1530, 630), "cloud"):
                mysql = card("MySQL HeatWave", "글 메타데이터 · 계정 · JDBC 세션", "mysql", 1350, 535)
                objects = card("로컬 파일 저장소", "동기화 Markdown · 영속 첨부", None, 1350, 405)

            notes = [
                ("main push → CI", 300, 870, "muted"),
                ("main push · 수동", 590, 890, "muted"),
                ("공개 자료 조회", 925, 710, "muted"),
                ("수동 API 배포", 1175, 710, "deploy"),
                ("정적 산출물", 710, 665, "deploy"),
                ("정적 페이지", 270, 535, "muted"),
                ("API 요청", 310, 385, "muted"),
                ("로컬 전용", 1040, 300, "muted"),
            ]
            wires = [
                (source, ci, (), "request", "e", "w"),
                (source, pages_job, [(145, 920), (785, 920)], "request", "n", "n"),
                (pages_job, pages, [(785, 645), (445, 645)], "delivery", "s", "n"),
                (browser, pages, (), "request", "e", "w"),
                (browser, proxy, [(145, 390), (775, 390)], "request", "s", "s"),
                (proxy, api, (), "request", "e", "w"),
                (pages_job, api, [(785, 695), (1000, 695)], "request", "s", "n"),
                (operator, deploy_port, [(1230, 680), (1100, 680)], "delivery", "s", "c"),
                (api, mysql, [(1180, 505), (1180, 535)], "request", "e", "w"),
                (api, objects, [(1160, 505), (1160, 405)], "request", "e", "w"),
                (mcp, api, [(1000, 300)], "request", "e", "s"),
            ]
        else:
            reader = card("독자", "공개 글 · 검색 · 첨부 조회", "user", 145, 740)
            editor = card("관리자 화면", "메타데이터 · 출간 · 배포", None, 145, 545)
            agent = card("작성 에이전트", "VM 내부 또는 SSH 터널", "user", 145, 320)
            with region("하나의 Spring Boot · Kotlin API", (370, 120, 1185, 850), "vm"):
                rest = card("REST · Security", "Spring Session JDBC · 권한 · CSRF", "spring", 500, 650)
                mcp_entry = card("MCP 로컬 입구", "/mcp · 공개 프록시 차단", "spring", 500, 320)
                read = card("공개 글 조회", "PublicPostService · PostService", "kotlin", 800, 740)
                draft = card("원고 상태 · 출간", "저장소 Markdown · 충돌 검사", "kotlin", 800, 545)
                references = card("첨부 관리 · 위키 참조", "로컬 첨부 파일 / 첨부·위키 연결", None, 800, 365)
                belonging = card("글 소속", "Projects 대문·문서 · Notes 과목·회차", None, 800, 205)
                repo = card("JPA Repository", "글 메타데이터 · 첨부 · 참조 · 소속", None, 1060, 510)
            with region("데이터 저장소", (1230, 245, 1530, 830), "cloud"):
                mysql = card("MySQL HeatWave", "글 메타데이터·참조·세션", "mysql", 1380, 510)
                objects = card("로컬 파일 저장소", "Markdown 동기화본 · 영속 첨부", None, 1380, 320)
            notes = [
                ("작성 경로 중심 · MCP 조회·첨부 세부선 생략", 805, 805, "muted"),
                ("같은 작성 서비스 호출", 610, 455, "muted"),
                ("참조와 글을 한 DB 트랜잭션에 출간", 970, 135, "muted"),
                ("이미지 바이트", 1190, 300, "muted"),
                ("인증 세션은 Spring Session JDBC로 MySQL에 별도 저장", 800, 95, "muted"),
            ]
            wires = [
                (reader, rest, [(315, 740), (315, 650)], "request", "e", "w"),
                (editor, rest, [(330, 545), (330, 650)], "request", "e", "w"),
                (agent, mcp_entry, (), "request", "e", "w"),
                (rest, read, [(645, 650), (645, 740)], "request", "e", "w"),
                (rest, draft, [(665, 650), (665, 545)], "request", "e", "w"),
                (mcp_entry, draft, [(620, 320), (620, 545)], "request", "e", "w"),
                (draft, references, (), "request", "s", "n"),
                (draft, belonging, [(945, 545), (945, 205)], "request", "e", "e"),
                (read, repo, [(985, 740), (985, 620), (1060, 620)], "request", "e", "n"),
                (draft, repo, [(970, 545), (970, 510)], "request", "e", "w"),
                (references, repo, [(950, 365), (950, 480)], "request", "e", "w"),
                (repo, mysql, (), "request", "e", "w"),
                (references, objects, [(1180, 365), (1380, 365)], "request", "e", "n"),
            ]

        # 배치 측정 후 간선 경로를 고정해 글자 위를 관통하지 않도록 한다.
        diagram.dot.engine = "neato"
        geometry = json.loads(diagram.dot.pipe(format="json0", neato_no_op=2, quiet=True))
        bounds = {item["name"]: item for item in geometry["objects"] if "pos" in item}

        def anchor(item, side):
            geo = bounds[item.nodeid]
            x, y = map(float, geo["pos"].split(","))
            width, height = float(geo["width"]) * 72, float(geo["height"]) * 72
            return {"n": (x, y + height / 2), "s": (x, y - height / 2),
                    "e": (x + width / 2, y), "w": (x - width / 2, y), "c": (x, y)}[side]

        def wire(source, target, via, style, start, end):
            points = [anchor(source, start), *via, anchor(target, end)]
            points = [point for i, point in enumerate(points) if i == 0 or point != points[i - 1]]
            tip = points[-1]
            previous = points[-2]
            distance = math.hypot(tip[0] - previous[0], tip[1] - previous[1])
            assert distance > 0
            points[-1] = (tip[0] - (tip[0] - previous[0]) / distance * 5,
                          tip[1] - (tip[1] - previous[1]) / distance * 5)
            spline = [points[0]]
            for first, last in zip(points, points[1:]):
                spline.extend([first, last, last])
            position = ("e,%g,%g " % tip) + " ".join("%g,%g" % point for point in spline)
            source >> link(style, pos=position) >> target

        for args in wires:
            wire(*args)
        for label, x, y, shade in notes:
            note(label, x, y, shade)
        if kind == "infrastructure":
            note("━━ 요청 · 데이터", 500, 105, "edge")
            note("┄┄ 빌드 · 수동 배포", 750, 105, "deploy")
        else:
            note("━━ 서비스 호출 · 데이터 접근", 815, 70, "edge")
    svg_file(diagram, output, stem)
    print(f"Generated {stem} PNG/SVG")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--icons", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for kind in ("infrastructure", "system"):
        for theme in PALETTES:
            draw(args.output.resolve(), args.icons.resolve(), kind, theme)
