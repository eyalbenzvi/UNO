import { cardColor } from '../../../src/features/game/engine/cards.ts';
import { createRng } from '../../../src/features/game/engine/prng.ts';
import { WILD_KINDS } from '../../../src/features/game/engine/cards.ts';
import type {
  Card,
  CardColor,
  ColoredActionKind,
  NumberValue,
  WildKind,
} from '../../../src/features/game/engine/cards.ts';
import type {
  CommandResult,
  EnginePlayer,
  GameEvent,
  GameState,
  PlayerId,
  RejectionCode,
} from '../../../src/features/game/engine/state.ts';

let counter = 0;

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}#${counter}`;
}

/**
 * Compact card factory for tests.
 * `'red:5'` -> red 5, `'blue:skip'` -> blue Skip, `'wild'` / `'wildDrawFour'` -> colourless.
 */
export function card(spec: string): Card {
  if ((WILD_KINDS as readonly string[]).includes(spec)) {
    return { id: nextId(spec), kind: spec as WildKind };
  }
  const [color, rest] = spec.split(':');
  if (!color || !rest) {
    throw new Error(`Invalid card spec: ${spec}`);
  }
  const numeric = Number(rest);
  if (Number.isInteger(numeric)) {
    return {
      id: nextId(spec),
      kind: 'number',
      color: color as CardColor,
      value: numeric as NumberValue,
    };
  }
  return { id: nextId(spec), kind: rest as ColoredActionKind, color: color as CardColor };
}

export function cards(...specs: string[]): Card[] {
  return specs.map(card);
}

export function players(...names: string[]): EnginePlayer[] {
  return names.map((name) => ({ id: `p-${name.toLowerCase()}`, name }));
}

export interface StateOverrides {
  players?: EnginePlayer[];
  mode?: GameState['mode'];
  /** How far the table leans towards each seat. Defaults to not at all. */
  assist?: GameState['assist'];
  hands?: Record<PlayerId, Card[]>;
  drawPile?: Card[];
  discardPile?: Card[];
  activeColor?: CardColor;
  direction?: 1 | -1;
  currentPlayerIndex?: number;
  drawnCardId?: string | null;
  challenge?: GameState['challenge'];
  declaredUno?: readonly PlayerId[];
  /**
   * Seats that can still be caught, and the turn they became catchable on.
   *
   * Defaulted to "everybody on a single uncalled card is catchable now", because
   * that is what a test setting up a catch almost always means — and stamping it by
   * hand in every such test would make the window's own tests indistinguishable
   * from the tests that merely need it open.
   */
  unoExposed?: Record<PlayerId, number>;
  points?: Record<PlayerId, number>;
  phase?: GameState['phase'];
  winnerId?: PlayerId | null;
  endReason?: GameState['endReason'];
  turnSeq?: number;
  version?: number;
}

/** Builds a fully-specified game state for targeted rule tests. */
export function makeState(overrides: StateOverrides = {}): GameState {
  const list = overrides.players ?? players('Alice', 'Bob');
  const hands: Record<PlayerId, Card[]> = {};
  for (const player of list) {
    hands[player.id] = overrides.hands?.[player.id] ?? cards('red:1');
  }
  const turnSeq = overrides.turnSeq ?? 0;
  const declaredUno = overrides.declaredUno ?? [];
  const exposed: Record<PlayerId, number> =
    overrides.unoExposed ??
    Object.fromEntries(
      list
        .filter(
          (player) =>
            player.left !== true &&
            (hands[player.id] ?? []).length === 1 &&
            !declaredUno.includes(player.id),
        )
        .map((player) => [player.id, turnSeq]),
    );
  const discardPile = overrides.discardPile ?? cards('red:9');
  const top = discardPile[discardPile.length - 1];
  const fallbackColor: CardColor = (top ? cardColor(top) : null) ?? 'red';

  return {
    version: overrides.version ?? 1,
    phase: overrides.phase ?? 'playing',
    mode: overrides.mode ?? 'classic',
    players: list,
    assist: overrides.assist ?? {},
    hands,
    drawPile: overrides.drawPile ?? cards('green:4', 'green:5', 'green:6'),
    discardPile,
    activeColor: overrides.activeColor ?? fallbackColor,
    direction: overrides.direction ?? 1,
    currentPlayerIndex: overrides.currentPlayerIndex ?? 0,
    drawnCardId: overrides.drawnCardId ?? null,
    challenge: overrides.challenge ?? null,
    declaredUno,
    unoExposed: exposed,
    points: overrides.points ?? {},
    rng: createRng(12345),
    winnerId: overrides.winnerId ?? null,
    endReason: overrides.endReason ?? null,
    turnSeq,
    seed: 12345,
  };
}

/** Unwraps a successful command result, failing loudly otherwise. */
export function expectOk(result: CommandResult): { state: GameState; events: readonly GameEvent[] } {
  if (!result.ok) {
    throw new Error(`Expected success but command was rejected: ${result.rejection.code}`);
  }
  return { state: result.state, events: result.events };
}

/** Asserts a command was rejected with the given code. */
export function expectRejected(result: CommandResult, code: RejectionCode): void {
  if (result.ok) {
    throw new Error(`Expected rejection ${code} but command succeeded`);
  }
  if (result.rejection.code !== code) {
    throw new Error(`Expected rejection ${code} but got ${result.rejection.code}`);
  }
}

export function eventTypes(events: readonly GameEvent[]): string[] {
  return events.map((event) => event.type);
}

export function handOf(state: GameState, playerId: PlayerId): Card[] {
  return (state.hands[playerId] ?? []).slice();
}

export function idOf(state: GameState, playerId: PlayerId, spec: string): string {
  const match = (state.hands[playerId] ?? []).find((candidate) => candidate.id.startsWith(`${spec}#`));
  if (!match) {
    throw new Error(`Card ${spec} not in hand of ${playerId}`);
  }
  return match.id;
}
