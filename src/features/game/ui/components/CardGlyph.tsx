import { memo, type ReactNode } from 'react';
import type { Card } from '../../engine/cards.ts';
import { isNumberCard } from '../../engine/cards.ts';
import { BlockArt } from '../../../../lib/BlockArt.tsx';
import { arc, turn, type Box, type Part, type Pt, type Shape } from '../../../../lib/blockGeometry.ts';
import { digit } from '../../../../lib/blockAlphabet.ts';

/**
 * The card symbols.
 *
 * Each one is a solid object: an outline drawn in a 100×100 box, which
 * `blockGeometry` extrudes down and to the left into a bright front face with its
 * own side and bottom walls, every edge outlined. Symbols made of several
 * pieces — a numeral and the plus beside it, the four letters of TAKI — are
 * given as separate parts so each is a solid in its own right and the pieces
 * overlap the way real blocks would.
 *
 * The one exception is the Wild, whose cubes are seen straight on in isometric
 * rather than leaning, exactly as the four-colour mark is printed; those are drawn
 * face by face here.
 */

const BOX: Box = { x: 3, y: 3, w: 94, h: 94 };

/* Outlines ------------------------------------------------------------------- */

/** A blunt cross, the take-cards mark. Drawn once, reused at three sizes. */
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

/**
 * The prohibition ring: a heavy annulus with a bar laid across it.
 *
 * A ring rather than a disc with a slot cut in it, because the counter has to
 * survive the extrusion — the inner wall eats into it from the top left, and a
 * thinner ring closes up into a solid blob at the size a corner index is drawn.
 */
const RING: readonly Shape[] = [
  { outer: arc(50, 50, 48, 48, 0, 360, 20), holes: [arc(50, 50, 30, 30, 0, 360, 20)] },
];

/**
 * The bar, on the upper-left-to-lower-right diagonal every prohibition sign uses.
 *
 * Its own part rather than a hole in the ring, so it extrudes as a solid in front
 * of the ring and reads as two objects — which is what the printed card shows, and
 * what stops the mark reading as a letter O with a scratch on it.
 */
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

/** A block arrow pointing right; the pair below is this one and its opposite. */
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

/** Two arrows head to tail, the Change Direction mark. */
const ARROWS: readonly Shape[] = [...ARROW, ...turn(ARROW, 50, 54)];

/* Compositions --------------------------------------------------------------- */

function scaleShapes(shapes: readonly Shape[], factor: number, dx: number, dy: number): Shape[] {
  const move = ([x, y]: Pt): Pt => [x * factor + dx, y * factor + dy];
  return shapes.map((shape) => ({
    outer: shape.outer.map(move),
    ...(shape.holes ? { holes: shape.holes.map((hole) => hole.map(move)) } : {}),
  }));
}

/** A numeral with the small cross that marks a take-cards card. */
function counted(value: number, numeralSlot?: number): Part[] {
  return [
    {
      shapes: scaleShapes(digit(value), 1, 0, 22),
      ...(numeralSlot === undefined ? {} : { slot: numeralSlot }),
    },
    { shapes: scaleShapes(CROSS, 0.36, 62, 0), slot: numeralSlot === undefined ? undefined : 0 },
  ];
}

/* The Wild -------------------------------------------------------------- */

/**
 * Half-width, half-height and wall height of one cube, and the step between
 * cubes. The step is wider than the cube, so the four stand apart instead of
 * fusing into one block with four coloured lids — the printed card floats them
 * the same way, and it is the only way each cube keeps all three of its faces.
 */
const CUBE = { w: 19, h: 11, d: 21, stepX: 28.5, stepY: 16.5 };

/**
 * One cube: a rhombus lid over a left and a right wall. It borrows the same
 * three tones the extruded symbols use — face, side, bottom — so a cube and a
 * numeral look like they are made of the same stuff.
 */
function CubeBlock({
  x,
  y,
  slot,
}: {
  readonly x: number;
  readonly y: number;
  readonly slot: number;
}): ReactNode {
  const { w, h, d } = CUBE;
  return (
    <g className={`glyph__slot--${slot}`} transform={`translate(${x} ${y})`}>
      <path className="glyph__wall glyph__wall--mid" d={`M${-w} 0 0 ${h} 0 ${h + d} ${-w} ${d}z`} />
      <path className="glyph__wall glyph__wall--deep" d={`M${w} 0 ${w} ${d} 0 ${h + d} 0 ${h}z`} />
      <path className="glyph__face" d={`M0 ${-h} ${w} 0 0 ${h} ${-w} 0z`} />
    </g>
  );
}

