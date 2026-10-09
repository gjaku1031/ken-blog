"""본측정 종료 후 최종 적재 객체의 읽기 전용 DB 확인."""

from __future__ import annotations

import argparse
import json

from shared.connect import mysql_connection, neo4j_driver

CELL = 'n1000-d100-s50-b4'


def mysql_evidence() -> dict:
    con = mysql_connection()
    try:
        with con.cursor() as cur:
            cur.execute('SELECT VERSION()')
            version = cur.fetchone()[0]
            counts = {}
            for table in ('br3_path','br3_step','br3_member','br3_next'):
                cur.execute(f'SELECT COUNT(*) FROM {table} WHERE condition_id=%s',(CELL,))
                counts[table] = cur.fetchone()[0]
            indexes = {}
            for table in counts:
                cur.execute(f'SHOW INDEX FROM {table}')
                names = [column[0] for column in cur.description]
                indexes[table] = [dict(zip(names,row)) for row in cur.fetchall()]
        return {'engine':'mysql','cell':CELL,'version':version,'counts':counts,
                'indexes':indexes}
    finally:
        con.close()


def neo_evidence() -> dict:
    driver = neo4j_driver()
    try:
        with driver.session(database='neo4j') as session:
            version = session.run('CALL dbms.components() YIELD name, versions RETURN name, versions').data()
            counts = {}
            for label in ('BR3_Path','BR3_Step'):
                counts[label] = session.run(f'MATCH (n:{label} {{condition:$cell}}) RETURN count(n) AS n',cell=CELL).single()['n']
            for relationship in ('BR3_MEMBER','BR3_NEXT'):
                counts[relationship] = session.run(f'MATCH ()-[r:{relationship} {{condition:$cell}}]->() RETURN count(r) AS n',cell=CELL).single()['n']
            indexes = session.run('SHOW INDEXES YIELD name, state, labelsOrTypes, properties '
                                  'WHERE name STARTS WITH "br3_" RETURN name, state, labelsOrTypes, properties').data()
        return {'engine':'neo4j','cell':CELL,'version':version,'counts':counts,
                'indexes':indexes}
    finally:
        driver.close()


if __name__=='__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--engine',choices=('mysql','neo4j'),required=True)
    args = parser.parse_args()
    print(json.dumps(mysql_evidence() if args.engine=='mysql' else neo_evidence(),
                     ensure_ascii=False,default=str),flush=True)
