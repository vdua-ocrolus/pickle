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

  const SNAPSHOT_VERSION = 1;

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

  /* Only what a spectator reads: no ids, no schedule, no settings. Keeping it
     to the standings is what holds the QR small enough to scan off a phone. */
  function buildSnapshot(tournament) {
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
      r: rows.map(function (row) {
        return [row.name, row.w, row.l, row.pf, row.pa, row.byes];
      }),
    };
  }

  function encodeSnapshot(tournament) {
    return encode64(JSON.stringify(buildSnapshot(tournament)));
  }

  /* Returns null rather than throwing: a mistyped or truncated link should
     show a friendly message, not a broken page. */
  function decodeSnapshot(encoded) {
    let parsed;
    try {
      parsed = JSON.parse(decode64(encoded));
    } catch (err) {
      return null;
    }
    if (!parsed || parsed.v !== SNAPSHOT_VERSION || !Array.isArray(parsed.r)) return null;

    const rows = [];
    for (let i = 0; i < parsed.r.length; i++) {
      const r = parsed.r[i];
      if (!Array.isArray(r) || r.length < 6 || typeof r[0] !== 'string') return null;
      const gp = r[1] + r[2];
      rows.push({
        name: r[0],
        w: r[1], l: r[2], pf: r[3], pa: r[4], byes: r[5],
        gp: gp,
        diff: r[3] - r[4],
        winPct: gp ? r[1] / gp : 0,
      });
    }
    return {
      name: typeof parsed.n === 'string' ? parsed.n : 'Tournament',
      done: parsed.d || 0,
      total: parsed.t || 0,
      champions: Array.isArray(parsed.c) ? parsed.c : null,
      rows: rows,
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

  function snapshotUrl(href, tournament) {
    return baseUrl(href) + '#snap=' + encodeSnapshot(tournament);
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
    decodeSnapshot: decodeSnapshot,
    newShareId: newShareId,
    liveUrl: liveUrl,
    snapshotUrl: snapshotUrl,
    readMode: readMode,
  };
});
