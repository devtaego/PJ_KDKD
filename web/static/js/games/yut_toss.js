// Visual-only toss simulation. Game rules decide the result; this module
// settles the four sticks to the corresponding faces before revealing it.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const VIEW = [-0.12, 0.70, 0.71];
const norm = (v) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };
const qNorm = (q) => { const n = Math.hypot(q.w, q.x, q.y, q.z) || 1; return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n }; };
const qMul = (a, b) => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});
const qAxis = (axis, angle) => {
  const [x, y, z] = norm(axis), h = angle / 2, s = Math.sin(h);
  return { w: Math.cos(h), x: x * s, y: y * s, z: z * s };
};
function qRotate(q, v) {
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const u = [q.x, q.y, q.z], uv = cross(u, v).map((x) => x * 2), uuv = cross(u, uv);
  return v.map((x, i) => x + q.w * uv[i] + uuv[i]);
}
function qSlerp(a, b, t) {
  let dot = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
  if (dot < 0) { b = { w: -b.w, x: -b.x, y: -b.y, z: -b.z }; dot = -dot; }
  if (dot > .9995) return qNorm({ w: a.w + (b.w - a.w) * t, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
  const theta = Math.acos(clamp(dot, -1, 1)), s = Math.sin(theta), wa = Math.sin((1 - t) * theta) / s, wb = Math.sin(t * theta) / s;
  return { w: a.w * wa + b.w * wb, x: a.x * wa + b.x * wb, y: a.y * wa + b.y * wb, z: a.z * wa + b.z * wb };
}
const targetPose = (flat, yaw) => qNorm(qMul(qAxis([0, 0, 1], yaw), qAxis([1, 0, 0], flat ? Math.PI : 0)));

function facesFor(body, width, height) {
  const { length, stickWidth, thickness } = body, radius = stickWidth / 2, faces = [];
  const capRadius = radius * 1.65, straightHalf = length / 2 - capRadius;
  const endScale = (x) => {
    const over = Math.max(0, Math.abs(x) - straightHalf);
    const round = over >= capRadius ? 0 : Math.sqrt(Math.max(0, 1 - (over / capRadius) ** 2));
    return .78 + round * .22;
  };
  const project = (local) => {
    const r = qRotate(body.q, local), x = body.x + r[0], y = body.y + r[1], z = body.z + r[2];
    const scale = 1500 / (1500 + y * .28);
    return [width / 2 + (x + r[1] * .18) * scale, height / 2 + (body.y * .78 - body.z * .78 + r[1] * .78 - r[2] * .78 - r[0] * .06) * scale];
  };
  const point = (x, angle) => {
    const r = radius * endScale(x);
    return [x, r * Math.cos(angle), -thickness / 2 + r * Math.sin(angle)];
  };
  const arcSteps = 16, lengthSteps = 10;
  for (let a = 0; a < arcSteps; a++) {
    const a0 = Math.PI * a / arcSteps, a1 = Math.PI * (a + 1) / arcSteps;
    const n = qRotate(body.q, [0, Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2)]);
    const facing = n[0] * VIEW[0] + n[1] * VIEW[1] + n[2] * VIEW[2];
    if (facing < -.08) continue;
    const light = clamp(.63 + facing * .13 - Math.abs(n[1]) * .04, .5, .79);
    const fill = "hsl(31 43% " + Math.round(light * 100) + "%)";
    for (let i = 0; i < lengthSteps; i++) {
      const x0 = -length / 2 + length * i / lengthSteps, x1 = -length / 2 + length * (i + 1) / lengthSteps;
      const pts = [point(x0, a0), point(x1, a0), point(x1, a1), point(x0, a1)].map(project);
      faces.push({ y: pts.reduce((s, p) => s + p[1], 0) / 4, pts, fill, stroke: null });
    }
  }
  // Rounded, softly shaded cut ends keep the sticks looking like short wooden batons.
  for (const sign of [-1, 1]) {
    const normal = qRotate(body.q, [sign, 0, 0]);
    const facing = normal[0] * VIEW[0] + normal[1] * VIEW[1] + normal[2] * VIEW[2];
    if (facing < .08) continue;
    const x = sign * length / 2;
    const pts = [];
    for (let i = 0; i <= 16; i++) pts.push(project(point(x, Math.PI * i / 16)));
    faces.push({ y: pts.reduce((s, p) => s + p[1], 0) / pts.length, pts, fill: "#B98552", stroke: "#8C6038" });
  }
  const flatNormal = qRotate(body.q, [0, 0, -1]);
  const flatFacing = flatNormal[0] * VIEW[0] + flatNormal[1] * VIEW[1] + flatNormal[2] * VIEW[2];
  body.markLines = null;
  body.surfaceLines = [];
  if (flatFacing > .02) {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const x = -length / 2 + length * i / 24;
      pts.push(project([x, -radius * endScale(x), -thickness / 2]));
    }
    for (let i = 24; i >= 0; i--) {
      const x = -length / 2 + length * i / 24;
      pts.push(project([x, radius * endScale(x), -thickness / 2]));
    }
    faces.push({ y: pts.reduce((s, p) => s + p[1], 0) / pts.length, pts, fill: "#D3AD7B", stroke: "#936B43" });
    const surface = (x, y) => {
      return project([x, y, -thickness / 2 - .35]);
    };
    for (const x of [-length * .25, 0, length * .25]) {
      body.surfaceLines.push({ color: "rgba(112,73,39,.55)", width: 1.2, points: [[surface(x - 3.8, -3.4), surface(x + 3.8, 3.4)], [surface(x + 3.8, -3.4), surface(x - 3.8, 3.4)]] });
    }
    for (const y of [-radius * .56, radius * .56]) body.surfaceLines.push({
      color: "rgba(255,247,228,.34)", width: 1,
      points: [[surface(-length * .42, y), surface(length * .42, y)]],
    });
    for (const y of [-radius * .94, radius * .94]) body.surfaceLines.push({
      color: "rgba(124,84,48,.2)", width: .8,
      points: [[surface(-length * .43, y), surface(length * .43, y)]],
    });
    if (body.marked) body.markLines = [
      [surface(-7, -5), surface(7, 5)], [surface(7, -5), surface(-7, 5)],
    ];
  } else {
    const crown = qRotate(body.q, [0, 0, 1]);
    const crownFacing = crown[0] * VIEW[0] + crown[1] * VIEW[1] + crown[2] * VIEW[2];
    if (crownFacing > .08) {
      const top = (x, y) => {
        const edge = radius * endScale(x);
        const safeY = clamp(y, -edge * .88, edge * .88);
        return project([x, safeY, -thickness / 2 + Math.sqrt(Math.max(0, edge * edge - safeY * safeY))]);
      };
      for (const x of [-length * .25, 0, length * .25]) {
        body.surfaceLines.push({ color: "rgba(112,73,39,.55)", width: 1.2, points: [[top(x - 3.8, -3.4), top(x + 3.8, 3.4)], [top(x + 3.8, -3.4), top(x - 3.8, 3.4)]] });
      }
      for (const y of [-radius * .48, radius * .48]) body.surfaceLines.push({
        color: "rgba(255,247,228,.42)", width: 1.15,
        points: [[top(-length * .42, y), top(length * .42, y)]],
      });
      body.surfaceLines.push({ color: "rgba(255,250,235,.7)", width: 2.2, points: [[top(-length * .35, 0), top(length * .35, 0)]] });
    }
  }
  return faces;
}

