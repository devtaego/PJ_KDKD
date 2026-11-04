// 토너먼트 대진표 그리기. 대진과 진행은 서버가 정하고, 여기서는 받은 그대로 보여 줌
import { avatarHtml, esc } from "./art.js";

export function roundName(t, r) {
  const teams = 2 ** (t.rounds.length - r);
  return teams === 2 ? "결승" : `${teams}강`;
}

/** 지금 치를 수 있거나 치르는 중인 경기들 { round, index, a, b, state, marks, watchers, label } */
export function liveMatches(t) {
  if (!t) return [];
  return t.rounds.flatMap((matches, round) => matches.flatMap((m, index) => {
    if (m.state !== "ready" && m.state !== "playing") return [];
    const name = roundName(t, round);
    return [{ ...m, round, index, label: name === "결승" ? name : `${name} ${index + 1}경기` }];
  }));
}

/** 이 사람이 지금 치러야 할 경기. 없으면 null */
export function myMatch(t, me) {
  return liveMatches(t).find((m) => m.a === me || m.b === me) || null;
}

function slotHtml(t, m, pid, round) {
  if (!pid) return `<div class="b-slot empty">${round === 0 ? "부전승" : m.done ? "-" : "미정"}</div>`;
  const who = t.people[pid] || { name: "?", avatar: "cat" };
  const state = m.done && m.winner === pid ? "win" : m.done ? "lose" : "";
  return `<div class="b-slot ${state}">${avatarHtml(who.avatar, 26)}<span class="b-name">${esc(who.name)}</span>${who.left ? `<span class="b-left">나감</span>` : ""}</div>`;
}

/** 왼쪽에서 오른쪽으로 올라가는 대진표. 칸이 많으면 옆으로 밀어서 봄 */
export function bracketHtml(t) {
  const last = t.rounds.length - 1;
  const columns = t.rounds.map((matches, r) => {
    const cells = matches.map((m, i) => {
      const live = m.state === "ready" || m.state === "playing";
      return `<div class="b-wrap ${m.winner ? "won" : ""}"><div class="b-match ${live ? "live" : ""}">${slotHtml(t, m, m.a, r)}${slotHtml(t, m, m.b, r)}</div></div>`;
    }).join("");
    return `<div class="b-round ${r === last ? "final" : ""}"><div class="b-round-name">${roundName(t, r)}</div><div class="b-cells">${cells}</div></div>`;
  }).join("");
  const champ = t.champion ? t.people[t.champion] : null;
  const crown = `<div class="b-round b-crown"><div class="b-round-name">우승</div><div class="b-cells"><div class="b-wrap"><div class="b-champ ${champ ? "on" : ""}">
    ${champ ? `${avatarHtml(champ.avatar, 44)}<span class="b-name">${esc(champ.name)}</span>` : `<span class="b-trophy">🏆</span>`}</div></div></div></div>`;
  return `<div class="bracket-scroll"><div class="bracket">${columns}${crown}</div></div>`;
}

/** 지금 경기가 보이게 대진표를 옆으로 밂 */
export function showLiveMatch(box) {
  const live = box.querySelector(".b-match.live");
  const scroll = box.querySelector(".bracket-scroll");
  if (live && scroll) scroll.scrollLeft = live.offsetLeft - (scroll.clientWidth - live.offsetWidth) / 2;
}
