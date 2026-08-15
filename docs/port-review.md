# Porting Taki to UNO — what the review passes found

This game was not written from nothing. It is a port: an existing, finished Taki game
(SuperTaki) whose architecture, transport, resilience, robots, accessibility and look were
kept exactly as they were, and whose **deck and rules were replaced**. That is a specific and
slightly unusual kind of change, and it fails in a specific way — the parts nobody thought to
look at keep quietly meaning the old game.

Four review passes were run against it: an architecture review and a rules review of the plan
before any code was written, then a senior code review and a QA acceptance pass on the
finished port. This records what they found, because most of it is only obvious in hindsight
and all of it is the kind of thing a second port would repeat.

---

## The plan reviews, before the code

**The soft rule that had been hard-gated.** The plan said a Wild Draw Four may be a bluff and
described the challenge in detail — and separately specified that the card would be
_unplayable_ unless the hand held no card of the colour in play. Those cannot both be true. A
card the table refuses to let you lay cannot be laid dishonestly, so the entire challenge
subsystem would have been dead code guarding a state no game could reach. `isCardPlayable`
returns true for both wilds unconditionally, and `isWildDrawFourHonest` answers the separate
question the challenge asks.

**The rule the port would have inherited silently.** In Taki, drawing ends your turn. In UNO
it does not: you take one card, and you may play _that card_ or end the turn yourself. Nothing
in the plan mentioned it, because nothing in the source game had a concept to rename. It is
the single most-often-wrong rule in digital UNO, and it needed a command (`passTurn`), a piece
of state (`drawnCardId`), a restriction in the playability rules, and a prompt.

**The ordering trap.** The challenge verdict must be computed against the colour in play
_before_ the card is laid. Read a line later — after `activeColor` becomes the colour the
player just chose — the question becomes "do you hold the colour you named", which a player
naming their own strongest colour answers yes to almost every time. Every bluff would have
been exonerated, and the card that makes UNO interesting would have been a coin the challenger
always loses.

**A card id spells the card.** `drawnCardId` cannot be public: ids in this deck read
`n-red-5-0`. The public view carries `hasDrawn: boolean`.

**Two games, one origin.** GitHub Pages project sites share an origin, so `localStorage` keys
had to move from `superTaki:` to `uno:` or the two games would read each other's resume
offers. Worse, the Durable Object namespace is addressed by room code: deployed under the same
worker name, a six-digit collision between the two games would have resolved as the
corrupt-storage wipe, and players of one game would have silently deleted live rooms of the
other. Both are guarded by tests now.

---

## The card deck

The product owner looked at a rendered contact sheet of all 54 faces and said, in effect, that
it did not look like UNO. An UNO subject-matter expert audited it against a retail deck.

The **composition** was already exact: 108 cards, one 0 and two each of 1–9 per colour, two
each of Skip, Reverse and Draw Two, four Wilds, four Wild Draw Fours, official point values
summing to 1240, target 500. UNO has no 10, so its absence was correct.

Every defect was in the artwork, and all of it was inherited geometry that had never been
re-drawn:

|                 | Was (Taki's)                                           | Is (UNO's)                                                                               |
| --------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Take-cards mark | `2⁺` / `4⁺` — numeral first, small raised cross        | **`+2` / `+4`** — plus first, at the numeral's weight, centred on its body               |
| Wild Draw Four  | violet numeral on a white card                         | **black card, white `+4`** — UNO has no fifth colour, and black is what says "no colour" |
| Card body       | white stock, coloured symbol                           | **solid suit colour, white margin, tilted white oval** under the symbol                  |
| Wild            | four separate floating cubes                           | **one oval cut into four coloured quarters** — one object, four colours                  |
| Reverse         | two horizontal arrows                                  | **two vertical arrows** — a horizontal pair reads as "pass it along"                     |
| 6 and 9         | one drawing rotated: a 6's upside-down index _was_ a 9 | **both underlined, in the corner index only**                                            |

