/* Dependency-free checks for the tournament logic.  Run: node tests/logic.test.js */
'use strict';

const Model = require('../js/model.js');
const Scheduler = require('../js/scheduler.js');
const Standings = require('../js/standings.js');
const Finals = require('../js/finals.js');
const Snapshots = require('../js/snapshots.js');
const Demo = require('../js/demo.js');
const Share = require('../js/share.js');

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) { passed += 1; return; }
  failures.push(label + (detail ? ' — ' + detail : ''));
}

function roster(n) {
  const players = [];
  for (let i = 1; i <= n; i++) players.push(Model.createPlayer('Player ' + i));
  return players;
}

/* A small deterministic RNG so a failure can be reproduced. */
function seeded(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ------------------------------------------------------------- scheduling */

for (let n = Model.MIN_PLAYERS; n <= Model.MAX_PLAYERS; n++) {
  for (const courts of [1, 2, 3, 4]) {
    const players = roster(n);
    const settings = { courts: courts, rounds: 6, targetScore: 9, winBy: 1 };
    const expectedGames = Model.gamesPerRound(n, courts);
    if (expectedGames < 1) continue;

    const schedule = Scheduler.generateSchedule(players, settings, seeded(n * 100 + courts));
    const ids = players.map(function (p) { return p.id; });
    const tag = n + ' players / ' + courts + ' courts';

    check('rounds generated (' + tag + ')', schedule.length === 6);

    schedule.forEach(function (round) {
      const seen = [];
      round.games.forEach(function (g) { seen.push.apply(seen, g.teamA.concat(g.teamB)); });
      check('games per round (' + tag + ')', round.games.length === expectedGames);
      check('nobody plays twice in a round (' + tag + ')', new Set(seen).size === seen.length);
      check('everyone is placed (' + tag + ')',
        seen.length + round.byes.length === n,
        seen.length + ' playing + ' + round.byes.length + ' byes != ' + n);
      check('byes do not overlap play (' + tag + ')',
        round.byes.every(function (id) { return seen.indexOf(id) === -1; }));
      check('court numbers are unique (' + tag + ')',
        new Set(round.games.map(function (g) { return g.court; })).size === round.games.length);
    });

    const quality = Scheduler.scheduleQuality(schedule, ids);
    check('sit-outs are shared evenly (' + tag + ')', quality.byeSpread <= 1,
      'spread of ' + quality.byeSpread);

    // With enough distinct players a six-round draw should never repeat a partner.
    if (n >= 12) {
      check('no repeat partners (' + tag + ')', quality.maxPartnerRepeats <= 1,
        'a pair partnered ' + quality.maxPartnerRepeats + ' times');
    }
  }
}

check('too few players is rejected', (function () {
  try {
    Scheduler.generateSchedule(roster(3), { courts: 1, rounds: 3 });
    return false;
  } catch (err) { return true; }
})());

/* ------------------------------------------------------------- validation */

check('9-6 is a valid finish', Model.validateScore(9, 6, 9, 1) === null);
check('9-8 is a valid finish', Model.validateScore(9, 8, 9, 1) === null);
check('8-6 is unfinished', Model.validateScore(8, 6, 9, 1) !== null);
check('a tie is rejected', Model.validateScore(9, 9, 9, 1) !== null);
check('11-9 is rejected when playing to 9', Model.validateScore(11, 9, 9, 1) !== null);
check('win-by-2 rejects 9-8', Model.validateScore(9, 8, 9, 2) !== null);
check('win-by-2 accepts 10-8', Model.validateScore(10, 8, 9, 2) === null);
check('negative scores are rejected', Model.validateScore(-1, 9, 9, 1) !== null);

check('roster below the minimum is flagged', Model.rosterError(roster(5)) !== null);
check('roster above the maximum is flagged', Model.rosterError(roster(25)) !== null);
check('a valid roster passes', Model.rosterError(roster(12)) === null);
check('duplicate names are flagged',
  Model.rosterError([Model.createPlayer('Ann'), Model.createPlayer('ann')].concat(roster(5))) !== null);

/* -------------------------------------------------------------- standings */

(function standingsTest() {
  const players = roster(8);
  const tournament = {
    players: players,
    settings: { courts: 2, rounds: 5, targetScore: 9, winBy: 1 },
    schedule: Scheduler.generateSchedule(players, { courts: 2, rounds: 5 }, seeded(7)),
  };

  const progress0 = Standings.roundRobinProgress(tournament);
  check('progress starts at zero', progress0.done === 0 && progress0.complete === false);

  // Player 1 wins every game they play 9-2; everything else goes to team A 9-7.
  const hero = players[0].id;
  tournament.schedule.forEach(function (round) {
    round.games.forEach(function (game) {
      const heroOnA = game.teamA.indexOf(hero) !== -1;
      const heroOnB = game.teamB.indexOf(hero) !== -1;
      if (heroOnB) { game.scoreA = 2; game.scoreB = 9; }
      else if (heroOnA) { game.scoreA = 9; game.scoreB = 2; }
      else { game.scoreA = 9; game.scoreB = 7; }
    });
  });

  const progress = Standings.roundRobinProgress(tournament);
  check('progress reaches complete', progress.complete === true);

  const table = Standings.compute(tournament);
  check('every player appears once', table.length === 8);
  check('the undefeated player is first', table[0].playerId === hero);
  check('the undefeated player has no losses', table[0].l === 0);
  check('first place is rank 1', table[0].rank === 1);

  const totalGames = table.reduce(function (sum, row) { return sum + row.gp; }, 0);
  check('game participation adds up', totalGames === progress.done * 4);

  const pf = table.reduce(function (sum, row) { return sum + row.pf; }, 0);
  const pa = table.reduce(function (sum, row) { return sum + row.pa; }, 0);
  check('points for and against balance', pf === pa);

  const ranks = table.map(function (row) { return row.rank; });
  check('ranks never decrease', ranks.every(function (r, i) { return i === 0 || r >= ranks[i - 1]; }));
})();

(function tieTest() {
  const players = roster(6);
  const table = Standings.compute({
    players: players,
    schedule: [{
      round: 1,
      byes: [players[4].id, players[5].id],
      games: [{ teamA: [players[0].id, players[1].id], teamB: [players[2].id, players[3].id], scoreA: 9, scoreB: 8 }],
    }],
  });
  check('winners share rank 1', table[0].rank === 1 && table[1].rank === 1);
  check('shared ranks are marked tied', table[0].tied === true);
  check('byes are counted', table.filter(function (r) { return r.byes === 1; }).length === 2);
})();

/* ----------------------------------------------------------------- finals */

(function finalsTest() {
  const players = roster(4);
  const ids = players.map(function (p) { return p.id; });
  const byId = {};
  players.forEach(function (p) { byId[p.id] = p; });

  const finals = Finals.start(ids);
  check('finals has three games', finals.games.length === 3);

  const partnerships = new Set();
  finals.games.forEach(function (g) {
    partnerships.add(g.teamA.slice().sort().join('|'));
    partnerships.add(g.teamB.slice().sort().join('|'));
  });
  check('every partner combination is used exactly once', partnerships.size === 6);

  finals.games.forEach(function (g) {
    check('finalists are not on both sides', new Set(g.teamA.concat(g.teamB)).size === 4);
  });

  check('an incomplete finals has no champions', Finals.champions(finals, byId).length === 0);

  // Seeds 1 and 2 take every game they are on the winning side of.
  finals.games[0].scoreA = 9; finals.games[0].scoreB = 5; // 1&4 beat 2&3
  finals.games[1].scoreA = 9; finals.games[1].scoreB = 3; // 1&3 beat 2&4
  finals.games[2].scoreA = 9; finals.games[2].scoreB = 1; // 1&2 beat 3&4

  check('completed finals is detected', Finals.isComplete(finals) === true);
  const champions = Finals.champions(finals, byId);
  check('exactly two champions', champions.length === 2);
  check('seed 1 wins out', champions[0].playerId === ids[0] && champions[0].w === 3);

  const results = Finals.compute(finals, byId);
  check('every finalist plays all three games', results.every(function (r) { return r.gp === 3; }));
  check('six wins are distributed', results.reduce(function (s, r) { return s + r.w; }, 0) === 6);

  check('finals reject a duplicate finalist', (function () {
    try { Finals.start([ids[0], ids[0], ids[1], ids[2]]); return false; } catch (e) { return true; }
  })());
  check('finals reject the wrong player count', (function () {
    try { Finals.start(ids.slice(0, 3)); return false; } catch (e) { return true; }
  })());
})();

/* -------------------------------------------------------------- snapshots */

(function snapshotTest() {
  // Stand-in for localStorage.
  const backing = {};
  const store = Snapshots.createStore({
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null; },
    setItem: function (k, v) { backing[k] = String(v); },
    removeItem: function (k) { delete backing[k]; },
  });

  check('an empty store lists nothing', store.list().length === 0);

  const state = Model.defaultState();
  state.tournaments[0].players = roster(8);

  const first = store.add('Before finals', state, 'eight players');
  check('a save succeeds', first.ok === true);
  check('the save is listed', store.list().length === 1);
  check('the summary is kept', store.list()[0].summary === 'eight players');
  check('an unnamed save is rejected', store.add('   ', state).ok === false);

  // Mutating live state must not reach into the stored snapshot.
  state.tournaments[0].players = [];
  state.tournaments[0].name = 'Changed';
  const restored = store.restore(first.snapshot.id);
  check('restore is isolated from later edits', restored.tournaments[0].players.length === 8);
  check('restore keeps the saved name',
    restored.tournaments[0].name === Model.DEFAULT_NAMES[0],
    'got ' + restored.tournaments[0].name);

  // Editing what restore handed back must not reach into the snapshot either.
  restored.tournaments[0].players = [];
  check('restore returns a fresh copy each time',
    store.restore(first.snapshot.id).tournaments[0].players.length === 8);

  check('restoring an unknown id returns null', store.restore('nope') === null);

  store.add('Second', state, '');
  check('a second save is kept alongside the first', store.list().length === 2);
  // Same-millisecond saves must still order newest-first, not arbitrarily.
  check('newest sorts first', store.list()[0].name === 'Second');
  store.add('Third', state, '');
  check('newest of three sorts first', store.list()[0].name === 'Third');
  check('older saves keep their order', store.list()[1].name === 'Second');

  store.remove(first.snapshot.id);
  const left = store.list();
  const leftNames = left.map(function (s2) { return s2.name; });
  check('delete removes only its own save',
    left.length === 2 && leftNames.indexOf('Before finals') === -1,
    'left behind: ' + leftNames.join(', '));

  // Fill to the cap and confirm it refuses rather than silently dropping saves.
  while (store.list().length < Snapshots.MAX_SNAPSHOTS) store.add('filler', state, '');
  const overflow = store.add('one too many', state, '');
  check('saves are capped', overflow.ok === false);
  check('the cap message names the limit', /\d+/.test(overflow.error));

  store.clear();
  check('clear empties the store', store.list().length === 0);

  // A full disk surfaces as an error, not a crash.
  const fullStore = Snapshots.createStore({
    getItem: function () { return null; },
    setItem: function () { throw new Error('QuotaExceededError'); },
    removeItem: function () {},
  });
  const failed = fullStore.add('no room', state, '');
  check('a storage failure is reported, not thrown', failed.ok === false && !!failed.error);
})();

