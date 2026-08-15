# Rules of UNO / חוקי אונו

These are the **exact** rules the engine implements. Where editions of UNO disagree, one
interpretation was chosen, documented here, and covered by tests. Where this build
deliberately departs from the official rules, it says so and says why. The app itself has no
rules page: this file is the specification.

Every rule below corresponds to at least one unit test in `tests/unit/engine/`.

---

## English

### The deck — 108 cards

| Cards                               | Count     | Total   |
| ----------------------------------- | --------- | ------- |
| 0, four colours, one of each        | 4 × 1     | 4       |
| 1–9, four colours, two of each      | 9 × 4 × 2 | 72      |
| Skip, four colours, two of each     | 4 × 2     | 8       |
| Reverse, four colours, two of each  | 4 × 2     | 8       |
| Draw Two, four colours, two of each | 4 × 2     | 8       |
| Wild (no colour)                    | —         | 4       |
| Wild Draw Four (no colour)          | —         | 4       |
| **Deck total**                      |           | **108** |

Colours: **red, yellow, green, blue**.

**The nought is printed once per colour**, and every other number twice. That is four of the
deck's 108 cards, and it is why a 0 is worth holding on to.

**Both wilds repaint the table.** A Wild Draw Four is not "a Draw Four that happens to be
colourless" — it is a wild, and its owner names the colour play continues in, whether the
card was honest or a bluff, and whether or not the challenge that follows goes against them.
Playing either wild without a colour is rejected with `colorRequired`; playing any coloured
card _with_ one is rejected with `colorNotAllowed`.

### Setup

- 2 to 6 players. Seats keep the order in which players joined, and that order is visible to
  everyone. (Official UNO allows up to 10 — see **Deliberate limitations**.)
- The deck is shuffled with a seeded PRNG, so a given seed always deals the same game.
- Each player is dealt **7 cards**.
- The top card of the remaining deck is turned up to start the discard pile. **A wild of
  either kind is buried at the bottom of the draw pile and another card turned up** — see
  **Where editions disagree** for the half of that which is a deviation.
- The opening card's effect falls on the first player, exactly as it does at a table:

  | Opening card | What happens                                                                               |
  | ------------ | ------------------------------------------------------------------------------------------ |
  | Number       | Nothing. The first player takes an ordinary turn.                                          |
  | Skip         | The first player loses their turn; play passes to the next seat.                           |
  | Reverse      | Play turns round: **the dealer goes first**, and the player to the dealer's right is next. |
  | Draw Two     | The first player draws two cards and loses their turn.                                     |

  The "dealer" here is the seat before the one that would nominally open, because play
  starts to the dealer's left. At two seats an opening Reverse and an opening Skip name the
  same player, which is the two-player rule falling out rather than being written twice.

### A turn

On your turn you do exactly one of:

1. **Play a legal card**, or
2. **Draw one card from the draw pile.** This does **not** end your turn. If the card you
   drew can be played, you may play it — that card and nothing else from your hand — or you
   may end your turn. Drawing is voluntary: you may draw even while holding a perfectly good
   card, and the rules have nothing to say about it.

Ending your turn is only legal once you have drawn. There is no free pass in UNO: you play
or you draw. The single exception is a pile with nothing left in it, discard included —
drawing then takes nothing, and refusing the pass as well would leave the turn with no legal
move at all.

A card is legal when it matches the **colour** in play, matches the **symbol** on the top
card (its number, or its action), or is a **wild**. After a wild the colour in play is the
one that was named, which is not the colour of any card on the pile.

### The action cards

| Card               | Effect                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------- |
| **Skip**           | The next player loses their turn.                                                             |
| **Reverse**        | Play turns round. **At two seats it acts as a Skip**, so the player who played it goes again. |
| **Draw Two**       | The next player draws two cards and loses their turn.                                         |
| **Wild**           | You name the colour play continues in.                                                        |
| **Wild Draw Four** | You name the colour; the next player draws four and loses their turn — unless they challenge. |

**There is no stacking.** A Draw Two cannot be answered with another Draw Two, and a Wild
Draw Four cannot be answered with anything. The victim draws and their turn is skipped, full
stop. This is the official rule; see **House rules not implemented**.

### The Wild Draw Four, and the challenge

A Wild Draw Four may only _honestly_ be played when you hold no card of the colour in play.
Holding a matching number or symbol does not bar it, and a wild in your hand never counts as
a colour match — a hand of nothing but wilds is an honest hand.

