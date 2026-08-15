import { memo, type ReactNode } from 'react';
import type { Card } from '../../engine/cards.ts';
import { isNumberCard } from '../../engine/cards.ts';
import { BlockArt } from '../../../../lib/BlockArt.tsx';
import { arc, turn, type Box, type Part, type Pt, type Shape } from '../../../../lib/blockGeometry.ts';
import { digit, REVERSIBLE_DIGITS } from '../../../../lib/blockAlphabet.ts';

/**
 * The card symbols.
 *
 * Each one is a solid object: an outline drawn in a 100×100 box, which
 * `blockGeometry` extrudes down and to the left into a bright front face with its
 * own side and bottom walls, every edge outlined. Symbols made of several
 * pieces — the plus and the numeral of a "+2", the two arrows of a Reverse — are
 * given as separate parts so each is a solid in its own right and the pieces
 * overlap the way real blocks would.
 *
 * The one exception is the Wild, whose four-colour mark is one flat object cut
 * into quarters rather than a solid; it is drawn face by face here.
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

/**
 * A block arrow pointing down; the pair below is this one and its opposite.
 *
 * Vertical rather than horizontal, which is how the Reverse is printed: two
 * arrows running up and down side by side. A horizontal pair — which is what
 * this was, inherited — reads as "pass it along" rather than "turn the table
 * round", and that is the one thing the card must not be mistaken for.
 */
const ARROW: readonly Shape[] = [
  {
    outer: [
      [24, 6],
      [24, 54],
      [8, 54],
      [34, 94],
      [60, 54],
      [44, 54],
      [44, 6],
    ],
  },
];

/** Two arrows side by side, pointing opposite ways: the Reverse mark. */
const ARROWS: readonly Shape[] = [...ARROW, ...turn(ARROW, 54, 50)];

/* Compositions --------------------------------------------------------------- */

function scaleShapes(shapes: readonly Shape[], factor: number, dx: number, dy: number): Shape[] {
  const move = ([x, y]: Pt): Pt => [x * factor + dx, y * factor + dy];
  return shapes.map((shape) => ({
    outer: shape.outer.map(move),
    ...(shape.holes ? { holes: shape.holes.map((hole) => hole.map(move)) } : {}),
  }));
}

/**
 * A take-cards card's mark: "+2", not "2⁺".
 *
 * The plus comes *first*, to the left of the numeral and centred on its body,
 * at very nearly the numeral's own stroke weight — the mark is an arithmetic
 * instruction, "take two more", and that is the whole content of the card. The
 * deck this game was built from notates the same idea the other way round, as a
 * numeral with a small raised cross after it, and inheriting that layout made
 * every take-cards card here read as a power rather than a sum.
 *
 * `PLUS` is a fraction of the numeral's 76-unit body, chosen so the cross arms
 * come out at about the numeral's stroke weight rather than markedly thinner;
 * `GAP` is the smallest space at which the two solids' extruded walls do not
 * touch. Paint order needs no help: the drawing leans down and to the left, and
 * `buildSolids` sorts on that axis, so the numeral correctly laps over the plus.
 */
function counted(value: number): Part[] {
  const PLUS = 46;
  const GAP = 10;
  return [
    { shapes: scaleShapes(CROSS, PLUS / 100, 0, (76 - PLUS) / 2) },
    { shapes: scaleShapes(digit(value), 1, PLUS + GAP, 0) },
  ];
}

/* The Wild -------------------------------------------------------------- */

/**
 * The Wild's mark: one tilted oval cut into four coloured quarters.
 *
 * *One* object, four colours, which is the whole message — this single card is
 * every colour at once. It was four separate cubes standing apart on a floor,
 * inherited from the deck this was built from, and four separate objects in four
 * colours read as a set of blocks rather than as a choice of colour.
 *
 * Drawn face by face rather than extruded: the quarters meet along shared edges,
 * and giving each its own walls would put a lit side wall down the middle of a
 * shape that is meant to be continuous.
 */
const WHEEL = { cx: 50, cy: 50, rx: 44, ry: 34, tilt: -18 };

function ColorWheel(): ReactNode {
  const { cx, cy, rx, ry, tilt } = WHEEL;
  // Quarter, and the suit in it. Angles run clockwise from three o'clock, so
  // these are right, bottom, left, top — red, yellow, green, blue by CARD_COLORS.
  const wedges: ReadonlyArray<readonly [number, number, number]> = [
    [-45, 45, 0],
    [45, 135, 1],
    [135, 225, 2],
    [225, 315, 3],
  ];
  return (
    <g transform={`rotate(${tilt} ${cx} ${cy})`}>
      {wedges.map(([from, to, slot]) => (
        <path
          key={slot}
          className={`glyph__face glyph__slot--${slot}`}
          d={`M${cx} ${cy}L${arc(cx, cy, rx, ry, from, to, 10)
            .map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`)
            .join('L')}z`}
        />
      ))}
    </g>
  );
}

/** The corner index for the Wild: the same four suits, small enough to read. */
function WildIndex(): ReactNode {
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
      // The Wild is a flat quartered oval rather than an extruded outline, and is
      // taken before this function is reached.
      return { parts: [{ shapes: CROSS }] };
  }
}

/**
 * The corner index, where a symbol has to be *recognised* rather than read.
 *
 * A 6 and a 9 are one drawing turned over, and half the indices on a card are
 * printed upside down — so in a fanned hand, where a leading corner is often all
 * that shows, the two are the same mark. Underlined here, and only here: the
 * numeral in the middle of the card is always upright and needs no help, and
 * barring it would put a visibly smaller 6 beside every 5 to solve an ambiguity
 * that half of the card does not have.
 *
 * Everything else survives being drawn a few millimetres across, including the
 * busiest mark left in this deck — a plus beside a numeral. The Wild has its own
 * stand-in, taken before this function is reached.
 */
function indexFor(card: Card): Drawing | null {
  if (isNumberCard(card) && REVERSIBLE_DIGITS.includes(card.value)) {
    return { parts: [{ shapes: digit(card.value, true) }] };
  }
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
        {flat ? <WildIndex /> : <ColorWheel />}
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
