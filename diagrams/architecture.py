"""P1-03 아키텍처의 같은 배치 라이트·다크 도면을 생성한다."""

from argparse import ArgumentParser
from html import escape
from itertools import count
from pathlib import Path
import xml.etree.ElementTree as ET

import cairosvg
from diagrams import Cluster, Diagram, Edge, Node


FONT = "Noto Sans CJK KR"
PALETTES = {
    "light": {
        "background": "#fbfaf7", "panel": "#ffffff", "soft": "#f1f4f0",
        "text": "#22352c", "muted": "#51665a", "border": "#a9b9ad",
        "runtime": "#24684a", "delivery": "#31735c", "future": "#ad7652",
    },
    "dark": {
        "background": "#101916", "panel": "#18241e", "soft": "#22342a",
        "text": "#edf5ee", "muted": "#b4c4b8", "border": "#66796c",
        "runtime": "#87d3a4", "delivery": "#9cddb6", "future": "#efba8c",
    },
}


class FixedDiagram(Diagram):
    """Graphviz의 고정 좌표 렌더링으로 두 테마의 위치를 일치시킨다."""

    def render(self):
        """PNG를 고정 좌표로 생성한다."""
        self.dot.engine = "neato"
        self.dot.render(format="png", neato_no_op=2, quiet=True)