function drawFrame(ctx, bodies, width, height) {
  ctx.clearRect(0, 0, width, height);
  for (const b of bodies) {
    const scale = 1 - clamp((b.y / height) * .035, -.025, .025), x = width / 2 + b.x * scale, y = height / 2 + b.y * scale;
    const lift = clamp(b.z / 180, 0, 1);
    ctx.save(); ctx.globalAlpha = .12 + (1 - lift) * .24; ctx.fillStyle = "#24150B";
    ctx.shadowColor = "rgba(27,16,8,.35)"; ctx.shadowBlur = 4 + lift * 16;
    ctx.beginPath(); ctx.ellipse(x, y + 5, b.length * (.38 + lift * .1), b.stickWidth * (.18 + lift * .08), 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  const faces = bodies.flatMap((b) => facesFor(b, width, height));
  faces.sort((a, b) => a.y - b.y);
  for (const f of faces) {
    ctx.beginPath(); ctx.moveTo(f.pts[0][0], f.pts[0][1]);
    for (let i = 1; i < f.pts.length; i++) ctx.lineTo(f.pts[i][0], f.pts[i][1]);
    ctx.closePath(); ctx.fillStyle = f.fill; ctx.fill();
    if (f.stroke) { ctx.strokeStyle = f.stroke; ctx.lineWidth = 1.15; ctx.stroke(); }
  }
  for (const b of bodies) {
    for (const line of b.surfaceLines || []) {
      ctx.strokeStyle = line.color; ctx.lineWidth = line.width; ctx.lineCap = "round";
      for (const points of line.points) { ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]); ctx.lineTo(points[1][0], points[1][1]); ctx.stroke(); }
    }
    if (b.markLines) {
      ctx.strokeStyle = "#80552F"; ctx.lineWidth = 2; ctx.lineCap = "round";
      for (const line of b.markLines) { ctx.beginPath(); ctx.moveTo(line[0][0], line[0][1]); ctx.lineTo(line[1][0], line[1][1]); ctx.stroke(); }
    }
  }
}

