// Fig 1 — Six-check interlock.
// The compliance gate as a real machine: a console with six faders (one per check), a lamp
// above each, and a launch plunger held down by a locking bar. When all six faders are up,
// the bar slides back into its guide and the plunger rises. Nothing else can release it.
//
//   node figures/gate/build.mjs          writes components/figures/gate/art.generated.ts
//   node figures/gate/build.mjs --page   also writes figures/out/gate.html for capture checks

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

const WIDTH = 640;
const HEIGHT = 330;

// ---- world -------------------------------------------------------------------------
const PLATE = { x: -152, y: -66, w: 300, d: 132, r: 8 };
const PLATE_H = 12;
const FOOT_H = 5;

const CONSOLE = { x: -138, y: -50, w: 190, d: 100, r: 6 };
const CONSOLE_H = 18;
const PANEL = k.insetPlan(CONSOLE, 4);
const PANEL_TOP = CONSOLE_H + 0.8;

export const CHANNELS = [-116, -88, -60, -32, -4, 24];
const SLOT = { y: -38, d: 56 };
const CAP = { w: 12, d: 10, h: 7.2 };
export const CAP_OFF = 12; // cap centre y when the check fails (pulled toward the operator)
export const CAP_ON = -30; // cap centre y when the check passes (pushed up)
const LAMP_Y = 38;

const HOUSING = { x: 58, y: -36, w: 80, d: 72, r: 6 };
const HOUSING_H = 28;
const BUTTON = [116, 4];
const COLLAR_R = 13;
const COLLAR_TOP = HOUSING_H + 5;
const ROD_R = 7.5;
const ROD_REST = 2; // rod shows 2 units above the collar while held down
export const RISE = 11; // how far the plunger rises when released
const BTN_R = 11;
const BTN_H = 6;
const BTN_Z = COLLAR_TOP + ROD_REST; // 35
const BTN_TOP = BTN_Z + BTN_H; // 41
const GUIDE = { x: 60, y: -7, w: 30, d: 18, r: 2.5 };
const BAR = { x: 62, y: -2, w: 56, d: 6, r: 1.6 };
const BAR_H = 3;
export const BAR_SLIDE = -14; // bar travel (x) when released
const ARMED_LAMP = [70, 24];

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [BUTTON[0], BUTTON[1], BTN_TOP + RISE + 1], [CONSOLE.x, CONSOLE.y, CONSOLE_H + 9]],
  WIDTH,
  HEIGHT,
  { pad: 22, azimuth: Number(process.env.AZ || 62), elevation: Number(process.env.EL || 32) },
);

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const depth = (x, y, z = 0) => k.depthOf([x, y, z], P);
const byDepth = (points) => [...points].sort((a, b) => depth(a[0], a[1]) - depth(b[0], b[1]));

// ---- parts --------------------------------------------------------------------------
function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 22))) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid", inner: L(k.sideSeam(PLATE, -6, P, 8), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  // ruler strip along the operator's edge, ticks rooted on its edge
  const strip = { x: -134, y: PLATE.y + PLATE.d - 12, w: 188, d: 6, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 3, strip.x + strip.w - 3, 4, 5, strip.y + 0.6, 0.6, [1.8, 3.4], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  return out.join("");
}

function consoleBody() {
  const out = [];
  out.push(S(k.slabOf(CONSOLE, 0, CONSOLE_H, P, 8, 0.8), { tone: "mid", inner: L(k.sideSeam(CONSOLE, 5, P, 8), { tone: "faint" }) }));
  out.push(S(k.slabOf(PANEL, CONSOLE_H, 0.8, P, 6), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(PANEL, 3), PANEL_TOP, P, 6), { tone: "faint" }));
  const screws = k.corners(PANEL, 6);
  out.push(D(screws.map(([x, y]) => at([x, y, PANEL_TOP])), { size: 0.5 }));
  // a label plate at the console's right end, three printed rules
  const label = { x: 36, y: 22, w: 12, d: 18, r: 1.2 };
  out.push(S(k.slabOf(label, PANEL_TOP, 0.6, P, 3), { tone: "mid", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.4), PANEL_TOP + 0.6, P, 3), { tone: "faint" }));
  out.push(L([[39, 26, 8], [39, 30, 6], [39, 34, 7]].map(([x, y, w]) => k.lineOnTop([x, y], [x + w * 0.6, y], PANEL_TOP + 0.6, P)).join(""), { tone: "lo", free: true }));
  return out.join("");
}

