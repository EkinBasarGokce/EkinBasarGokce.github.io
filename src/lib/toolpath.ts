/**
 * A procedural circuit-board drawing for the featured project: traces that
 * run in 45-degree steps between pads, like the toolpaths the Beespenser
 * machine dispenses. Generated at build time from a seed; no JavaScript ships.
 */
function mkRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Board {
  w: number;
  h: number;
  traces: string[];
  pads: { x: number; y: number; r: number }[];
  chips: { x: number; y: number; w: number; h: number }[];
}

export function board(seed = 7, w = 520, h = 320, n = 16): Board {
  const R = mkRng(seed);
  const G = 20; // grid step
  const snap = (v: number) => Math.round(v / G) * G;
  const dirs = [
    [1, 0], [1, 1], [1, -1], [0, 1], [0, -1],
  ];
  const traces: string[] = [];
  const pads: Board['pads'] = [];
  const chips: Board['chips'] = [
    { x: snap(w * 0.36), y: snap(h * 0.3), w: 120, h: 80 },
    { x: snap(w * 0.7), y: snap(h * 0.58), w: 60, h: 40 },
  ];
  for (let i = 0; i < n; i++) {
    let x = snap(R() * w * 0.4) + G;
    let y = snap(G + R() * (h - 2 * G));
    pads.push({ x, y, r: 5 });
    let d = `M${x} ${y}`;
    const segs = 2 + Math.floor(R() * 4);
    let last = 0;
    for (let k = 0; k < segs; k++) {
      // mostly run right, with diagonal jogs, never reverse
      const pick = k % 2 === 0 ? 0 : 1 + Math.floor(R() * 4);
      const [dx, dy] = dirs[pick === last && pick !== 0 ? 0 : pick];
      last = pick;
      const len = G * (1 + Math.floor(R() * (dx && !dy ? 6 : 3)));
      x = Math.min(w - G, Math.max(G, x + dx * len));
      y = Math.min(h - G, Math.max(G, y + dy * len));
      d += ` L${x} ${y}`;
    }
    pads.push({ x, y, r: R() < 0.3 ? 7 : 4 });
    traces.push(d);
  }
  return { w, h, traces, pads, chips };
}
