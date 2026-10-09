"""worker 밖에 있는 원본 제품 파일의 HEAD·SHA를 호스트에서 확인."""

import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

SOURCE = Path('/home/ubuntu/Develop/project/vowser/vowser-agent-server/app/services/neo4j_service.py')
EXPECTED_HEAD = 'd94eaf5f30f734952838528d7045e0eab8891509'
EXPECTED_SHA = '153593f35d9d32aad2416dd8efddc63629a1d2b0047a9bcfb74dd3add3a94e58'


def main() -> None:
    head = subprocess.check_output(['git','-C',str(SOURCE.parents[2]),'rev-parse','HEAD'],text=True).strip()
    sha = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    if head != EXPECTED_HEAD or sha != EXPECTED_SHA:
        raise AssertionError(f'original source changed: HEAD={head}, SHA={sha}')
    out = Path(__file__).resolve().parent/'results/host-preflight.json'
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps({'utc':datetime.now(timezone.utc).isoformat(),
                               'agent_server_head':head,'source_sha256':sha},indent=2)+'\n')


if __name__ == '__main__':
    main()
