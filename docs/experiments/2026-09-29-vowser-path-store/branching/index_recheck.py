"""BR3 전용 root 인덱스 검증 후 스모크 객체 정리."""

from pathlib import Path

from branching.bench import capture_plans, write_json
from branching.model import Model
from branching.storage import cleanup_own_objects
from shared.connect import mysql_connection, neo4j_driver


def main() -> None:
    out = Path('/work/branching/results/smoke-n720-s50-b4')
    driver = neo4j_driver()
    try:
        with driver.session(database='neo4j') as session:
            session.run('DROP INDEX br3_path_context IF EXISTS').consume()
            session.run('CREATE INDEX br3_path_context IF NOT EXISTS FOR (p:BR3_Path) ON (p.condition,p.domain,p.intent,p.auth)').consume()
            session.run('CALL db.awaitIndexes(300)').consume()
            indexes = [r.data() for r in session.run(
                "SHOW INDEXES YIELD name,properties,state WHERE name='br3_path_context' RETURN name,properties,state")]
    finally:
        driver.close()
    model = Model(720,50,4)
    plans = capture_plans(model,model.cases()[0])
    root_seek = 'NodeIndexSeek' in str(plans['neo_adj_explain'])
    record = {'index':indexes,'root_seek':root_seek,
              'neo_adj_explain':plans['neo_adj_explain'],
              'neo_adj_profile':plans['neo_adj_profile']}
    write_json(out/'index-recheck.json',record)
    if not indexes or indexes[0]['state']!='ONLINE' or indexes[0]['properties']!=['condition','domain','intent','auth'] or not root_seek:
        raise AssertionError(f'index recheck failed: {indexes}, seek={root_seek}')
    cleanup_own_objects()
    driver = neo4j_driver()
    try:
        with driver.session(database='neo4j') as session:
            nodes = session.run('MATCH (n) WHERE n:BR3_Path OR n:BR3_Step RETURN count(n) AS n').single()['n']
    finally:
        driver.close()
    con = mysql_connection()
    try:
        with con.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='vowser_eval_v2' AND table_name LIKE 'br3_%'")
            tables = cur.fetchone()[0]
    finally:
        con.close()
    write_json(out/'cleanup.json',{'br3_nodes':nodes,'br3_tables':tables,'index_recheck_online':True})
    if nodes or tables:
        raise AssertionError('BR3 cleanup incomplete')
    print({'index':indexes,'root_seek':root_seek,'cleaned':True})


if __name__ == '__main__':
    main()
