/**
 * PNG IHDR 또는 JPEG SOF에서 화면 비율 예약용 크기 추출
 *
 * 1. 헤더 경계·크기 제한 검사
 * 2. JPEG의 EXIF 회전 방향을 반영하여 화면 기준 너비·높이 반환
 * 전체 픽셀 디코딩이나 파일 정규화는 수행하지 않음
 */
export function imageSize(bytes, type) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, orientation = 1;
  if (type === 'image/png') {
    if (bytes.length < 33 || view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) throw new Error('PNG IHDR 오류');
    width = view.getUint32(16); height = view.getUint32(20);
  } else {
    // 길이가 있는 JPEG 세그먼트만 범위 내에서 순회
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) throw new Error('JPEG 세그먼트 오류');
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 2 > bytes.length) throw new Error('JPEG 길이 오류');
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw new Error('JPEG 길이 오류');
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) throw new Error('JPEG SOF 오류');
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5);
      }
      if (marker === 0xe1) orientation = exifOrientation(view, offset + 2, offset + length) ?? orientation;
      offset += length;
    }
  }
  if (!width || !height || width > 65535 || height > 65535 || width * height > 100_000_000) throw new Error('공개 이미지 크기 헤더 오류');
  return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
}

/**
 * APP1 내부의 유효한 TIFF 방향만 읽고 미지원·손상 메타데이터는 무시
 */
function exifOrientation(view, start, end) {
  if (end - start < 14 || view.getUint32(start) !== 0x45786966 || view.getUint16(start + 4) !== 0) return;
  const base = start + 6;
  const order = view.getUint16(base);
  if (order !== 0x4949 && order !== 0x4d4d) return;
  const little = order === 0x4949;
  if (view.getUint16(base + 2, little) !== 42) return;
  const directory = base + view.getUint32(base + 4, little);
  if (directory < base + 8 || directory + 2 > end) return;
  const count = view.getUint16(directory, little);
  for (let index = 0; index < count; index++) {
    const entry = directory + 2 + index * 12;
    if (entry + 12 > end) return;
    if (view.getUint16(entry, little) === 0x112 && view.getUint16(entry + 2, little) === 3 && view.getUint32(entry + 4, little) === 1) {
      const orientation = view.getUint16(entry + 8, little);
      if (orientation >= 1 && orientation <= 8) return orientation;
    }
  }
}
