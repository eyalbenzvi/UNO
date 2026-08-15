# Robot players

## Why they exist

Three problems, one mechanism:

1. **A table that cannot fill up.** Two players is a game; one is not. A robot takes a seat
   and plays, so a single player has a table — and a table of three can play four-handed.
2. **A player whose phone dies.** The room already holds their seat for five minutes and
   passes their turn for free while they are gone. That keeps the _seat_, but after three
   orbits of skipping it is no longer a game. A robot plays their hand until they are back.
3. **A player who is there but not answering.** The table can nudge them, and then it waits.
   After that, a robot plays their turns until their next tap.

## What a robot is, exactly

A **room-side policy**, and nothing else. There is no robot in the engine, none on the wire,
and none in any client.

- The engine stays pure and knows nothing about robots. Every robot move is an ordinary
  `GameCommand` through `applyCommand`, exactly like a human's.
- A robot has no privileged path. It cannot express anything a remote player cannot express:
  its decisions are typed as the wire's `GameAction`, so `skipTurn`, `leaveGame` and
  `abandonRound` are unreachable from it by construction.
- Robots live in the room because the authoritative state does. They used to live in the room
  creator's tab, which meant that player leaving took the robots with them — along with the
  game. Neither goes anywhere now.

```
src/features/game/bot/
  view.ts     what a robot may know          (the only file that may see a GameState)
  policy.ts   what it decides                (pure; no clocks, no Math.random)
  runner.ts   when it decides                (one pause at a time; the pause is injected —
                                              on the server it is a Durable Object alarm)
  names.ts    what it is called
```

## A robot cannot see your hand

This is structural, not a promise. The room holds every hand, so a policy that read
`GameState` would be reading its opponents' cards. Instead `botViewFor()` builds a `BotView`
out of the same projections a remote client is sent:

| In a `BotView`                           | Not in a `BotView`                   |
| ---------------------------------------- | ------------------------------------ |
| `PublicGameState` — the whole table      | anybody else's cards                 |
| its own hand                             | the draw pile's order                |
| whether a challenge is open, and on whom | whether that challenge would succeed |
| which seats to go easy on, and how easy  | why, or anything they hold           |

The last row is a number per _seat_, decided by the person running the table before a card was
dealt. It carries no cards and says nothing whatever about what anybody is holding, so all
three tests above hold unchanged.

Three tests hold the line: no card id from another hand or from the draw pile appears in a
serialised view; the same decision comes out however the _other_ hands are rearranged; and
`view.ts` is the only file in the package that imports a `GameState`.

The first row is the one place this is subtler than "only what a client is sent". An open
challenge names who played the Wild Draw Four and who has to answer it, and both are public —
a person at the table can see exactly that much. What is _not_ published is whether the play
was a bluff: that is a fact about the player's hand, the room settles it only once somebody
has actually challenged, and a robot deciding whether to challenge is therefore guessing on
the same evidence a person guesses on.

## How it plays

Legality is never re-implemented: every candidate goes through the same `isCardPlayable` the
table's own UI highlights with, so a robot cannot drift from the rules or propose a move the
room would refuse.

**Priority.** Answer a challenge aimed at it → play a card that ends the round → declare a
last card → take the turn → call somebody out. The order is deliberate: an open Wild Draw Four
freezes every seat and only its target can unfreeze it; the declaration is not what wins, so
pausing to shout before a winning card would only hand the table a window to catch you; and
calling somebody out is the one move a human would rather make themselves.

**Choosing a card.** A score per playable card, best taken, ties broken from the room's
seeded stream:

| Card           | Reasoning                                                                                |
| -------------- | ---------------------------------------------------------------------------------------- |
| Wild Draw Four | the heaviest card in the deck; spent freely on a seat that is nearly out, kept otherwise |
| Draw Two       | strong, more so against a seat that is nearly out                                        |
| Skip           | strong at two players, where it is an extra turn; situational above that                 |
| Reverse        | the same card as a Skip at two players; worth little above that                          |
| number         | the baseline; prefers the colour the hand is strongest in                                |
| Wild           | hoarded — it is the one card that is always playable and never a bluff                   |

**Naming a colour.** Both wilds demand one, and the robot names the colour the _rest_ of its
hand is strongest in — the card it is about to play cannot help it next turn. A hand of
nothing but wilds falls back to the colour already in play, because the engine refuses a wild
with no colour named and a winning card must never be refused.

**After a draw** the turn is not over — that is UNO's rule and this game's — so the robot
re-decides on the state the draw produced: the drawn card if it is playable, and otherwise the
button that ends the turn. Nothing else in the hand is considered, because nothing else in the
hand is legal any more.

**A challenge** is answered on what a person can see: how many cards the player who laid the
Wild Draw Four is holding. Many cards means they were likelier to have held the colour, so a
bluff is likelier and calling it pays; a player down to their last card or two had few chances
to hold it, and being wrong costs six rather than four. It never peeks.

