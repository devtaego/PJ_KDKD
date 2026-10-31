// 화면 테마: 밤하늘(기본) · 말랑말랑(귀여운 파스텔) · 오락실(네온). 고른 테마는 이 기기에 저장함
import { store } from "./ui.js";

export const THEMES = [
  { id: "night", name: "밤하늘", bar: "#1A1446", swatch: ["#2B1A5E", "#7C5CFF", "#FF5C8A"] },
  { id: "pastel", name: "말랑말랑", bar: "#FFE9F0", swatch: ["#FFF4E8", "#FF8FB1", "#8FD3FF"] },
  { id: "arcade", name: "오락실", bar: "#07071A", swatch: ["#07071A", "#00E5FF", "#FF2BD6"] },
];

export const currentTheme = () => document.documentElement.dataset.theme || "night";

export function applyTheme(id) {
  const t = THEMES.find((x) => x.id === id) || THEMES[0];
  document.documentElement.dataset.theme = t.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.bar);
  store.set("theme", t.id);
  window.dispatchEvent(new Event("themechange"));
}

applyTheme(store.get("theme", "night"));
