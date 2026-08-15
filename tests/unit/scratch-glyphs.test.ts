import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { digit, letter, setAt, widthAt } from '../../src/lib/blockAlphabet.ts';
import { buildSolids, type Shape } from '../../src/lib/blockGeometry.ts';

const BOX = { x: 3, y: 3, w: 94, h: 94 };

function solids(shapes: readonly Shape[]) {
  return buildSolids([{ shapes }], { box: BOX });
}

function render(shapes: readonly Shape[], label: string): string {
  const body = solids(shapes)
    .map(
      (s) =>
        s.walls.map((w) => `<path d="${w.d}" fill="${w.deep ? '#5a0c0c' : '#8a1414'}"/>`).join('') +
        `<path d="${s.face}" fill-rule="evenodd" fill="#e63946"/>`,
    )
    .join('');
  return `<svg viewBox="0 0 100 100" width="110" height="110"><rect width="100" height="100" fill="#fff"/>${body}<text x="3" y="97" font-size="10" fill="#333">${label}</text></svg>`;
}

describe('scratch glyph render', () => {
  it('writes a contact sheet', () => {
    const cells: string[] = [];
    for (let v = 0; v <= 9; v += 1) cells.push(render(digit(v), String(v)));
    for (const ch of ['U', 'N', 'O', 'T', 'A', 'K', 'I']) cells.push(render(letter(ch), ch));
    writeFileSync(
      '/tmp/claude-0/-home-user-UNO/f79365c4-4c11-59c0-8e81-7cd97eb16a48/scratchpad/glyphs.html',
      `<body style="background:#222;display:flex;flex-wrap:wrap;gap:4px;margin:0">${cells.join('')}</body>`,
    );
    expect(cells.length).toBe(17);
  });

  it('every glyph has a non-degenerate face and walls', () => {
    const check = (shapes: readonly Shape[], label: string): void => {
      const built = solids(shapes);
      expect(built.length, label).toBeGreaterThan(0);
      expect(built[0]!.face.length, `${label} face`).toBeGreaterThan(40);
      expect(built[0]!.walls.length, `${label} walls`).toBeGreaterThan(2);
    };
    for (let v = 0; v <= 9; v += 1) check(digit(v), `digit ${v}`);
    for (const ch of ['U', 'N', 'O']) check(letter(ch), ch);
  });

  it('the new letters set to sensible widths', () => {
    const cap = 44;
    for (const ch of ['U', 'N', 'O']) {
      const w = widthAt(letter(ch), cap);
      expect(w, ch).toBeGreaterThan(20);
      expect(w, ch).toBeLessThan(60);
      expect(setAt(letter(ch), 0, 0, cap).length).toBeGreaterThan(0);
    }
  });

  it('digit 0 is distinct from the fallback 1', () => {
    expect(JSON.stringify(digit(0))).not.toBe(JSON.stringify(digit(1)));
  });
});
