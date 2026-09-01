/* Testing aid: fill games with plausible random results so a whole tournament
   can be played out in one click. Every score it writes obeys the tournament's
   own "to N, win by M" rule, so nothing it produces could be rejected on the
   Schedule tab. */
(function (root, factory) {
  const api = factory(root.Model || (typeof require !== 'undefined' ? require('./model.js') : null));
  root.Demo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function (Model) {
  'use strict';

  function randInt(rand, maxInclusive) {
    return Math.floor(rand() * (maxInclusive + 1));
  }

  /* The winner lands exactly on the target; the loser gets anything far enough
     back to satisfy the winning margin. Sides are picked at random, so the
     results spread evenly and ties in the standings show up naturally. */
  function randomResult(settings, rand) {
    const target = settings.targetScore;
    const loserMax = Math.max(0, target - settings.winBy);
    const loser = randInt(rand, loserMax);
    return rand() < 0.5
      ? { scoreA: target, scoreB: loser }
      : { scoreA: loser, scoreB: target };
  }

  function applyTo(games, settings, overwrite, rand) {
    let filled = 0;
    games.forEach(function (game) {
      if (!overwrite && Model.isGameComplete(game)) return;
      const result = randomResult(settings, rand);
      game.scoreA = result.scoreA;
      game.scoreB = result.scoreB;
      filled += 1;
    });
    return filled;
  }

  /**
   * Fills a tournament's games with random results.
   * @param {Object} tournament
   * @param {Object} [options] { overwrite: replace scores already entered,
   *                             includeFinals: also fill the finals }
   * @param {Function} [rand] injectable RNG for deterministic tests
   * @returns {{ roundRobin: number, finals: number, total: number }}
   */
  function fill(tournament, options, rand) {
    const opts = options || {};
    const random = rand || Math.random;
    const overwrite = !!opts.overwrite;
    const includeFinals = opts.includeFinals !== false;
    const settings = tournament.settings;

    let roundRobin = 0;
    (tournament.schedule || []).forEach(function (round) {
      roundRobin += applyTo(round.games, settings, overwrite, random);
    });

    let finals = 0;
    if (includeFinals && tournament.finals) {
      finals = applyTo(tournament.finals.games, settings, overwrite, random);
    }

    return { roundRobin: roundRobin, finals: finals, total: roundRobin + finals };
  }

  /* How many games a fill would touch, so the button can be disabled and the
     confirmation can name a number. */
  function countFillable(tournament, options) {
    const opts = options || {};
    const overwrite = !!opts.overwrite;
    const includeFinals = opts.includeFinals !== false;
    let total = 0;
    (tournament.schedule || []).forEach(function (round) {
      round.games.forEach(function (game) {
        if (overwrite || !Model.isGameComplete(game)) total += 1;
      });
    });
    if (includeFinals && tournament.finals) {
      tournament.finals.games.forEach(function (game) {
        if (overwrite || !Model.isGameComplete(game)) total += 1;
      });
    }
    return total;
  }

  return {
    randomResult: randomResult,
    fill: fill,
    countFillable: countFillable,
  };
});
