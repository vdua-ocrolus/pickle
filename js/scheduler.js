/* Round-robin schedule generation: random doubles pairings that avoid repeat
   partners, spread out opponents, and share sit-outs evenly. */
(function (root, factory) {
  const api = factory(root.Model || (typeof require !== 'undefined' ? require('./model.js') : null));
  root.Scheduler = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function (Model) {
  'use strict';

  // Playing with the same partner twice is a worse outcome than facing the same
  // opponent twice, so partners carry the heavier weight.
  const PARTNER_WEIGHT = 12;
  const OPPONENT_WEIGHT = 1;
  const ATTEMPTS_PER_ROUND = 800;

  function pairKey(a, b) {
    return a < b ? a + '|' + b : b + '|' + a;
  }

  function bump(counts, a, b) {
    const k = pairKey(a, b);
    counts[k] = (counts[k] || 0) + 1;
  }

  function get(counts, a, b) {
    return counts[pairKey(a, b)] || 0;
  }

  function shuffle(list, rand) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  /* Cost of splitting a group of four into these two teams. */
  function splitCost(teamA, teamB, partners, opponents) {
    const p = get(partners, teamA[0], teamA[1]) + get(partners, teamB[0], teamB[1]);
    let o = 0;
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) o += get(opponents, teamA[i], teamB[j]);
    }
    return PARTNER_WEIGHT * p * p + OPPONENT_WEIGHT * o;
  }

  const SPLITS = [
    [[0, 1], [2, 3]],
    [[0, 2], [1, 3]],
    [[0, 3], [1, 2]],
  ];

  function bestSplit(quad, partners, opponents) {
    let best = null;
    let bestCost = Infinity;
    for (const split of SPLITS) {
      const teamA = [quad[split[0][0]], quad[split[0][1]]];
      const teamB = [quad[split[1][0]], quad[split[1][1]]];
      const cost = splitCost(teamA, teamB, partners, opponents);
      if (cost < bestCost) {
        bestCost = cost;
        best = { teamA: teamA, teamB: teamB };
      }
    }
    return { pairing: best, cost: bestCost };
  }

  /* Repeatedly reshuffles the playing pool and keeps the cheapest arrangement. */
  function arrangeGames(playing, partners, opponents, rand) {
    let best = null;
    let bestCost = Infinity;
    for (let attempt = 0; attempt < ATTEMPTS_PER_ROUND; attempt++) {
      const pool = shuffle(playing.slice(), rand);
      const games = [];
      let total = 0;
      for (let i = 0; i < pool.length; i += 4) {
        const result = bestSplit(pool.slice(i, i + 4), partners, opponents);
        games.push(result.pairing);
        total += result.cost;
      }
      if (total < bestCost) {
        bestCost = total;
        best = games;
      }
      if (bestCost === 0) break;
    }
    return best || [];
  }

  /* Picks who plays this round: whoever has sat out most goes first, with ties
     broken randomly so the same people aren't always on the bubble. */
  function selectPlaying(playerIds, seats, byeCount, rand) {
    const ordered = shuffle(playerIds.slice(), rand).sort(function (a, b) {
      return (byeCount[b] || 0) - (byeCount[a] || 0);
    });
    return {
      playing: ordered.slice(0, seats),
      byes: ordered.slice(seats),
    };
  }

  /**
   * Builds the full round-robin schedule up front.
   * @param {Array} players  roster objects with { id, name }
   * @param {Object} settings { courts, gamesPerPlayer } (or a legacy { rounds })
   * @param {Function} [rand] injectable RNG for deterministic tests
   */
  function generateSchedule(players, settings, rand) {
    const random = rand || Math.random;
    const playerIds = players.map(function (p) { return p.id; });
    const perRound = Model.gamesPerRound(playerIds.length, settings.courts);
    if (perRound < 1) {
      throw new Error('Not enough players for a game on the courts available.');
    }

    const partners = {};
    const opponents = {};
    const byeCount = {};
    playerIds.forEach(function (id) { byeCount[id] = 0; });

    const rounds = Model.resolveRounds(playerIds.length, settings);
    const schedule = [];
    for (let r = 1; r <= rounds; r++) {
      const picked = selectPlaying(playerIds, perRound * 4, byeCount, random);
      picked.byes.forEach(function (id) { byeCount[id] += 1; });

      const pairings = arrangeGames(picked.playing, partners, opponents, random);
      const games = pairings.map(function (pairing, index) {
        bump(partners, pairing.teamA[0], pairing.teamA[1]);
        bump(partners, pairing.teamB[0], pairing.teamB[1]);
        for (let i = 0; i < 2; i++) {
          for (let j = 0; j < 2; j++) bump(opponents, pairing.teamA[i], pairing.teamB[j]);
        }
        return {
          id: Model.uid('g'),
          round: r,
          court: index + 1,
          teamA: pairing.teamA,
          teamB: pairing.teamB,
          scoreA: null,
          scoreB: null,
        };
      });

      schedule.push({ round: r, games: games, byes: picked.byes });
    }
    return schedule;
  }

  /* Diagnostics used by the tests and the schedule summary line. */
  function scheduleQuality(schedule, playerIds) {
    const partners = {};
    const opponents = {};
    const byes = {};
    (playerIds || []).forEach(function (id) { byes[id] = 0; });
    schedule.forEach(function (round) {
      round.byes.forEach(function (id) { byes[id] = (byes[id] || 0) + 1; });
      round.games.forEach(function (g) {
        bump(partners, g.teamA[0], g.teamA[1]);
        bump(partners, g.teamB[0], g.teamB[1]);
        for (let i = 0; i < 2; i++) {
          for (let j = 0; j < 2; j++) bump(opponents, g.teamA[i], g.teamB[j]);
        }
      });
    });
    const counts = Object.keys(partners).map(function (k) { return partners[k]; });
    const byeValues = Object.keys(byes).map(function (k) { return byes[k]; });
    return {
      repeatPartnerships: counts.filter(function (c) { return c > 1; }).length,
      maxPartnerRepeats: counts.length ? Math.max.apply(null, counts) : 0,
      maxOpponentRepeats: Object.keys(opponents).reduce(function (m, k) {
        return Math.max(m, opponents[k]);
      }, 0),
      byeSpread: byeValues.length ? Math.max.apply(null, byeValues) - Math.min.apply(null, byeValues) : 0,
    };
  }

  return {
    generateSchedule: generateSchedule,
    scheduleQuality: scheduleQuality,
    _internals: { pairKey: pairKey, shuffle: shuffle, arrangeGames: arrangeGames },
  };
});
