/* Roster changes after play has started.
 *
 * Someone not turning up or getting hurt is normal, and rebuilding the whole
 * draw is not an acceptable answer once scores are in. Both operations here
 * treat completed games as immovable: what has been played stays played, and
 * only the unplayed part of the schedule is touched.
 */
(function (root, factory) {
  const api = factory(
    root.Model || (typeof require !== 'undefined' ? require('./model.js') : null),
    root.Scheduler || (typeof require !== 'undefined' ? require('./scheduler.js') : null)
  );
  root.Roster = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function (Model, Scheduler) {
  'use strict';

  function activePlayers(tournament) {
    return tournament.players.filter(function (p) { return !p.withdrawn; });
  }

  function roundIsPlayed(round) {
    return round.games.some(Model.isGameComplete);
  }

  /**
   * A replacement takes over someone's remaining games.
   *
   * The original keeps every game they actually played, so the standings stay
   * honest; the replacement inherits only what had not started. Pairings do not
   * move, which is what makes this safe to do between rounds.
   */
  function substitute(tournament, outgoingId, incomingName) {
    const outgoing = tournament.players.find(function (p) { return p.id === outgoingId; });
    if (!outgoing) return { ok: false, error: 'That player is not in this tournament.' };

    const name = String(incomingName || '').trim();
    if (!name) return { ok: false, error: 'Give the replacement a name.' };
    const clash = tournament.players.some(function (p) {
      return p.name.toLowerCase() === name.toLowerCase();
    });
    if (clash) return { ok: false, error: name + ' is already on the roster.' };

    const incoming = Model.createPlayer(name);
    tournament.players.push(incoming);
    outgoing.withdrawn = true;
    outgoing.replacedBy = incoming.id;

    let games = 0;
    let byes = 0;
    (tournament.schedule || []).forEach(function (round) {
      round.games.forEach(function (game) {
        if (Model.isGameComplete(game)) return; // played, so it stands
        ['teamA', 'teamB'].forEach(function (side) {
          const at = game[side].indexOf(outgoingId);
          if (at !== -1) { game[side][at] = incoming.id; games += 1; }
        });
      });
      // Only take over sit-outs in rounds that have not started.
      if (!roundIsPlayed(round)) {
        const at = (round.byes || []).indexOf(outgoingId);
        if (at !== -1) { round.byes[at] = incoming.id; byes += 1; }
      }
    });

    return { ok: true, player: incoming, gamesTaken: games, byesTaken: byes };
  }

  /**
   * Someone drops out and nobody replaces them.
   *
   * Rounds that have started are kept as they are, minus any of their unplayed
   * games involving the leaver — those cannot be played four-a-side, so they
   * are dropped and the other three sit that round out. Every round that had
   * not started is redrawn without them, keeping the same number of rounds so
   * the day's timing does not move.
   */
  function withdraw(tournament, playerId, rand) {
    const player = tournament.players.find(function (p) { return p.id === playerId; });
    if (!player) return { ok: false, error: 'That player is not in this tournament.' };

    const remaining = activePlayers(tournament).filter(function (p) { return p.id !== playerId; });
    if (remaining.length < Model.MIN_PLAYERS) {
      return {
        ok: false,
        error: 'That would leave only ' + remaining.length + ' players, below the minimum of ' +
          Model.MIN_PLAYERS + '.',
      };
    }
    if (Model.gamesPerRound(remaining.length, tournament.settings.courts) < 1) {
      return { ok: false, error: 'Not enough players left to fill a court.' };
    }

    player.withdrawn = true;
    const schedule = tournament.schedule || [];

    // Everything up to and including the last round with a score is history.
    let lastPlayed = -1;
    schedule.forEach(function (round, i) { if (roundIsPlayed(round)) lastPlayed = i; });

    const kept = schedule.slice(0, lastPlayed + 1);
    const toRedraw = schedule.length - kept.length;

    let voided = 0;
    kept.forEach(function (round) {
      const survivors = [];
      round.games = round.games.filter(function (game) {
        const involved = game.teamA.concat(game.teamB).indexOf(playerId) !== -1;
        if (!involved || Model.isGameComplete(game)) return true;
        // Unplayed and short a player: drop it, the other three sit out.
        game.teamA.concat(game.teamB).forEach(function (id) {
          if (id !== playerId) survivors.push(id);
        });
        voided += 1;
        return false;
      });
      round.byes = (round.byes || []).filter(function (id) { return id !== playerId; }).concat(survivors);
    });

    const redrawn = toRedraw > 0
      ? Scheduler.extendSchedule(remaining, tournament.settings, kept, toRedraw, kept.length + 1, rand)
      : [];

    tournament.schedule = kept.concat(redrawn);

    // A player who is not on court cannot be seeded into the finals.
    if (tournament.finals && tournament.finals.seeds.indexOf(playerId) !== -1) {
      tournament.finals = null;
    }

    return {
      ok: true,
      keptRounds: kept.length,
      redrawnRounds: redrawn.length,
      voidedGames: voided,
      remaining: remaining.length,
    };
  }

  /* Someone who left mid-tournament should not be pre-selected for the finals,
     even if their partial record still ranks them highly. */
  function eligibleForFinals(tournament, standingsRows) {
    const out = {};
    tournament.players.forEach(function (p) { if (p.withdrawn) out[p.id] = true; });
    return standingsRows.filter(function (row) { return !out[row.playerId]; });
  }

  return {
    activePlayers: activePlayers,
    substitute: substitute,
    withdraw: withdraw,
    eligibleForFinals: eligibleForFinals,
  };
});
