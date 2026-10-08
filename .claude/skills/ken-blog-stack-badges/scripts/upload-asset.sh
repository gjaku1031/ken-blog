#!/usr/bin/env bash
# 운영 서버 이미지 디렉터리에 PNG를 새 UUID 이름으로 올림. 기존 파일은 덮어쓰지 않음
# 실행용: upload-asset.sh <PNG 파일>...
# 출력: 파일마다 한 줄 "<로컬 경로> <object_key> <바이트>". object_key·바이트는 DB 등록 SQL에 그대로 씀
# 필요: oci-blog SSH 설정(비밀번호 입력 없이 접속, 원격 sudo). 종료 코드: 64 인자·파일 오류, 69 업로드 실패
set -euo pipefail
(( $# > 0 )) || { echo "사용: upload-asset.sh <PNG 파일>..." >&2; exit 64; }

# API 컨테이너가 읽는 디렉터리와 소유자(UID 10001, GID 1001). 파일은 소유자만 읽도록 0600
DIR=/srv/ken-blog-live/assets/ken-blog/live/attachments
KEY_PREFIX=ken-blog/live/attachments
# 첨부 크기 상한 10MiB(서비스의 첨부 검사와 같은 값)
MAX_BYTES=10485760

for file in "$@"; do
  [[ -r "$file" ]] || { echo "파일을 읽을 수 없음: $file" >&2; exit 64; }
  [[ "$(head -c 8 "$file" | od -An -tx1 | tr -d ' \n')" == "89504e470d0a1a0a" ]] || { echo "PNG가 아님: $file" >&2; exit 64; }
  bytes=$(stat -c %s "$file")
  (( bytes > 0 && bytes <= MAX_BYTES )) || { echo "크기 범위 밖(1바이트~10MiB): $file ($bytes)" >&2; exit 64; }
  uuid=$(cat /proc/sys/kernel/random/uuid)
  # -n: 반복문 안에서 ssh가 표준 입력을 읽어 다음 파일을 건너뛰지 않게 함
  scp -q "$file" "oci-blog:/tmp/$uuid.png" < /dev/null || { echo "전송 실패: $file" >&2; exit 69; }
  ssh -n oci-blog "sudo install -o 10001 -g 1001 -m 0600 /tmp/$uuid.png $DIR/$uuid.png && rm /tmp/$uuid.png && sudo test \$(sudo stat -c %s $DIR/$uuid.png) -eq $bytes" \
    || { echo "설치 실패: $file" >&2; exit 69; }
  echo "$file $KEY_PREFIX/$uuid.png $bytes"
done