/* ------------------------------------------------------- random score fill */

(function fillTest() {
  [{ targetScore: 9, winBy: 1 }, { targetScore: 11, winBy: 2 }, { targetScore: 15, winBy: 2 }]
    .forEach(function (rule) {
      const players = roster(10);
      const settings = Object.assign({ courts: 2, rounds: 5 }, rule);
      const tournament = {
        name: 'Fill test',
        players: players,
        settings: settings,
        schedule: Scheduler.generateSchedule(players, settings, seeded(21)),
        finals: null,
      };
      const tag = 'to ' + rule.targetScore + ' win by ' + rule.winBy;

      const expected = Demo.countFillable(tournament);
      const result = Demo.fill(tournament, {}, seeded(99));
      check('fill count matches the estimate (' + tag + ')', result.roundRobin === expected);
      check('fill reports no finals when there are none (' + tag + ')', result.finals === 0);

      const progress = Standings.roundRobinProgress(tournament);
      check('a fill completes the round robin (' + tag + ')', progress.complete === true);

      // The whole point: nothing it writes may be a score the app would reject.
      let illegal = 0;
      let decided = 0;
      tournament.schedule.forEach(function (round) {
        round.games.forEach(function (g) {
          if (Model.validateScore(g.scoreA, g.scoreB, rule.targetScore, rule.winBy)) illegal += 1;
          if (g.scoreA !== g.scoreB) decided += 1;
        });
      });
      check('every filled score is legal (' + tag + ')', illegal === 0, illegal + ' illegal');
      check('no filled game is a tie (' + tag + ')', decided === expected);

      // Standings must balance, which they only do if the fill is self-consistent.
      const table = Standings.compute(tournament);
      const pf = table.reduce(function (s2, r) { return s2 + r.pf; }, 0);
      const pa = table.reduce(function (s2, r) { return s2 + r.pa; }, 0);
      check('filled results balance (' + tag + ')', pf === pa);
    });
})();

