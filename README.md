# Pickleball Tournament

A courtside scorekeeper for two simultaneous pickleball tournaments. Random-partner
doubles round robin, individual standings, then a four-player finals that crowns two
champions.

Open `index.html` in a browser. No install, no build step, no server, no network.

## Format

**Round robin.** Partners are drawn at random every round — you never keep the same
partner — and every player carries their own record. The draw avoids repeat partners
first and repeat opponents second, and it shares the sit-outs evenly, so nobody ends
up benched twice while someone else never sits.

**Standings.** Ranked by win percentage, then point differential, then points scored.
Win percentage is the primary key because sit-outs can leave players one game apart.

**Finals.** The top four play three games covering every partner combination:

| Game | Teams |
| --- | --- |
| 1 | Seed 1 + Seed 4 vs Seed 2 + Seed 3 |
| 2 | Seed 1 + Seed 3 vs Seed 2 + Seed 4 |
| 3 | Seed 1 + Seed 2 vs Seed 3 + Seed 4 |

Each finalist partners each other finalist exactly once, so the result is a read on the
player, not the pairing. Six wins split four ways can never come out even, so the top
two records always separate; ties below that break on point differential, then points
scored, then round-robin seed. **The top two records win the tournament.**

## Using it

1. **Setup** — name the tournament, add 6–24 players (type them in or paste a list),
   set courts, rounds, and the scoring rule. The summary line tells you how many games
   that produces and how many players sit out each round.
2. **Generate schedule** — the whole round robin is drawn up front, so you can print it.
3. **Schedule** — enter the final score for each game. Scores are checked against the
   "to 9, win by 1" rule; a game that could not have ended that way is flagged and not
   counted.
4. **Standings** — live rankings, with the top four marked and the cut line drawn.
5. **Finals** — the top four are pre-selected. Adjust them if you settled a tie on
   court, start the finals, and enter the three scores.

6. **Data** — save a restore point, load one back, or wipe everything and start over.

The two tabs at the top are fully independent tournaments — separate rosters, settings,
schedules and results.

### Defaults

| Setting | Default | Range |
| --- | --- | --- |
| Players | — | 6–24 |
| Courts | 2 | 1–6 |
| Round-robin rounds | 6 | 1–15 |
| Play to | 9 | 1–21 |
| Win by | 1 | 1–2 |

Changing the roster, court count, or round count after a schedule exists redraws it, so
you are asked to confirm first.

## Data

Everything is saved to this browser's `localStorage` as you go — close the tab, reload,
lose signal, and your scores are still there. Data does not sync between devices, so run
each tournament from one device. **Print** produces a clean schedule or standings sheet.

The **Data** tab adds explicit control on top of that autosave:

| Action | What it does |
| --- | --- |
| **Save** | Snapshots both tournaments under a name — rosters, settings, every score, the finals. |
| **Restore** | Puts a saved snapshot back, replacing current state. |
| **Export to file** | Downloads the state as JSON, to move devices or survive a browser wipe. |
| **Import from file** | Loads a previously exported file back in. |
| **Kill everything** | Wipes both tournaments to empty. Saved snapshots are deliberately kept. |
| **Fill / Re-roll** | Plays the active tournament out with random results — see below. |

Snapshots live under their own storage key (`pickleball-snapshots-v1`), separate from the
live tournaments, which is why **Kill** cannot destroy them — save first and it is always
recoverable. Up to 20 snapshots; past that, delete one to make room. Because they live in
this browser, use **Export to file** for anything you truly cannot lose.

### Random fill

Typing 32 scores to see what the standings look like is no way to try the app out.
**Fill** on the Data tab plays the active tournament out with random results, finals
included, so one click gets you to a champion.

Every score it writes is one you could have typed: the winner lands on the target and the
loser far enough back to satisfy the winning margin, whatever those are set to. Sides are
drawn at random, so ties turn up on their own and the tiebreak rules actually get
exercised. **Fill** only touches games with no score, leaving anything you entered by
hand; **Re-roll** replaces every score.

Smaller resets stay where the work is: **Regenerate schedule** and **Reset tournament** on
Setup, **Clear all scores** on Schedule, **Reset finals** on Finals.

To move to a shared backend later, write an adapter with the same `load`/`save`/
`describe` methods as the one in `js/storage.js` and register it before startup:

```js
Storage.use(myRemoteAdapter);
```

Nothing else in the app touches storage directly.

## Layout

```
index.html          markup and script tags
assets/styles.css   styling, including dark mode and print
js/model.js         data shapes, defaults, score and roster validation
js/scheduler.js     round-robin draw
js/standings.js     individual standings and ranking
js/finals.js        finals bracket and champions
js/snapshots.js     named save/restore points
js/demo.js          random score fill for testing
js/storage.js       persistence adapter
js/app.js           UI
tests/logic.test.js checks for everything above except the UI
```

## Tests

```
node tests/logic.test.js
```

No dependencies. Covers every roster size from 6 to 24 against 1–4 courts, checking that
nobody is double-booked or dropped from a round, that sit-outs stay within one of each
other, that partners do not repeat, plus score validation, standings, ties and the
finals bracket, and the snapshot store (isolation of saved copies, the cap, and
storage failures), and the random fill (legal scores under several scoring
rules, overwrite behaviour, and filling the finals).
