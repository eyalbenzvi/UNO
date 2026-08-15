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

    /*
     * Taken in paint order, not sorted into it. The drawing leans down and to the
     * left and `buildSolids` paints along that axis, so the plus — which is behind
     * — is emitted first and the numeral laps over it. Sorting the two by position
     * would define the answer this test is asking for: whichever came out on the
     * left would be named "plus", and "the plus is left of the numeral" would then
     * be true of the layout this replaced as well as of the one it asserts.
     */
    const [plus, numeral] = faces.map((points) => boundsOf(points));
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
  it('tell a 6 from a 9 in the corner index, which is printed both ways up', () => {
    // The underlined forms — what a corner index draws. The bare forms in the
    // middle of the card are deliberately one drawing turned over, and need not be
    // told apart: that numeral is always upright.
    const six = digit(6, true).flatMap((shape) => shape.outer);
    const nine = digit(9, true).flatMap((shape) => shape.outer);
    expect(six).toHaveLength(nine.length);

    const bounds = boundsOf(six);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const turned = six.map(([x, y]) => [2 * cx - x, 2 * cy - y] as const);

    // Turning a 6 over must not produce this deck's 9. Compared as sets of points,
    // because the two rings need not start at the same corner. Without the bar the
    // two are equal to the last decimal, which is exactly the defect.
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

    /*
     * Four paths, no more, and every one of them beginning at the centre of the
     * oval: that shared vertex is the whole difference between four quarters of one
     * shape and four shapes standing near each other.
     *
     * The sign in the coordinate pattern matters more than it looks. Without it the
     * four separate cubes this replaced also passed — their negative start points
     * simply did not match, leaving one path per cube whose `d` was identical
     * because a cube was positioned by a transform rather than by its own geometry.
     */
    const paths = [...markup.matchAll(/d="M(-?[\d.]+) (-?[\d.]+)/g)].map(
      ([, x, y]) => `${Number(x)} ${Number(y)}`,
    );
    expect(paths).toHaveLength(4);
    expect(new Set(paths)).toEqual(new Set(['50 50']));
  });
});
