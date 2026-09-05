# Pickleball Tournament

A courtside scorekeeper for two simultaneous pickleball tournaments. Random-partner
doubles round robin, individual standings, then a four-player finals that crowns two
champions.

Open `index.html` in a browser. No install, no build step, no server, no network.

**It works with no internet.** Load the page once somewhere with a signal and it keeps
working at a court with none — see [Offline use](#offline-use).

Handing this to someone who just needs to run a tournament? Give them
[QUICKSTART.md](QUICKSTART.md) instead — a plain-language phone guide with no jargon.

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
   set courts, games per player, and the scoring rule. The summary line tells you how many games
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
schedules and results. They start named **Advanced** and **Intermediate**; rename either
on its Setup tab.

## On a phone

The layout is built for a phone first, since that is what is in someone's hand at a court.

- Buttons, score boxes and the remove-player control are all at least 44px, the size a
  thumb actually hits.
- Score boxes open the numeric keypad, and text is 16px so iOS never zooms on focus.
- On a narrow screen the standings drop the supporting columns (points for, points
  against, byes) and keep rank, name, games played, W–L, win % and differential. Turn the
  phone to landscape for the full table.
- Tables scroll inside their own card, so a long name can never drag the whole page
  sideways.

Checked for layout overflow and undersized tap targets at 320, 375 and 393px wide plus
landscape, across every tab.

## Sharing with spectators

Players can follow along on their own phones, read-only. Two routes, because they
have opposite requirements.

### QR snapshot — no server, no signal

**Data → Show standings QR.** The standings are packed into the link itself and shown as
a QR code. A spectator scans it and sees the table. Nothing is sent anywhere, no database
is involved, and it works in airplane mode.

It is a snapshot, not a feed: show a fresh code after each round.

**The one catch:** the link points at this site, so the spectator's phone needs the app
files. If they have opened the app before, the service worker has them and the scan works
with no connection at all. If they have *never* opened it and have no signal, the scan
cannot load anything. Have spectators open the link once while they still have a
connection — at registration, or the night before — and they are set for the day.

A full 24-player snapshot encodes to well under 2 KB, which is a QR that scans easily off
a phone screen.

### Live link — updates as scores are typed

Off by default. To enable it, create a Firebase Realtime Database and put its URL in
`js/config.js`:

```js
window.AppConfig = { DATABASE_URL: 'https://your-project-default-rtdb.firebaseio.com', ... };
```

Then **Data → Publish live** gives a link and QR. Watchers see scores appear as they are
entered, plus the round currently on court.

Database rules to start from:

```json
{
  "rules": {
    "tournaments": {
      "$id": {
        ".read": true,
        ".write": true,
        ".validate": "newData.hasChildren(['name', 'players'])"
      }
    }
  }
}
```

**Be clear about what that does and does not protect.** The published id is a random
16-character string, and knowing it is what grants access — a capability URL. It is not
guessable, but anyone you give the viewer link to could, with effort, write to that same
path. For a club tournament that is proportionate: it stops strangers, not a determined
guest. If you need it properly enforced, add Firebase Anonymous Auth and require
`auth != null` for writes, with admins signed in and viewers not.

**Stop publishing** deletes the published copy, so a finished board does not sit there
looking live.

No Firebase SDK is used — writes go over the REST API and viewers read the database's
server-sent-events stream, both with what the browser already has. That keeps the app
dependency-free and the offline guarantee intact.

### Losing signal while publishing

Local storage stays the source of truth. Publishing only ever queues: a push that fails
is retried when the connection returns, on the next save, or on a timer. **Scoring is
never blocked by the network** — a dead signal costs spectators freshness and costs the
person entering scores nothing. The Data tab says which state you are in.

## Offline use

The app makes no network requests once it is running: no API, no fonts, no CDN, no
analytics. A service worker caches the page and its files on first visit, so after one
load with a connection it opens and runs with none.

To set a device up for a tournament:

1. Open the site once somewhere with signal and wait for **Works offline** in the footer.
2. Add it to the home screen — iOS: Share → Add to Home Screen; Android: menu → Install app.
   It then opens full-screen with its own icon.
3. Go to the court. Everything works: pairings, score entry, standings, finals, saves.

Scores live in that device's storage, so the device that scores a tournament is the one
that holds it. Airplane mode is a fair test of the whole setup.

One maintenance note: `sw.js` serves from cache first — deliberately, because a weak
signal at a court is worse than none, and a network-first strategy would stall on it. So
**bump `CACHE_VERSION` in `sw.js` whenever a cached file changes**, or returning devices
keep the old version.

### Defaults

| Setting | Default | Range |
| --- | --- | --- |
| Players | — | 6–24 |
| Courts | 2 | 1–6 |
| Games per player (minimum) | 5 | 1–15 |
| Play to | 9 | 1–21 |
| Win by | 1 | 1–2 |

### Games per player, not rounds

You set how many games **each player** is guaranteed; the app works out the rounds needed.
The two are nothing alike once there are more players than court space — 15 players on 2
courts means only 8 are on court per round, so a round is worth about half a game each,
and 5 games apiece takes 10 rounds. Asking for "5 rounds" there would have given everyone
2.7 games and a standings table too thin to rank anyone by.

Rounds come out as `ceil(target x players / seats)`. Sit-outs are shared to within one
round, so the least-played player lands on `floor(rounds x seats / players)` — requiring
that to reach the target is what makes it a floor rather than an average. Tests sweep
every roster size from 6 to 24 against 1–6 courts at several targets and assert that the
*least-played* player always reaches it, and that one fewer round would not.

Changing the roster, court count, or games per player after a schedule exists redraws it,
so you are asked to confirm first.

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
index.html          markup, script tags, service worker registration
sw.js               offline cache
manifest.webmanifest  home-screen install metadata
assets/icons/       app icons
assets/styles.css   styling, including dark mode and print
js/model.js         data shapes, defaults, score and roster validation
js/scheduler.js     round-robin draw
js/standings.js     individual standings and ranking
js/finals.js        finals bracket and champions
js/snapshots.js     named save/restore points
js/demo.js          random score fill for testing
js/config.js        live-sharing configuration (empty = feature off)
js/share.js         snapshot encoding and share links
js/sync.js          Firebase REST publishing and the live viewer
vendor/qrcode.js    vendored MIT QR encoder
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
rules, overwrite behaviour, and filling the finals), and share links (snapshot
round-trips including non-ASCII names, agreement with the admin's own standings,
worst-case QR payload size, malformed input, and share-id uniqueness).

The transports are covered by browser tests rather than this suite: the QR route was
checked with the network genuinely disabled, and the live route against a stand-in
Firebase REST/SSE server, including losing and regaining signal mid-tournament.
