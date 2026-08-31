/* Core data shapes and defaults. No DOM access — safe to require from node. */
(function (root, factory) {
  const api = factory();
  root.Model = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const MIN_PLAYERS = 6;
  const MAX_PLAYERS = 24;
  const PLAYERS_PER_GAME = 4;

  const DEFAULT_SETTINGS = {
    courts: 2,
    rounds: 6,
    targetScore: 9,
    winBy: 1,
  };

  let counter = 0;
  function uid(prefix) {
    counter += 1;
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + counter.toString(36);
  }

  function createPlayer(name) {
    return { id: uid('p'), name: String(name).trim() };
  }

  function createTournament(name) {
    return {
      id: uid('t'),
      name: name,
      settings: Object.assign({}, DEFAULT_SETTINGS),
      players: [],
      schedule: null, // array of rounds once generated
      finals: null, // { seeds: [id x4], games: [...] } once started
      phase: 'setup', // setup | roundRobin | finals | complete
    };
  }

  function defaultState() {
    const a = createTournament('Tournament A');
    const b = createTournament('Tournament B');
    return {
      version: 1,
      activeTournamentId: a.id,
      tournaments: [a, b],
    };
  }

  /* Number of games that can run at once, given roster size and court count. */
  function gamesPerRound(playerCount, courts) {
    return Math.max(0, Math.min(courts, Math.floor(playerCount / PLAYERS_PER_GAME)));
  }

  function isGameComplete(game) {
    return Number.isInteger(game.scoreA) && Number.isInteger(game.scoreB);
  }

  /* Validates a final score against the tournament's "to N, win by M" rule. */
  function validateScore(a, b, targetScore, winBy) {
    const target = Number(targetScore);
    const margin = Number(winBy);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
      return 'Scores must be whole numbers of 0 or more.';
    }
    if (a === b) return 'A game cannot end tied.';
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    if (hi < target) return 'The winner must reach at least ' + target + '.';
    if (hi - lo < margin) return 'The winner must win by at least ' + margin + '.';
    if (hi > target && hi - lo > margin) {
      return 'Past ' + target + ', play stops the moment the lead hits ' + margin + '.';
    }
    return null;
  }

  function rosterError(players) {
    const names = players.map(function (p) { return p.name.trim().toLowerCase(); });
    if (players.length < MIN_PLAYERS) {
      return 'Add at least ' + MIN_PLAYERS + ' players (currently ' + players.length + ').';
    }
    if (players.length > MAX_PLAYERS) {
      return 'Maximum ' + MAX_PLAYERS + ' players (currently ' + players.length + ').';
    }
    if (names.some(function (n) { return n === ''; })) return 'Every player needs a name.';
    if (new Set(names).size !== names.length) return 'Player names must be unique.';
    return null;
  }

  return {
    MIN_PLAYERS: MIN_PLAYERS,
    MAX_PLAYERS: MAX_PLAYERS,
    PLAYERS_PER_GAME: PLAYERS_PER_GAME,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    uid: uid,
    createPlayer: createPlayer,
    createTournament: createTournament,
    defaultState: defaultState,
    gamesPerRound: gamesPerRound,
    isGameComplete: isGameComplete,
    validateScore: validateScore,
    rosterError: rosterError,
  };
});
