// 윷놀이 말 캐릭터: 굵은 테두리 + 단색 + 점 눈 + 볼터치의 통통한 동물 8종 (모두 코드로 직접 그림)
// charSvg(id): 발끝이 (0, 0), 키는 약 20 (판 좌표). 받침(자리 색)은 윷판 쪽에서 그림
export const CHARACTERS = [
  { id: "penguin", name: "펭귄" }, { id: "tiger", name: "호랑이" }, { id: "rabbit", name: "토끼" }, { id: "frog", name: "개구리" },
  { id: "bear", name: "곰" }, { id: "cat", name: "고양이" }, { id: "chick", name: "병아리" }, { id: "fox", name: "여우" },
];
export const CHAR_IDS = new Set(CHARACTERS.map((c) => c.id));

const INK = "#2B2B2B";
const O = `stroke="${INK}" stroke-width="0.75" stroke-linejoin="round" stroke-linecap="round"`;
// 머리와 몸이 하나인 통통한 몸
const BODY = "M0 -19.5 C6.4 -19.5 7.4 -13.5 6.9 -9 C7.6 -3.6 5.6 -0.8 0 -0.8 C-5.6 -0.8 -7.6 -3.6 -6.9 -9 C-7.4 -13.5 -6.4 -19.5 0 -19.5Z";
const both = (fn) => fn(-1) + fn(1);

const arms = (c) => both((s) => `<ellipse cx="${s * 6.7}" cy="-10.4" rx="1.8" ry="3.4" fill="${c}" ${O} transform="rotate(${s * 40} ${s * 6.7} -10.4)"/>`);
const feet = (c) => both((s) => `<ellipse cx="${s * 2.7}" cy="-0.7" rx="2.1" ry="1.1" fill="${c}" ${O}/>`);
const belly = (c, cy = -5.8, rx = 4.3, ry = 4.4) => `<ellipse cy="${cy}" rx="${rx}" ry="${ry}" fill="${c}"/>`;
const eyes = (y = -12.6, dx = 2.3) => both((s) => `<ellipse cx="${s * dx}" cy="${y}" rx="0.75" ry="0.95" fill="${INK}"/>`);
const cheeks = (y = -10.8, dx = 3.9) => both((s) => `<ellipse cx="${s * dx}" cy="${y}" rx="1.1" ry="0.7" fill="#FF9AA2" opacity="0.85"/>`);
const mouth = (y = -10.2) => `<path d="M-0.8 ${y} q0.4 0.5 0.8 0 q0.4 0.5 0.8 0" fill="none" ${O} stroke-width="0.5"/>`;
const nose = (c, y = -11.1) => `<ellipse cy="${y}" rx="0.75" ry="0.5" fill="${c}"/>`;
const beak = (y = -11) => `<ellipse cy="${y}" rx="1.4" ry="0.85" fill="#FFB347" ${O} stroke-width="0.6"/>`;
const body = (c) => `<path d="${BODY}" fill="${c}" ${O}/>`;

