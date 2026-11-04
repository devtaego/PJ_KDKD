// 토너먼트 대진표 그리기. 대진과 진행은 서버가 정하고, 여기서는 받은 그대로 보여 줌
import { avatarHtml, esc } from "./art.js";
import { titleFx } from "./data/titles.js";

export function roundName(t, r) {
  const teams = 2 ** (t.rounds.length - r);
  return teams === 2 ? "결승" : `${teams}강`;
}

function matchLabel(t, round, index) {
  const name = roundName(t, round);
  return name === "결승" ? name : `${name} ${index + 1}경기`;
}

/** 지금 치를 수 있거나 치르는 중인 경기들 { round, index, a, b, state, marks, watchers, label } */
export function liveMatches(t) {
  if (!t) return [];
  return t.rounds.flatMap((matches, round) => matches.flatMap((m, index) => {
    if (m.state !== "ready" && m.state !== "playing") return [];
    return [{ ...m, round, index, label: matchLabel(t, round, index) }];
  }));
}

/** 아직 지지 않은 참가자인지 */
export function stillIn(t, me) {
  return !!t && t.stage === "running" && t.entrants.includes(me) && !t.people[me]?.left
    && !t.rounds.flat().some((m) => m.done && m.winner !== me && (m.a === me || m.b === me));
}

/** 다음 상대가 아직 정해지지 않았을 때 어느 경기의 승자를 기다리는지. 없으면 "" */
export function nextFoeText(t, me) {
  for (let round = 1; round < t.rounds.length; round++) {
    for (let index = 0; index < t.rounds[round].length; index++) {
      const m = t.rounds[round][index];
      if (m.done || (m.a !== me && m.b !== me) || (m.a && m.b)) continue;
      const feed = m.a === me ? index * 2 + 1 : index * 2;
      const prev = t.rounds[round - 1][feed];
      const name = (pid) => t.people[pid]?.name || "?";
      const who = prev.a && prev.b ? ` (${name(prev.a)} vs ${name(prev.b)})` : "";
      return `다음 상대는 ${matchLabel(t, round - 1, feed)}${who} 승자예요. ${matchLabel(t, round, index)}에서 만나요`;
    }
  }
  return "";
}

/** 이 사람이 지금 치러야 할 경기. 없으면 null */
export function myMatch(t, me) {
  return liveMatches(t).find((m) => m.a === me || m.b === me) || null;
}

/** 대회에 아직 남아 있는 사람의 이름 (칭호 효과는 남아 있는 동안만 보임) */
export function bracketName(t, pid) {
  const who = t.people[pid] || { name: "?" };
  const out = who.left || t.rounds.flat().some((m) => m.done && m.winner !== pid && (m.a === pid || m.b === pid));
  return `<span class="b-name"><span class="${out ? "" : titleFx(who.title)}">${esc(who.name)}</span></span>`;
}

function slotHtml(t, m, pid, round) {
  if (!pid) return `<div class="b-slot empty">${round === 0 ? "부전승" : m.done ? "-" : "미정"}</div>`;
  const who = t.people[pid] || { name: "?", avatar: "cat" };
  const state = m.done && m.winner === pid ? "win" : m.done ? "lose" : "";
  return `<div class="b-slot ${state}">${avatarHtml(who.avatar, 26)}${bracketName(t, pid)}${who.left ? `<span class="b-left">나감</span>` : ""}</div>`;
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
    ${champ ? `${avatarHtml(champ.avatar, 44)}${bracketName(t, t.champion)}` : `<span class="b-trophy">🏆</span>`}</div></div></div></div>`;
  return `<div class="bracket-scroll"><div class="bracket">${columns}${crown}</div></div>`;
}

/** 지금 경기가 보이게 대진표를 옆으로 밂 */
export function showLiveMatch(box) {
  const live = box.querySelector(".b-match.live");
  const scroll = box.querySelector(".bracket-scroll");
  if (live && scroll) scroll.scrollLeft = live.offsetLeft - (scroll.clientWidth - live.offsetWidth) / 2;
}
