// 프로필 사진 조절 창: 끌어서 위치, 슬라이더 · 휠 · 손가락으로 크기를 고르면 원 안쪽이 프로필이 됨
import { MIN_ZOOM, MAX_ZOOM, clampZoom, cropRect } from "./engine/photo_crop.js";
import { el, modal } from "./ui.js";

const STAGE = 560; // 화면에 그리는 칸의 실제 픽셀
const AVATAR = 96; // 서버로 보내는 프로필 사진 크기
const SOURCE = 720; // 다시 조절할 때 쓰려고 이 브라우저에만 남기는 사진의 긴 쪽 길이

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** 고른 파일을 줄여서 data URL로 (조절 창에서 쓰고, 다시 조절할 때를 위해 브라우저에 저장) */
export async function photoSource(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const k = Math.min(1, SOURCE / Math.max(img.width, img.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(img.width * k);
    cv.height = Math.round(img.height * k);
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; // 투명한 PNG도 검게 나오지 않게
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 조절 창을 띄움. 적용하면 프로필용 data URL, 취소하면 null. onOther: '다른 사진' 버튼을 눌렀을 때 */
export async function cropPhoto(source, onOther) {
  const img = await loadImage(source);
  return new Promise((resolve) => {
    const body = el(`<div class="photo-crop">
      <p class="muted photo-crop-help">끌어서 위치를 옮기고, 슬라이더나 마우스 휠로 크기를 조절해요. 원 안쪽이 프로필이 돼요.</p>
      <canvas class="photo-crop-stage" width="${STAGE}" height="${STAGE}" tabindex="0" role="img" aria-label="사진 위치 조절. 화살표 키로 옮겨요"></canvas>
      <label class="photo-crop-zoom"><span>크기</span><input type="range" min="${MIN_ZOOM * 100}" max="${MAX_ZOOM * 100}" step="1" value="100" aria-label="사진 크기"><b>100%</b></label>
      <div class="row modal-actions"><button type="button" class="btn ghost" data-k="other">다른 사진</button><button type="button" class="btn ghost" data-k="cancel">취소</button><button type="button" class="btn primary" data-k="ok">적용</button></div>
    </div>`);
    const stage = body.querySelector("canvas");
    const ctx = stage.getContext("2d");
    const slider = body.querySelector("input");
    const label = body.querySelector("b");
    let zoom = 1;
    let cx = img.width / 2;
    let cy = img.height / 2;

    const draw = () => {
      const r = cropRect(img.width, img.height, zoom, cx, cy);
      cx = r.x + r.size / 2; // 가장자리에 닿으면 그 자리에 멈춤
      cy = r.y + r.size / 2;
      ctx.drawImage(img, r.x, r.y, r.size, r.size, 0, 0, STAGE, STAGE);
      ctx.fillStyle = "rgba(10, 8, 30, 0.6)"; // 원 바깥은 어둡게
      ctx.beginPath();
      ctx.rect(0, 0, STAGE, STAGE);
      ctx.arc(STAGE / 2, STAGE / 2, STAGE / 2 - 3, 0, Math.PI * 2, true);
      ctx.fill("evenodd");
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(STAGE / 2, STAGE / 2, STAGE / 2 - 3, 0, Math.PI * 2);
      ctx.stroke();
      slider.value = Math.round(zoom * 100);
      label.textContent = `${Math.round(zoom * 100)}%`;
    };
    const setZoom = (value) => { zoom = clampZoom(value); draw(); };
    /** 화면에서 움직인 만큼 사진을 옮김 */
    const panBy = (dx, dy) => {
      const k = cropRect(img.width, img.height, zoom, cx, cy).size / stage.getBoundingClientRect().width;
      cx -= dx * k;
      cy -= dy * k;
      draw();
    };

    // 끌기 · 두 손가락 벌리기
    const pointers = new Map();
    let pinch = null;
    const gap = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    stage.addEventListener("pointerdown", (e) => {
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      pinch = pointers.size === 2 ? { gap: gap(), zoom } : null;
    });
    stage.addEventListener("pointermove", (e) => {
      const last = pointers.get(e.pointerId);
      if (!last) return;
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) setZoom(pinch.zoom * gap() / pinch.gap);
      else if (pointers.size === 1) panBy(dx, dy);
    });
    const release = (e) => { pointers.delete(e.pointerId); pinch = null; };
    stage.addEventListener("pointerup", release);
    stage.addEventListener("pointercancel", release);
    stage.addEventListener("wheel", (e) => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });
    stage.addEventListener("keydown", (e) => {
      const move = { ArrowLeft: [8, 0], ArrowRight: [-8, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] }[e.key];
      if (move) { e.preventDefault(); panBy(...move); }
    });
    slider.oninput = () => setZoom(slider.value / 100);

    const finish = (result) => { close(); resolve(result); };
    const close = modal("프로필 사진 조절", body, { closable: false, onEscape: () => finish(null) });
    body.closest(".modal")?.classList.add("photo-crop-modal");
    body.querySelector('[data-k="cancel"]').onclick = () => finish(null);
    body.querySelector('[data-k="other"]').onclick = () => { onOther?.(); finish(null); };
    body.querySelector('[data-k="ok"]').onclick = () => {
      const r = cropRect(img.width, img.height, zoom, cx, cy);
      const out = document.createElement("canvas");
      out.width = out.height = AVATAR;
      const octx = out.getContext("2d");
      octx.imageSmoothingQuality = "high";
      octx.drawImage(img, r.x, r.y, r.size, r.size, 0, 0, AVATAR, AVATAR);
      finish(out.toDataURL("image/jpeg", 0.82));
    };
    draw();
  });
}