But the rule is not enforced when the card is played. **You may bluff**, and the next player
may call it. Enforcing it at play time would make the challenge unreachable, and the
challenge is the whole of what makes the card interesting.

While a Wild Draw Four is waiting to be answered the table is frozen: the only two moves at
it are the victim's, and every other command from every other seat is refused with
`awaitingChallenge`. The two shouts — calling UNO, and calling somebody else out — stay
legal, because they are legal at any moment.

The victim does one of two things:

- **Take the four cards.** They draw four and lose their turn.
- **Call the bluff.** The player's hand at the moment they played the card is judged against
  the colour that was leading _before_ it:
  - **They were bluffing** — the _player_ draws the four instead, and the challenger takes
    their turn normally.
  - **They were honest** — the _challenger_ draws **six**: the four they owed, plus two for
    the accusation. Their turn is still lost.

The colour the player named stands in every case. A challenge decides who draws, never what
is led.

The verdict is decided once, when the card is played, and not re-derived when the challenge
is made. That matters because the hand _can_ change in between — the two shouts stay legal
while the table is frozen, so a caught UNO can add two cards to the very hand a challenge
would be judged against, and a player who bluffed should not be exonerated by being caught
out.

### Calling UNO

The moment your hand comes down to a single card you should call **UNO**. In this build that
is a button, because a screen cannot hear you.

- The call is legal from any seat, in or out of turn, and only while you hold exactly one
  card.
- It belongs to the card, not to the player: draw back up and you owe a fresh call next time
  you come down to one.
- If you are caught silent, you draw **two cards**.

**The window is bounded**, and this is the half of the rule that makes it a game: you can be
caught from the moment your hand reaches a single uncalled card **until the next player
begins their turn** — draws or plays. After that you are safe. Without the bound a silent
player would stay catchable for the rest of the round, which turns a two-second reflex into
a standing bounty and makes calling UNO pointless, since there would be no moment at which
staying quiet became safe.

One digitisation to state plainly: you call UNO _after_ your play resolves rather than as the
card leaves your hand, because the button only exists once the hand is settled.

The call is **not** what wins the round — putting your last card down is. What silence costs
is being caught.

### Winning the round

The first player to put down their last card wins the round.

You **can** go out on a Draw Two or a Wild Draw Four, and the victim still draws — the
effect resolves first, and those cards count toward your score. A Wild Draw Four played as a
last card still opens its challenge window, and the round ends only once it is answered.
Such a hand is necessarily honest (a lone Wild Draw Four means no colour was held), so a
challenge against it always costs the challenger six.

You can also go out on a Wild, and you must still name a colour.

### Scoring, and the two modes

| Mode        | How the match is won                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Classic** | The first player to empty their hand wins the round. The room counts rounds won.                                                       |
| **Points**  | The official match: the winner of a round scores what everybody else is still holding, and the first player to **500** takes the game. |

The card values, in a points round:

| Card                    | Value                |
| ----------------------- | -------------------- |
| Number card             | Its face value (0–9) |
| Skip, Reverse, Draw Two | 20 each              |
| Wild, Wild Draw Four    | 50 each              |

A seat that left the round is still counted — the round was won against the table as it
stood. An abandoned round scores nothing.

The running total belongs to the _seat_, so it lives exactly as long as the seat does: a room
that closes takes every score with it. Starting a round after somebody has crossed 500 starts
a **new match** rather than continuing a won one.

### Running out of cards to draw

When the draw pile is empty, the discard pile is shuffled back into it, **keeping the card
currently face up**. If there is nothing anywhere left to draw — the pile empty and the
discard a single card — the draw takes nothing, and the turn may be ended anyway. That last
part is a house decision: the official rules are silent, and the alternative is a deadlock.

### Effect order when a card is played

Written down because two of these could sensibly be swapped, and the choice is visible:

1. The card leaves the hand and goes face up on the pile.
2. The colour in play becomes the card's own colour, or the one named for a wild.
3. "UNO!" is recorded, when it was called with the card, and only if the play really did
   leave exactly one card in hand.
4. **The card's effect resolves** — the Skip, the Reverse, the two cards, or the challenge
   window opening.
5. **Then** the round-end check runs.

Steps 4 and 5 are in that order on purpose: a round can be won on a card that makes somebody
else draw, and ending the round first would let the table off a penalty it had honestly
earned — and cost the winner those cards' worth of score.

### Two-player behaviour, stated explicitly

- A **Reverse** acts as a Skip: the player who played it goes again.
- A **Skip** hands the turn straight back, for the same reason.
- A **Draw Two** and a **Wild Draw Four** make the opponent draw and lose their turn, so the
  player goes again.

