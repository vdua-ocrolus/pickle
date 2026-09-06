/* Persistence behind a tiny adapter interface.
 *
 * Today everything lives in this device's localStorage. To move to a shared
 * backend later, write an adapter with the same three methods (load, save,
 * describe) that talks to your API and set `Storage.use(myAdapter)` before
 * `App.start()` — nothing else in the app touches storage directly.
 */
(function (root) {
  'use strict';

  const KEY = 'pickleball-tournaments-v1';
  const SHARE_KEY = 'pickleball-share-id-v1';

  const localAdapter = {
    name: 'local',
    describe: function () { return 'Saved on this device'; },
    load: function () {
      try {
        const raw = root.localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        console.warn('Could not read saved tournaments:', err);
        return null;
      }
    },
    save: function (state) {
      try {
        root.localStorage.setItem(KEY, JSON.stringify(state));
        return true;
      } catch (err) {
        console.warn('Could not save tournaments:', err);
        return false;
      }
    },
    clear: function () {
      try {
        root.localStorage.removeItem(KEY);
      } catch (err) {
        console.warn('Could not clear tournaments:', err);
      }
    },
  };

  let adapter = localAdapter;

  root.Storage = {
    use: function (custom) { adapter = custom; },
    current: function () { return adapter; },
    load: function () { return adapter.load(); },
    save: function (state) { return adapter.save(state); },
    clear: function () { return adapter.clear && adapter.clear(); },
    describe: function () { return adapter.describe(); },

    /* The published id lives outside the tournament data so restoring an old
       save cannot silently repoint an already-shared link. */
    loadShareId: function () {
      try { return root.localStorage.getItem(SHARE_KEY) || null; } catch (err) { return null; }
    },
    saveShareId: function (id) {
      try {
        if (id) root.localStorage.setItem(SHARE_KEY, id);
        else root.localStorage.removeItem(SHARE_KEY);
      } catch (err) { /* storage unavailable; publishing just will not resume */ }
    },

    STORAGE_KEY: KEY,
    SHARE_KEY: SHARE_KEY,
  };
})(typeof window !== 'undefined' ? window : globalThis);
