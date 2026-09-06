/* Read-only sharing.
 *
 * Two ways a spectator can see what is going on:
 *
 *   Live   — the tournament is published to a database and the viewer link
 *            streams updates. Needs a connection at both ends.
 *   Snapshot — the standings at one moment, packed into the link itself and
 *            handed over as a QR code. Needs no connection whatsoever, which
 *            is the whole point at a court with no signal.
 *
 * This file is only the encoding. Transport lives in sync.js.
 */
(function (root, factory) {
  const api = factory(
    root.Model || (typeof require !== 'undefined' ? require('./model.js') : null),
    root.Standings || (typeof require !== 'undefined' ? require('./standings.js') : null),
    root.Finals || (typeof require !== 'undefined' ? require('./finals.js') : null)
  );
  root.Share = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function (Model, Standings, Finals) {
  'use strict';

  const SNAPSHOT_VERSION = 2;

  /* ------------------------------------------------------------- base64url */

  function toBytes(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
    return Uint8Array.from(Buffer.from(text, 'utf8'));
  }

  function fromBytes(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
    return Buffer.from(bytes).toString('utf8');
  }

  function encode64(text) {
    const bytes = toBytes(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decode64(encoded) {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    if (typeof atob === 'function') {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return fromBytes(bytes);
    }
    return Buffer.from(b64, 'base64').toString('utf8');
  }

  /* ------------------------------------------------------------- snapshots */

  /* Carries the results themselves rather than a computed table: names once,
     then every game as four player indexes and the score. Standings, sit-outs
     and champions are all derivable from that, so shipping both would be
     bytes spent twice — and bytes are what decide whether a QR can be scanned
     off a phone screen. */
  function buildSnapshot(tournament) {
    const index = {};
    const names = [];
    tournament.players.forEach(function (p) {
      index[p.id] = names.length;
      names.push(p.name);
    });

    function encodeGame(game) {
      const cells = game.teamA.concat(game.teamB).map(function (id) { return index[id]; });
      // A game with no score is just the four players; length says the rest.
      if (Model.isGameComplete(game)) cells.push(game.scoreA, game.scoreB);
      return cells;
    }

    const snapshot = {
      v: SNAPSHOT_VERSION,
      n: tournament.name,
      p: names,
      r: (tournament.schedule || []).map(function (round) {
        return round.games.map(encodeGame);
      }),
    };

    const withdrawn = tournament.players
      .map(function (p, i) { return p.withdrawn ? i : -1; })
      .filter(function (i) { return i !== -1; });
    if (withdrawn.length) snapshot.o = withdrawn;

    if (tournament.finals) {
      snapshot.f = tournament.finals.games.map(encodeGame);
    }
    return snapshot;
  }

  /* Standings only, for when the full results would make a QR too dense to
     scan comfortably off a phone screen. */
  function buildCompactSnapshot(tournament) {
    const rows = Standings.compute(tournament);
    const progress = Standings.roundRobinProgress(tournament);
    const byId = {};
    tournament.players.forEach(function (p) { byId[p.id] = p; });
    const champions = Finals.isComplete(tournament.finals)
      ? Finals.champions(tournament.finals, byId).map(function (c) { return c.name; })
      : null;

    return {
      v: SNAPSHOT_VERSION,
      n: tournament.name,
      d: progress.done,
      t: progress.total,
      c: champions,
      s: rows.map(function (row) {
        return [row.name, row.w, row.l, row.pf, row.pa, row.byes];
      }),
    };
  }

  function encodeSnapshot(tournament, compact) {
    return encode64(JSON.stringify(
      compact ? buildCompactSnapshot(tournament) : buildSnapshot(tournament)));
  }

  /* Rebuilds a tournament-shaped object so the viewer can run the very same
     standings and finals code the organiser's phone runs. Anything else risks
     spectators reading a subtly different table. */
  function decodeSnapshot(encoded) {
    let parsed;
    try {
      parsed = JSON.parse(decode64(encoded));
    } catch (err) {
      return null;
    }
    if (!parsed) return null;
    if (parsed.v === 1) return decodeLegacySnapshot(parsed);
    if (parsed.v !== SNAPSHOT_VERSION) return null;
    // A compact snapshot carries the finished table instead of the games.
    if (Array.isArray(parsed.s)) {
      return decodeLegacySnapshot({ n: parsed.n, r: parsed.s, d: parsed.d, t: parsed.t, c: parsed.c });
    }
    if (!Array.isArray(parsed.p) || !Array.isArray(parsed.r)) return null;

    const withdrawn = {};
    (parsed.o || []).forEach(function (i) { withdrawn[i] = true; });
    const players = parsed.p.map(function (name, i) {
      if (typeof name !== 'string') return null;
      return { id: 's' + i, name: name, withdrawn: !!withdrawn[i] };
    });
    if (players.some(function (p) { return p === null; })) return null;

    function decodeGame(cells, roundNumber, court) {
      if (!Array.isArray(cells) || cells.length < 4) return null;
      const ids = cells.slice(0, 4).map(function (i) {
        return players[i] ? players[i].id : null;
      });
      if (ids.some(function (id) { return id === null; })) return null;
      const scored = cells.length >= 6;
      return {
        id: 'sg' + roundNumber + '_' + court,
        round: roundNumber,
        court: court,
        teamA: [ids[0], ids[1]],
        teamB: [ids[2], ids[3]],
        scoreA: scored ? cells[4] : null,
        scoreB: scored ? cells[5] : null,
      };
    }

    const allIds = players.map(function (p) { return p.id; });
    const schedule = [];
    for (let r = 0; r < parsed.r.length; r++) {
      if (!Array.isArray(parsed.r[r])) return null;
      const games = [];
      for (let g = 0; g < parsed.r[r].length; g++) {
        const game = decodeGame(parsed.r[r][g], r + 1, g + 1);
        if (!game) return null;
        games.push(game);
      }
      // Sit-outs are whoever is not on a court that round, so they need no bytes.
      const playing = {};
      games.forEach(function (g) {
        g.teamA.concat(g.teamB).forEach(function (id) { playing[id] = true; });
      });
      schedule.push({
        round: r + 1,
        games: games,
        byes: allIds.filter(function (id) { return !playing[id]; }),
      });
    }

    let finals = null;
    if (Array.isArray(parsed.f) && parsed.f.length) {
      const games = [];
      for (let i = 0; i < parsed.f.length; i++) {
        const game = decodeGame(parsed.f[i], i + 1, 1);
        if (!game) return null;
        games.push(game);
      }
      const seeds = [];
      games.forEach(function (g) {
        g.teamA.concat(g.teamB).forEach(function (id) {
          if (seeds.indexOf(id) === -1) seeds.push(id);
        });
      });
      finals = { seeds: seeds, games: games };
    }

    return {
      name: typeof parsed.n === 'string' ? parsed.n : 'Tournament',
      tournament: {
        name: typeof parsed.n === 'string' ? parsed.n : 'Tournament',
        players: players,
        settings: Model.DEFAULT_SETTINGS,
        schedule: schedule,
        finals: finals,
      },
    };
  }

  /* Links produced before results were included carry a computed table and no
     games. Old codes in someone's camera roll should still open. */
  function decodeLegacySnapshot(parsed) {
    if (!Array.isArray(parsed.r)) return null;
    const rows = [];
    for (let i = 0; i < parsed.r.length; i++) {
      const r = parsed.r[i];
      if (!Array.isArray(r) || r.length < 6 || typeof r[0] !== 'string') return null;
      const gp = r[1] + r[2];
      rows.push({
        name: r[0], w: r[1], l: r[2], pf: r[3], pa: r[4], byes: r[5],
        gp: gp, diff: r[3] - r[4], winPct: gp ? r[1] / gp : 0, rank: i + 1,
      });
    }
    return {
      name: typeof parsed.n === 'string' ? parsed.n : 'Tournament',
      legacyRows: rows,
      done: parsed.d || 0,
      total: parsed.t || 0,
      champions: Array.isArray(parsed.c) ? parsed.c : null,
    };
  }

  /* ------------------------------------------------------------------ ids */

  /* The published id is also the capability to read it, so it has to be long
     enough that nobody stumbles onto someone else's tournament. */
  function newShareId() {
    const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
    const size = 16;
    let out = '';
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const bytes = new Uint8Array(size);
      crypto.getRandomValues(bytes);
      for (let i = 0; i < size; i++) out += alphabet[bytes[i] % alphabet.length];
      return out;
    }
    for (let i = 0; i < size; i++) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }

  /* ------------------------------------------------------------------ urls */

  function baseUrl(href) {
    return String(href).split('#')[0];
  }

  function liveUrl(href, shareId) {
    return baseUrl(href) + '#live=' + shareId;
  }

  function snapshotUrl(href, tournament, compact) {
    return baseUrl(href) + '#snap=' + encodeSnapshot(tournament, compact);
  }

  /* What mode a given URL puts the app into. */
  function readMode(hash) {
    const raw = String(hash || '').replace(/^#/, '');
    if (!raw) return { mode: 'admin' };
    const live = raw.match(/^live=([A-Za-z0-9_-]+)$/);
    if (live) return { mode: 'live', shareId: live[1] };
    const snap = raw.match(/^snap=([A-Za-z0-9_-]+)$/);
    if (snap) return { mode: 'snapshot', payload: snap[1] };
    return { mode: 'admin' };
  }

  return {
    SNAPSHOT_VERSION: SNAPSHOT_VERSION,
    encode64: encode64,
    decode64: decode64,
    buildSnapshot: buildSnapshot,
    encodeSnapshot: encodeSnapshot,
    buildCompactSnapshot: buildCompactSnapshot,
    decodeSnapshot: decodeSnapshot,
    newShareId: newShareId,
    liveUrl: liveUrl,
    snapshotUrl: snapshotUrl,
    readMode: readMode,
  };
});
