// 칭호 목록: 이모지 · 이름 · 효과(fx: style.css 의 .fx-…) · 얻는 방법. 새 칭호는 여기와 web/server.py 의 TITLE_IDS에 함께 추가
// 코드로 받는 칭호의 코드는 서버에 해시로만 있음 (화면 코드에는 없음). 연승 칭호는 온라인 방에서 이기면 서버가 줌
import { esc } from "../art.js";

// group: 칭호 목록에서 묶는 이름. how: 얻는 방법 (얻기 전에는 화면에 ???로 보임)
// fx는 어려운 정도에 맞춤 (style.css): 1 stone / 2 moss·slate·clay / 3 ice·jade·dice·kda / 4 gold·royal·neon / 5 legend·cosmic
export const TITLES = {
  dev: { emoji: "🛠️", name: "DEV", fx: "fx-dev", hidden: true }, // 칭호 목록에 안 나옴. 코드를 넣은 사람만 달 수 있음

  first_game: { emoji: "🪑", name: "일단 앉아봄", fx: "fx-stone", group: "첫걸음", how: "온라인 첫 판" },
  first_win: { emoji: "🌱", name: "쑥쑥새싹", fx: "fx-moss", group: "첫걸음", how: "온라인 첫 승" },
  kda: { emoji: "🎓", name: "KDA", fx: "fx-kda", group: "첫걸음", how: "코드 입력" },

  chess_s2: { emoji: "♟️", name: "폰 그 자체", fx: "fx-stone", group: "체스", how: "2연승" },
  chess_s3: { emoji: "🐴", name: "말 좀 타네", fx: "fx-slate", group: "체스", how: "3연승" },
  chess_s5: { emoji: "🏰", name: "룩 앤 롤", fx: "fx-ice", group: "체스", how: "5연승" },
  chess_s7: { emoji: "👸", name: "퀸의 품격", fx: "fx-royal", group: "체스", how: "7연승" },
  chess_s10: { emoji: "👑", name: "THE KING", fx: "fx-legend", group: "체스", how: "10연승" },

  omok_s2: { emoji: "🙏", name: "한수요", fx: "fx-stone", group: "오목", how: "2연승" },
  omok_s3: { emoji: "⚫", name: "돌 좀 놓는 편", fx: "fx-slate", group: "오목", how: "3연승" },
  omok_s5: { emoji: "🧐", name: "복기 장인", fx: "fx-jade", group: "오목", how: "5연승" },
  omok_s7: { emoji: "🧙", name: "오목 사범", fx: "fx-neon", group: "오목", how: "7연승" },
  omok_s10: { emoji: "🤖", name: "알파고", fx: "fx-cosmic", group: "오목", how: "10연승" },

  yacht_s2: { emoji: "🎲", name: "D1C3", fx: "fx-stone", group: "야추", how: "2연승" },
  yacht_s3: { emoji: "🍀", name: "주사위가 내 편", fx: "fx-moss", group: "야추", how: "3연승" },
  yacht_s5: { emoji: "🎰", name: "도박사", fx: "fx-dice", group: "야추", how: "5연승" },
  yacht_s7: { emoji: "🕶️", name: "확률 조작단", fx: "fx-gold", group: "야추", how: "7연승" },
  yacht_s10: { emoji: "🪐", name: "주사위의 신", fx: "fx-cosmic", group: "야추", how: "10연승" },

  yut_win: { emoji: "🐷", name: "도 닦는 중", fx: "fx-stone", group: "윷놀이", how: "첫 우승" },
  yut_s2: { emoji: "🐶", name: "개이득", fx: "fx-stone", group: "윷놀이", how: "2연승" },
  yut_chaos: { emoji: "🎬", name: "막장 드라마", fx: "fx-clay", group: "윷놀이", how: "막장 모드 우승" },
  yut_team: { emoji: "🤜", name: "환상의 짝꿍", fx: "fx-moss", group: "윷놀이", how: "팀전 우승" },
  yut_s3: { emoji: "🐑", name: "걸작", fx: "fx-clay", group: "윷놀이", how: "3연승" },
  yut_s5: { emoji: "🐮", name: "윷이 손에 붙음", fx: "fx-jade", group: "윷놀이", how: "5연승" },
  yut_s7: { emoji: "🏇", name: "모 아니면 우승", fx: "fx-gold", group: "윷놀이", how: "7연승" },
  yut_s10: { emoji: "🏆", name: "윷판 지배자", fx: "fx-legend", group: "윷놀이", how: "10연승" },

  spectator: { emoji: "🍿", name: "팝콘 각", fx: "fx-stone", group: "별난 기록", how: "관전하다 판이 끝남" },
  draw: { emoji: "🤝", name: "사이좋게 무승부", fx: "fx-stone", group: "별난 기록", how: "무승부" },
  teabag: { emoji: "🍑", name: "매너 실종", fx: "fx-stone", group: "별난 기록", how: "승리 후 티배깅" },
  fast_win: { emoji: "⚡", name: "번개 승부", fx: "fx-clay", group: "별난 기록", how: "1분 안에 승리" },
  long_win: { emoji: "🧘", name: "엉덩이 장인", fx: "fx-slate", group: "별난 기록", how: "20분 넘는 판 승리" },
  night_win: { emoji: "🦉", name: "야행성 고수", fx: "fx-slate", group: "별난 기록", how: "밤 11시~오전 6시 승리" },
  teabag3: { emoji: "😈", name: "티배깅 장인", fx: "fx-clay", group: "별난 기록", how: "승리 후 티배깅 3판" },
  comeback: { emoji: "🔥", name: "역전의 명수", fx: "fx-neon", group: "별난 기록", how: "3연패 뒤 승리" },

  q_about: { emoji: "📖", name: "기획서 정독", fx: "fx-stone", group: "숨은 재미", how: "게임 기획 의도 열어 보기" },
  q_rules: { emoji: "🧑‍⚖️", name: "규칙 변호사", fx: "fx-moss", group: "숨은 재미", how: "네 게임 규칙 모두 보기" },
  q_theme: { emoji: "🎨", name: "인테리어 업자", fx: "fx-clay", group: "숨은 재미", how: "기기 테마 전부 써 보기" },
  q_wrong: { emoji: "🔑", name: "찍기 장인", fx: "fx-slate", group: "숨은 재미", how: "틀린 칭호 코드 5번 입력 (접속 중)" },
  q_nick: { emoji: "🎭", name: "신분 세탁", fx: "fx-slate", group: "숨은 재미", how: "닉네임 10번 바꾸기" },
  q_sound: { emoji: "🔇", name: "음소거 장인", fx: "fx-clay", group: "숨은 재미", how: "소리 버튼 20번 누르기" },
  q_flip: { emoji: "🌀", name: "멀미왕", fx: "fx-dice", group: "숨은 재미", how: "체스판 20번 돌리기" },
  q_logo: { emoji: "👆", name: "로고 덕후", fx: "fx-jade", group: "숨은 재미", how: "로고 30번 누르기" },
  q_tap: { emoji: "🖱️", name: "손가락 장인", fx: "fx-gold", group: "숨은 재미", how: "칭호 목록을 100번 누르기" },

  lose_3: { emoji: "🫠", name: "오늘은 아닌가 봐", fx: "fx-stone", group: "패배의 전당", how: "3연패" },
  lose_5: { emoji: "🧂", name: "짠맛 전문가", fx: "fx-slate", group: "패배의 전당", how: "5연패" },
  lose_10: { emoji: "🥊", name: "인간 샌드백", fx: "fx-dice", group: "패배의 전당", how: "10연패" },
};

/** 칭호 뱃지 HTML (모르는 칭호면 빈칸) */
export const titleBadge = (id) => (TITLES[id] ? `<span class="title-badge ${TITLES[id].fx}">${TITLES[id].emoji} ${esc(TITLES[id].name)}</span>` : "");
/** 이름에 입힐 효과 클래스 */
export const titleFx = (id) => (TITLES[id] ? `name-fx ${TITLES[id].fx}` : "");

// 운영자인 척할 수 있는 닉네임은 막음 (DEV 칭호가 있는 사람만 예외, 서버도 같은 목록으로 확인)
const RESERVED = new Set(["개발자", "관리자", "운영자", "운영진", "dev", "admin", "administrator", "gm", "시스템", "system", "공지"]);
export const isReservedName = (name) => RESERVED.has(String(name || "").replace(/\s+/g, "").toLowerCase());