"Two players" means two _seats still in the round_, not two players currently connected. A
three-player table with somebody temporarily absent is still a three-player table, and does
not start playing the two-player rules for as long as a phone is in a tunnel.

### A player who is not there

A seat that stops answering is held for five minutes, and the table says who it is waiting
for. When the grace runs out the room passes that turn:

- The skip costs **one card** — the same card the same turn would have cost had they been
  there to take it. A free pass would be the cheapest turn at the table.
- A seat that had **already drawn** pays nothing further. It has taken its card.
- A seat that is not there to answer a **Wild Draw Four** has the four cards taken for it,
  rather than the bluff called on its behalf. A skip is free in this game, but a penalty
  somebody else created is paid in full — or pulling the plug becomes the cheapest answer to
  a Wild Draw Four. Challenging on their behalf would be worse: it is a gamble, and losing it
  costs six.
- Somebody who is not there **cannot be caught** for a silent UNO. They cannot shout, so it
  would be farming rather than catching. A seat a robot is playing counts as present.

A player who leaves for good keeps their seat, their cards and their place in the standings.
Their hand is frozen out of play rather than removed, which is what keeps the card count
honest. If too few players are left the round ends with **no winner**.

### Where editions disagree

- **A wild turned up as the opening card.** Official UNO buries a Wild Draw Four and turns up
  another; on a plain Wild, the first player names the colour. **This build buries both.**
  That is a deviation, and a deliberate one: implementing the official rule means the colour
  in play becomes nullable throughout the engine, the wire, the stored round and the styling,
  plus a command of its own and an answer for a first player who never arrives — for four
  cards in a hundred and eight. Burying it is a widely played variant, and it is the
  procedure the official rules already use for the other wild.
- **The UNO penalty.** Two cards here, which is the current Mattel rule. Some editions and
  many tables use four.
- **The alternative scoring.** Mattel prints a second method in the same rulebook: instead of
  the winner collecting, each player keeps a running total of what _they_ were caught with,
  and when somebody reaches 500 the player with the **lowest** total wins. This build
  implements the winner-collects method.
- **The target score.** 500 here. Some editions scale it to the number of players.

### House rules not implemented

None of these are official, and the game plays without them:

- **Stacking** — answering a Draw Two with another Draw Two. The most-played house rule in
  the world, and explicitly not the rule.
- **Jump-in** — playing an identical card out of turn.
- **7-0** — swapping hands on a 7, passing them round on a 0.
- **Progressive UNO**, **no-bluffing**, and the rest.

"UNO Out" — calling something when you play your _last_ card — is not a rule at all, and
players expect it to be. It is not implemented because it does not exist.

### Deliberate limitations

- **2 to 6 players**, where official UNO allows 2 to 10. This is a product limitation rather
  than a rules one: the seat geometry, the table layout and its 320-pixel regression tests
  are built for six chairs, and ten would be an interface project.
- **A penalty larger than the cards available** draws as many as there are and says so. The
  official rules are silent on it.

### Robot players

A robot plays a seat exactly as a person does. It sees the public table, its own hand and
which seats are answering for themselves — and nothing else, which is a test rather than a
promise. Every legality decision it makes goes through the same function the app's own
highlight uses. See [robots.md](robots.md).

Its challenge policy is a real decision made on real evidence: it knows the colour that was
in play and how many cards the player is holding, which is exactly what a person at the table
knows. It does not read the verdict, and there is a test that two tables differing only in
whether the play was a bluff produce the same decision.

### Worked examples

**1 — Matching**

The pile shows Red 5 and the colour is red. Legal: any red card, any 5 of any colour, either
wild. Illegal: Blue 3.

**2 — A wild changes what "matching" means**

Ann plays a Wild and names green. The top card is a colourless wild, so there is no symbol to
match — only green cards and other wilds are legal.

**3 — Drawing**

Ben holds nothing legal. He draws one card: a Red 9, and the colour is red, so he may play it
at once. Had he drawn a Blue 3 he would have ended his turn holding it. Either way he drew
exactly one card, and no other card in his hand was playable in between.

**4 — A bluff called, and right**

The colour is red. Ann holds a Red 2 and plays a Wild Draw Four, naming green. Ben calls it.
Ann was holding red, so **Ann** draws four, and **Ben** takes his turn — in green, because
the colour Ann named stands.

**5 — A bluff called, and wrong**

The same, except Ann held no red at all. Ben draws **six** and loses his turn.

**6 — Reverse at two seats**

