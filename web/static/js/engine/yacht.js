// 야추 다이스 규칙 + 컴퓨터 (yacht/yacht_game.py 의 YachtGame, ai_* 를 그대로 옮김)
export const MAX_PLAYERS = 6;
export const UPPER = ["ones", "twos", "threes", "fours", "fives", "sixes"];
export const LOWER = ["choice", "four", "full", "sstraight", "lstraight", "yacht"];
export const CATEGORIES = UPPER.concat(LOWER);
export const CAT_NAMES = {
  ones: "에이스", twos: "듀스", threes: "트레이", fours: "포", fives: "파이브", sixes: "식스",
  choice: "초이스", four: "포 카인드", full: "풀 하우스", sstraight: "S. 스트레이트", lstraight: "L. 스트레이트", yacht: "야추",
};
export const CAT_HELP = {
  ...Object.fromEntries(UPPER.map((c, i) => [c, `${i + 1}이(가) 나온 주사위 눈의 합`])),
  choice: "주사위 5개 눈의 합",
  four: "같은 눈이 4개 이상일 때, 그 4개의 합",
  full: "같은 눈 3개 + 같은 눈 2개일 때, 5개의 합",
  sstraight: "연속된 숫자 4개 (예: 1-2-3-4) → 15점",
  lstraight: "연속된 숫자 5개 (1-2-3-4-5 또는 2-3-4-5-6) → 30점",
  yacht: "5개 모두 같은 눈 → 50점",
};
export const BONUS_NEED = 63, BONUS = 35;

export function score(cat, dice) {
  const counts = [1, 2, 3, 4, 5, 6].map((v) => dice.filter((d) => d === v).length);
  const faces = new Set(dice);
  const sum = dice.reduce((a, b) => a + b, 0);
  if (UPPER.includes(cat)) {
    const face = UPPER.indexOf(cat) + 1;
    return face * counts[face - 1];
  }
  switch (cat) {
    case "choice": return sum;
    case "four": for (let f = 1; f <= 6; f++) if (counts[f - 1] >= 4) return f * 4; return 0;
    case "full": return counts.filter((c) => c).sort().join() === "2,3" ? sum : 0;
    case "sstraight": return [[1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]].some((run) => run.every((v) => faces.has(v))) ? 15 : 0;
    case "lstraight": return faces.size === 5 && (!faces.has(1) || !faces.has(6)) ? 30 : 0;
    case "yacht": return Math.max(...counts) === 5 ? 50 : 0;
  }
  throw new Error(cat);
}

export const rollDie = () => 1 + Math.floor(Math.random() * 6);

export class YachtGame {
  constructor(names = [], ai = []) {
    this.players = names.map((n, i) => ({ name: n, scores: {}, ai: ai.includes(i), resigned: false }));
    this.current = 0;
    this.dice = [1, 1, 1, 1, 1];
    this.held = [false, false, false, false, false];
    this.rollsLeft = 3;
    this.rollId = 0;
    this.over = false;
  }

  get rolled() { return this.rollsLeft < 3; }
  get round() { return Math.min(Object.keys(this.players[this.current].scores).length + 1, 12); }

  /** values: 굴린 결과 5개 (고정된 주사위 자리는 무시). 네트워크에선 굴린 사람이 정한 값을 모두 똑같이 씀 */
  roll(values) {
    if (this.over || this.rollsLeft === 0) return false;
    for (let i = 0; i < 5; i++) if (!this.held[i]) this.dice[i] = values ? values[i] : rollDie();
    this.rollsLeft--;
    this.rollId++;
    return true;
  }

  toggle(i) {
    if (this.over || !this.rolled || this.rollsLeft === 0) return false;
    this.held[i] = !this.held[i];
    return true;
  }

  record(cat) {
    const scores = this.players[this.current].scores;
    if (this.over || !this.rolled || cat in scores || !CATEGORIES.includes(cat)) return false;
    scores[cat] = score(cat, this.dice);
    this.held = [false, false, false, false, false];
    this.rollsLeft = 3;
    this.advance();
    return true;
  }