(function fillOverwriteTest() {
  const players = roster(8);
  const settings = { courts: 2, rounds: 4, targetScore: 9, winBy: 1 };
  const tournament = {
    name: 'Overwrite test',
    players: players,
    settings: settings,
    schedule: Scheduler.generateSchedule(players, settings, seeded(5)),
    finals: null,
  };

  // Pin one game by hand; a non-overwriting fill must leave it alone.
  const pinned = tournament.schedule[0].games[0];
  pinned.scoreA = 9;
  pinned.scoreB = 0;

  const all = Demo.countFillable(tournament, { overwrite: true });
  const empties = Demo.countFillable(tournament);
  check('a scored game is excluded from the empty count', empties === all - 1);

  Demo.fill(tournament, {}, seeded(3));
  check('fill leaves an existing score untouched', pinned.scoreA === 9 && pinned.scoreB === 0);

  // Re-roll may legitimately land on the same numbers, so check the call reports
  // the game as touched rather than guessing from the values.
  const rerolled = Demo.fill(tournament, { overwrite: true }, seeded(4));
  check('re-roll touches every game', rerolled.roundRobin === all);

  // Finals get filled too, so one click can reach a champion.
  const standings = Standings.compute(tournament);
  tournament.finals = Finals.start(standings.slice(0, 4).map(function (r) { return r.playerId; }));
  const withFinals = Demo.fill(tournament, {}, seeded(11));
  check('finals are filled', withFinals.finals === 3);
  check('round robin was already full', withFinals.roundRobin === 0);

  const byId = {};
  players.forEach(function (p) { byId[p.id] = p; });
  check('a filled finals produces two champions', Finals.champions(tournament.finals, byId).length === 2);

  // Opting out of the finals must leave them alone.
  tournament.finals.games.forEach(function (g) { g.scoreA = null; g.scoreB = null; });
  const skipped = Demo.fill(tournament, { includeFinals: false }, seeded(12));
  check('finals can be skipped', skipped.finals === 0);
  check('skipped finals stay empty', Finals.isComplete(tournament.finals) === false);
})();