/** faces[i] is true when that stick must finish flat-side up. */
export function animateYutToss(container, { faces = [], markedIndex = -1, onImpact = () => {}, onSettled = () => {} } = {}) {
  let raf = 0, observer = null, stopped = false, impacted = false, last = 0, elapsed = 0;
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { alpha: true });
  canvas.className = "yut-physics-canvas"; container.replaceChildren(canvas);
  let width = 1, height = 1, dpr = 1;
  const resize = () => {
    const rect = container.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = width + "px"; canvas.style.height = height + "px"; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize(); observer = new ResizeObserver(resize); observer.observe(container);
  const stickWidth = clamp(width * .06, 22, 32), length = clamp(width * .31, 132, 190), thickness = stickWidth * .5;
  const bodies = Array.from({ length: 4 }, (_, i) => {
    const yaw = rand(-Math.PI, Math.PI);
    const q = qNorm(qMul(qMul(qAxis([0, 0, 1], yaw), qAxis([0, 1, 0], rand(-1.1, 1.1))), qAxis([1, 0, 0], rand(-1.1, 1.1))));
    return {
      x: rand(-20, 20), y: height * rand(.25, .34), z: rand(25, 42),
      vx: rand(-245, 245), vy: rand(-380, -210), vz: rand(420, 610),
      omega: [rand(-13, 13), rand(-15, 15), rand(-12, 12)], q,
      target: targetPose(Boolean(faces[i]), rand(-Math.PI, Math.PI)),
      phase: rand(0, Math.PI * 2), length, stickWidth, thickness, marked: i === markedIndex, bounces: 0, landed: false, settled: false, markLines: null,
    };
  });
  const step = (dt) => {
    elapsed += dt;
    for (const b of bodies) {
      if (b.settled) continue;
      if (!b.landed) {
        b.vz -= 1480 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        const edgeX = width * .43, edgeY = height * .43;
        if (Math.abs(b.x) > edgeX) { b.x = Math.sign(b.x) * edgeX; b.vx *= -.48; }
        if (Math.abs(b.y) > edgeY) { b.y = Math.sign(b.y) * edgeY; b.vy *= -.42; }
        if (b.z <= thickness * .5) {
          b.z = thickness * .5;
          if (b.vz < -45 && b.bounces < 3) { b.vz = -b.vz * (b.bounces === 0 ? .43 : .29); b.bounces++; }
          else { b.vz = 0; b.landed = true; }
          b.omega[0] += b.vy / b.length * .7;
          b.omega[1] -= b.vx / b.length * .7;
          b.vx *= .78; b.vy *= .78; b.omega = b.omega.map((v) => v * .66);
          if (!impacted) { impacted = true; onImpact(); }
        }
      } else {
        const drag = Math.exp(-(elapsed > 1.35 ? 2.8 : 1.1) * dt);
        b.vx *= drag; b.vy *= drag; b.x += b.vx * dt; b.y += b.vy * dt;
        b.omega = b.omega.map((v) => v * Math.exp(-(elapsed > 1.35 ? 3.8 : 1.15) * dt));
      }
      if (!b.landed) {
        b.omega[0] += Math.sin(elapsed * 7 + b.x) * 1.1 * dt;
        b.omega[1] += Math.cos(elapsed * 6 + b.y) * 1.25 * dt;
        b.omega[2] += Math.sin(elapsed * 5 + b.z) * .9 * dt;
      }
      const spin = qMul(b.q, { w: 0, x: b.omega[0], y: b.omega[1], z: b.omega[2] });
      b.q = qNorm({ w: b.q.w + spin.w * .5 * dt, x: b.q.x + spin.x * .5 * dt, y: b.q.y + spin.y * .5 * dt, z: b.q.z + spin.z * .5 * dt });
      if (elapsed > 1.03) {
        const t = clamp((elapsed - 1.03) / .5, 0, 1);
        const wobble = Math.sin(elapsed * 36 + b.phase) * .045 * (1 - t);
        const softTarget = qNorm(qMul(qAxis([0, 1, 0], wobble), b.target));
        b.q = qSlerp(b.q, softTarget, 1 - Math.pow(1 - t, 2));
        b.vx *= Math.exp(-4 * dt); b.vy *= Math.exp(-4 * dt); b.omega = b.omega.map((v) => v * Math.exp(-4 * dt));
      }
      if (elapsed >= 1.53) {
        b.settled = true; b.landed = true; b.vx = b.vy = b.vz = 0; b.omega = [0, 0, 0]; b.q = b.target;
      }
    }
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      if (Math.abs(a.z - b.z) > 30) continue;
      let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = stickWidth * 2.2;
      if (d >= min) continue;
      if (d < .01) { dx = rand(-1, 1); dy = rand(-1, 1); d = Math.hypot(dx, dy); }
      const nx = dx / d, ny = dy / d, push = (min - d) * .5;
      a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
      const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (relative < 0) { const impulse = -relative * .38; a.vx -= impulse * nx; a.vy -= impulse * ny; b.vx += impulse * nx; b.vy += impulse * ny; }
    }
  };
  const frame = (now) => {
    if (stopped) return;
    if (!last) last = now;
    let dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    while (dt > 0) { const slice = Math.min(1 / 120, dt); step(slice); dt -= slice; }
    drawFrame(ctx, bodies, width, height);
    if (bodies.every((b) => b.settled)) {
      stopped = true; observer?.disconnect(); observer = null; onSettled();
      window.setTimeout(() => { canvas.classList.add("fade-out"); window.setTimeout(() => canvas.remove(), 400); }, 850);
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  drawFrame(ctx, bodies, width, height); raf = requestAnimationFrame(frame);
  return () => { stopped = true; cancelAnimationFrame(raf); observer?.disconnect(); canvas.remove(); };
}
