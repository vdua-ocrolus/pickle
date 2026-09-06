/* Individual standings. Partners rotate every round, so every stat is tracked
   per player rather than per team. */
(function (root, factory) {
  const api = factory(root.Model || (typeof require !== 'undefined' ? require('./model.js') : null));
  root.Standings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function (Model) {
  'use strict';

  function blankRow(player) {
    return {
      playerId: player.id,
      name: player.name,
      gp: 0,
      w: 0,
      l: 0,
      pf: 0,
      pa: 0,
      byes: 0,
      diff: 0,
      winPct: 0,
    };
  }

  function record(row, scored, allowed, won) {
    row.gp += 1;
    row.pf += scored;
    row.pa += allowed;
    if (won) row.w += 1; else row.l += 1;
  }

  /* Byes are shared evenly, so games played differ by at most one. Win
     percentage keeps a player who sat out an extra round on equal footing;
     point differential and points scored break the ties below that. */
  function compare(a, b) {
    if (b.winPct !== a.winPct) return b.winPct - a.winPct;
    if (b.diff !== a.diff) return b.diff - a.diff;
    if (b.pf !== a.pf) return b.pf - a.pf;
    if (b.w !== a.w) return b.w - a.w;
    return a.name.localeCompare(b.name);
  }

  function sameRank(a, b) {
    return a.winPct === b.winPct && a.diff === b.diff && a.pf === b.pf && a.w === b.w;
  }

  function compute(tournament) {
    const rows = new Map();
    tournament.players.forEach(function (p) { rows.set(p.id, blankRow(p)); });

    (tournament.schedule || []).forEach(function (round) {
      round.byes.forEach(function (id) {
        const row = rows.get(id);
        if (row) row.byes += 1;
      });
      round.games.forEach(function (game) {
        if (!Model.isGameComplete(game)) return;
        const aWon = game.scoreA > game.scoreB;
        game.teamA.forEach(function (id) {
          const row = rows.get(id);
          if (row) record(row, game.scoreA, game.scoreB, aWon);
        });
        game.teamB.forEach(function (id) {
          const row = rows.get(id);
          if (row) record(row, game.scoreB, game.scoreA, !aWon);
        });
      });
    });

    const list = Array.from(rows.values());
    list.forEach(function (row) {
      row.diff = row.pf - row.pa;
      row.winPct = row.gp ? row.w / row.gp : 0;
    });
    list.sort(compare);

    let rank = 0;
    list.forEach(function (row, i) {
      if (i === 0 || !sameRank(row, list[i - 1])) rank = i + 1;
      row.rank = rank;
      row.tied = (i > 0 && sameRank(row, list[i - 1])) ||
        (i < list.length - 1 && sameRank(row, list[i + 1]));
    });
    return list;
  }

  function roundRobinProgress(tournament) {
    let total = 0;
    let done = 0;
    (tournament.schedule || []).forEach(function (round) {
      round.games.forEach(function (game) {
        total += 1;
        if (Model.isGameComplete(game)) done += 1;
      });
    });
    return { total: total, done: done, complete: total > 0 && done === total };
  }

  /* True when players seeded 4th and 5th are dead even — the operator should
     settle that one by hand before locking the finalists. */
  function tieAtCutLine(standings) {
    return standings.length > 4 && sameRank(standings[3], standings[4]);
  }

  return {
    compute: compute,
    compare: compare,
    roundRobinProgress: roundRobinProgress,
    tieAtCutLine: tieAtCutLine,
  };
});
