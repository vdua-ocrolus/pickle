/* Live publishing over the Firebase Realtime Database REST API.
 *
 * Deliberately no Firebase SDK. The SDK would have to come from a CDN, which
 * would either break offline use or need vendoring and precaching for a
 * feature most sessions never turn on. REST covers writing, and the database's
 * server-sent-events endpoint covers live reading, both with what the browser
 * already has.
 *
 * The rule this file exists to protect: the admin is never blocked by the
 * network. Local storage stays the source of truth, every write is queued, and
 * a failed push is retried later. Losing signal costs a spectator freshness; it
 * costs the person entering scores nothing.
 */
(function (root) {
  'use strict';

  const config = root.AppConfig || {};

  function enabled() {
    return !!(config.DATABASE_URL && String(config.DATABASE_URL).trim());
  }

  function endpoint(shareId) {
    const base = String(config.DATABASE_URL).replace(/\/+$/, '');
    return base + '/' + (config.PATH || 'tournaments') + '/' + shareId + '.json';
  }

  /* -------------------------------------------------------------- publisher */

  /**
   * Pushes a tournament to the database, coalescing rapid edits and retrying
   * whatever could not get through.
   *
   * @param {Function} onStatus called with 'synced' | 'pending' | 'offline' | 'error'
   */
  function createPublisher(onStatus) {
    let shareId = null;
    let pending = null;     // most recent payload not yet confirmed
    let timer = null;
    let inFlight = false;
    let status = 'idle';

    function setStatus(next) {
      if (next === status) return;
      status = next;
      if (onStatus) onStatus(next);
    }

    function flush() {
      if (!shareId || pending === null || inFlight) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setStatus('offline');
        return;
      }

      const payload = pending;
      inFlight = true;

      fetch(endpoint(shareId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(function (response) {
        inFlight = false;
        if (!response.ok) throw new Error('HTTP ' + response.status);
        // Only clear the queue if nothing newer arrived while this was in the air.
        if (pending === payload) {
          pending = null;
          setStatus('synced');
        } else {
          flush();
        }
      }).catch(function () {
        inFlight = false;
        // Keep `pending` — it is retried on the next save, the next online
        // event, or the next scheduled attempt.
        setStatus(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error');
        schedule(5000);
      });
    }

    function schedule(delay) {
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
    }

    if (typeof root.addEventListener === 'function') {
      root.addEventListener('online', function () {
        if (pending !== null) { setStatus('pending'); schedule(200); }
      });
      root.addEventListener('offline', function () {
        if (pending !== null) setStatus('offline');
      });
    }

    return {
      start: function (id) { shareId = id; },
      stop: function () {
        shareId = null;
        pending = null;
        clearTimeout(timer);
        setStatus('idle');
      },
      isPublishing: function () { return !!shareId; },
      shareId: function () { return shareId; },
      status: function () { return status; },

      /* Called on every local save. Cheap: it only queues. */
      publish: function (tournament) {
        if (!shareId) return;
        pending = {
          name: tournament.name,
          settings: tournament.settings,
          players: tournament.players,
          schedule: tournament.schedule,
          finals: tournament.finals,
          updatedAt: Date.now(),
        };
        setStatus('pending');
        schedule(config.PUSH_DEBOUNCE_MS || 1200);
      },

      /* Used when the admin stops publishing, so a stale board does not sit
         there looking live. */
      remove: function () {
        if (!shareId) return Promise.resolve();
        const url = endpoint(shareId);
        return fetch(url, { method: 'DELETE' }).catch(function () { /* best effort */ });
      },
    };
  }

  /* --------------------------------------------------------------- viewer */

  /**
   * Watches a published tournament. Streams over server-sent events where the
   * browser allows it, and falls back to polling otherwise.
   *
   * @param {Function} onData    called with the tournament object
   * @param {Function} onStatus  called with 'live' | 'connecting' | 'offline' | 'missing'
   */
  function createViewer(shareId, onData, onStatus) {
    let source = null;
    let poller = null;
    let stopped = false;

    function status(s) { if (onStatus) onStatus(s); }

    function handle(value) {
      if (value === null || value === undefined) { status('missing'); return; }
      status('live');
      onData(value);
    }

    function poll() {
      if (stopped) return;
      fetch(endpoint(shareId), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(handle)
        .catch(function () { status('offline'); });
    }

    function startPolling() {
      if (poller) return;
      poll();
      poller = setInterval(poll, config.POLL_INTERVAL_MS || 15000);
    }

    function startStream() {
      if (typeof EventSource === 'undefined') { startPolling(); return; }
      status('connecting');
      try {
        source = new EventSource(endpoint(shareId));
      } catch (err) {
        startPolling();
        return;
      }

      source.addEventListener('put', function (event) {
        try {
          const parsed = JSON.parse(event.data);
          // A root-level put carries the whole tournament; anything deeper is
          // a partial update, and re-reading once is simpler than patching.
          if (parsed.path === '/') handle(parsed.data);
          else poll();
        } catch (err) { poll(); }
      });
      source.addEventListener('patch', function () { poll(); });

      source.onerror = function () {
        // The stream drops on any network blip. Polling keeps the board moving
        // until it recovers.
        status('offline');
        startPolling();
      };
    }

    startStream();

    return {
      stop: function () {
        stopped = true;
        if (source) { source.close(); source = null; }
        if (poller) { clearInterval(poller); poller = null; }
      },
      refresh: poll,
    };
  }

  root.Sync = {
    enabled: enabled,
    endpoint: endpoint,
    createPublisher: createPublisher,
    createViewer: createViewer,
  };
})(typeof window !== 'undefined' ? window : globalThis);