def render(icons: Path, output: Path, theme: str):
    """확인된 현재 연결과 미연결 후속 자원을 한 장으로 그린다."""
    color = PALETTES[theme]
    ids = count()
    stem = "architecture" + (".dark" if theme == "dark" else "")
    graph = {
        "fontname": FONT, "bgcolor": color["background"], "pad": "0.22",
        "splines": "line", "overlap": "true", "notranslate": "true", "dpi": "144",
    }
    node = {
        "fontname": FONT, "fixedsize": "false", "shape": "plain",
        "margin": "0", "width": "0", "height": "0",
    }
    edge = {
        "fontname": FONT, "fontsize": "10", "color": color["runtime"],
        "fontcolor": color["muted"], "penwidth": "1.8", "arrowsize": "0.75",
    }

    def region(title, bounds, fill=None, border=None, dashed=False):
        """실제 실행 경계 또는 명시된 후속 범위를 표시한다."""
        left, bottom, right, top = bounds
        return Cluster(title, graph_attr={
            "bb": ",".join(map(str, bounds)),
            "lp": f"{(left + right) / 2},{top - 18}",
            "fontname": FONT, "fontsize": "13", "fontcolor": color["text"],
            "style": "rounded,dashed" if dashed else "rounded,filled",
            "pencolor": border or color["border"],
            "bgcolor": fill or color["panel"], "penwidth": "1.25",
        })

    def card(title, detail, x, y, image=None, width=190):
        """아이콘이 있으면 비율을 보존하고 텍스트와 함께 카드에 표시한다."""
        if image:
            path = str(icons / (image + ".png"))
            anchor = Node("", nodeid=f"n{next(ids)}", pos=f"{x - 70},{y}!", pin="true",
                          image=path, imagescale="true", shape="none", width="0.65",
                          height="0.65", fixedsize="true")
            text_x = x + 75
        else:
            anchor = Node("", nodeid=f"n{next(ids)}", pos=f"{x - 45},{y}!", pin="true",
                          shape="point", width="0.01", height="0.01", style="invis")
            text_x = x + 30
        caption(title, text_x, y + 14, 13, color["text"])
        caption(detail, text_x, y - 12, 10, color["muted"])
        return anchor

    def port(x, y):
        """보이지 않는 연결점을 통해 겹침 없는 실제 Graphviz 선을 만든다."""
        return Node("", nodeid=f"p{next(ids)}", pos=f"{x},{y}!", pin="true",
                    shape="point", width="0.01", height="0.01", style="invis")

    def caption(label, x, y, size=11, fill=None):
        """선의 의미와 실행 상태를 색 외에 텍스트로 설명한다."""
        return Node(
            escape(label), nodeid=f"t{next(ids)}", pos=f"{x},{y}!", pin="true",
            fontname=FONT, fontsize=str(size), fontcolor=fill or color["muted"],
            fixedsize="false", width="0", height="0",
        )

    with FixedDiagram(
        "", filename=str(output / stem), show=False,
        graph_attr=graph, node_attr=node, edge_attr=edge,
    ) as diagram:
        Node("", nodeid=f"p{next(ids)}", pos="600,700!", pin="true",
             shape="point", width="0.01", height="0.01", style="invis")
        card("Actions · CI", "Web·API 빌드와 검사", 260, 585, "github", 225)
        workflow = card("Pages workflow", "Next 정적 out 배포", 750, 585, "github", 245)
        caption("CI는 VM에 앱을 자동 배포하지 않음", 185, 535, 10)

        browser = card("방문자", "브라우저", 105, 420, width=165)
        with region("GitHub Pages · 공개 정적 화면", (275, 220, 685, 520)):
            pages = card("GitHub Pages", "HTML·JS·도면 제공", 475, 420, "github", 250)
            card("Next.js · static export", "서버 프로세스 없음", 475, 310, "nextjs", 250)
        with region("OCI ARM64 VM · 로컬 검증 환경", (735, 80, 1165, 520)):
            card("OCI Compute", "호스트 24 GB", 940, 420, "oci-vm", 245)
            card("Docker Compose", "API·MySQL 수동 기동", 940, 335, "docker", 245)
            api = card("Spring Boot · API", "쿠키 세션 · 로컬 :18081", 940, 250, "spring", 255)
            mysql = card("MySQL 8.4.11", "게시글·계정·세션 저장", 940, 145, "mysql", 225)
        with region("OCI Object Storage · 비공개 버킷", (620, -110, 1165, 55)):
            storage = card("OCI Object Storage", "관리자 이미지 원본", 840, -40, "oci-object-storage", 260)

        browser >> Edge(color=color["runtime"], penwidth="1.8", arrowsize="0.75") >> pages
        delivery_top = port(305, 560)
        delivery_left = port(305, 420)
        workflow >> Edge(color=color["delivery"], style="dashed", arrowhead="none", penwidth="1.7") >> delivery_top
        delivery_top >> Edge(color=color["delivery"], style="dashed", arrowhead="none", penwidth="1.7") >> delivery_left
        delivery_left >> Edge(color=color["delivery"], style="dashed", penwidth="1.7", arrowsize="0.75") >> pages

        pending_corner = port(105, 190)
        pending_turn = port(800, 190)
        browser >> Edge(color=color["future"], style="dashed", arrowhead="none", penwidth="1.5") >> pending_corner
        pending_corner >> Edge(color=color["future"], style="dashed", arrowhead="none", penwidth="1.5") >> pending_turn
        pending_turn >> Edge(color=color["future"], style="dashed", arrowsize="0.75", penwidth="1.5") >> api
        api >> Edge(color=color["runtime"], penwidth="1.8", arrowsize="0.75") >> mysql
        storage_top = port(870, 290)
        storage_right_top = port(1150, 290)
        storage_right_bottom = port(1150, -75)
        storage_left_bottom = port(770, -75)
        api >> Edge(color=color["runtime"], arrowhead="none") >> storage_top
        storage_top >> Edge(color=color["runtime"], arrowhead="none") >> storage_right_top
        storage_right_top >> Edge(color=color["runtime"], arrowhead="none") >> storage_right_bottom
        storage_right_bottom >> Edge(color=color["runtime"], arrowhead="none") >> storage_left_bottom
        storage_left_bottom >> Edge(color=color["runtime"], arrowsize="0.75") >> storage

        caption("GET 정적 파일", 270, 455, 10, color["runtime"])
        caption("out 업로드", 460, 580, 10, color["delivery"])
        caption("공개 HTTPS API · 주소 미정 / 미연결", 505, 174, 10, color["future"])
        caption("Pages 로그인 화면 없음 · API 인증은 로컬 검증", 450, 115, 10)
        caption("JPA·Flyway / Spring Session JDBC", 1040, 195, 10, color["runtime"])
        caption("첨부 메타데이터 · 로컬 DB :13306", 1030, 100, 10)
        caption("HTTPS · 비공개 버킷", 980, -91, 10, color["runtime"])

        with region("후속 단계 · 미구현 / 미연결", (35, -110, 590, 55), color["panel"], color["future"], True):
            card("Redis Cloud", "공개 글 캐시 예정", 350, -40, "redis", 225)
        caption("실선: 정적 요청·MySQL 접근·첨부 전송   /   초록 파선: Pages 산출물   /   갈색 파선: 공개 API 예정", 575, -145, 10)

    svg = diagram.dot.pipe(format="svg", renderer="cairo", neato_no_op=2)
    root = ET.fromstring(svg)
    assert not list(root.iter("{http://www.w3.org/2000/svg}text")), "SVG 문자가 경로로 변환되지 않음"
    for item in root.iter("{http://www.w3.org/2000/svg}image"):
        assert item.get("{http://www.w3.org/1999/xlink}href", "").startswith("data:"), "외부 아이콘 참조"
    (output / f"{stem}.svg").write_bytes(svg)
    cairosvg.svg2png(bytestring=svg, write_to=str(output / f"{stem}.png"))
    print(f"{theme}: {stem}.svg / {stem}.png")


if __name__ == "__main__":
    parser = ArgumentParser()
    parser.add_argument("--icons", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for name in PALETTES:
        render(args.icons, args.output, name)