**In points** nothing about the policy changes, and that is not an oversight. Emptying the
hand is worth taking on sight whether it wins the round or the match, so the "play the card
that empties the hand" branch is right in both modes; the next round arrives as an ordinary
state change, which the robot re-reads like any other. `worker/test` plays a whole match out
against one.

## Deliberately not an oracle

- It never reasons about cards it has not seen, and does not count the discard pile to infer
  anybody's hand.
- It declares its own last card **at the speed of a tap** — a jittered fraction of a second,
  not the same tick. It used to wait a second or two, and that was not a window but a
  guarantee: a robot on one card was caught every round by whoever happened to be looking, so
  the rule stopped being something the table enforced and became something it farmed. On a
  seat it is merely _covering_ it declares at once, with no jitter at all — those four cards
  would follow somebody else into the standings for a rule they were not there to keep.
- It calls others out slowest of all its moves, so the people at the table normally get there
  first.
- It never calls out somebody who is not there — they cannot shout, so that would be farming
  rather than catching. A seat a robot is _playing_ is fair game: the robot can shout.
- It never calls out a seat the table has been asked to go easy on, and never aims a Draw Two,
  a Wild Draw Four or a Skip at one. See **Going easy** below.

## Going easy

A table can ask its robots to be gentle with particular seats — see
[assist.md](assist.md), which is where the whole feature is explained and where the reasons
live. Four things change, and none of them is a rule:

| What                | Ordinary table                         | A seat the table is leaning towards                              |
| ------------------- | -------------------------------------- | ---------------------------------------------------------------- |
| Calling them out    | anybody silent on one card             | never that seat; the humans may still call it                    |
| Challenging them    | on the evidence, like anybody else     | never                                                            |
| The punishing cards | worth _more_ against a seat nearly out | ranked below every ordinary card in the hand                     |
| Choosing a card     | always the best-scoring                | the second-best 25–50% of the time, at the top two dial settings |
| Its own last card   | 0–100 ms, effectively uncatchable      | 0.9–2 s, which a child can actually beat                         |

The last one gives back something a robot had taken. `BOT_DECLARE_*` is short on purpose — a
robot that paused was caught every round by whoever happened to be looking, so the rule stopped
being enforced and started being farmed. That argument is about a table of equals, and it is
the wrong argument at a table with a six-year-old at it: catching a robot out is one of the few
moments in this game a small child can win unaided.

A robot is never lenient towards its **own** seat, including a human seat it is standing in
for: that hand is played to win it, which is the point of covering it at all.

## Timing

All in `network/timing.ts`, all jittered from a per-seat seeded stream.

| Constant                          | Value      | What it is                                          |
| --------------------------------- | ---------- | --------------------------------------------------- |
| `BOT_THINK_MIN_MS` … `MAX`        | 0.7–1.7 s  | before an ordinary move                             |
| `BOT_SEQUENCE_MIN_MS` … `MAX`     | 0.62–0.9 s | between cards inside a turn                         |
| `BOT_DECLARE_MIN_MS` … `MAX`      | 0–0.1 s    | before declaring its own last card                  |
| `BOT_SOFT_DECLARE_MIN_MS` … `MAX` | 0.9–2 s    | the same, at a table that is going easy on somebody |
| `BOT_CATCH_MIN_MS` … `MAX`        | 2.2–4.0 s  | before calling somebody out                         |
| `BOT_ANSWER_MIN_MS` … `MAX`       | 0.5–1.2 s  | before answering a challenge aimed at it            |
| `BOT_STALL_MS`                    | 15 s       | before the room passes a robot's own seat           |
| `STAND_IN_ABSENT_MS`              | 45 s       | absence before a robot may play a human's seat      |
| `STAND_IN_IDLE_MS`                | 90 s       | silence, while present, before the same             |

`BOT_STALL_MS` is the one that is not about pacing. A robot cannot be absent, so no grace,
hold or vacate would ever rescue a table stuck on one — a suspended tab, a throttled timer or
a bug in the driver would stop the round with nothing on screen to explain it. Past the
deadline the room passes the seat itself, and logs that it had to.

## Standing in for a human

`standInEnabled` is a table setting, on by default, visible to every player in the lobby
snapshot and changeable by the seat holding the lobby buttons. When it is off, absence behaves exactly as it did before
robots existed.

A stand-in is **layered on top of** the passed turn, never in place of it:

| Time since the seat went quiet | What happens                                           |
| ------------------------------ | ------------------------------------------------------ |
| 0–12 s                         | nothing; they may be back in a second                  |
| 12 s onwards                   | their turn is passed, for the card the turn would cost |
| 45 s onwards                   | a robot plays the seat — if the table allows it        |
| any moment they speak          | the seat is theirs again, before their move is applied |

The last row is the whole design. A stand-in changes nothing else about the seat: not the
credential, not the resume token, not the name, not the standings. It is a favour the table
does somebody, and it ends the instant it is not needed.