function channelStatic(cx) {
  const out = [];
  // slot: a closed outline, so it has no ends
  out.push(L(k.planOutline({ x: cx - 1.8, y: SLOT.y, w: 3.6, d: SLOT.d, r: 1.8 }, PANEL_TOP, P, 4), { tone: "lo" }));
  // ruler strip beside the slot, ticks hanging from its inner edge
  const strip = { x: cx + 6.2, y: SLOT.y + 1, w: 4, d: SLOT.d - 2, r: 0.8 };
  out.push(S(k.slabOf(strip, PANEL_TOP, 0.5, P, 2), { tone: "lo", crease: "none" }));
  const t = k.topTicks(strip.y + 1.5, strip.y + strip.d - 1.5, 4, 3, strip.x + 0.2, PANEL_TOP + 0.5, [1.4, 2.8], P, "y");
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));
  return out.join("");
}

function capAt(cx) {
  // built at y = 0; the live code translates it along y
  const plan = { x: cx - CAP.w / 2, y: -CAP.d / 2, w: CAP.w, d: CAP.d, r: 2 };
  const top = PANEL_TOP + CAP.h;
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(plan, 1), PANEL_TOP, 0.1, P)}" style="filter:blur(3px)"/>`];
  out.push(S(k.slabOf({ x: cx - 2.4, y: -2.4, w: 4.8, d: 4.8, r: 1 }, PANEL_TOP, 2.2, P, 3), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf(plan, PANEL_TOP + 2.2, CAP.h - 2.2, P, 4, 0.6), { tone: "hi", crease: "lo", inner: L(k.sideSeam(plan, PANEL_TOP + 4.4, P, 4), { tone: "faint" }) }));
  out.push(L([-2.2, 0, 2.2].map((y) => k.lineOnTop([cx - CAP.w / 2, y], [cx + CAP.w / 2, y], top, P)).join(""), { tone: "lo" }));
  return out.join("");
}

function lamp(cx, i) {
  const out = [];
  out.push(S(k.cylinder(cx, LAMP_Y, 3.6, PANEL_TOP, 2.2, P, 24), { tone: "mid" }));
  out.push(`<g data-part="lamp" data-index="${i}">${S(k.cylinder(cx, LAMP_Y, 2.5, PANEL_TOP + 2.2, 1.6, P, 24, 0.4), { tone: "hi", crease: "lo", lit: true })}</g>`);
  return out.join("");
}

function housing() {
  const out = [];
  out.push(S(k.slabOf(HOUSING, 0, HOUSING_H, P, 8, 0.8), { tone: "mid", inner: L(k.sideSeam(HOUSING, 8, P, 8), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(HOUSING, 4), HOUSING_H, P, 6), { tone: "faint" }));
  out.push(D(k.corners(HOUSING, 6).map(([x, y]) => at([x, y, HOUSING_H])), { size: 0.5 }));
  // vent slots on the top, closed outlines
  for (let i = 0; i < 4; i++) out.push(L(k.planOutline({ x: 70 + i * 6, y: -30, w: 2.4, d: 16, r: 1.2 }, HOUSING_H, P, 3), { tone: "lo" }));
  // armed lamp
  out.push(S(k.cylinder(ARMED_LAMP[0], ARMED_LAMP[1], 3.8, HOUSING_H, 2.4, P, 24), { tone: "mid" }));
  out.push(`<g data-part="armed">${S(k.cylinder(ARMED_LAMP[0], ARMED_LAMP[1], 2.7, HOUSING_H + 2.4, 1.8, P, 24, 0.4), { tone: "hi", crease: "lo", lit: true })}</g>`);
  // collar around the plunger
  out.push(S(k.cylinder(BUTTON[0], BUTTON[1], COLLAR_R, HOUSING_H, COLLAR_TOP - HOUSING_H, P, 56, 0.6), { tone: "mid", inner: L(k.sideArc(BUTTON[0], BUTTON[1], COLLAR_R, HOUSING_H + 2.4, P, 40), { tone: "faint" }) }));
  out.push(L(k.ring(BUTTON[0], BUTTON[1], ROD_R + 0.6, COLLAR_TOP, P, 40), { tone: "faint" }));
  out.push(D(Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    return at([BUTTON[0] + Math.cos(a) * (COLLAR_R - 2.6), BUTTON[1] + Math.sin(a) * (COLLAR_R - 2.6), COLLAR_TOP]);
  }), { size: 0.45 }));
  return out.join("");
}