Ann and Ben are playing. Ann plays a Reverse. It acts as a Skip: Ben loses his turn and Ann
plays again.

**7 — Going out on a Draw Two**

Ann's last card is a Red Draw Two. She plays it. Ben draws two, and Ann wins the round — with
Ben's two extra cards counting toward her score.

**8 — Recycling**

The draw pile is empty and Cat must draw. The discard pile is Red 9, Red 2, Blue 2, Yellow 2
(Yellow 2 on top). Yellow 2 stays face up; the other three are shuffled back; Cat draws one
of them; two remain in the draw pile.

**9 — The UNO window**

Ann plays down to one card and says nothing. Ben, whose turn it now is, can call her out for
two cards — right up until he draws or plays. Once he does, Ann is safe for the rest of the
round even though she never called.

---

## עברית

### החבילה — 108 קלפים

| קלפים                                   | כמות      | סה"כ    |
| --------------------------------------- | --------- | ------- |
| 0, ארבעה צבעים, אחד מכל אחד             | 4 × 1     | 4       |
| 1–9, ארבעה צבעים, שניים מכל אחד         | 9 × 4 × 2 | 72      |
| עצור, ארבעה צבעים, שניים מכל אחד        | 4 × 2     | 8       |
| שינוי כיוון, ארבעה צבעים, שניים מכל אחד | 4 × 2     | 8       |
| קח 2, ארבעה צבעים, שניים מכל אחד        | 4 × 2     | 8       |
| ג׳וקר (ללא צבע)                         | —         | 4       |
| ג׳וקר קח 4 (ללא צבע)                    | —         | 4       |
| **סה"כ בחבילה**                         |           | **108** |

צבעים: **אדום, צהוב, ירוק, כחול**.

**האפס מודפס פעם אחת בכל צבע**, וכל מספר אחר פעמיים. אלה ארבעה קלפים מתוך 108, ולכן אפס הוא
קלף ששווה לשמור.

**שני הג׳וקרים משנים את הצבע.** ג׳וקר קח 4 אינו "קח 4 שבמקרה חסר צבע" — הוא ג׳וקר, ובעליו
בוחר/ת את הצבע שבו המשחק ממשיך, בין אם הקלף היה כן ובין אם היה בלוף, ובין אם ההטלת ספק
שאחריו תצליח ובין אם לא.

### התחלה

- 2 עד 6 שחקנים. הסדר הוא סדר ההצטרפות, וגלוי לכולם.
- החבילה מעורבבת עם מחולל אקראיות עם זרע, כך שאותו זרע תמיד מחלק אותו משחק.
- כל שחקן מקבל **7 קלפים**.
- הקלף העליון נפתח לערמת ההשלכה. **ג׳וקר משני הסוגים נקבר בתחתית החבילה ונפתח קלף אחר** — ראו
  "החלטות שקיבלנו".
- ההשפעה של קלף הפתיחה נופלת על השחקן הראשון: עצור מדלג עליו, קח 2 מחייב אותו למשוך שניים
  ולוותר על התור, ושינוי כיוון הופך את הסדר כך ש**המחלק** מתחיל.

### מהלך תור

בתור שלך עושים בדיוק אחד מהשניים:

1. **מניחים קלף חוקי**, או
2. **מושכים קלף אחד** — וזה **לא** מסיים את התור. אם הקלף שנמשך מתאים, אפשר להניח אותו —
   אותו קלף בלבד — או לסיים את התור. המשיכה היא בחירה: מותר למשוך גם כשיש קלף טוב ביד.

סיום התור חוקי רק אחרי משיכה. אין ויתור חינם באונו: או מניחים או מושכים. החריג היחיד הוא חבילה
שנגמרה לגמרי.

קלף חוקי אם הוא מתאים ל**צבע** שבמשחק, ל**סמל** שעל הקלף העליון, או שהוא **ג׳וקר**.

### הקלפים המיוחדים

| קלף             | השפעה                                                            |
| --------------- | ---------------------------------------------------------------- |
| **עצור**        | השחקן הבא מפסיד את התור.                                         |
| **שינוי כיוון** | הסדר מתהפך. **בשני שחקנים הוא פועל כמו עצור**.                   |
| **קח 2**        | השחקן הבא מושך שני קלפים ומפסיד את התור.                         |
| **ג׳וקר**       | בוחרים את הצבע.                                                  |
| **ג׳וקר קח 4**  | בוחרים את הצבע; הבא מושך ארבעה ומפסיד את התור — אלא אם יטיל ספק. |

**אין הצטברות.** אי אפשר לענות לקח 2 בקח 2 נוסף. זה החוק הרשמי.

