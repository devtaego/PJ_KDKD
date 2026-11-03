// 프로필 사진 자르기 계산 (화면과 분리해서 테스트할 수 있게)
export const MIN_ZOOM = 1; // 사진의 짧은 쪽이 자르는 칸에 꽉 차는 배율
export const MAX_ZOOM = 4;

export const clampZoom = (zoom) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** 사진에서 잘라 낼 정사각형. cx, cy: 칸 가운데에 올 사진 좌표 (사진 밖이 보이지 않게 맞춤) */
export function cropRect(width, height, zoom, cx, cy) {
  const size = Math.min(width, height) / clampZoom(zoom);
  const x = Math.min(width - size, Math.max(0, cx - size / 2));
  const y = Math.min(height - size, Math.max(0, cy - size / 2));
  return { x, y, size };
}