/* ---------------------------------------------------------- default naming */

check('the two draws are named for their levels',
  Model.DEFAULT_NAMES.join(' / ') === 'Advanced / Intermediate');
(function () {
  const fresh = Model.defaultState();
  check('a fresh state uses the level names',
    fresh.tournaments[0].name === 'Advanced' && fresh.tournaments[1].name === 'Intermediate');
  check('the two draws stay independent', fresh.tournaments[0].id !== fresh.tournaments[1].id);
  check('legacy names are still known for migration', Model.LEGACY_NAMES.length === 2);
})();

/* ------------------------------------------------------------- share links */

(function shareTest() {
  const players = roster(12);
  const settings = { courts: 2, rounds: 4, targetScore: 9, winBy: 1 };
  const tournament = {
    name: 'Advanced',
    players: players,
    settings: settings,
    schedule: Scheduler.generateSchedule(players, settings, seeded(31)),
    finals: null,
  };
  Demo.fill(tournament, {}, seeded(32));

  check('base64url survives a round trip', Share.decode64(Share.encode64('hello')) === 'hello');
  check('base64url handles non-ASCII names',
    Share.decode64(Share.encode64('Renée Ökonomou 李')) === 'Renée Ökonomou 李');
  check('base64url output is URL-safe', /^[A-Za-z0-9_-]*$/.test(Share.encode64('??>>>~~~###')));

  const encoded = Share.encodeSnapshot(tournament);
  const snap = Share.decodeSnapshot(encoded);
  check('a snapshot decodes', snap !== null);
  check('the snapshot carries the name', snap.name === 'Advanced');
  check('every player is in the snapshot', snap.rows.length === 12);
  check('progress is carried', snap.done === snap.total && snap.total > 0);

  // The snapshot must agree with what the admin sees, or spectators are
  // reading a different tournament.
  const local = Standings.compute(tournament);
  check('snapshot order matches the standings',
    snap.rows.map(function (r) { return r.name; }).join() ===
    local.map(function (r) { return r.name; }).join());
  check('snapshot records match', snap.rows.every(function (r, i) {
    return r.w === local[i].w && r.l === local[i].l && r.diff === local[i].diff;
  }));

  // A QR has to physically fit, so the worst case matters.
  const big = roster(Model.MAX_PLAYERS).map(function (p, i) {
    return Object.assign({}, p, { name: 'Verylongname Player ' + (i + 1) });
  });
  const bigT = {
    name: 'A Long Tournament Name',
    players: big,
    settings: settings,
    schedule: Scheduler.generateSchedule(big, settings, seeded(33)),
    finals: null,
  };
  Demo.fill(bigT, {}, seeded(34));
  const bigEncoded = Share.encodeSnapshot(bigT);
  check('a full 24-player snapshot stays QR-sized', bigEncoded.length < 2000,
    bigEncoded.length + ' chars');
  check('the big snapshot still decodes', Share.decodeSnapshot(bigEncoded).rows.length === 24);

  // Champions ride along once the finals are done.
  const top4 = Standings.compute(tournament).slice(0, 4).map(function (r) { return r.playerId; });
  tournament.finals = Finals.start(top4);
  Demo.fill(tournament, {}, seeded(35));
  const done = Share.decodeSnapshot(Share.encodeSnapshot(tournament));
  check('champions are shared once decided', Array.isArray(done.champions) && done.champions.length === 2);

  // Bad input must fail softly — a half-scanned QR should not break the page.
  check('garbage decodes to null', Share.decodeSnapshot('!!!!not-base64!!!!') === null);
  check('truncated payload decodes to null', Share.decodeSnapshot(encoded.slice(0, 40)) === null);
  check('empty payload decodes to null', Share.decodeSnapshot('') === null);
  check('valid base64 of the wrong thing decodes to null',
    Share.decodeSnapshot(Share.encode64('{\"hello\":1}')) === null);

  // URL mode detection drives which app the browser boots into.
  check('a bare url is admin', Share.readMode('').mode === 'admin');
  check('an unknown fragment is admin', Share.readMode('#something').mode === 'admin');
  const liveMode = Share.readMode('#live=abc123xyz');
  check('a live link is detected', liveMode.mode === 'live' && liveMode.shareId === 'abc123xyz');
  check('a snapshot link is detected', Share.readMode('#snap=' + encoded).mode === 'snapshot');
  check('a snapshot link keeps its payload', Share.readMode('#snap=' + encoded).payload === encoded);

  const url = Share.snapshotUrl('https://example.com/pickle/#live=old', tournament);
  check('building a url replaces any existing fragment',
    url.indexOf('#snap=') > 0 && url.indexOf('live=old') === -1);
  check('the live url points at the share id',
    Share.liveUrl('https://example.com/pickle/', 'zzz') === 'https://example.com/pickle/#live=zzz');

  // Ids are the read capability, so they must not collide or be guessable.
  const ids = {};
  for (let i = 0; i < 500; i++) ids[Share.newShareId()] = true;
  check('share ids are unique across 500 draws', Object.keys(ids).length === 500);
  check('share ids are long enough to be unguessable', Share.newShareId().length >= 16);
  check('share ids are url-safe', /^[a-z0-9]+$/.test(Share.newShareId()));
})();

