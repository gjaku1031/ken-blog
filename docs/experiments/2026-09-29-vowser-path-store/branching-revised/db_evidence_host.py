"""측정 완료 뒤 각 DB를 단독 기동해 최종 객체·인덱스 증거 수집."""

from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timezone

from branching.model import Model
from manifest import RESULTS, ROOT, sha, verify, write_json
from orchestrate import activate, control, stop_all

NAME = 'vowser-eval-v2-br3-revised-final'
CELL = 'n1000-d100-s50-b4'


def container(name: str) -> dict:
    raw = subprocess.check_output(['docker','inspect',name],text=True)
    item = json.loads(raw)[0]
    host = item['HostConfig']
    return {'name':name,'image_id':item['Image'],'running':item['State']['Running'],
            'nano_cpus':host['NanoCpus'],'memory_bytes':host['Memory'],
            'memory_swap_bytes':host['MemorySwap'],'pids_limit':host['PidsLimit']}


def main() -> None:
    verify()
    if not json.loads((RESULTS/'run-main-r02.json').read_text())['state']=='complete' or not json.loads(
        (RESULTS/'run-stress-r01.json').read_text())['state']=='complete':
        raise AssertionError('both measure groups must be complete')
    path = RESULTS/'postrun-db-evidence.json'
    if path.exists():
        raise FileExistsError(path)
    model = Model(1000,50,4,depth_override=100)
    expected = {'mysql':{'br3_path':len(model.paths),'br3_step':len(model.steps),
                         'br3_member':len(model.members),'br3_next':len(model.next_edges)},
                'neo4j':{'BR3_Path':len(model.paths),'BR3_Step':len(model.steps),
                         'BR3_MEMBER':len(model.members),'BR3_NEXT':len(model.next_edges)}}
    evidence = {'collected_utc':datetime.now(timezone.utc).isoformat(),
                'cell':CELL,'expected_counts':expected,
                'freeze_sha256':sha(RESULTS/'freeze.json'),
                'run_main_r02_sha256':sha(RESULTS/'run-main-r02.json'),
                'run_stress_r01_sha256':sha(RESULTS/'run-stress-r01.json'),
                'environment_revised_sha256':sha(ROOT/'shared/environment-branching-revised.json'),
                'engines':{}}
    log = RESULTS/'postrun-db-evidence.log'
    try:
        stop_all(log)
        for engine in ('mysql','neo4j'):
            activate(engine,log)
            env = dict(os.environ,EVAL_CLIENT_NAME='br3-revised-final')
            command = ['bash',str(ROOT/'shared/run-client.sh'),'python',
                       'branching-revised/db_evidence_worker.py','--engine',engine]
            result = subprocess.run(command,cwd=ROOT,text=True,capture_output=True,env=env,
                                    timeout=120,check=True)
            record = json.loads(result.stdout.strip())
            if record['counts'] != expected[engine]:
                raise AssertionError(f'{engine} postrun object counts changed: {record["counts"]}')
            evidence['engines'][engine] = record
            evidence['engines'][engine]['container'] = container(
                'vowser-eval-v2-mysql' if engine=='mysql' else 'vowser-eval-v2-neo4j')
            control('stop',engine,log)
    finally:
        subprocess.run(['docker','rm','-f',NAME],stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL,check=False)
        stop_all(log)
    evidence['final_containers'] = {engine:container(name) for engine,name in (
        ('mysql','vowser-eval-v2-mysql'),('neo4j','vowser-eval-v2-neo4j'))}
    if any(item['running'] for item in evidence['final_containers'].values()):
        raise AssertionError('DB still active after postrun evidence')
    write_json(path,evidence)
    print(json.dumps({'path':str(path),'sha256':sha(path),
                      'engines':list(evidence['engines'])}))


if __name__=='__main__':
    main()
