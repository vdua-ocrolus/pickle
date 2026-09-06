/* Live-sharing configuration.
 *
 * Leave DATABASE_URL empty and the app behaves exactly as it always has:
 * everything local, no network, offline forever. Publishing simply does not
 * appear as an option. QR snapshot sharing works either way — it needs no
 * server at all.
 *
 * To turn live sharing on, create a Firebase Realtime Database and paste its
 * URL below. Setup instructions and the security rules to use are in
 * README.md under "Live sharing".
 */
window.AppConfig = {
  // Shown in the footer so it is possible to tell at a glance whether a phone
  // is running the current build or a stale cached one. Must match
  // CACHE_VERSION in sw.js — the test suite enforces that.
  APP_VERSION: 'v7',

  // e.g. 'https://your-project-default-rtdb.firebaseio.com'
  DATABASE_URL: '',

  // Where tournaments are stored inside that database.
  PATH: 'tournaments',

  // How long to wait after a score is typed before pushing, so a burst of
  // edits becomes one write rather than five.
  PUSH_DEBOUNCE_MS: 1200,

  // How often a viewer re-checks when the live stream is unavailable.
  POLL_INTERVAL_MS: 15000,
};
