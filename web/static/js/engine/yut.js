// 윷놀이 규칙 엔진
// 판: 바깥 20칸(0~19, 0이 출발 · 도착 모서리) + 대각선 9칸(20~28, 22가 한가운데)
//   5(오른쪽 위 모서리)에서 시작하면 5→20→21→22→23→24→15 지름길
//   10(왼쪽 위 모서리)에서 시작하면 10→25→26→22→27→28→0 지름길
//   22(한가운데)에서 시작하면 22→27→28→0
// 골인: 어느 길로 오든 0(출발점)에 딱 멈추면 아직 판 위. 0을 1칸 이상 넘어가야 도착(HOME)
// 모든 무작위(윷 결과 · 능력 뽑기 · 대환장 파티 등)는 행동마다 붙는 seed로 계산 → 모든 기기가 같은 결과
import { ABILITY_BY_ID, THROW_ODDS, dealPowers } from "../data/yut_abilities.js";

export const START = -1; // 아직 판에 안 올라온 말
export const HOME = 99; // 도착한 말
export const CENTER = 22;
export const RESULT_NAMES = { 0: "낙", "-1": "빽도", 1: "도", 2: "개", 3: "걸", 4: "윷", 5: "모" };

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** 이 칸에서 출발할 때 지나가는 칸 목록 (마지막은 HOME) */
export function pathFrom(node) {
  if (node === START) return [...range(1, 19), 0, HOME];
  if (node === 0) return [HOME];
  if (node === 5) return [20, 21, 22, 23, 24, 15, 16, 17, 18, 19, 0, HOME];
  if (node === 10) return [25, 26, 22, 27, 28, 0, HOME];
  if (node === CENTER) return [27, 28, 0, HOME];
  if (node === 20) return [21, 22, 23, 24, 15, 16, 17, 18, 19, 0, HOME];
  if (node === 21) return [22, 23, 24, 15, 16, 17, 18, 19, 0, HOME];
  if (node === 23) return [24, 15, 16, 17, 18, 19, 0, HOME];
  if (node === 24) return [15, 16, 17, 18, 19, 0, HOME];
  if (node === 25) return [26, 22, 27, 28, 0, HOME];
  if (node === 26) return [22, 27, 28, 0, HOME];
  if (node === 27) return [28, 0, HOME];
  if (node === 28) return [0, HOME];
  return [...range(node + 1, 19), 0, HOME]; // 바깥 칸
}

