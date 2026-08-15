import type { ReactNode } from 'react';
import { BlockArt } from '../lib/BlockArt.tsx';
import type { Part } from '../lib/blockGeometry.ts';
import { letter, setAt, widthAt } from '../lib/blockAlphabet.ts';
import { useT } from './useT.ts';

/**
 * The wordmark: UNO, whose three letters are solid blocks in three of the four
 * suit colours.
 *
 * Drawn by the same engine as the card symbols, from the same alphabet, so the
 * mark and the deck are unmistakably the same object — bright faces, two tones
 * of wall, a line on every edge. The letters sit on one baseline and overlap
 * slightly; because a letter further right is nearer the viewer under this
 * projection, each one correctly laps over the one before it.
 *
 * Drawn rather than set in CSS so the blocks keep their proportions at every
 * size and in both writing directions; the accessible name is the plain title.
 */

/**
 * Cap height, and the space between letters — negative, so each letter's wall
 * lands on the face of the one before it. The mark is a heap of blocks pushed
 * together, not a line of type.
 */
const CAP = 76;
const TRACK = -5;
/**
 * A suit per letter, in an order chosen so no two neighbours share a hue.
 *
 * Three letters rather than four, and the mark lost its shoulder word with them:
 * the game this was built from had a small "SUPER" set over the left of a
 * four-letter block, and three heavy letters need no help filling the space.
 */
const SUITS = [0, 2, 3] as const;

export function BrandMark({ size = 'md' }: { readonly size?: 'sm' | 'md' }): ReactNode {
  const t = useT();
  const characters = [...t('app.titleMain')].slice(0, SUITS.length);

  let cursor = 0;
  const parts: Part[] = characters.map((character, index) => {
    const shapes = letter(character);
    const w = widthAt(shapes, CAP);
    const part: Part = {
      shapes: setAt(shapes, cursor + w / 2, CAP / 2, CAP),
      slot: SUITS[index] ?? 0,
    };
    cursor += w + TRACK;
    return part;
  });

  return (
    <svg className={`brand brand--${size}`} viewBox="0 0 208 104" role="img" aria-label={t('app.title')}>
      <BlockArt parts={parts} box={{ x: 4, y: 4, w: 200, h: 96 }} depth={[-14, 17.5]} prefix="brand" />
    </svg>
  );
}
