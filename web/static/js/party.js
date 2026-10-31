// 게임이 끝난 뒤의 재미 요소 데이터 (hub/party.py 와 같은 문구)
export const WIN_LINES = ["ㅋㅋ 이게 실력이지", "다음엔 연습 좀 해 와~", "GG! 너무 쉬웠다", "1등 자리 따뜻하다~",
  "한 판 더? 또 이길 건데", "내가 좀 하지?", "박수 쳐 줘 짝짝짝", "오늘 감 좋네 ㅎㅎ"];
export const LOSE_LINES = ["운빨이잖아!!", "한 판 더 해!", "인정... 잘했다 ㅠ", "다음엔 내가 이긴다", "봐준 거야 진짜로",
  "GG... 분하다", "방금 건 연습 경기", "복수한다 기다려라"];
export const DRAW_LINES = ["무승부 ㅋㅋ 다시!", "막상막하네", "이건 인정이지", "한 판 더 해서 끝장 보자"];
export const TAUNTS = ["ㅋㅋㅋㅋㅋ", "킹받쥬?", "약오르지~", "-100 자존심", "ㅎㅎ 앉았다 일어났다"];
export const QUESTIONS = [
  "요즘 제일 빠져 있는 것은?", "최애 점심 메뉴는?", "MBTI가 뭐예요?", "주말에 주로 뭐 해요?",
  "인생 영화 / 드라마 하나만!", "요즘 자주 듣는 노래는?", "가장 가 보고 싶은 여행지는?", "어릴 때 꿈은?",
  "나만의 스트레스 해소법은?", "아침형 인간? 저녁형 인간?", "부먹? 찍먹?", "민초파? 반민초파?",
  "최근에 산 것 중 제일 만족한 것은?", "자신 있는 요리 하나는?", "제일 좋아하는 계절과 이유는?",
  "수업 끝나고 제일 하고 싶은 것은?", "개발자가 된다면 만들고 싶은 서비스는?", "숨겨진 특기가 있다면?",
  "커피파? 차파? 음료파?", "고양이파? 강아지파?", "요즘 배우고 싶은 것은?", "최근에 웃겼던 일 하나!",
  "가장 좋아하는 간식은?", "로또 1등 되면 제일 먼저 할 일은?", "올해 꼭 이루고 싶은 것 하나는?",
  "나를 동물로 표현하면?", "추천하고 싶은 유튜브 채널은?", "여기 오기 전에 뭐 했어요?",
];
export const CHAT_AI_TEXTS = ["ㅋㅋㅋ", "집중해!", "오~ 좀 하네", "나도 질 수 없지", "긴장된다...", "ㅎㅎ"];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 모든 기기에서 똑같이 나오도록 같은 재료(이름들, 수 개수)로 질문을 고름 (party.question_for 와 같은 결과) */
export function questionFor(...keys) {
  const s = keys.map(String).sort().join("|");
  return QUESTIONS[crc32(new TextEncoder().encode(s)) % QUESTIONS.length];
}

const sample = (arr, n) => arr.slice().sort(() => Math.random() - 0.5).slice(0, n);
export const pickLines = (kind, n = 4) => sample(kind === "win" ? WIN_LINES : kind === "lose" ? LOSE_LINES : DRAW_LINES, n);
export const replyLine = (kind) => pickLines(kind, 1)[0];
export const randomOf = (arr) => arr[Math.floor(Math.random() * arr.length)];
