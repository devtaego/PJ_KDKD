// 윷놀이 규칙 엔진
// 판: 바깥 20칸(0~19, 0이 출발 · 도착 모서리) + 대각선 9칸(20~28, 22가 한가운데)
//   5(오른쪽 위 모서리)에서 시작하면 5→20→21→22→23→24→15 지름길
//   10(왼쪽 위 모서리)에서 시작하면 10→25→26→22→27→28→도착 지름길
//   22(한가운데)에서 시작하면 22→27→28→도착
// 모든 무작위(윷 결과 · 능력 뽑기 · 대환장 파티 등)는 행동마다 붙는 seed로 계산 → 모든 기기가 같은 결과
import { ABILITIES, ABILITY_BY_ID, THROW_ODDS, START_HAND } from "../data/yut_abilities.js";

export const START = -1; // 아직 판에 안 올라온 말
export const HOME = 99; // 도착한 말
export const CENTER = 22;
export const RESULT_NAMES = { "-1": "빽도", 1: "도", 2: "개", 3: "걸", 4: "윷", 5: "모" };
const LEVELS = [-1, 1, 2, 3, 4, 5]; // 손가락 꼬임 · 존버로 한 단계씩 오르내리는 순서

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** 이 칸에서 출발할 때 지나가는 칸 목록 (마지막은 HOME) */
export function pathFrom(node) {
  if (node === START) return [...range(1, 19), HOME];
  if (node === 0 || node === 28) return [HOME];
  if (node === 5) return [20, 21, 22, 23, 24, 15, 16, 17, 18, 19, HOME];
  if (node === 10) return [25, 26, 22, 27, 28, HOME];
  if (node === CENTER) return [27, 28, HOME];
  if (node === 20) return [21, 22, 23, 24, 15, 16, 17, 18, 19, HOME];
  if (node === 21) return [22, 23, 24, 15, 16, 17, 18, 19, HOME];
  if (node === 23) return [24, 15, 16, 17, 18, 19, HOME];
  if (node === 24) return [15, 16, 17, 18, 19, HOME];
  if (node === 25) return [26, 22, 27, 28, HOME];
  if (node === 26) return [22, 27, 28, HOME];
  if (node === 27) return [28, HOME];
  return [...range(node + 1, 19), HOME]; // 바깥 칸
}

/** 남은 거리 (작을수록 앞선 말). 출발 전 20, 도착 0 */
export const remaining = (node) => (node === HOME ? 0 : pathFrom(node).length);

function backDefault(node) {
  const m = { 0: 19, 20: 5, 21: 20, 22: 21, 23: 22, 24: 23, 25: 10, 26: 25, 27: 22, 28: 27 };
  if (node in m) return m[node];
  return node - 1; // 바깥 1~19
}

