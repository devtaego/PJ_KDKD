// 윷놀이: 초능력 목록 (게임 규칙 코드와 분리 → 이름 · 대사 · 힘만 바꾸면 쉽게 갈아 끼울 수 있음)
//
// kind: yut(윷을 다루는 힘) / piece(말을 다루는 힘)
// power: 1~3 (셀수록 큼). 각자 윷 능력 1장 + 말 능력 1장을 받고, 두 장의 힘 합이 모두 같게 나눔 (POWER_SUM)
// target: 쓸 때 고르는 대상
//   none      바로 발동            ownPiece  내 말(묶음) 하나
//   oppPiece  상대 말(묶음) 하나    node      판의 빈칸 하나
//   swap      내 말 하나 + 상대 말 하나
// allowStart: 아직 안 나간 말도 고를 수 있음 / onlyFresh: 이번 차례에 나온 결과가 없을 때만

export const TIERS = {
  p1: { name: "★", color: "#7BD389" },
  p2: { name: "★★", color: "#4DABF7" },
  p3: { name: "★★★", color: "#FFB547" },
};
export const KINDS = { yut: "윷의 힘", piece: "말의 힘" };

const card = (id, name, kind, power, target, desc, shout, extra = {}) => ({ id, name, kind, power, tier: `p${power}`, target, desc, shout, ...extra });

export const ABILITIES = [
  // ---- 윷의 힘: 다음 던지기를 바꿈
  card("gul3", "뚜벅뚜벅", "yut", 1, "none", "다음 던지기가 무조건 걸", "세 칸만 갈게요"),
  card("reverse", "뒷걸음질", "yut", 1, "none", "다음 던지기가 무조건 빽도 (판 위에 말이 없으면 버려져요)", "뒤로 갈게요~"),
  card("later", "킵해 둘게요", "yut", 1, "none", "이번에 던진 결과를 다음 내 차례로 미루고 차례를 넘김 (낙이면 사라져요)", "이건 다음에!", { onlyFresh: true }),
  card("combo", "도개 세트", "yut", 2, "none", "다음 던지기 대신 도와 개를 모두 받음", "세트로 주세요"),
  card("double", "곱빼기", "yut", 2, "none", "다음 던지기 결과를 두 번 받음 (낙이면 사라져요)", "곱빼기요!"),
  card("allin", "인생 한 방", "yut", 2, "none", "다음 던지기가 모 또는 도 (반반)", "모 아니면 도!"),
  card("golden", "황금 손", "yut", 3, "none", "다음 던지기가 윷 또는 모 (반반)", "손에서 빛이 난다"),
  card("extra", "한 번만 더", "yut", 3, "none", "이번 차례에 윷을 한 번 더 던짐", "한 번만 더!"),

  // ---- 말의 힘: 판 위 말을 움직임
  card("callme", "이리 와 봐", "piece", 1, "swap", "상대 말 하나를 내 말 앞 1~3칸으로 불러옴", "이리 와 봐~"),
  card("hitch", "슬쩍 얹혀가기", "piece", 1, "ownPiece", "판 위 내 말에 아직 안 나간 말 하나를 업힘", "나도 태워 줘"),
  card("guard", "철벽 방어", "piece", 1, "ownPiece", "이 말은 내 다음 차례까지 잡히지도, 공격받지도 않음", "못 건드려"),
  card("tail", "그림자 밟기", "piece", 2, "swap", "내 말을 상대 말 바로 한 칸 뒤로 옮김", "뒤에 딱 붙었다", { allowStart: true }),
  card("mine", "지뢰 설치", "piece", 2, "node", "빈칸에 지뢰 설치. 지나가거나 멈춘 말은 출발 전으로 (내 말도 예외 없음)", "조심해서 다니세요"),
  card("flip", "판 뒤엎기", "piece", 2, "none", "판 위 모든 말의 자리를 무작위로 섞음", "다 같이 망하자!"),
  card("taxi", "집 앞 택시", "piece", 3, "ownPiece", "내 말을 출발 칸으로 옮김 (한 칸만 더 가면 골인)", "기사님 집으로요", { allowStart: true }),
  card("gohome", "귀가 조치", "piece", 3, "oppPiece", "상대 말 하나(업힌 말 포함)를 출발 전으로 돌려보냄", "집에 가세요"),
  card("swapme", "자리 좀 바꿔요", "piece", 3, "swap", "내 말 하나와 상대 말 하나의 자리를 바꿈", "거기 제 자리인데요"),
];

export const ABILITY_BY_ID = Object.fromEntries(ABILITIES.map((a) => [a.id, a]));

export const POWER_SUM = 4; // 한 사람이 받는 두 장의 힘 합 (1+3, 2+2, 3+1)
export const HAND_SIZE = 2;

/** count명에게 나눠 줄 카드. 모두 윷의 힘 1장 + 말의 힘 1장이고 힘 합이 같음. 되도록 겹치지 않게 뽑음 */
export function dealPowers(count, rng) {
  const shuffled = (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const yutPool = shuffled(ABILITIES.filter((a) => a.kind === "yut"));
  const piecePool = shuffled(ABILITIES.filter((a) => a.kind === "piece"));
  const usedPiece = new Set();
  return Array.from({ length: count }, (_, i) => {
    const y = yutPool[i % yutPool.length];
    const fits = piecePool.filter((a) => a.power === POWER_SUM - y.power);
    const p = fits.find((a) => !usedPiece.has(a.id)) || fits[0];
    usedPiece.add(p.id);
    return [y.id, p.id];
  });
}

// 가중치 기반 가상 결과 확률. 실제 윷가락 조합 확률을 그대로 계산하는 방식은 아님.
export const THROW_ODDS = [
  // 낙은 온라인 보드에서 가상으로 적용하는 게임 규칙 확률(3%).
  // 제안된 6개 결과 비율(빽도·도·개·걸·윷·모 = 8:22:32:22:8:8)을
  // 낙 3%를 제외한 97% 안에 비례 배분한다.
  { v: 0, name: "낙", p: 0.03 },
  { v: -1, name: "빽도", p: 0.0776 },
  { v: 1, name: "도", p: 0.2134 },
  { v: 2, name: "개", p: 0.3104 },
  { v: 3, name: "걸", p: 0.2134 },
  { v: 4, name: "윷", p: 0.0776 },
  { v: 5, name: "모", p: 0.0776 },
];
