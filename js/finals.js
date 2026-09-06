/* Finals: the top four play three games covering every partner combination, so
   each finalist partners each other finalist exactly once. The two best
   individual records win the tournament. */
(function (root, factory) {
  const api = factory(root.Model || (typeof require !== 'undefined' ? require('./model.js') : null));
  root.Finals = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function (Model) {
  'use strict';

  const FINALISTS = 4;

  /* Seeds are 1-4. Every player partners each other exactly once across the
     three games, and faces each other exactly twice. */
  const PATTERN = [
    [[0, 3], [1, 2]],
    [[0, 2], [1, 3]],
    [[0, 1], [2, 3]],
  ];

  function buildGames(seeds) {
    if (!Array.isArray(seeds) || seeds.length !== FINALISTS) {
      throw new Error('Finals need exactly ' + FINALISTS + ' players.');
    }
    if (new Set(seeds).size !== FINALISTS) {
      throw new Error('Each finalist can only be picked once.');
    }
    return PATTERN.map(function (pair, index) {
      return {
        id: Model.uid('f'),
        round: index + 1,
        court: 1,
        teamA: [seeds[pair[0][0]], seeds[pair[0][1]]],
        teamB: [seeds[pair[1][0]], seeds[pair[1][1]]],
        scoreA: null,
        scoreB: null,
      };
    });
  }

  function start(seeds) {
    return { seeds: seeds.slice(), games: buildGames(seeds) };
  }

  function compute(finals, playersById) {
    if (!finals) return [];
    const rows = finals.seeds.map(function (id, index) {
      const player = playersById[id];
      return {
        playerId: id,
        name: player ? player.name : 'Unknown',
        seed: index + 1,
        gp: 0,
        w: 0,
        l: 0,
        pf: 0,
        pa: 0,
        diff: 0,
      };
    });
    const byId = {};
    rows.forEach(function (row) { byId[row.playerId] = row; });

    finals.games.forEach(function (game) {
      if (!Model.isGameComplete(game)) return;
      const aWon = game.scoreA > game.scoreB;
      game.teamA.concat(game.teamB).forEach(function (id, i) {
        const row = byId[id];
        if (!row) return;
        const onA = i < 2;
        row.gp += 1;
        row.pf += onA ? game.scoreA : game.scoreB;
        row.pa += onA ? game.scoreB : game.scoreA;
        if (onA === aWon) row.w += 1; else row.l += 1;
      });
    });

    rows.forEach(function (row) { row.diff = row.pf - row.pa; });
    rows.sort(function (a, b) {
      if (b.w !== a.w) return b.w - a.w;
      if (b.diff !== a.diff) return b.diff - a.diff;
      if (b.pf !== a.pf) return b.pf - a.pf;
      return a.seed - b.seed; // round-robin seeding is the final tiebreak
    });
    rows.forEach(function (row, i) { row.place = i + 1; });
    return rows;
  }

  function isComplete(finals) {
    return !!finals && finals.games.every(Model.isGameComplete);
  }

  /* The two players the tournament is awarded to. */
  function champions(finals, playersById) {
    if (!isComplete(finals)) return [];
    return compute(finals, playersById).slice(0, 2);
  }

  return {
    FINALISTS: FINALISTS,
    buildGames: buildGames,
    start: start,
    compute: compute,
    isComplete: isComplete,
    champions: champions,
  };
});
