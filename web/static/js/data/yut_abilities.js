// 윷놀이: 능력 목록과 나올 확률 (게임 규칙 코드와 분리 → 이름 · 대사 · 확률만 바꾸면 다음 기수 유행어로 갈아 끼울 수 있음)
//
// tier: normal(일반) / rare(희귀) / legend(전설)
// weight: 모드별 뽑힐 무게. 확률 = 이 능력의 무게 / 그 모드의 전체 무게 (아래 abilityOdds 로 계산해서 화면에 보여 줌)
// target: 쓸 때 고르는 대상
//   none      바로 발동            nextPlayer 다음 차례 사람에게
//   ownPiece  내 말(묶음) 하나      oppPiece   상대 말(묶음) 하나
//   node      판의 빈칸 하나        swap       내 말 하나 + 상대 말 하나
// guard: true 면 '어쩔티비'로 막을 수 있는 공격

export const TIERS = {
  normal: { name: "일반", color: "#7BD389" },
  rare: { name: "희귀", color: "#4DABF7" },
  legend: { name: "전설", color: "#FFB547" },
};

export const ABILITIES = [
  // ---- 일반
  { id: "kingbat", name: "킹받쥬", tier: "normal", target: "oppPiece", guard: true,
    desc: "상대 말 하나를 1칸 뒤로", shout: "킹받쥬?", weight: { special: 12, chaos: 9 } },
  { id: "lucky", name: "럭키비키", tier: "normal", target: "none",
    desc: "다음 던지기가 빽도 · 도면 '개'로 바뀜", shout: "오히려 좋아~", weight: { special: 12, chaos: 8 } },
  { id: "godlife", name: "갓생 모드", tier: "normal", target: "ownPiece",
    desc: "이 말은 내 다음 차례까지 잡히지도, 공격받지도 않음", shout: "갓생 산다", weight: { special: 12, chaos: 8 } },
  { id: "twist", name: "손가락 꼬임", tier: "normal", target: "nextPlayer", guard: true,
    desc: "다음 사람의 다음 던지기가 한 단계 나빠짐 (모→윷→걸→개→도→빽도)", shout: "손이 미끄러졌네?", weight: { special: 12, chaos: 8 } },
  { id: "hodl", name: "존버", tier: "normal", target: "none", onlyFresh: true,
    desc: "이번 차례를 바로 쉬는 대신, 다음 던지기가 두 단계 좋아짐", shout: "존버는 승리한다", weight: { special: 10, chaos: 6 } },
  { id: "upside", name: "화면 거꾸로", tier: "normal", target: "nextPlayer", guard: true,
    desc: "다음 사람 차례 동안 그 사람 화면의 판이 뒤집혀 보임 (효과는 없음, 정신만 나감)", shout: "어지럽지?", weight: { special: 8, chaos: 8 } },

  // ---- 희귀
  { id: "missile", name: "킹받쥬 미사일", tier: "rare", target: "none", guard: true,
    desc: "가장 앞서 있는 상대 말을 자동으로 찾아 3칸 뒤로", shout: "1등 저격!", weight: { special: 5, chaos: 7 } },
  { id: "bomb", name: "스불재 폭탄", tier: "rare", target: "node",
    desc: "빈칸에 폭탄 설치. 그 칸에 도착하거나 지나친 말은 출발점으로 (내 말도 예외 없음)", shout: "스스로 불러온 재앙~", weight: { special: 5, chaos: 7 } },
  { id: "eojjeol", name: "어쩔티비", tier: "rare", target: "none",
    desc: "다음에 나를 노리는 공격 하나를 막고, 그 능력을 빼앗아 옴", shout: "어쩔티비~", weight: { special: 5, chaos: 6 } },
  { id: "isthisright", name: "이게 맞아?", tier: "rare", target: "swap", guard: true,
    desc: "내 말 하나와 상대 말 하나의 자리를 통째로 바꿈", shout: "이게 맞아?", weight: { special: 4, chaos: 6 } },
  { id: "gazua", name: "가즈아", tier: "rare", target: "ownPiece",
    desc: "동전 던지기! 앞면이면 이 말이 5칸 전진, 뒷면이면 출발점으로", shout: "가즈아!!!", weight: { special: 4, chaos: 6 } },
  { id: "darkmode", name: "흑화", tier: "rare", target: "oppPiece", guard: true,
    desc: "이번 판에 내 말이 잡힌 횟수만큼 (1~5칸) 상대 말을 뒤로", shout: "참을 만큼 참았다", weight: { special: 4, chaos: 6 } },
  { id: "yeongkkeul", name: "영끌", tier: "rare", target: "ownPiece",
    desc: "들고 있는 다른 능력을 모두 버리고, 버린 수 × 3칸만큼 이 말이 전진", shout: "영혼까지 끌어모아!", weight: { special: 3, chaos: 5 } },

  // ---- 전설 (막장 모드에서만)
  { id: "party", name: "대환장 파티", tier: "legend", target: "none",
    desc: "판 위의 모든 말 위치를 무작위로 섞음", shout: "대환장 파티!!", weight: { special: 0, chaos: 3 } },
  { id: "quake", name: "지진 났다", tier: "legend", target: "none",
    desc: "판 위의 모든 말이 1~3칸씩 무작위로 앞으로 미끄러짐", shout: "지진 났다!!", weight: { special: 0, chaos: 3 } },
  { id: "assemble", name: "전원 집합", tier: "legend", target: "none",
    desc: "판 위의 모든 말을 한가운데 칸으로 소환", shout: "전원 집합!!", weight: { special: 0, chaos: 3 } },
  { id: "roulette", name: "러시안 윷렛", tier: "legend", target: "none",
    desc: "모두 한 번씩 던져서 가장 낮게 나온 사람의 제일 앞선 말이 출발점으로 (나도 예외 없음)", shout: "러시안 윷렛!!", weight: { special: 0, chaos: 3 } },
  { id: "dopamine", name: "도파민 중독", tier: "legend", target: "none",
    desc: "지금부터 한 바퀴 동안 모두가 차례마다 윷을 두 번씩 던짐", shout: "도파민 풀충전!!", weight: { special: 0, chaos: 3 } },
];

export const ABILITY_BY_ID = Object.fromEntries(ABILITIES.map((a) => [a.id, a]));

/** 모드별 능력 확률(%) 목록. mode: special / chaos */
export function abilityOdds(mode) {
  const total = ABILITIES.reduce((s, a) => s + (a.weight[mode] || 0), 0);
  return ABILITIES.filter((a) => a.weight[mode] > 0).map((a) => ({ ...a, pct: (a.weight[mode] / total) * 100 }));
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

// 능력 카드는 게임을 시작할 때 한 번만 나눠 받음 (판 위에 카드 칸은 없음)
export const START_HAND = { special: 3, chaos: 4 };