The 6/9 fix is worth stating precisely, because the obvious version of it is wrong. Barring
the numeral grows its drawn body from 76 units to 98, and since every symbol is fitted to the
same box, that renders each 6 and 9 about a fifth smaller than the 5 beside it. The ambiguity
exists only in the **corner index**, where half the indices are printed upside down; the large
numeral in the middle is always upright. So `digit()` takes the bar as a parameter, and only
`indexFor` asks for it.

`tests/unit/lib/cardArt.test.ts` pins the three that could regress silently. Each assertion
fails on the code it replaced — which two of them did not, at first: the Wild's "four quarters
of one shape" test passed against the four separate cubes, because its coordinate pattern
could not match a leading minus sign and it ended up comparing the one path per cube that
happened to start with a digit.

---

## What the code review found

- **The white oval was clipped flush into the white margin.** Its rotated extent reached 0.50
  of the card's width against the 0.455 the padding box has, so it was cut off level with the
  border and read as a band _across_ the card rather than a shape _on_ one.
- **The pile's height arithmetic still divided by 2:3** after the cards took the printed
  56 × 88 proportion, silently eating the six pixels of slack that exist so a platform's font
  metrics cannot break the layout.
- **A dead branch with a false justification.** `beginTurnAction` spared the actor's own UNO
  window on the reasoning that a player cannot close their own window by taking the turn after
  it. Mutation coverage said the line never mattered — and the comment defending it stated
  three things the code contradicts. The one state where old and new differ is a draw against
  a pile with nothing left in it, where a catch would draw two cards from the same empty pile
  and cost nothing.
- **A test that defined its own answer.** The `+2` layout test sorted the two solids by
  position and _then_ asked which was on the left.
- **Deal-dependence, six times.** The opening card's effect falls on the first seat before
  anybody has moved, and at two seats a Skip, a Reverse and a Draw Two all hand the turn
  straight over — so about one deal in four does not begin with the room's creator. Six
  end-to-end tests assumed it did.

---

## What the QA pass found

**The blocker.** The Wild Draw Four prompt named the wrong colour. The rule is judged against
the colour in play when the card was laid, and that colour is _gone_ by the time anybody sees
the challenge — the card repaints the table to the one its owner chose. The prompt read
`activeColor`, so it asked the victim "if they were holding the colour they just named". An
honest player by definition cannot have been. Wrong in essentially every real play, in front
of the one decision in this game that costs six cards.

Fixing it needed the colour on the wire: `ChallengeState` carries it, the public view
publishes it — everybody at a real table saw what was on the pile a moment ago — and the
stored round keeps it. The verdict itself stays private, which is what the challenge is for.

No test caught it because the component fixture built a state the engine cannot produce: an
open challenge whose discard top is not the Wild Draw Four.

**Four more a real table would hit within an evening.** The waiting notice named the player who
had already moved rather than the one holding everyone up. A player removed from the round was
left on a table that refused everything with no explanation — "wait for your turn", for the
rest of the round, about a turn that was never coming. The blocked draw pile chose between two
sentences where five conditions block it, so it could show one reason on screen and announce a
contradictory one to a screen reader. And the Hebrew — the default language — still called UNO
by the ported game's name in the four catch notices, and named every coloured action card in
English word order ("red stop" rather than "stop red"), which reaches twelve of the 54 faces on
every screen a Hebrew player touches.

**Documentation that had drifted from the code.** `docs/rules.md` stated the absence rule with
the wrong number by a factor of 25 — five minutes is how long the _seat_ is held, not the
_turn_, which is passed after about twelve seconds. It also credited the robot's challenge
policy with reasoning it does not do.

**Tests that could not fail.** The whole 500-point match assertion sat inside an `if` that only
held when the room's creator happened to win the round. The end-to-end drivers had been looking
for a "Last card!" button since the rename, so no end-to-end run had ever declared UNO or been
caught for not declaring. And a component test asserted the absence of a standings column that
no longer exists.

---

## The lesson, if there is one

Almost nothing above is a bug in the sense of a wrong line of code. They are places where the
port left something _meaning the old game_ — a comment, a colour, a piece of geometry, a
sentence in the default language, a test fixture, a documented number. The engine, which is
where the attention naturally goes, was largely right from the first pass. What needed four
reviews was everything around it.