function guide() {
  const out = [];
  out.push(S(k.slabOf(GUIDE, HOUSING_H, BTN_TOP - HOUSING_H, P, 4, 0.6), { tone: "mid", inner: L(k.sideSeam(GUIDE, HOUSING_H + 4, P, 4), { tone: "faint" }) }));
  out.push(D([at([GUIDE.x + 3, GUIDE.y + 3, BTN_TOP]), at([GUIDE.x + 3, GUIDE.y + GUIDE.d - 3, BTN_TOP])], { size: 0.45 }));
  return out.join("");
}

function strap() {
  // retaining strap over the bar on the guide: two posts and a bridge
  const out = [];
  for (const y of [-6.2, 6.2]) out.push(S(k.slabOf({ x: 64, y: y - 1.2, w: 5, d: 2.4, r: 0.6 }, BTN_TOP, BAR_H + 0.6, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf({ x: 64, y: -7.4, w: 5, d: 14.8, r: 0.8 }, BTN_TOP + BAR_H + 0.6, 1.4, P, 2, 0.3), { tone: "mid" }));
  out.push(D([at([66.5, -5.6, BTN_TOP + BAR_H + 2]), at([66.5, 5.6, BTN_TOP + BAR_H + 2])], { size: 0.4 }));
  return out.join("");
}

function bar() {
  const out = [];
  out.push(S(k.slabOf(BAR, BTN_TOP, BAR_H, P, 3, 0.4), { tone: "hi", crease: "lo" }));
  out.push(D([at([BAR.x + BAR.w - 3, 1, BTN_TOP + BAR_H])], { size: 0.5, tone: "hi" }));
  return out.join("");
}

const F_ROD = G.frameAlong([BUTTON[0], BUTTON[1], COLLAR_TOP], [0, 0, 1]);
const ROD = G.rodOut(F_ROD, 0, ROD_REST, ROD_R, P, { stroke: RISE });

function plunger() {
  const out = [];
  out.push(`<clipPath id="vd-gate-rod"><path data-hold d="${ROD.clip}"/></clipPath><g clip-path="url(#vd-gate-rod)">${S(ROD.paths, { tone: "mid" })}</g>`);
  out.push(`<g data-part="button">${S(k.cylinder(BUTTON[0], BUTTON[1], BTN_R, BTN_Z, BTN_H, P, 56, 0.6), { tone: "hi", crease: "lo", lit: true, inner: L(k.sideArc(BUTTON[0], BUTTON[1], BTN_R, BTN_Z + 2, P, 40), { tone: "faint" }) })}</g>`);
  out.push(L(k.knurl(BUTTON[0], BUTTON[1], BTN_R, BTN_Z, BTN_Z + 2, 56, P, 0.3), { tone: "lo" }));
  out.push(L(k.ring(BUTTON[0], BUTTON[1], BTN_R - 3.2, BTN_TOP, P, 40), { tone: "lo" }));
  return out.join("");
}

// ---- assemble in painter's order ------------------------------------------------------
const channels = CHANNELS.map((cx, i) => ({ cx, i, key: depth(cx, 0, PANEL_TOP) }));
const body = [
  base(),
  consoleBody(),
  ...channels.map(({ cx }) => channelStatic(cx)),
  // lamps are nearer the operator than the caps' far positions: draw caps (sorted) then lamps
  ...channels
    .sort((a, b) => a.key - b.key)
    .map(({ cx, i }) => `<g data-part="cap" data-index="${i}" transform="${k.translateAlong(P, [0, CAP_OFF, 0])}">${capAt(cx)}</g>`),
  ...CHANNELS.map((cx, i) => lamp(cx, i)),
  housing(),
  guide(),
  `<g data-part="plunger" transform="${k.translateAlong(P, [0, 0, 0])}">${plunger()}</g>`,
  `<g data-part="bar">${bar()}</g>`,
  strap(),
];

const LABEL =
  "An interlock console on a bench plate. Six faders stand in a row, one for each compliance check, each with a lamp in front of it. A locking bar lies across a launch plunger on the right; only when all six faders are pushed up does the bar slide back into its guide and the plunger rise.";

const svg = k.figureSvg({ width: WIDTH, height: HEIGHT, label: LABEL, body });

const unit = (v) => k.axisVector(P, v).map((n) => Math.round(n * 10000) / 10000);
const ts = `// Generated by figures/gate/build.mjs. Do not edit by hand.
export const GATE_SVG = ${JSON.stringify(svg)};
export const GATE = ${JSON.stringify({
  width: WIDTH,
  height: HEIGHT,
  capOff: CAP_OFF,
  capOn: CAP_ON,
  rise: RISE,
  barSlide: BAR_SLIDE,
  unitX: unit([1, 0, 0]),
  unitY: unit([0, 1, 0]),
  unitZ: unit([0, 0, 1]),
})} as const;
`;
mkdirSync(join(ROOT, "components", "figures", "gate"), { recursive: true });
writeFileSync(join(ROOT, "components", "figures", "gate", "art.generated.ts"), ts);
console.log("wrote components/figures/gate/art.generated.ts", Math.round(svg.length / 1024), "KB");

if (process.argv.includes("--page")) {
  const { kitScript } = await import("../scripts/inline-kit.mjs");
  const live = `
const P = ${JSON.stringify(P)};
const svg = document.querySelector("svg");
const caps = [...svg.querySelectorAll('[data-part="cap"]')];
const lamps = [...svg.querySelectorAll('[data-part="lamp"] .iso-solid')];
const pass = (location.hash.slice(1) || "111110").split("").map((c) => c === "1");
caps.forEach((cap) => { const i = +cap.dataset.index; cap.setAttribute("transform", translateAlong(P, [0, pass[i] ? ${CAP_ON} : ${CAP_OFF}, 0])); });
lamps.forEach((l, i) => { if (!pass[i]) l.removeAttribute("data-lit"); });
const all = pass.every(Boolean);
if (!all) svg.querySelector('[data-part="armed"] .iso-solid').removeAttribute("data-lit");
if (!all) svg.querySelector('[data-part="button"] .iso-solid').removeAttribute("data-lit");
const pl = svg.querySelector('[data-part="plunger"]');
const lift = all ? ${RISE} : 0;
pl.setAttribute("transform", translateAlong(P, [0, 0, lift]));
const d = axisVector(P, [0, 0, lift]); holdStill(pl, d);
svg.querySelector('[data-part="bar"]').setAttribute("transform", translateAlong(P, [all ? ${BAR_SLIDE} : 0, 0, 0]));
`;
  const page = k.pageHtml({
    title: "Gate",
    theme: "dark",
    body: k.plateHtml({ fig: "Fig 1", title: "Six-check interlock", hint: "", readout: "", body: `<div class="iso-stage">${svg}</div>` }),
    script: kitScript() + live,
    width: 900,
  });
  mkdirSync(join(ROOT, "figures", "out"), { recursive: true });
  writeFileSync(join(ROOT, "figures", "out", "gate.html"), page);
  console.log("wrote figures/out/gate.html");
}