export function mulberry(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rollRaw(rng) {
  let x = rng();
  for (const o of THROW_ODDS) {
    if (x < o.p) return o.v;
    x -= o.p;
  }
  return 2;
}

const onBoard = (n) => n !== START && n !== HOME;

/** 받침에 맞춰 조사 붙이기 (홍길동이 / 친구 2가) */
export function josa(word, withFinal, noFinal) {
  const c = word.charCodeAt(word.length - 1);
  const has = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 > 0 : /[0-9]$/.test(word) ? "013678".includes(word.at(-1)) : false;
  return word + (has ? withFinal : noFinal);
}

export class YutGame {
  /** names: 자리별 이름, opts: { pieces: 2~4, mode: basic / special / chaos, seed: 시작 카드 나눠 주기용 } */
  constructor(names, { pieces = 3, mode = "special", seed = 1 } = {}) {
    this.mode = ["basic", "special", "chaos"].includes(mode) ? mode : "special";
    this.pieceCount = Math.min(4, Math.max(2, pieces | 0 || 3));
    this.players = names.map((name) => ({
      name, hand: [], captured: 0, luck: false, ward: false, shift: 0, resigned: false,
      pieces: Array.from({ length: this.pieceCount }, () => ({ node: START, prev: null, shield: 0 })),
    }));
    this.current = 0;
    this.phase = "throw"; // throw: 던질 차례 / move: 나온 결과로 말 옮길 차례
    this.throws = 1;
    this.pending = []; // 아직 안 쓴 윷 결과
    this.turnNo = 1;
    this.usedAbility = false;
    this.bombs = {}; // 칸 -> 설치한 자리
    this.dopamine = 0;
    this.upside = null; // 화면 거꾸로 당한 자리
    this.over = false;
    this.winner = null;
    this.log = [];
    this.events = []; // 방금 행동에서 일어난 일 (화면 연출용)
    this.lastThrow = null;
    if (this.abilitiesOn) { // 시작할 때 모두 같은 장수의 능력 카드를 받음
      const rng = mulberry(seed | 0);
      for (let k = 0; k < START_HAND[this.mode]; k++) this.players.forEach((_, i) => this.draw(i, rng));
      this.say(`능력 카드를 ${START_HAND[this.mode]}장씩 나눠 받았어요`, "card");
    }
  }

  get abilitiesOn() { return this.mode !== "basic"; }
  get n() { return this.players.length; }
  nextSeat(seat = this.current) {
    for (let k = 1; k <= this.n; k++) {
      const s = (seat + k) % this.n;
      if (!this.players[s].resigned) return s;
    }
    return seat;
  }
  finished(seat) { return this.players[seat].pieces.filter((p) => p.node === HOME).length; }
  remainingOf(seat) { return this.players[seat].pieces.reduce((s, p) => s + remaining(p.node), 0); }
  shielded(piece) { return piece.shield >= this.turnNo; }
  /** seat의 node 칸에 있는 말 묶음 (업힌 말 전부) */
  stackAt(seat, node) { return this.players[seat].pieces.filter((p) => p.node === node && onBoard(node)); }

  say(text, kind = "info") {
    this.log.push({ text, kind });
    if (this.log.length > 60) this.log.shift();
  }
  event(e) { this.events.push(e); }

  // ------------------------------------------------------------ 던지기
  throw(seed) {
    if (this.over || this.phase !== "throw" || this.throws <= 0) return false;
    this.events = [];
    const p = this.players[this.current];
    let r = rollRaw(mulberry(seed));
    if (p.shift) { // 손가락 꼬임 / 존버
      const i = Math.max(0, Math.min(LEVELS.length - 1, LEVELS.indexOf(r) + p.shift));
      r = LEVELS[i];
      p.shift = 0;
    }
    if (p.luck && (r === -1 || r === 1)) { // 럭키비키
      r = 2;
      this.event({ kind: "fx", text: "럭키비키!" });
    }
    p.luck = false;
    this.throws--;
    this.pending.push(r);
    this.lastThrow = r;
    if (r >= 4) this.throws++; // 윷 · 모는 한 번 더
    this.say(`${p.name}: ${RESULT_NAMES[r]}${r >= 4 ? " · 한 번 더!" : ""}`, r >= 4 ? "good" : "info");
    this.event({ kind: "throw", value: r });
    if (this.throws === 0) this.phase = "move";
    this.prune();
    return true;
  }

  canUse(seat, r) {
    const ps = this.players[seat].pieces;
    return r === -1 ? ps.some((p) => onBoard(p.node)) : ps.some((p) => p.node !== HOME);
  }

  /** 쓸 수 없는 결과(말이 없는데 빽도 등)는 버리고, 다 썼으면 차례를 넘김 */
  prune() {
    if (this.over || this.throws > 0) return; // 아직 더 던질 수 있으면 다 던진 뒤에 판단
    const before = this.pending.length;
    // 빽도는 지금 판 위에 말이 없어도, 다른 결과(윷 · 모 등)로 말을 먼저 올리면 쓸 수 있으니 남겨 둠
    const canEnter = this.pending.some((r) => r > 0 && this.canUse(this.current, r));
    this.pending = this.pending.filter((r) => this.canUse(this.current, r) || (r === -1 && canEnter));
    if (this.pending.length < before) this.say("움직일 말이 없어 결과를 버려요");
    if (this.throws === 0 && this.pending.length === 0) this.endTurn();
  }

  // ------------------------------------------------------------ 말 옮기기
  /** 결과 r로 piece를 옮겼을 때 도착 칸 (못 옮기면 null) */
  destOf(piece, r) {
    if (piece.node === HOME) return null;
    if (r === -1) {
      if (!onBoard(piece.node)) return null;
      return this.backOne(piece.node, piece.prev);
    }
    const path = pathFrom(piece.node);
    return r > path.length ? HOME : path[r - 1];
  }

  backOne(node, prev) {
    if (prev !== null && prev !== undefined) return prev === START ? 0 : prev;
    return backDefault(node);
  }

  move(pieceIdx, resIdx, seed) {
    if (this.over || this.phase !== "move") return false;
    const seat = this.current;
    const r = this.pending[resIdx];
    const piece = this.players[seat].pieces[pieceIdx];
    if (r === undefined || !piece) return false;
    const dest = this.destOf(piece, r);
    if (dest === null) return false;
    this.events = [];
    const stack = piece.node === START ? [piece] : this.stackAt(seat, piece.node);
    let prev = null;
    if (r !== -1) {
      const path = pathFrom(piece.node);
      prev = r >= 2 && r <= path.length ? path[r - 2] : piece.node;
    }
    this.pending.splice(resIdx, 1);
    this.event({ kind: "move", seat, from: piece.node, to: dest, count: stack.length });
    this.land(seat, stack, dest, prev, mulberry(seed), true);
    this.afterAction();
    return true;
  }

  /** 말 묶음을 칸에 내려놓음: 도착 · 폭탄 · 잡기 · 능력 칸 처리 */
  land(seat, stack, node, prev, rng, fromMove) {
    const p = this.players[seat];
    for (const pc of stack) { pc.node = node; pc.prev = node === HOME ? null : prev; }
    if (node === HOME) {
      this.say(`${p.name}의 말 ${stack.length}개 도착!`, "good");
      this.event({ kind: "home", seat, count: stack.length });
      return;
    }
    if (this.bombs[node] !== undefined) { // 스불재 폭탄
      delete this.bombs[node];
      for (const pc of stack) { pc.node = START; pc.prev = null; }
      p.captured += stack.length;
      this.say(`펑! ${p.name}의 말이 폭탄을 밟아 출발점으로`, "bad");
      this.event({ kind: "boom", node });
      return;
    }
    for (let s = 0; s < this.n; s++) { // 잡기
      if (s === seat) continue;
      const victims = this.players[s].pieces.filter((pc) => pc.node === node && !this.shielded(pc));
      if (victims.length) {
        for (const pc of victims) { pc.node = START; pc.prev = null; }
        this.players[s].captured += victims.length;
        this.say(`${josa(p.name, "이", "가")} ${this.players[s].name}의 말 ${victims.length}개를 잡았다!${fromMove ? " 한 번 더!" : ""}`, "good");
        this.event({ kind: "catch", seat, victim: s, node, count: victims.length });
        if (fromMove) { this.throws++; this.phase = "throw"; }
      }
    }
  }

  draw(seat, rng) {
    const pool = ABILITIES.map((a) => [a, a.weight[this.mode] || 0]).filter(([, w]) => w > 0);
    const total = pool.reduce((s, [, w]) => s + w, 0);
    let x = rng() * total;
    let pick = pool[pool.length - 1][0];
    for (const [a, w] of pool) {
      if (x < w) { pick = a; break; }
      x -= w;
    }
    this.players[seat].hand.push(pick.id);
  }

  afterAction() {
    for (let s = 0; s < this.n; s++) {
      if (!this.over && this.finished(s) === this.pieceCount) {
        this.over = true;
        this.winner = s;
        this.say(`${this.players[s].name} 모든 말 도착! 승리!`, "good");
        return;
      }
    }
    if (this.throws > 0) this.phase = "throw";
    else if (this.pending.length === 0) this.endTurn();
    else { this.phase = "move"; this.prune(); }
  }

  endTurn() {
    if (this.over) return;
    if (this.upside === this.current) this.upside = null;
    const left = this.players.filter((p) => !p.resigned).length;
    if (left <= 1) return;
    this.current = this.nextSeat();
    this.turnNo++;
    this.phase = "throw";
    this.throws = 1;
    if (this.dopamine > 0) { this.throws = 2; this.dopamine--; }
    this.pending = [];
    this.usedAbility = false;
  }

  resign(seat) {
    if (this.over || this.players[seat].resigned) return false;
    this.players[seat].resigned = true;
    this.say(`${this.players[seat].name} 기권`, "bad");
    const alive = this.players.map((p, i) => i).filter((i) => !this.players[i].resigned);
    if (alive.length === 1) {
      this.over = true;
      this.winner = alive[0];
    } else if (seat === this.current) {
      this.pending = [];
      this.throws = 0;
      this.endTurn();
    }
    return true;
  }

  ranking() {
    return this.players.map((p, i) => i).sort((a, b) =>
      (this.players[a].resigned - this.players[b].resigned) ||
      (a === this.winner ? -1 : b === this.winner ? 1 : 0) ||
      this.finished(b) - this.finished(a) || this.remainingOf(a) - this.remainingOf(b));
  }

  // ------------------------------------------------------------ 능력
  /** 능력 쓰기. t = { piece:{seat, idx}, own:idx, opp:{seat, idx}, node } */
  use(handIdx, t, seed) {
    if (this.over || !this.abilitiesOn || this.usedAbility) return false;
    const seat = this.current;
    const p = this.players[seat];
    const id = p.hand[handIdx];
    const def = ABILITY_BY_ID[id];
    if (!def) return false;
    const rng = mulberry(seed);
    const oppStack = () => {
      const o = t?.opp;
      if (!o || o.seat === seat || !this.players[o.seat]) return null;
      const pc = this.players[o.seat].pieces[o.idx];
      if (!pc || !onBoard(pc.node) || this.shielded(pc)) return null;
      return { seat: o.seat, stack: this.stackAt(o.seat, pc.node), node: pc.node };
    };
    const ownStack = (allowStart = false) => {
      const pc = p.pieces[t?.own];
      if (!pc || pc.node === HOME || (!allowStart && !onBoard(pc.node))) return null;
      return pc.node === START ? [pc] : this.stackAt(seat, pc.node);
    };
    // 대상 확인 (잘못된 대상이면 쓰지 않음)
    let victim = null;
    let opp = null, own = null;
    if (def.target === "oppPiece" || def.target === "swap") {
      opp = oppStack();
      if (!opp) return false;
      victim = opp.seat;
    }
    if (def.target === "ownPiece" || def.target === "swap") {
      own = ownStack(id === "gazua" || id === "yeongkkeul");
      if (!own) return false;
    }
    if (def.target === "node") {
      const nd = t?.node;
      if (!Number.isInteger(nd) || nd < 1 || nd > 28 || this.bombs[nd] !== undefined) return false;
      if (this.players.some((pl) => pl.pieces.some((pc) => pc.node === nd))) return false;
    }
    if (def.target === "nextPlayer") victim = this.nextSeat();
    if (def.onlyFresh && !(this.phase === "throw" && this.pending.length === 0)) return false;
    let missileTarget = null;
    if (id === "missile") {
      missileTarget = this.leadingOpponentStack(seat);
      victim = missileTarget?.seat ?? null;
    }

    this.events = [];
    p.hand.splice(handIdx, 1);
    this.usedAbility = true;
    this.say(`${p.name}: 「${def.name}」 ${def.shout}`, "ability");
    this.event({ kind: "ability", seat, id, shout: def.shout });

    if (def.guard && victim !== null && this.players[victim].ward) { // 어쩔티비
      const v = this.players[victim];
      v.ward = false;
      v.hand.push(id);
      this.say(`${v.name}: 어쩔티비~ 막고 「${def.name}」 카드를 빼앗았다!`, "ability");
      this.event({ kind: "blocked", seat: victim, id });
      this.afterAction();
      return true;
    }

    switch (id) {
      case "kingbat": this.pushBack(opp.stack, 1); break;
      case "lucky": p.luck = true; break;
      case "godlife": for (const pc of own) pc.shield = this.turnNo + this.n - 1; break;
      case "twist": this.players[victim].shift -= 1; break;
      case "hodl":
        p.shift += 2;
        this.say(`${p.name} 존버 중… 다음 던지기 두 단계 업!`);
        this.pending = [];
        this.throws = 0;
        this.endTurn();
        return true;
      case "upside": this.upside = victim; break;
      case "missile":
        if (missileTarget) this.pushBack(missileTarget.stack, 3);
        else this.say("쏠 상대가 없어서 미사일이 허공으로…");
        break;
      case "bomb": this.bombs[t.node] = seat; break;
      case "eojjeol": p.ward = true; break;
      case "isthisright": {
        const a = own[0].node, b = opp.node;
        for (const pc of own) { pc.node = b; pc.prev = null; }
        for (const pc of opp.stack) { pc.node = a; pc.prev = null; }
        break;
      }
      case "gazua":
        if (rng() < 0.5) {
          this.say("앞면! 5칸 전진!", "good");
          this.event({ kind: "coin", heads: true });
          const path = pathFrom(own[0].node);
          this.land(seat, own, path.length < 5 ? HOME : path[4], path.length >= 5 ? path[3] : null, rng, false);
        } else {
          this.say("뒷면… 출발점으로", "bad");
          this.event({ kind: "coin", heads: false });
          for (const pc of own) { pc.node = START; pc.prev = null; }
        }
        break;
      case "darkmode": this.pushBack(opp.stack, Math.max(1, Math.min(5, p.captured))); break;
      case "yeongkkeul": {
        const n = p.hand.length;
        p.hand = [];
        if (n === 0) { this.say("버릴 카드가 없어서 영끌 실패…"); break; }
        const path = pathFrom(own[0].node), k = n * 3;
        this.land(seat, own, k > path.length ? HOME : path[k - 1], k >= 2 && k <= path.length ? path[k - 2] : null, rng, false);
        break;
      }
      case "party": {
        const stacks = this.allStacks();
        const nodes = stacks.map((s) => s.node);
        for (let i = nodes.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
        }
        stacks.forEach((s, i) => { for (const pc of s.pieces) { pc.node = nodes[i]; pc.prev = null; } });
        break;
      }
      case "quake":
        for (const s of this.allStacks()) {
          const k = 1 + Math.floor(rng() * 3), path = pathFrom(s.node);
          const dest = k > path.length ? HOME : path[k - 1];
          for (const pc of s.pieces) { pc.node = dest; pc.prev = null; }
        }
        break;
      case "assemble":
        for (const s of this.allStacks()) for (const pc of s.pieces) { pc.node = CENTER; pc.prev = null; }
        break;
      case "roulette": {
        const rolls = this.players.map((pl) => (pl.resigned ? 99 : rollRaw(rng)));
        const low = Math.min(...rolls);
        this.say(`러시안 윷렛: ${this.players.map((pl, i) => `${pl.name} ${RESULT_NAMES[rolls[i]] ?? "-"}`).join(" · ")}`, "ability");
        rolls.forEach((v, s) => {
          if (v !== low) return;
          const lead = this.leadingStackOf(s, true);
          if (lead) {
            for (const pc of lead.pieces) { pc.node = START; pc.prev = null; }
            this.players[s].captured += lead.pieces.length;
            this.say(`${this.players[s].name}의 말이 출발점으로!`, "bad");
          }
        });
        break;
      }
      case "dopamine": this.dopamine = this.n; break;
      default: break;
    }
    this.afterAction();
    return true;
  }

  pushBack(stack, k) {
    let node = stack[0].node, prev = stack[0].prev;
    for (let i = 0; i < k && onBoard(node); i++) {
      node = node === 0 ? START : this.backOne(node, i === 0 ? prev : null);
    }
    for (const pc of stack) { pc.node = node; pc.prev = null; }
  }

  allStacks() {
    const out = [];
    this.players.forEach((pl, s) => {
      const seen = new Set();
      for (const pc of pl.pieces) {
        if (!onBoard(pc.node) || seen.has(pc.node)) continue;
        seen.add(pc.node);
        out.push({ seat: s, node: pc.node, pieces: pl.pieces.filter((q) => q.node === pc.node) });
      }
    });
    return out;
  }

  leadingStackOf(seat, ignoreShield = false) {
    let best = null;
    for (const s of this.allStacks()) {
      if (s.seat !== seat || (!ignoreShield && s.pieces.some((pc) => this.shielded(pc)))) continue;
      if (!best || remaining(s.node) < remaining(best.node)) best = s;
    }
    return best ? { ...best, stack: best.pieces } : null;
  }

  leadingOpponentStack(seat) {
    let best = null;
    for (let s = 0; s < this.n; s++) {
      if (s === seat || this.players[s].resigned) continue;
      const st = this.leadingStackOf(s);
      if (st && (!best || remaining(st.node) < remaining(best.node))) best = st;
    }
    return best;
  }
}
