# Kitchen Table Euchre

A single-player Euchre game that runs in any web browser. You play with a computer partner against two computer opponents. First team to 10 points wins.

## Play

Open `index.html` in a browser. No install or build step is needed.

To put it online for free, turn on GitHub Pages for this repository (Settings → Pages → Deploy from branch → `main`, folder `/`). The game will then be at `https://<your-username>.github.io/euchre-game/`.

## Options

- **Regular** difficulty: sensible computer players who sometimes guess wrong.
- **Hard** difficulty: your partner and both opponents remember every card played, notice when someone can't follow suit, bid with the seating position in mind and only go alone when the hand can carry it. In 4,000 simulated games, a Hard team beat a Regular team about 60% of the time.
- **Stick the Dealer**: if everyone passes in both rounds of bidding, the dealer must name trump. With it off, the hand is thrown in and the deal moves left.
- **Canadian Loner**: if you order up the card when your own partner is the dealer, you must play that hand alone.

## Scoring

| Result | Points |
| --- | --- |
| Calling team takes 3 or 4 tricks | 1 |
| Calling team takes all 5 | 2 |
| Player alone takes all 5 | 4 |
| Calling team is euchred (takes fewer than 3) | 2 to the other team |

## Files

- `index.html`: the page.
- `css/style.css`: how the table and cards look.
- `js/engine.js`: the rules (dealing, bidding, following suit, scoring).
- `js/ai.js`: the computer players for Regular and Hard.
- `js/ui.js`: draws the table and handles your clicks.
- `test/sim.js`: plays thousands of computer-only games to check the rules and compare the two difficulties. Run it with `node test/sim.js`.

Add `#fast` to the end of the address to make the computer players move quickly.