const DRAW = {
  penguin: () => [
    arms("#4A4E57"), feet("#FFB347"), body("#4A4E57"),
    `<path d="M0 -16.6 C2.6 -17.6 5.3 -16 5.3 -12.4 C6.1 -8 5.6 -2.2 0 -1.8 C-5.6 -2.2 -6.1 -8 -5.3 -12.4 C-5.3 -16 -2.6 -17.6 0 -16.6Z" fill="#FFF8E7"/>`,
    eyes(), cheeks(), beak(),
  ],
  tiger: () => [
    both((s) => `<circle cx="${s * 4.6}" cy="-17.4" r="1.9" fill="#FFA43A" ${O}/><circle cx="${s * 4.6}" cy="-17.4" r="0.85" fill="#FFD9C0"/>`),
    arms("#FFA43A"), feet("#FFA43A"), body("#FFA43A"), belly("#FFF3E0"),
    `<path d="M0 -19.4 v2 M-2.1 -19 l0.6 1.6 M2.1 -19 l-0.6 1.6 M-7 -7.4 h1.7 M-6.9 -5 h1.4 M7 -7.4 h-1.7 M6.9 -5 h-1.4" fill="none" ${O}/>`,
    `<ellipse cy="-10.6" rx="2.1" ry="1.4" fill="#FFF3E0"/>`, eyes(), cheeks(), nose(INK, -11.3), mouth(),
  ],
  rabbit: () => [
    both((s) => `<ellipse cx="${s * 2.3}" cy="-21.4" rx="1.6" ry="4.3" fill="#FFFFFF" ${O} transform="rotate(${s * 8} ${s * 2.3} -21.4)"/><ellipse cx="${s * 2.3}" cy="-21" rx="0.7" ry="3" fill="#FFC2D1" transform="rotate(${s * 8} ${s * 2.3} -21)"/>`),
    arms("#FFFFFF"), feet("#FFFFFF"), body("#FFFFFF"), belly("#FFEFF3"), eyes(), cheeks(), nose("#FF8FAB", -11.2), mouth(),
  ],
  frog: () => [
    arms("#8BD86F"), feet("#8BD86F"), body("#8BD86F"), belly("#E4F7C8"),
    both((s) => `<circle cx="${s * 3}" cy="-18" r="2.5" fill="#8BD86F" ${O}/><circle cx="${s * 3}" cy="-18" r="1.5" fill="#FFFFFF"/><ellipse cx="${s * 3}" cy="-17.8" rx="0.7" ry="0.9" fill="${INK}"/>`),
    `<path d="M-2.6 -12 q2.6 2.2 5.2 0" fill="none" ${O} stroke-width="0.6"/>`, cheeks(-11.8, 4),
  ],
  bear: () => [
    both((s) => `<circle cx="${s * 4.8}" cy="-17.6" r="2" fill="#A8734A" ${O}/><circle cx="${s * 4.8}" cy="-17.6" r="0.9" fill="#E8C9A8"/>`),
    arms("#A8734A"), feet("#A8734A"), body("#A8734A"), belly("#E8C9A8"),
    `<ellipse cy="-10.7" rx="2.3" ry="1.6" fill="#E8C9A8"/>`, eyes(-13), cheeks(-11.2, 4), nose(INK, -11.3), mouth(-10.1),
  ],
  cat: () => [
    both((s) => `<path d="M${s * 5.9} -15.2 L${s * 5.2} -21 L${s * 1.9} -18.6Z" fill="#C9CED8" ${O}/><path d="M${s * 5} -17.2 L${s * 4.8} -19.6 L${s * 3.2} -18.6Z" fill="#FFC2D1"/>`),
    arms("#C9CED8"), feet("#C9CED8"), body("#C9CED8"), belly("#FFFFFF"),
    `<path d="M-1.4 -19.2 l0.5 1.4 M0 -19.5 v1.5 M1.4 -19.2 l-0.5 1.4" fill="none" ${O} stroke-width="0.55"/>`,
    both((s) => `<path d="M${s * 4.4} -11.6 h${s * 2.4} M${s * 4.4} -10.6 l${s * 2.2} 0.6" fill="none" ${O} stroke-width="0.45"/>`),
    eyes(), cheeks(-10.6, 3.6), `<path d="M-0.6 -11.6 h1.2 l-0.6 0.7z" fill="#FF8FAB"/>`, mouth(-10.6),
  ],
  chick: () => [
    `<path d="M-0.4 -19.2 q-1.6 -2.4 0.2 -3 q0.6 1.2 0.2 3 q1.2 -2.2 2.4 -1.6 q-0.6 1.4 -2.4 1.8" fill="#FFD84D" ${O} stroke-width="0.6"/>`,
    arms("#FFD84D"), feet("#FFB347"), body("#FFD84D"), belly("#FFF0A8"), eyes(), cheeks(), beak(-10.9),
  ],
  fox: () => [
    `<path d="M4.6 -4 C10.6 -6 12.4 -12.6 9.4 -15.4 C8.6 -11.6 6.6 -8.6 3.6 -7.6Z" fill="#FF9A4D" ${O}/><path d="M9.4 -15.4 C10.6 -14.2 11 -12.6 10.6 -11.2 C9.8 -12 9.2 -13.2 9.4 -15.4Z" fill="#FFFFFF"/>`,
    both((s) => `<path d="M${s * 6} -15 L${s * 5.6} -21.2 L${s * 2} -18.6Z" fill="#FF9A4D" ${O}/><path d="M${s * 5.1} -17.2 L${s * 5} -19.8 L${s * 3.3} -18.6Z" fill="#5A3519"/>`),
    arms("#FF9A4D"), feet("#5A3519"), body("#FF9A4D"), belly("#FFFFFF"),
    `<path d="M-5.4 -12 Q0 -6.6 5.4 -12 Q2.8 -9.6 0 -9.8 Q-2.8 -9.6 -5.4 -12Z" fill="#FFFFFF"/>`, eyes(-13), cheeks(-11.4, 4.1), nose(INK, -11.2),
  ],
};

/** 캐릭터 하나 (발끝이 0, 0) */
export function charSvg(id) {
  return (DRAW[id] || DRAW.penguin)().join("");
}