  active() { return this.players.map((p, i) => i).filter((i) => !this.players[i].resigned); }

  advance() {
    const act = this.active();
    const humans = act.filter((i) => !this.players[i].ai);
    if (act.length <= 1 || (!humans.length && act.length < this.players.length) ||
        act.every((i) => Object.keys(this.players[i].scores).length === CATEGORIES.length)) {
      this.over = true;
      return;
    }
    const n = this.players.length;
    let nxt = (this.current + 1) % n;
    while (this.players[nxt].resigned) nxt = (nxt + 1) % n;
    this.current = nxt;
  }

  resign(seat) {
    if (this.over || seat < 0 || seat >= this.players.length || this.players[seat].resigned) return false;
    this.players[seat].resigned = true;
    if (seat === this.current) {
      this.held = [false, false, false, false, false];
      this.rollsLeft = 3;
    }
    if (seat === this.current || this.active().length <= 1) this.advance();
    else if (!this.active().some((i) => !this.players[i].ai)) this.over = true;
    return true;
  }

  static upperSum(p) { return UPPER.reduce((a, c) => a + (p.scores[c] || 0), 0); }
  bonus(p) { return YachtGame.upperSum(p) >= BONUS_NEED ? BONUS : 0; }
  total(p) { return Object.values(p.scores).reduce((a, b) => a + b, 0) + this.bonus(p); }

  ranking() {
    return this.players.map((p, i) => i).sort((a, b) => {
      const ra = this.players[a].resigned ? 1 : 0, rb = this.players[b].resigned ? 1 : 0;
      return ra - rb || this.total(this.players[b]) - this.total(this.players[a]);
    });
  }
}

const AI_BASE = { ones: 2, twos: 5, threes: 8, fours: 11, fives: 14, sixes: 17, choice: 21, four: 9, full: 12, sstraight: 10, lstraight: 8, yacht: 4 };

export function aiPickCategory(game, level = "normal") {
  const p = game.players[game.current];
  const open = CATEGORIES.filter((c) => !(c in p.scores));
  const utility = (c) => {
    let u = score(c, game.dice) - AI_BASE[c];
    if (UPPER.includes(c) && YachtGame.upperSum(p) < BONUS_NEED) {
      const face = UPPER.indexOf(c) + 1;
      u += (game.dice.filter((d) => d === face).length - 3) * face * 0.5;
    }
    return u;
  };
  const ranked = open.slice().sort((a, b) => utility(b) - utility(a));
  if (level === "easy" && ranked.length > 1 && Math.random() < 0.45) {
    const pool = ranked.slice(1, 4);
    return pool[Math.floor(Math.random() * pool.length)];
  }
  if (level === "normal" && ranked.length > 1 && Math.random() < 0.12) return ranked[1];
  return ranked[0];
}

export function aiShouldStop(game) {
  const p = game.players[game.current].scores;
  const good = ["yacht", "lstraight", "full", "four"].filter((c) => !(c in p) && score(c, game.dice) > 0);
  if (!("sstraight" in p) && "lstraight" in p && score("sstraight", game.dice) > 0) good.push("sstraight");
  return good.length > 0;
}

export function aiHolds(game) {
  const d = game.dice;
  const p = game.players[game.current].scores;
  const faces = new Set(d);
  const count = (v) => d.filter((x) => x === v).length;
  if (!("lstraight" in p) || !("sstraight" in p)) {
    for (const run of [[2, 3, 4, 5], [3, 4, 5, 6], [1, 2, 3, 4]]) {
      const hit = run.filter((v) => faces.has(v)).length;
      if (hit >= 4 || (hit === 3 && Math.max(...d.map(count)) < 2)) {
        const used = new Set();
        return d.map((v) => {
          if (run.includes(v) && !used.has(v)) { used.add(v); return true; }
          return false;
        });
      }
    }
  }
  const best = [...faces].sort((a, b) => count(b) - count(a) || b - a)[0];
  if (count(best) === 1) return "choice" in p ? d.map(() => false) : d.map((v) => v >= 5);
  return d.map((v) => v === best);
}
