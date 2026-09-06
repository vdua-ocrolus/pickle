/* Named restore points. Each snapshot is a deep copy of the whole app state —
   both tournaments — so restoring one puts everything back exactly as it was.
   Kept under its own storage key so clearing the tournaments never touches them. */
(function (root, factory) {
  const api = factory(root.Model || (typeof require !== 'undefined' ? require('./model.js') : null));
  root.Snapshots = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function (Model) {
  'use strict';

  const KEY = 'pickleball-snapshots-v1';
  const MAX_SNAPSHOTS = 20;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /* `backend` is anything with getItem/setItem/removeItem — localStorage in the
     browser, a plain object stand-in under test. */
  function createStore(backend) {
    function readAll() {
      try {
        const raw = backend.getItem(KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        console.warn('Could not read saved snapshots:', err);
        return [];
      }
    }

    function writeAll(list) {
      try {
        backend.setItem(KEY, JSON.stringify(list));
        return { ok: true };
      } catch (err) {
        // Almost always a full localStorage quota.
        return { ok: false, error: 'No room left to save. Delete an older save first.' };
      }
    }

    return {
      /* Newest first. Two saves made in the same millisecond tie on savedAt, so
         insertion order breaks the tie — the stored list is append-ordered. */
      list: function () {
        return readAll()
          .map(function (snap, index) { return { snap: snap, index: index }; })
          .sort(function (a, b) {
            return (b.snap.savedAt - a.snap.savedAt) || (b.index - a.index);
          })
          .map(function (entry) { return entry.snap; });
      },

      get: function (id) {
        return readAll().find(function (s) { return s.id === id; }) || null;
      },

      add: function (name, state, summary) {
        const trimmed = String(name || '').trim();
        if (!trimmed) return { ok: false, error: 'Give the save a name.' };

        const list = readAll();
        if (list.length >= MAX_SNAPSHOTS) {
          return {
            ok: false,
            error: 'You have ' + MAX_SNAPSHOTS + ' saves already. Delete one to make room.',
          };
        }
        const snapshot = {
          id: Model.uid('snap'),
          name: trimmed.slice(0, 60),
          savedAt: Date.now(),
          summary: summary || '',
          state: clone(state),
        };
        list.push(snapshot);

        const written = writeAll(list);
        if (!written.ok) return written;
        return { ok: true, snapshot: snapshot };
      },

      remove: function (id) {
        const list = readAll().filter(function (s) { return s.id !== id; });
        return writeAll(list);
      },

      clear: function () {
        try {
          backend.removeItem(KEY);
          return { ok: true };
        } catch (err) {
          return { ok: false, error: 'Could not clear saves.' };
        }
      },

      /* Deep copy on the way out too, so editing the restored state can never
         write back into the stored snapshot. */
      restore: function (id) {
        const snapshot = this.get(id);
        return snapshot ? clone(snapshot.state) : null;
      },
    };
  }

  const api = {
    STORAGE_KEY: KEY,
    MAX_SNAPSHOTS: MAX_SNAPSHOTS,
    createStore: createStore,
    clone: clone,
  };

  if (typeof window !== 'undefined' && window.localStorage) {
    api.store = createStore(window.localStorage);
  }
  return api;
});