### ג׳וקר קח 4 והטלת הספק

מותר להניח ג׳וקר קח 4 רק כשאין ביד קלף בצבע שבמשחק — אבל החוק אינו נאכף בהנחה. **מותר לבלף**,
והשחקן הבא רשאי להטיל ספק. אכיפה בהנחה הייתה הופכת את הטלת הספק לבלתי אפשרית, והיא כל מה
שמעניין בקלף הזה.

- **לוקחים את ארבעת הקלפים** — מושכים ארבעה ומפסידים את התור.
- **מטילים ספק** — היד נבחנת מול הצבע שהיה **לפני** הקלף:
  - **היה בלוף** — ה*מניח* מושך ארבעה, והמטיל ספק משחק תור רגיל.
  - **היה כן** — ה*מטיל ספק* מושך **שישה** ומפסיד את התור.

הצבע שנבחר נשאר בתוקף בכל מקרה.

### הכרזת "אונו"

ברגע שנשאר קלף אחד ביד צריך להכריז **אונו**. מי שנתפס שותק מושך **שני קלפים**.

**החלון מוגבל**: אפשר לתפוס מהרגע שהיד ירדה לקלף אחד ועד ש**השחקן הבא מתחיל את תורו**. אחר כך
בטוח. בלי הגבול הזה שתיקה הייתה נענשת עד סוף הסבב, וההכרזה הייתה מאבדת כל משמעות.

ההכרזה אינה מה שמנצח — הנחת הקלף האחרון היא. מה שהשתיקה עולה זה להיתפס.

### ניצחון וניקוד

| סוג             | איך מנצחים                                                                    |
| --------------- | ----------------------------------------------------------------------------- |
| **רגיל**        | הראשון שנשאר בלי קלפים מנצח בסבב.                                             |
| **ניקוד ל־500** | המנצח בסבב מקבל ניקוד לפי מה שנשאר בידי כולם, והראשון שמגיע ל־500 מנצח במשחק. |

מספר לפי ערכו; עצור, שינוי כיוון וקח 2 שווים 20; שני הג׳וקרים שווים 50.

אפשר לסיים על קח 2 או על ג׳וקר קח 4, והקורבן עדיין מושך — הקלפים האלה נספרים בניקוד.

### כשנגמרים הקלפים למשיכה

ערמת ההשלכה מעורבבת חזרה, כשהקלף העליון נשאר גלוי. אם אין מה למשוך בכלל, המשיכה לא לוקחת כלום
ומותר לסיים את התור בכל זאת — החלטה של הבית, כדי למנוע תקיעה.

### התנהגות בשני שחקנים

שינוי כיוון פועל כמו עצור, עצור מחזיר את התור מיד, וקח 2 וג׳וקר קח 4 גורמים ליריב למשוך
ולהפסיד את התור — כך שהמניח משחק שוב. "שני שחקנים" הם שני **מושבים בסבב**, לא שני מחוברים.

### שחקן שאינו נוכח

מושב שהפסיק לענות נשמר חמש דקות. כשהזמן נגמר החדר מעביר את התור בעלות של **קלף אחד** — ומושב
שכבר משך לא משלם שוב. מושב שאינו נוכח כדי לענות לג׳וקר קח 4 **לוקח את הקלפים** במקום להטיל
ספק. מי שאינו נוכח **לא ניתן לתפיסה** על אי־הכרזה: הוא לא יכול לצעוק.

### החלטות שקיבלנו במקומות שהמהדורות חולקות

- **ג׳וקר כקלף פתיחה** — כאן נקבר, בשני הסוגים. זו סטייה מכוונת מהחוק הרשמי, שמסביר אותה
  בגרסה האנגלית למעלה.
- **קנס האונו** — שני קלפים, כפי שמאטל מגדירה היום. מהדורות רבות משתמשות בארבעה.
- **שיטת ניקוד חלופית** — מאטל מדפיסה גם שיטה שבה כל שחקן צובר את מה ש*נתפס* איתו, ומי שמגיע
  ל־500 מפסיד. כאן מיושמת השיטה שבה המנצח אוסף.

### חוקי בית שלא מיושמים

הצטברות (קח 2 על קח 2), קפיצה לתור, 7-0, ואונו מתקדם. אף אחד מהם אינו רשמי.

### מגבלות מכוונות

2 עד 6 שחקנים, במקום 2 עד 10 הרשמיים — מגבלת מוצר ולא מגבלת חוקים: פריסת השולחן בנויה לשישה
מושבים.
