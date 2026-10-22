// Fig 2 — Voice cartridge deck.
// Language switching as a machine: four voice cartridges stand in the slots of a deck, one
// per language. The cartridge for the language being spoken is seated (pressed down and lit).
// When the caller switches language, the seated cartridge rises and the new one drops in.
// A VU meter on the right shows the voice level.
//
//   node figures/switchboard/build.mjs [--page]

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import { hullOf } from "../kit/lathe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const WIDTH = 640;
const HEIGHT = 330;

const PLATE = { x: -132, y: -56, w: 242, d: 110, r: 8 };
const PLATE_H = 12;
const FOOT_H = 5;
const DECK = { x: -118, y: -42, w: 214, d: 82, r: 6 };
const DECK_H = 30;
const TOP = DECK_H + 0.8;
const SLOTS = [-94, -60, -26, 8];
const CART = { w: 26, d: 8 };
const CART_Y = -26; // cartridge plan y (back face); front face at CART_Y + CART.d
const CART_H = 40;
const CART_Z = TOP - 14; // bottom when raised; top = CART_Z + CART_H
export const DROP = -18; // seated = raised + DROP
const LAMP_Y = -6;
const METER = [62, -16];
const METER_R = 17;
const METER_Z = TOP;
const METER_H = 6;
const KNOBS = [[42, 20], [80, 20]];
const GRILLE = { x: -108, y: 10, w: 132, d: 22, r: 3 };

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [SLOTS[0], CART_Y, CART_Z + CART_H + 1], [SLOTS[3] + 13, CART_Y, CART_Z + CART_H + 1]],
  WIDTH, HEIGHT, { pad: 22, azimuth: 60, elevation: 30 },
);

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const depth = (x, y, z = 0) => k.depthOf([x, y, z], P);
const byDepth = (points) => [...points].sort((a, b) => depth(a[0], a[1]) - depth(b[0], b[1]));
const poly = (pts) => k.pathOf(pts.map(at), true);

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
  return out.join("");
}

function deck() {
  const out = [];
  out.push(S(k.slabOf(DECK, 0, DECK_H, P, 8, 0.8), { tone: "mid", inner: L(k.sideSeam(DECK, 8, P, 8) + k.sideSeam(DECK, 22, P, 8), { tone: "faint" }) }));
  const panel = k.insetPlan(DECK, 4);
  out.push(S(k.slabOf(panel, DECK_H, 0.8, P, 6), { tone: "lo", crease: "none" }));
  out.push(D(k.corners(panel, 5).map(([x, y]) => at([x, y, TOP])), { size: 0.5 }));
  // speaker grille: a closed outline with a perforated field inside it
  out.push(L(k.planOutline(GRILLE, TOP, P, 4), { tone: "lo" }));
  out.push(D(k.dotGrid(GRILLE.x + 4, GRILLE.y + 4, 37, 5, 3.4, TOP, P), { size: 0.42, tone: "lo" }));
  // slots: a dark recess with an outline (closed, no ends)
  for (const cx of SLOTS) {
    const slot = { x: cx - CART.w / 2 - 1.2, y: CART_Y - 1.2, w: CART.w + 2.4, d: CART.d + 2.4, r: 1.6 };
    out.push(`<path d="${k.planOutline(slot, TOP, P, 4)}" style="fill:var(--anatomy-shade-0);stroke:none"/>`);
    out.push(L(k.planOutline(slot, TOP, P, 4), { tone: "lo" }));
  }
  // label plate
  const label = { x: 52, y: 28, w: 18, d: 7, r: 1.2 };
  out.push(S(k.slabOf(label, TOP, 0.6, P, 3), { tone: "mid", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.4), TOP + 0.6, P, 3), { tone: "faint" }));
  out.push(L([[55, 30.4, 10], [55, 32.8, 7]].map(([x, y, w]) => k.lineOnTop([x, y], [x + w, y], TOP + 0.6, P)).join(""), { tone: "lo", free: true }));
  return out.join("");
}

function cartridge(cx, i, seated = false) {
  const plan = { x: cx - CART.w / 2, y: CART_Y, w: CART.w, d: CART.d, r: 1.2 };
  const top = CART_Z + CART_H;
  const front = CART_Y + CART.d;
  const shell = S(k.slabOf(plan, CART_Z, CART_H, P, 3, 0.5), { tone: "hi", crease: "lo", lit: true, inner: L(k.sideSeam(plan, top - 3, P, 3), { tone: "faint" }) });
  const parts = [shell];
  // label window near the top of the front face, a closed rectangle
  parts.push(L(poly([[cx - 10, front, top - 5], [cx + 10, front, top - 5], [cx + 10, front, top - 12], [cx - 10, front, top - 12]]), { tone: "lo" }));
  parts.push(L([[top - 7.4, 14], [top - 9.6, 10]].map(([z, w]) => k.segment([cx - 8, front, z], [cx - 8 + w, front, z], P)).join(""), { tone: "faint", free: true }));
  // reel window with two hubs
  parts.push(L(poly([[cx - 11, front, top - 15], [cx + 11, front, top - 15], [cx + 11, front, top - 27], [cx - 11, front, top - 27]]), { tone: "lo" }));
  for (const dx of [-5.5, 5.5]) {
    parts.push(L(k.sideRing([cx + dx, front, top - 21], 3.6, "y", P, 24), { tone: "mid" }));
    parts.push(L(k.sideRing([cx + dx, front, top - 21], 1.3, "y", P, 12), { tone: "lo" }));
  }
  // grip ridges on the top, edge to edge
  parts.push(L([-2, 2].map((dy) => k.lineOnTop([cx - CART.w / 2, CART_Y + CART.d / 2 + dy], [cx + CART.w / 2, CART_Y + CART.d / 2 + dy], top, P)).join(""), { tone: "lo" }));
  // clip: everything above the deck top over the slot, so the part inside the deck is hidden
  const foot = k.ringOf(k.insetPlan(plan, -0.6), 3);
  const clip = hullOf([...foot.map(([x, y]) => at([x, y, TOP])), ...foot.map(([x, y]) => at([x, y, TOP + 400]))]);
  const id = `vd-cart-${i}`;
  return `<g data-part="cart" data-index="${i}"><clipPath id="${id}"><path data-hold d="${k.pathOf(clip, true)}"${seated ? ` transform="${k.translateAlong(P, [0, 0, -DROP])}"` : ""}/></clipPath><g clip-path="url(#${id})">${parts.join("")}</g></g>`;
}