/* --------------------------------------------------- games-per-player target */

// The promise the Setup tab makes is a MINIMUM, so the least-played player in
// every configuration is what has to be checked -- not the average.
(function gamesPerPlayerTest() {
  let worstShortfall = 0;
  let configs = 0;

  for (let n = Model.MIN_PLAYERS; n <= Model.MAX_PLAYERS; n++) {
    for (const courts of [1, 2, 3, 4, 6]) {
      if (Model.gamesPerRound(n, courts) < 1) continue;
      for (const target of [3, 5, 6, 8]) {
        const settings = { courts: courts, gamesPerPlayer: target, targetScore: 9, winBy: 1 };
        const rounds = Model.roundsForGamesPerPlayer(n, courts, target);
        const tag = n + 'p/' + courts + 'ct/' + target + 'g';
        configs += 1;

        const players = roster(n);
        const schedule = Scheduler.generateSchedule(players, settings, seeded(n * 31 + courts * 7 + target));
        check('rounds match the resolver (' + tag + ')', schedule.length === rounds);

        const played = {};
        players.forEach(function (p) { played[p.id] = 0; });
        schedule.forEach(function (round) {
          round.games.forEach(function (g) {
            g.teamA.concat(g.teamB).forEach(function (id) { played[id] += 1; });
          });
        });
        const counts = Object.keys(played).map(function (k) { return played[k]; });
        const least = Math.min.apply(null, counts);
        const most = Math.max.apply(null, counts);

        check('nobody falls short of the target (' + tag + ')', least >= target,
          'least played ' + least + ' of ' + target);
        check('games stay within one of each other (' + tag + ')', most - least <= 1,
          least + '-' + most);
        if (least < target) worstShortfall = Math.max(worstShortfall, target - least);
      }
    }
  }
  check('no configuration shorted anyone', worstShortfall === 0, 'worst shortfall ' + worstShortfall);
  check('the sweep actually covered a lot of ground', configs > 200, configs + ' configs');

  // No wasted rounds either: one fewer would miss the target.
  for (const [n, c, target] of [[15, 2, 5], [15, 2, 6], [11, 2, 5], [26, 4, 5], [13, 2, 5]]) {
    const r = Model.roundsForGamesPerPlayer(n, c, target);
    const seats = Model.gamesPerRound(n, c) * 4;
    check('rounds are the minimum needed (' + n + 'p/' + c + 'ct/' + target + 'g)',
      Math.floor((r - 1) * seats / n) < target,
      r + ' rounds may be one too many');
  }

  // The worked examples from planning the real event.
  check('15 players on 2 courts need 10 rounds for 5 games', Model.roundsForGamesPerPlayer(15, 2, 5) === 10);
  check('15 players on 2 courts need 12 rounds for 6 games', Model.roundsForGamesPerPlayer(15, 2, 6) === 12);
  check('11 players on 2 courts need 7 rounds for 5 games', Model.roundsForGamesPerPlayer(11, 2, 5) === 7);
  check('26 players on 4 courts need 9 rounds for 5 games', Model.roundsForGamesPerPlayer(26, 4, 5) === 9);

  // A legacy tournament saved with a raw round count still resolves.
  check('a legacy rounds setting still works',
    Model.resolveRounds(12, { courts: 2, rounds: 7 }) === 7);
  check('games-per-player wins when both are present',
    Model.resolveRounds(15, { courts: 2, rounds: 99, gamesPerPlayer: 5 }) === 10);
  check('the default target is five', Model.DEFAULT_SETTINGS.gamesPerPlayer === 5);
})();

/* ------------------------------------------------------------------ report */

if (failures.length) {
  console.error('FAILED ' + failures.length + ' check(s):');
  failures.forEach(function (f) { console.error('  ✗ ' + f); });
  console.error(passed + ' passed.');
  process.exit(1);
}
console.log('✓ all ' + passed + ' checks passed');
