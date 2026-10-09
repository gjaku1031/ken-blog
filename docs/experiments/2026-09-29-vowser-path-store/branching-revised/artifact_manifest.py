"""완주 자료와 보고서의 크기·SHA를 후처리 시점에 목록화."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from manifest import HERE, RESULTS, sha, write_json


def main() -> None:
    output = RESULTS/'artifact-manifest.json'
    files = [path for path in RESULTS.rglob('*') if path.is_file() and path != output]
    files.extend(path for path in (HERE/'report.md',HERE/'report.html',HERE/'report.pdf',
                                   HERE/'report.full.pdf',
                                   HERE/'report.one-page.html',HERE/'report.one-page.pdf') if path.is_file())
    records = {str(path.relative_to(HERE)):{'bytes':path.stat().st_size,
                                             'sha256':sha(path)} for path in sorted(files)}
    value = {'created_utc':datetime.now(timezone.utc).isoformat(),
             'cohort':'branching-revised-ordered-membership',
             'file_count':len(records),'files':records}
    write_json(output,value)
    print(json.dumps({'path':str(output),'file_count':len(records),'sha256':sha(output)}))


if __name__=='__main__':
    main()