/**
 * Four cubes on a two-by-two floor, one suit each, painted back to front the
 * way an isometric stack has to be.
 */
function CubeStack(): ReactNode {
  const { stepX, stepY } = CUBE;
  // Floor cell (i, j), and the suit standing on it. Painted in order of i + j,
  // which for an isometric floor is back to front.
  const cells: ReadonlyArray<readonly [number, number, number]> = [
    [0, 0, 0],
    [1, 0, 1],
    [0, 1, 3],
    [1, 1, 2],
  ];
  return (
    <g transform="translate(50 23)">
      {cells.map(([i, j, slot]) => (
        <CubeBlock key={`${i}-${j}`} x={(i - j) * stepX} y={(i + j) * stepY} slot={slot} />
      ))}
    </g>
  );
}

/** The corner index for Change Colour: the four suits, small enough to read. */
function CubeIndex(): ReactNode {
  const quarters: ReadonlyArray<readonly [string, number]> = [
    ['M50 6 94 50 50 50z', 0],
    ['M94 50 50 94 50 50z', 1],
    ['M50 94 6 50 50 50z', 2],
    ['M6 50 50 6 50 50z', 3],
  ];
  return (
    <>
      {quarters.map(([d, slot]) => (
        <path key={slot} className={`glyph__face glyph__slot--${slot}`} d={d} />
      ))}
    </>
  );
}

/* Symbol table --------------------------------------------------------------- */

interface Drawing {
  readonly parts: readonly Part[];
  /** A crowded drawing leans less, or the pieces bury each other. */
  readonly depth?: Pt;
}

const SHALLOW: Pt = [-6, 7.2];

function drawingFor(card: Card): Drawing {
  if (isNumberCard(card)) return { parts: [{ shapes: digit(card.value) }] };
  switch (card.kind) {
    case 'skip':
      return { parts: [{ shapes: RING }, { shapes: BAR }], depth: SHALLOW };
    case 'reverse':
      return { parts: [{ shapes: [ARROWS[0]!] }, { shapes: [ARROWS[1]!] }], depth: SHALLOW };
    case 'drawTwo':
      return { parts: counted(2), depth: SHALLOW };
    case 'wildDrawFour':
      return { parts: counted(4), depth: SHALLOW };
    default:
      // The Wild is drawn as cubes rather than an extruded outline, and is taken
      // before this function is reached.
      return { parts: [{ shapes: CROSS }] };
  }
}

/**
 * Corner indices are a few millimetres across. The full drawing does not
 * survive that, so the busiest symbols show a stand-in there — a single T for
 * TAKI, the four suits as a quartered diamond for Change Colour — the way the
 * printed deck shrinks its own indices down to a mark.
 */
function indexFor(card: Card): Drawing | null {
  /*
   * Nothing needs a stand-in any more. The busiest symbol in this deck is a
   * numeral beside a small cross, which survives being drawn a few millimetres
   * across; the deck this game was built from had a four-letter wordmark on two
   * cards, which did not. Kept as a seam because the corner index is the one place
   * where a symbol has to be *recognised* rather than read, and the next card added
   * to the deck may well need one.
   */
  void card;
  return null;
}

export interface CardGlyphProps {
  readonly card: Card;
  /** Renders the front face alone, for the corner indices. */
  readonly flat?: boolean;
}

/**
 * Memoised, and compared on what the drawing actually depends on rather than on
 * object identity: two Red 5s are the same picture, and a card object that is
 * replaced wholesale by an incoming snapshot must not redraw a symbol that has
 * not changed. Every symbol here is built from polygon geometry at render time,
 * so this is the difference between a smooth table and a stuttering one.
 */
export const CardGlyph = memo(
  CardGlyphInner,
  (a, b) =>
    a.flat === b.flat &&
    a.card.kind === b.card.kind &&
    colorOf(a.card) === colorOf(b.card) &&
    valueOf(a.card) === valueOf(b.card),
);

function colorOf(card: Card): string | null {
  return 'color' in card ? card.color : null;
}

function valueOf(card: Card): number | null {
  return 'value' in card ? card.value : null;
}

function CardGlyphInner({ card, flat = false }: CardGlyphProps): ReactNode {
  if (card.kind === 'wild') {
    return (
      <svg className="glyph" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        {flat ? <CubeIndex /> : <CubeStack />}
      </svg>
    );
  }
  const drawing = (flat ? indexFor(card) : null) ?? drawingFor(card);
  return (
    <svg className="glyph" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <BlockArt
        parts={drawing.parts}
        box={BOX}
        flat={flat}
        {...(drawing.depth ? { depth: drawing.depth } : {})}
      />
    </svg>
  );
}