/** 남은 거리 (작을수록 앞선 말). 출발 전 21, 도착 0 */
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
  /** names: 자리별 이름, opts: { pieces: 2~4, mode: basic(클래식) / power(초능력), seed: 시작 카드 나눠 주기용,
   *  teams: 2:2 팀전 (4명일 때만, 자리 0 · 2가 A팀, 1 · 3이 B팀 → 팀이 번갈아 던짐.
   *  팀은 말 4개를 같이 씀: 자리 2 · 3의 pieces는 자리 0 · 1과 같은 배열. 초능력 카드는 사람마다 따로) } */
  constructor(names, { pieces = 3, mode = "power", seed = 1, teams = false } = {}) {
    this.mode = mode === "basic" ? "basic" : "power";
    this.teams = !!teams && names.length === 4;
    this.pieceCount = this.teams ? 4 : Math.min(4, Math.max(2, pieces | 0 || 3));
    this.players = names.map((name) => ({
      name, hand: [], captured: 0, stash: [], resigned: false,
      pieces: Array.from({ length: this.pieceCount }, () => ({ node: START, prev: null, shield: 0 })),
    }));
    if (this.teams) {
      for (const s of [2, 3]) {
        this.players[s].pieces = this.players[s - 2].pieces;
      }
    }
    this.current = 0;
    this.phase = "throw"; // throw: 던질 차례 / move: 나온 결과로 말 옮길 차례
    this.throws = 1;
    this.pending = []; // 아직 안 쓴 윷 결과
    this.turnNo = 1;
    this.usedAbility = false;
    this.bombs = {}; // 칸 -> 설치한 자리
    this.charm = null; // 다음 던지기에 걸린 윷의 힘
    this.over = false;
    this.winner = null;
    this.winners = []; // 팀전이면 이긴 팀 두 사람
    this.log = [];
    this.events = []; // 방금 행동에서 일어난 일 (화면 연출용)
    this.lastThrow = null;
    if (this.abilitiesOn) { // 시작할 때 사람마다 윷의 힘 1장 + 말의 힘 1장 (힘 합이 모두 같음)
      dealPowers(this.n, mulberry(seed | 0)).forEach((hand, i) => { this.players[i].hand.push(...hand); });
      this.say("초능력 카드를 2장씩 받았어요", "card");
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
  /** 같은 편인지 (팀전이면 같은 팀, 아니면 자기 자신만) */
  ally(a, b) { return a === b || (this.teams && a % 2 === b % 2); }
  /** 이 자리의 말 · 카드를 대표하는 자리 (팀전이면 팀 번호 0 · 1, 아니면 자기 자리) */
  team(seat) { return this.teams ? seat % 2 : seat; }
  /** 말 묶음 단위 목록: 팀전이면 [0, 1], 아니면 모든 자리 */
  sides() { return this.teams ? [0, 1] : this.players.map((_, i) => i); }
  /** 말 주인 이름 (팀전이면 A팀 · B팀) */
  sideName(seat) { return this.teams ? (seat % 2 ? "B팀" : "A팀") : this.players[seat].name; }
  remainingOf(seat) { return this.players[seat].pieces.reduce((s, p) => s + remaining(p.node), 0); }
  shielded(piece) { return piece.shield >= this.turnNo; }
  /** seat의 node 칸에 있는 말 묶음 (업힌 말 전부) */
  stackAt(seat, node) {
    if (!onBoard(node)) return [];
    return this.players[seat].pieces.filter((p) => p.node === node);
  }

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
    const rng = mulberry(seed);
    const charm = this.charm;
    this.charm = null;
    if (charm === "combo") { // 던지는 대신 도와 개를 모두 받음
      this.throws--;
      this.pending.push(1, 2);
      this.lastThrow = 2;
      this.say(`${p.name}: 도개 세트! 도와 개를 받았어요`, "good");
      this.event({ kind: "throw", value: 2, seat: this.current });
      if (this.throws === 0) this.phase = "move";
      this.prune();
      return true;
    }
    let r = charm === "gul3" ? 3 : charm === "reverse" ? -1 : charm === "allin" ? (rng() < 0.5 ? 1 : 5) : charm === "golden" ? (rng() < 0.5 ? 4 : 5) : rollRaw(rng);
    // 낙은 이번 던지기만 무효: 남은 던지기는 없어지지만, 앞에서 던져 쌓인 결과(모 · 윷 등)는 그대로 쓴다.
    if (r === 0) {
      this.throws = 0;
      this.lastThrow = 0;
      this.say(`${p.name}: 낙! ${this.pending.length ? "앞에 나온 결과로 말을 옮겨요." : "차례를 넘깁니다."}`, "bad");
      this.event({ kind: "throw", value: 0, seat: this.current });
      this.event({ kind: "nak" });
      if (this.pending.length) {
        this.phase = "move";
        this.prune();
      } else this.endTurn();
      return true;
    }
    this.throws--;
    this.lastThrow = r;
    if (charm === "later") { // 결과를 다음 내 차례로 미룸 (팀전은 다음 팀 차례)
      this.players[this.team(this.current)].stash.push(r);
      this.say(`${p.name}: ${RESULT_NAMES[r]} · 다음 차례로 미뤄요`, "ability");
      this.event({ kind: "throw", value: r, seat: this.current });
      this.throws = 0;
      this.endTurn();
      return true;
    }
    this.pending.push(r);
    if (charm === "double") this.pending.push(r);
    if (r >= 4) this.throws++; // 윷 · 모는 한 번 더
    this.say(`${p.name}: ${RESULT_NAMES[r]}${r >= 4 ? " · 한 번 더!" : ""}`, r >= 4 ? "good" : "info");
    this.event({ kind: "throw", value: r, seat: this.current });
    if (this.throws === 0) this.phase = "move";
    this.prune();
    return true;
  }

  /** seat가 옮길 수 있는 말의 주인 (팀전이면 같은 팀 말 4개를 누구나 옮김) */
  movers(seat) { return [this.team(seat)]; }
  canUse(seat, r) {
    const ps = this.movers(seat).flatMap((s) => this.players[s].pieces);
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
      // 첫 칸에서 빽도면 출발점(0)에 서고, 골인은 다음에 1칸 이상 더 가야 함
      return this.backOne(piece.node, piece.prev);
    }
    const path = pathFrom(piece.node);
    return r > path.length ? HOME : path[r - 1];
  }

  backOne(node, prev) {
    if (prev !== null && prev !== undefined) return prev === START ? 0 : prev;
    return backDefault(node);
  }

  backPath(node, prev, steps = 1) {
    const path = [];
    for (let i = 0; i < steps; i++) {
      node = this.backOne(node, i === 0 ? prev : null);
      path.push(node);
    }
    return path;
  }

  /** 나온 결과가 있으면 옮길 수 있음 (윷 · 모 뒤에 더 던지기 전에 먼저 옮겨도 됨) */
  move(pieceIdx, resIdx, seed, owner = this.current) {
    if (this.over || !this.pending.length) return false;
    const seat = this.current;
    if (!this.ally(seat, owner)) return false;
    const side = this.team(owner);
    const r = this.pending[resIdx];
    const piece = this.players[side].pieces[pieceIdx];
    if (r === undefined || !piece) return false;
    const dest = this.destOf(piece, r);
    if (dest === null) return false;
    const traversed = r === -1 ? this.backPath(piece.node, piece.prev) : pathFrom(piece.node).slice(0, r);
    this.events = [];
    const stack = piece.node === START ? [piece] : this.stackAt(side, piece.node);
    let prev = null;
    if (r !== -1) {
      const path = pathFrom(piece.node);
      prev = r >= 2 && r <= path.length ? path[r - 2] : piece.node;
    }
    this.pending.splice(resIdx, 1);
    const parts = [[side, stack.length, stack.map((q) => this.players[side].pieces.indexOf(q))]];
    this.event({ kind: "move", seat, from: piece.node, to: dest, count: stack.length, parts, traversed });
    this.land(seat, stack, dest, prev, mulberry(seed), true, traversed);
    this.afterAction();
    return true;
  }

  /** 말 묶음을 칸에 내려놓음: 도착 · 폭탄 · 잡기 · 능력 칸 처리 */
  triggerBomb(seat, stack, node, step = null) {
    if (node === HOME || this.bombs[node] === undefined) return false;
    delete this.bombs[node];
    for (const pc of stack) { pc.node = START; pc.prev = null; }
    this.players[this.team(seat)].captured += stack.length;
    this.say(`펑! ${this.sideName(seat)}의 말이 폭탄을 밟아 출발점으로`, "bad");
    this.event({ kind: "boom", node, step });
    return true;
  }

  land(seat, stack, node, prev, rng, fromMove, traversed = [node]) {
    const p = this.players[seat];
    for (const pc of stack) { pc.node = node; pc.prev = node === HOME ? null : prev; }
    const bombNode = traversed.find((step) => step !== HOME && this.bombs[step] !== undefined);
    if (bombNode !== undefined && this.triggerBomb(seat, stack, bombNode, traversed.indexOf(bombNode))) return;
    if (node === HOME) {
      this.say(`${this.sideName(seat)}의 말 ${stack.length}개 도착!`, "good");
      this.event({ kind: "home", seat, count: stack.length });
      return;
    }
    for (const s of this.sides()) { // 잡기 (같은 팀은 안 잡음)
      if (this.ally(seat, s)) continue;
      const victims = this.players[s].pieces.filter((pc) => pc.node === node && !this.shielded(pc));
      if (victims.length) {
        for (const pc of victims) { pc.node = START; pc.prev = null; }
        this.players[s].captured += victims.length;
        this.say(`${josa(p.name, "이", "가")} ${this.sideName(s)}의 말 ${victims.length}개를 잡았다!${fromMove ? " 한 번 더!" : ""}`, "good");
        this.event({ kind: "catch", seat, victim: s, node, count: victims.length });
        if (fromMove) { this.throws++; this.phase = "throw"; }
      }
    }
  }

  afterAction() {
    for (let s = 0; s < this.n; s++) {
      const mates = this.players.map((_, i) => i).filter((i) => this.ally(s, i));
      if (!this.over && mates.every((i) => this.finished(i) === this.pieceCount)) {
        this.over = true;
        this.winner = s;
        this.winners = mates;
        this.say(this.teams ? `${mates.map((i) => this.players[i].name).join(" · ")} 팀 모든 말 도착! 승리!` : `${this.players[s].name} 모든 말 도착! 승리!`, "good");
        return;
      }
    }
    if (this.throws > 0) this.phase = "throw";
    else if (this.pending.length === 0) this.endTurn();
    else { this.phase = "move"; this.prune(); }
  }

  endTurn() {
    if (this.over) return;
    const left = this.players.filter((p) => !p.resigned).length;
    if (left <= 1) return;
    this.current = this.nextSeat();
    this.turnNo++;
    this.phase = "throw";
    this.throws = 1;
    this.pending = [];
    this.charm = null;
    const side = this.players[this.team(this.current)];
    if (side.stash.length) { // 미뤄 둔 결과를 받음
      this.pending = side.stash;
      side.stash = [];
      this.say(`미뤄 둔 ${this.pending.map((r) => RESULT_NAMES[r]).join(", ")}을(를) 받았어요`, "ability");
    }
    this.usedAbility = false;
  }

  resign(seat) {
    if (this.over || this.players[seat].resigned) return false;
    this.players[seat].resigned = true;
    this.say(`${this.players[seat].name} 기권`, "bad");
    const alive = this.players.map((p, i) => i).filter((i) => !this.players[i].resigned);
    if (this.teams) { // 팀전은 한 사람이라도 기권하면 그 팀이 짐
      this.over = true;
      this.winners = this.players.map((_, i) => i).filter((i) => !this.ally(seat, i));
      this.winner = this.winners[0];
    } else if (alive.length === 1) {
      this.over = true;
      this.winner = alive[0];
      this.winners = [alive[0]];
    } else if (seat === this.current) {
      this.pending = [];
      this.throws = 0;
      this.endTurn();
    }
    return true;
  }

  ranking() {
    const won = (i) => this.winners.includes(i) || i === this.winner;
    return this.players.map((p, i) => i).sort((a, b) =>
      (this.players[a].resigned - this.players[b].resigned) ||
      (won(b) - won(a)) ||
      this.finished(b) - this.finished(a) || this.remainingOf(a) - this.remainingOf(b));
  }

  // ------------------------------------------------------------ 능력
  /** 지금 이 카드를 쓸 수 있는 말이 판에 있는지 (화면에서 미리 알려 주는 용도) */
  abilityReady(id, seat = this.current) {
    const def = ABILITY_BY_ID[id];
    if (!def || this.phase !== "throw" || this.throws <= 0) return false;
    if (def.onlyFresh && this.pending.length) return false;
    const mine = this.players[seat].pieces;
    const hasOwnBoard = mine.some((pc) => onBoard(pc.node));
    const hasOwn = def.allowStart ? mine.some((pc) => pc.node !== HOME) : hasOwnBoard;
    const hasOpp = this.sides().some((s) => !this.ally(seat, s) && !this.players[s].resigned && this.players[s].pieces.some((pc) => onBoard(pc.node) && !this.shielded(pc)));
    if (id === "hitch") return hasOwnBoard && mine.some((pc) => pc.node === START);
    if (id === "flip") return this.allStacks().length > 1;
    if (def.target === "ownPiece") return hasOwn;
    if (def.target === "oppPiece") return hasOpp;
    if (def.target === "swap") return hasOwn && hasOpp;
    return true;
  }

  /** 능력 쓰기: 윷을 던지기 전에, 한 차례에 한 장만. t = { own:idx, opp:{seat, idx}, node } */
  use(handIdx, t, seed) {
    if (this.over || !this.abilitiesOn || this.usedAbility || this.phase !== "throw" || this.throws <= 0) return false;
    const seat = this.current;
    const p = this.players[seat];
    const id = p.hand[handIdx];
    const def = ABILITY_BY_ID[id];
    if (!def || !this.abilityReady(id, seat)) return false;
    const rng = mulberry(seed);
    const oppStack = () => {
      const o = t?.opp;
      if (!o || this.ally(seat, o.seat) || !this.players[o.seat]) return null;
      const pc = this.players[o.seat].pieces[o.idx];
      if (!pc || !onBoard(pc.node) || this.shielded(pc)) return null;
      return { seat: o.seat, stack: this.stackAt(o.seat, pc.node), node: pc.node, prev: pc.prev };
    };
    const ownStack = () => {
      const pc = p.pieces[t?.own];
      if (!pc || pc.node === HOME || (!def.allowStart && !onBoard(pc.node))) return null;
      return pc.node === START ? [pc] : this.stackAt(seat, pc.node);
    };
    // 대상 확인 (잘못된 대상이면 쓰지 않음)
    let opp = null, own = null;
    if (def.target === "oppPiece" || def.target === "swap") {
      opp = oppStack();
      if (!opp) return false;
    }
    if (def.target === "ownPiece" || def.target === "swap") {
      own = ownStack();
      if (!own) return false;
    }
    if (def.target === "node") {
      const nd = t?.node;
      if (!Number.isInteger(nd) || nd < 1 || nd > 28 || this.bombs[nd] !== undefined) return false;
      if (this.players.some((pl) => pl.pieces.some((pc) => pc.node === nd))) return false;
    }

    this.events = [];
    p.hand.splice(handIdx, 1);
    this.usedAbility = true;
    this.say(`${p.name}: 「${def.name}」 ${def.shout}`, "ability");
    this.event({ kind: "ability", seat, id, shout: def.shout });

    switch (id) {
      case "gul3": case "reverse": case "later": case "combo": case "double": case "allin": case "golden":
        this.charm = id;
        break;
      case "extra": this.throws++; break;
      case "callme": { // 내 말 앞 1~3칸 중 내 말이 없는 칸으로
        const ahead = pathFrom(own[0].node).filter((n) => n !== HOME).slice(0, 3);
        const open = ahead.filter((n) => !p.pieces.some((pc) => pc.node === n) && n !== opp.node);
        const spots = open.length ? open : ahead.filter((n) => n !== own[0].node);
        if (spots.length) {
          const node = spots[Math.floor(rng() * spots.length)];
          for (const pc of opp.stack) { pc.node = START; pc.prev = null; }
          this.land(opp.seat, opp.stack, node, null, rng, false, [node]);
        } else this.say("불러올 자리가 없어요");
        break;
      }
      case "hitch": {
        const rider = p.pieces.find((pc) => pc.node === START);
        const carrier = p.pieces[t.own];
        rider.node = carrier.node;
        rider.prev = carrier.prev;
        break;
      }
      case "guard": for (const pc of own) pc.shield = this.turnNo + this.n; break;
      case "tail": {
        const node = this.backOne(opp.node, opp.prev);
        for (const pc of own) { pc.node = START; pc.prev = null; }
        this.land(seat, own, node, null, rng, false, [node]);
        break;
      }
      case "mine": this.bombs[t.node] = seat; break;
      case "flip": {
        const stacks = this.allStacks();
        const nodes = stacks.map((s) => s.node);
        for (let i = nodes.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
        }
        stacks.forEach((s) => { for (const pc of s.pieces) { pc.node = START; pc.prev = null; } });
        stacks.forEach((s, i) => this.land(s.seat, s.pieces, nodes[i], null, rng, false, [nodes[i]]));
        break;
      }
      case "taxi":
        for (const pc of own) { pc.node = START; pc.prev = null; }
        this.land(seat, own, 0, null, rng, false, [0]);
        break;
      case "gohome":
        for (const pc of opp.stack) { pc.node = START; pc.prev = null; }
        this.players[opp.seat].captured += opp.stack.length;
        break;
      case "swapme": {
        const a = own[0].node, b = opp.node;
        for (const pc of [...own, ...opp.stack]) { pc.node = START; pc.prev = null; }
        this.land(seat, own, b, null, rng, false, [b]);
        this.land(opp.seat, opp.stack, a, null, rng, false, [a]);
        break;
      }
      default: break;
    }
    this.afterAction();
    return true;
  }

  allStacks() {
    const out = [];
    for (const s of this.sides()) {
      const seen = new Set();
      for (const pc of this.players[s].pieces) {
        if (!onBoard(pc.node) || seen.has(pc.node)) continue;
        seen.add(pc.node);
        out.push({ seat: s, node: pc.node, pieces: this.stackAt(s, pc.node) });
      }
    }
    return out;
  }
}