function lamp(cx, i) {
  return [
    S(k.cylinder(cx, LAMP_Y, 3.4, TOP, 2.2, P, 24), { tone: "mid" }),
    `<g data-part="lamp" data-index="${i}">${S(k.cylinder(cx, LAMP_Y, 2.4, TOP + 2.2, 1.5, P, 24, 0.4), { tone: "hi", crease: "lo", lit: true })}</g>`,
  ].join("");
}

function meter() {
  const [x, y] = METER;
  const top = METER_Z + METER_H;
  const out = [];
  out.push(S(k.cylinder(x, y, METER_R + 2.4, METER_Z, 2.4, P, 56), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, METER_R, METER_Z + 2.4, METER_H - 2.4, P, 64, 0.8), { tone: "hi", crease: "lo" }));
  out.push(L(k.knurl(x, y, METER_R, top - 2.6, top, 72, P, 0.3), { tone: "lo" }));
  out.push(L(k.ring(x, y, METER_R - 2.2, top, P, 64), { tone: "lo" }));
  const ticks = k.radialTicks(x, y, METER_R - 3, 22, 4, top, [1.4, 3], P, -Math.PI * 0.32, Math.PI * 0.64);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(L(k.ring(x, y, 1.6, top, P, 16), { tone: "mid" }));
  return out.join("");
}

function knobs() {
  const out = [];
  for (const [x, y] of byDepth(KNOBS)) {
    out.push(S(k.cylinder(x, y, 6.4, TOP, 1.6, P, 32), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5, TOP + 1.6, 5, P, 32), { tone: "mid" }));
    out.push(L(k.knurl(x, y, 5, TOP + 1.6, TOP + 6.6, 30, P), { tone: "lo" }));
    out.push(L(k.lineOnTop([x, y], [x + 2.6, y - 3.6], TOP + 6.6, P), { tone: "hi", free: "end" }));
  }
  return out.join("");
}

export const NEEDLE = { cx: METER[0], cy: METER[1], z: METER_Z + METER_H + 0.2, r: METER_R - 4, tail: 3, from: -Math.PI * 0.32, span: Math.PI * 0.64 };
function needleD(share) {
  const a = NEEDLE.from + NEEDLE.span * share;
  const tip = [NEEDLE.cx + Math.sin(a) * NEEDLE.r, NEEDLE.cy - Math.cos(a) * NEEDLE.r];
  const tail = [NEEDLE.cx - Math.sin(a) * NEEDLE.tail, NEEDLE.cy + Math.cos(a) * NEEDLE.tail];
  return k.lineOnTop(tail, tip, NEEDLE.z, P);
}

const carts = SLOTS.map((cx, i) => ({ cx, i, key: depth(cx, CART_Y) })).sort((a, b) => a.key - b.key);
const body = [
  base(),
  deck(),
  ...carts.map(({ cx, i }) => `<g data-part="cart-pos" data-index="${i}" transform="${i === 0 ? k.translateAlong(P, [0, 0, DROP]) : ""}">${cartridge(cx, i, i === 0)}</g>`),
  ...SLOTS.map((cx, i) => lamp(cx, i)),
  meter(),
  `<path data-part="needle" class="iso-line" data-tone="lit" data-free="start" d="${needleD(0.35)}" style="stroke-width:1.1"/>`,
  knobs(),
];

const svg = k.figureSvg({
  width: WIDTH, height: HEIGHT, body,
  label: "A voice deck on a bench plate. Four voice cartridges stand in slots, one per language. The cartridge for the language being spoken is seated and lit; when the caller switches language it rises and the new one drops in. A meter on the right shows the voice level.",
});

const r4 = (n) => Math.round(n * 10000) / 10000;
const ts = `// Generated by figures/switchboard/build.mjs. Do not edit by hand.
export const DECK_SVG = ${JSON.stringify(svg)};
export const DECK_FIG = ${JSON.stringify({
  drop: DROP,
  unitZ: k.axisVector(P, [0, 0, 1]).map(r4),
  P: { origin: P.origin.map(r4), scale: r4(P.scale), azimuth: P.azimuth, elevation: P.elevation },
  needle: NEEDLE,
})} as const;
`;
mkdirSync(join(ROOT, "components", "figures", "switchboard"), { recursive: true });
writeFileSync(join(ROOT, "components", "figures", "switchboard", "art.generated.ts"), ts);
console.log("wrote components/figures/switchboard/art.generated.ts", Math.round(svg.length / 1024), "KB");

if (process.argv.includes("--page")) {
  const page = k.pageHtml({ title: "Deck", theme: "dark", body: k.plateHtml({ fig: "Fig 2", title: "Voice deck", hint: "", readout: "", body: `<div class="iso-stage">${svg}</div>` }), width: 900 });
  writeFileSync(join(ROOT, "figures", "out", "deck.html"), page);
  console.log("wrote figures/out/deck.html");
}
