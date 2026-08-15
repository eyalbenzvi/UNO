import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { digit } from '../../src/lib/blockAlphabet.ts';
import { arc, buildSolids, turn, type Part, type Pt, type Shape } from '../../src/lib/blockGeometry.ts';

const BOX = { x: 3, y: 3, w: 94, h: 94 };
const SHALLOW: Pt = [-6, 7.2];

/** The prohibition ring: a heavy annulus with a bar laid across it. */
const RING: readonly Shape[] = [
  { outer: arc(50, 50, 48, 48, 0, 360, 20), holes: [arc(50, 50, 30, 30, 0, 360, 20)] },
];

/** The bar, on the upper-left-to-lower-right diagonal the prohibition sign uses. */
const BAR: readonly Shape[] = [
  {
    outer: [
      [16.3, 27.7],
      [27.7, 16.3],
      [83.7, 72.3],
      [72.3, 83.7],
    ],
  },
];

const CROSS: readonly Shape[] = [
  {
    outer: [
      [34, 0],
      [66, 0],
      [66, 34],
      [100, 34],
      [100, 66],
      [66, 66],
      [66, 100],
      [34, 100],
      [34, 66],
      [0, 66],
      [0, 34],
      [34, 34],
    ],
  },
];

const ARROW: readonly Shape[] = [
  {
    outer: [
      [6, 24],
      [54, 24],
      [54, 8],
      [94, 34],
      [54, 60],
      [54, 44],
      [6, 44],
    ],
  },
];
const ARROWS: readonly Shape[] = [...ARROW, ...turn(ARROW, 50, 54)];

function scaleShapes(shapes: readonly Shape[], factor: number, dx: number, dy: number): Shape[] {
  const move = ([x, y]: Pt): Pt => [x * factor + dx, y * factor + dy];
  return shapes.map((shape) => ({
    outer: shape.outer.map(move),
    ...(shape.holes ? { holes: shape.holes.map((hole) => hole.map(move)) } : {}),
  }));
}

function counted(value: number): Part[] {
  return [
    { shapes: scaleShapes(digit(value), 1, 0, 22) },
    { shapes: scaleShapes(CROSS, 0.36, 62, 0) },
  ];
}

function render(parts: readonly Part[], label: string, depth?: Pt): string {
  const body = buildSolids(parts, { box: BOX, ...(depth ? { depth } : {}) })
    .map(
      (s) =>
        s.walls.map((w) => `<path d="${w.d}" fill="${w.deep ? '#5a0c0c' : '#8a1414'}"/>`).join('') +
        `<path d="${s.face}" fill-rule="evenodd" fill="#e63946"/>`,
    )
    .join('');
  return `<svg viewBox="0 0 100 100" width="150" height="150"><rect width="100" height="100" fill="#fff"/>${body}<text x="3" y="97" font-size="9" fill="#333">${label}</text></svg>`;
}

describe('scratch UNO symbols', () => {
  it('writes a contact sheet', () => {
    const cells = [
      render([{ shapes: RING }, { shapes: BAR }], 'skip', SHALLOW),
      render([{ shapes: [ARROWS[0]!] }, { shapes: [ARROWS[1]!] }], 'reverse', SHALLOW),
      render(counted(2), 'drawTwo', SHALLOW),
      render(counted(4), 'wildDrawFour', SHALLOW),
      render([{ shapes: digit(0) }], 'zero'),
    ];
    writeFileSync(
      '/tmp/claude-0/-home-user-UNO/f79365c4-4c11-59c0-8e81-7cd97eb16a48/scratchpad/symbols.html',
      `<body style="background:#222;display:flex;flex-wrap:wrap;gap:6px;margin:0">${cells.join('')}</body>`,
    );
    expect(cells.length).toBe(5);
  });

  it('the ring keeps an open counter', () => {
    const built = buildSolids([{ shapes: RING }], { box: BOX, depth: SHALLOW });
    expect(built[0]!.face).toContain('M');
    // Two subpaths: the outer ring and its hole. Without the hole the symbol is a disc.
    expect(built[0]!.face.split('M').length - 1).toBeGreaterThanOrEqual(2);
  });
});
