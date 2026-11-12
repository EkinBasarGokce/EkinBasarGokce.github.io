/**
 * A small, realistic-looking circuit board for the Beespenser project card:
 * green solder mask, gold pads, an 8 x 4 QFP, an SOIC, a crystal, passives,
 * an LED, a switch, a pin header, mounting holes, vias and silkscreen labels.
 * Traces are routed by hand in 45-degree steps. Everything is static SVG data.
 */

export type Pt = [number, number];
export interface Rect { x: number; y: number; w: number; h: number; rx?: number }
export interface Board {
  w: number;
  h: number;
  traces: { pts: Pt[]; wide?: boolean }[];
  smd: Rect[]; // exposed copper pads
  tht: { x: number; y: number; r: number; square?: boolean }[]; // through-hole pads
  vias: Pt[];
  holes: Pt[]; // mounting holes
  bodies: (Rect & { dot?: Pt })[]; // component bodies (chips)
  silk: { rects: Rect[]; circles: { x: number; y: number; r: number }[]; labels: { x: number; y: number; t: string; size?: number; anchor?: string }[] };
}

const pad = (cx: number, cy: number, w: number, h: number): Rect => ({ x: cx - w / 2, y: cy - h / 2, w, h, rx: 1.2 });

export function board(): Board {
  const smd: Rect[] = [];
  const tht: Board['tht'] = [];
  const traces: Board['traces'] = [];
  const bodies: Board['bodies'] = [];
  const rects: Rect[] = [];
  const circles: Board['silk']['circles'] = [];
  const labels: Board['silk']['labels'] = [];

  // J1: 1 x 6 pin header on the left edge
  const jy = (i: number) => 120 + 26 * i;
  for (let i = 0; i < 6; i++) tht.push({ x: 40, y: jy(i), r: 8, square: i === 0 });
  rects.push({ x: 27, y: 106, w: 26, h: 158, rx: 3 });
  labels.push({ x: 40, y: 98, t: 'J1' });

  // U1: QFP-32, 8 pins a side, pitch 9.5
  const U1 = { cx: 205, cy: 190 };
  const off = (k: number) => -33.25 + 9.5 * k;
  bodies.push({ x: 163, y: 148, w: 84, h: 84, rx: 3, dot: [172, 157] });
  for (let k = 0; k < 8; k++) {
    smd.push(pad(155.5, U1.cy + off(k), 11, 4.6)); // left
    smd.push(pad(254.5, U1.cy + off(k), 11, 4.6)); // right
    smd.push(pad(U1.cx + off(k), 140.5, 4.6, 11)); // top
    smd.push(pad(U1.cx + off(k), 239.5, 4.6, 11)); // bottom
  }
  labels.push({ x: 150, y: 132, t: 'U1', anchor: 'end' });

  // U2: SOIC-8
  bodies.push({ x: 398, y: 100, w: 64, h: 40, rx: 2.5, dot: [406, 108] });
  const u2x = [407.5, 422.5, 437.5, 452.5];
  for (const x of u2x) {
    smd.push(pad(x, 92, 6, 12));
    smd.push(pad(x, 148, 6, 12));
  }
  labels.push({ x: 392, y: 96, t: 'U2', anchor: 'end' });

  // Y1: crystal
  smd.push(pad(312, 110, 12, 16), pad(348, 110, 12, 16));
  rects.push({ x: 300, y: 98, w: 60, h: 24, rx: 9 });
  labels.push({ x: 330, y: 90, t: 'Y1' });

  // R1-R3: 0805 resistors
  for (const [i, y] of [200, 226, 252].entries()) {
    smd.push(pad(320, y, 9, 12), pad(340, y, 9, 12));
    labels.push({ x: 360, y: y + 3.5, t: `R${i + 1}`, anchor: 'start' });
  }

  // C1, C2: capacitors under U2
  smd.push(pad(421, 190, 9, 11), pad(439, 190, 9, 11));
  smd.push(pad(466, 190, 9, 11), pad(484, 190, 9, 11));
  labels.push({ x: 430, y: 211, t: 'C1' }, { x: 475, y: 211, t: 'C2' });

  // D1: LED with a polarity mark
  smd.push(pad(490, 270, 10, 12), pad(510, 270, 10, 12));
  rects.push({ x: 482, y: 260, w: 36, h: 20, rx: 2 });
  labels.push({ x: 500, y: 296, t: 'D1' });

  // SW1: tactile switch
  for (const [x, y] of [[522, 104], [558, 104], [522, 136], [558, 136]] as Pt[]) smd.push(pad(x, y, 10, 8));
  rects.push({ x: 526, y: 108, w: 28, h: 24, rx: 2 });
  circles.push({ x: 540, y: 120, r: 8 });
  labels.push({ x: 540, y: 160, t: 'SW1' });

  // traces: J1 to the left side of U1
  for (let i = 0; i < 6; i++) {
    const y0 = jy(i);
    const y1 = U1.cy + off(i + 1);
    const d = Math.abs(y1 - y0);
    traces.push({ pts: [[48, y0], [100, y0], [100 + d, y1], [150, y1]] });
  }
  // U1 top to the crystal and to U2
  traces.push({ pts: [[U1.cx + off(6), 135], [U1.cx + off(6), 125], [244.25, 110], [306, 110]] });
  traces.push({ pts: [[U1.cx + off(7), 135], [245.75, 128], [340, 128], [348, 120]] });
  traces.push({ pts: [[U1.cx + off(3), 135], [U1.cx + off(3), 62], [222.25, 50], [410.5, 50], [422.5, 62], [422.5, 86]] });
  traces.push({ pts: [[U1.cx + off(4), 135], [U1.cx + off(4), 72], [231.75, 60], [395.5, 60], [407.5, 72], [407.5, 86]] });
  // U1 right to the resistors and C1
  traces.push({ pts: [[260, U1.cy + off(4)], [300, U1.cy + off(4)], [305.25, 200], [315.5, 200]] });
  traces.push({ pts: [[260, U1.cy + off(6)], [290, U1.cy + off(6)], [302.25, 226], [315.5, 226]] });
  traces.push({ pts: [[260, U1.cy + off(7)], [280, U1.cy + off(7)], [308.75, 252], [315.5, 252]] });
  traces.push({ pts: [[260, U1.cy + off(1)], [397.25, U1.cy + off(1)], [416.5, 185.5]] });
  // U2 to the capacitors and the switch
  traces.push({ pts: [[437.5, 154], [437.5, 180], [439, 184.5]] });
  traces.push({ pts: [[452.5, 154], [452.5, 176], [466, 189.5]] });
  traces.push({ pts: [[452.5, 86], [458.5, 80], [493, 80], [517, 104]] });
  // resistors to the LED, switch to the LED
  traces.push({ pts: [[344.5, 252], [467, 252], [485, 270]] });
  traces.push({ pts: [[522, 140], [522, 262], [515, 269]] });
  // ground bus along the bottom, with drops
  traces.push({ pts: [[66, 318], [540, 318]], wide: true });
  traces.push({ pts: [[U1.cx + off(3), 245], [U1.cx + off(3), 318]], wide: true });
  traces.push({ pts: [[344.5, 226], [380, 226], [392, 238], [392, 318]], wide: true });
  traces.push({ pts: [[484, 195.5], [484, 214], [530, 214], [530, 318]], wide: true });

  labels.push({ x: 72, y: 344, t: 'BEESPENSER', size: 12, anchor: 'start' });
  labels.push({ x: 560, y: 309, t: 'GND', anchor: 'end' });

  return {
    w: 600,
    h: 372,
    traces,
    smd,
    tht,
    vias: [[300, 290], [380, 140], [500, 150], [120, 292], [560, 230], [270, 96]],
    holes: [[30, 30], [570, 30], [30, 342], [570, 342]],
    bodies,
    silk: { rects, circles, labels },
  };
}

export const path = (pts: Pt[]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
