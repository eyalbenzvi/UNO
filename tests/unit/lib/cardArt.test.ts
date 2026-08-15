import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CardGlyph } from '../../../src/features/game/ui/components/CardGlyph.tsx';
import { digit } from '../../../src/lib/blockAlphabet.ts';
import type { Card } from '../../../src/features/game/engine/cards.ts';

/**
 * What the cards have to *look* like.
 *
 * These are fidelity assertions, not rendering ones — the drawing engine has its own
 * tests. Every one of them locks in a decision where this deck previously inherited
 * the deck it was ported from and came out saying something an UNO card does not
 * say. They are cheap, they are geometry rather than pixels, and each of them would
 * have caught a real defect that shipped.
 */

/** Every point in a rendered glyph's front faces, part by part, in paint order. */
function facesOf(card: Card): Array<Array<readonly [number, number]>> {
  const markup = renderToStaticMarkup(createElement(CardGlyph, { card }));
  return [...markup.matchAll(/class="glyph__face"[^>]*d="([^"]+)"/g)].map(([, d]) =>
    [...(d as string).matchAll(/(-?[\d.]+)\s+(-?[\d.]+)/g)].map(
      ([, x, y]) => [Number(x), Number(y)] as const,
    ),
  );
}

function boundsOf(points: ReadonlyArray<readonly [number, number]>) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

describe('the take-cards cards', () => {
  /*
   * "+2", not "2⁺".
   *
   * A printed UNO card puts the plus *first*, to the left of the numeral and at
   * roughly its weight — the mark is an instruction to add, and that is the whole
   * content of the card. This deck was ported from one that notates the same idea
   * as a numeral with a small raised cross after it, and inheriting that layout is
   * exactly what shipped: every take-cards card read as a power rather than a sum.
   */
  it.each<readonly [string, Card]>([
    ['drawTwo', { id: 'd', kind: 'drawTwo', color: 'red' }],
    ['wildDrawFour', { id: 'w', kind: 'wildDrawFour' }],
  ])('draws %s as a plus and then a numeral, left to right', (_name, card) => {
    const faces = facesOf(card);
    expect(faces).toHaveLength(2);

    // Paint order is back to front, and the drawing leans down-left, so the plus —
    // which is behind — is painted first. Order the two by position, not by index.
    const [plus, numeral] = faces.map((points) => boundsOf(points)).sort((a, b) => a.minX - b.minX);
    if (!plus || !numeral) {
      throw new Error('the mark is two solids: a plus and a numeral');
    }

    // The plus is wholly left of the numeral: they do not overlap horizontally.
    expect(plus.maxX).toBeLessThan(numeral.minX);

    // And it is centred on the numeral's body rather than raised above it. A
    // superscript's whole point is that it sits clear of the numeral's top half;
    // this one straddles the middle.
    const middle = (numeral.minY + numeral.maxY) / 2;
    expect(plus.minY).toBeLessThan(middle);
    expect(plus.maxY).toBeGreaterThan(middle);

    // Nearly the numeral's own weight, not a small mark beside it.
    const plusHeight = plus.maxY - plus.minY;
    const numeralHeight = numeral.maxY - numeral.minY;
    expect(plusHeight / numeralHeight).toBeGreaterThan(0.4);
  });
});

describe('the numerals', () => {
  /*
   * A 9 is drawn as a 6 stood on its head, and a card prints its index at both ends
   * with one of them turned over — so without something to break the symmetry, the
   * bottom index of a 6 *is* a 9. In a fanned hand, where the leading corner is
   * often all that shows, that is a card read as the wrong card.
   */
  it('tell a 6 from a 9 however the card is turned', () => {
    const six = digit(6).flatMap((shape) => shape.outer);
    const nine = digit(9).flatMap((shape) => shape.outer);
    expect(six).toHaveLength(nine.length);

    const bounds = boundsOf(six);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const turned = six.map(([x, y]) => [2 * cx - x, 2 * cy - y] as const);

    // Turning a 6 over must not produce this deck's 9. Compared as sets of points,
    // because the two rings need not start at the same corner.
    const key = (points: ReadonlyArray<readonly [number, number]>) =>
      [...points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)].sort().join('|');
    expect(key(turned)).not.toBe(key(nine));
  });
});

describe('the Wild', () => {
  /*
   * One object in four colours, not four objects in one colour each: the card means
   * "this is every colour at once", and four separate marks say "a set of things".
   */
  it('is a single mark divided into four coloured quarters', () => {
    const markup = renderToStaticMarkup(createElement(CardGlyph, { card: { id: 'w', kind: 'wild' } }));
    const slots = [...markup.matchAll(/glyph__slot--(\d)/g)].map(([, slot]) => Number(slot));
    expect([...slots].sort()).toEqual([0, 1, 2, 3]);

    // Every quarter starts at the same point — the centre of the oval — which is
    // what makes them quarters of one shape rather than four shapes.
    const starts = [...markup.matchAll(/d="M([\d.]+) ([\d.]+)/g)].map(([, x, y]) => `${x} ${y}`);
    expect(new Set(starts).size).toBe(1);
  });
});