Never stood in for:

- a seat whose owner **said goodbye** — that was a decision, and playing the hand of somebody
  who has left is not a favour;
- a seat that is **visibly trying to come back** (a rejoin attempt in the last 20 s);
- a seat that has **left the round**;
- a seat the table has already **stopped a robot on**, for the kind of cover it stopped: a
  refusal about somebody's silence says nothing about what should happen when their phone
  actually dies, and it is spent as soon as they say anything;
- a seat that is **here and answering**: "let a robot play" needs the table to have
  actually been waiting on that player, or one mis-tap takes a hand off somebody mid-turn;
- anybody, while the table is **paused**.

The table keeps both ways out while a robot is playing: **stop the robot**, which is remembered
rather than undone by the next sweep, and **remove from the round** — the covered seat is
deliberately not listed as a held one, so those live on the robot's own notice.

Release is keyed on `lastIntentAt` — the last thing that seat actually _asked for_ — and never
on a heartbeat. A phone in a pocket answers every probe perfectly, so keying it on the wire
would have released every stand-in five seconds after it began.

The room creator's own seat is covered too: their own tap is an intent like any other, so somebody who
puts the phone down does not stop the round, and picking it up takes the seat straight back.

## What the table sees

- A robot seat carries a robot badge in the lobby and at the table, and no connection badge —
  there is no connection to report on.
- A seat a robot is standing in for keeps its owner's name and gains a notice every player
  sees: _"a robot is playing for Noa"_. The seat-hold countdown is suppressed while it lasts,
  because the table is not waiting for anybody.
- The seat holding the lobby buttons can start a stand-in early, or stop one, from that notice.
- A robot is called **"Robot 1"**, "Robot 2" and so on, in the table's language, numbered from
  the lowest number the table is not using — so removing one and adding another reuses its
  number rather than climbing. Human first names were tried and were the wrong call: the one
  thing a player needs to know about a seat is whether a person is behind it.
- The creator can **take a robot off the table** from the seat's own row, right up to the deal.
  Unlike removing a person it asks nothing first, because nothing is lost: a robot removed by
  mistake is one tap away from coming back.

Nothing about robot-ness is hidden, and nothing about it is inferred from a name: a human may
of course call themselves "Robot 1", and the badge comes from the seat, not the string.

## Votes

| Vote              | A robot seat                                                               | A seat a robot is standing in for                                                        |
| ----------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Play again        | always agrees — otherwise a table with one could never deal a second round | agrees, for the same reason                                                              |
| Abandon the round | not counted: stopping is a decision, and it has no view                    | not counted: nobody is answering for that seat, which is usually why the vote was called |

A new round is still dealt by a person. Robots agree so they can never block one, but nothing
starts a round on their say-so alone: a table where every seat is robot-controlled waits on the
standings until somebody taps, which is the only reading under which the standings are for
anybody. Their agreement is also never _published_ — the count on screen is a count of people,
so the one player still there is told the table is waiting for them rather than that everybody
is ready.

An open Wild Draw Four has its own deadline for the same reason. While one is open the seat on
turn is the player who _played_ it, so the target answering every heartbeat and tapping nothing
would freeze the whole table with nothing on any screen to explain it. Past `STAND_IN_IDLE_MS`
a robot takes that seat and answers — or, if the table has robots switched off, the room takes
the cards for it, which is the answer that costs the absent seat least.

## What a robot does not need

Two things every human client has, that a robot has no use for and does not get: the
`turnToken` that catches a move computed against a table that has moved on (a robot decides
from the state it is applied against, in the same tick), and the action lock that stops a
double tap. Neither is an advantage — they exist to make a _network_ honest, and there is no
network between a robot and the state it plays against.

## Wire and storage

Three fields in the lobby snapshot: `lobbyPlayer.bot` and `lobbyPlayer.standIn` per seat, both
optional, and `lobbySnapshot.standInEnabled`, which is required as of protocol 6 — every table
has an answer to "may a robot cover a seat", so a snapshot that omits it is a snapshot with a
hole in it rather than an older one.

The room's stored record carries `bot` per seat and the table setting, so a hibernation keeps
its robots. This is the whole of the durability story now, and it used to be the interesting
part of this section: a robot lived in the room creator's tab, so a handover had to carry it to
another device in a snapshot the _receiving_ build validated — and a successor on a build
without the `bot` field would have stripped it and left the seats human, with nobody behind
them. There is no handover, no snapshot and no successor. The room holds its robots because the
room holds everything.

## Not implemented, on purpose

- **No difficulty levels.** One competent policy. The seams for more are the score table and
  the injected randomness.
- **No robots added mid-round.** A round is dealt to the seats it starts with; a stand-in is
  the mid-round mechanism.
- **No client-side robots.** A robot needs the authoritative state, and that is the room's.
- **No personality, no chat.** It plays cards.
