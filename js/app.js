/* UI layer: tabs, roster setup, schedule, standings and finals. */
(function (window, document) {
  'use strict';

  const VIEWS = [
    { id: 'setup', label: 'Setup' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'standings', label: 'Standings' },
    { id: 'finals', label: 'Finals' },
    { id: 'data', label: 'Data' },
  ];

  let state = null;
  const activeView = {}; // tournamentId -> view id, kept in memory only
  let publisher = null;  // pushes the active tournament to the database
  let viewer = null;     // live subscription, viewer mode only

  /* ---------------------------------------------------------------- helpers */

  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (key) {
      const value = props[key];
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, '');
      else if (value !== false && value !== null && value !== undefined) node.setAttribute(key, value);
    });
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  let toastTimer = null;
  function toast(message, kind) {
    const node = document.getElementById('toast');
    node.textContent = message;
    node.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.className = 'toast'; }, 3200);
  }

  function activeTournament() {
    return state.tournaments.find(function (t) { return t.id === state.activeTournamentId; }) ||
      state.tournaments[0];
  }

  function playersById(tournament) {
    const map = {};
    tournament.players.forEach(function (p) { map[p.id] = p; });
    return map;
  }

  function nameOf(tournament, id) {
    const player = playersById(tournament)[id];
    return player ? player.name : '—';
  }

  function save() {
    window.Storage.save(state);
    // Publishing is fire-and-forget: it queues and never blocks score entry.
    if (publisher && publisher.isPublishing()) publisher.publish(activeTournament());
  }

  function currentView(tournament) {
    return activeView[tournament.id] || 'setup';
  }

  /* -------------------------------------------------------------- rendering */

  function render() {
    const tournament = activeTournament();
    renderTabs();
    renderViewNav(tournament);
    document.getElementById('tagline').textContent =
      'Games to ' + tournament.settings.targetScore + ', win by ' + tournament.settings.winBy;

    const host = document.getElementById('view');
    host.innerHTML = '';
    const view = currentView(tournament);
    if (view === 'setup') host.appendChild(renderSetup(tournament));
    else if (view === 'schedule') host.appendChild(renderSchedule(tournament));
    else if (view === 'standings') host.appendChild(renderStandings(tournament));
    else if (view === 'data') host.appendChild(renderData());
    else host.appendChild(renderFinals(tournament));
  }

  function renderTabs() {
    const host = document.getElementById('tournamentTabs');
    host.innerHTML = '';
    state.tournaments.forEach(function (t) {
      const isActive = t.id === state.activeTournamentId;
      host.appendChild(el('button', {
        type: 'button',
        class: 'tab' + (isActive ? ' active' : ''),
        'aria-current': isActive ? 'page' : false,
        onclick: function () {
          state.activeTournamentId = t.id;
          save();
          render();
        },
      }, [
        el('span', { class: 'tab-name', text: t.name }),
        el('span', { class: 'tab-meta', text: tournamentSummary(t) }),
      ]));
    });
  }

  function tournamentSummary(t) {
    if (!t.schedule) return t.players.length + ' players · not started';
    const progress = window.Standings.roundRobinProgress(t);
    if (window.Finals.isComplete(t.finals)) return 'Complete';
    if (t.finals) return 'Finals in progress';
    return progress.done + '/' + progress.total + ' games played';
  }

  function renderViewNav(tournament) {
    const host = document.getElementById('viewNav');
    host.innerHTML = '';
    const view = currentView(tournament);
    VIEWS.forEach(function (v) {
      host.appendChild(el('button', {
        type: 'button',
        class: 'view-tab' + (v.id === view ? ' active' : ''),
        onclick: function () {
          activeView[tournament.id] = v.id;
          render();
        },
      }, [v.label]));
    });
  }

  /* ------------------------------------------------------------ setup view */

  function renderSetup(t) {
    const wrap = el('div', { class: 'stack' });

    /* Tournament name */
    wrap.appendChild(section('Tournament', [
      field('Name', el('input', {
        type: 'text',
        value: t.name,
        maxlength: '40',
        onchange: function (e) {
          t.name = e.target.value.trim() || 'Untitled';
          save();
          render();
        },
      })),
    ]));

    /* Roster */
    const list = el('ol', { class: 'roster' });
    t.players.forEach(function (player, index) {
      list.appendChild(el('li', { class: 'roster-item' }, [
        el('span', { class: 'roster-num', text: String(index + 1) }),
        el('input', {
          type: 'text',
          class: 'roster-name',
          value: player.name,
          onchange: function (e) {
            player.name = e.target.value.trim();
            save();
            render();
          },
        }),
        el('button', {
          type: 'button',
          class: 'icon-btn',
          title: 'Remove ' + player.name,
          onclick: function () { removePlayer(t, player.id); },
        }, ['✕']),
      ]));
    });

    const addInput = el('input', {
      type: 'text',
      placeholder: 'Player name',
      onkeydown: function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          addPlayers(t, [e.target.value]);
          e.target.value = '';
          setTimeout(function () {
            const again = document.querySelector('#addPlayerRow input');
            if (again) again.focus();
          }, 0);
        }
      },
    });

    const bulk = el('textarea', {
      rows: '4',
      placeholder: 'Or paste a list — one name per line, or comma separated',
    });

    const rosterError = window.Model.rosterError(t.players);
    wrap.appendChild(section('Players (' + t.players.length + ' of ' +
      window.Model.MIN_PLAYERS + '–' + window.Model.MAX_PLAYERS + ')', [
      t.players.length ? list : el('p', { class: 'muted', text: 'No players yet.' }),
      el('div', { class: 'row', id: 'addPlayerRow' }, [
        addInput,
        el('button', {
          type: 'button',
          class: 'btn',
          onclick: function () {
            addPlayers(t, [addInput.value]);
            addInput.value = '';
            addInput.focus();
          },
        }, ['Add']),
      ]),
      bulk,
      el('div', { class: 'row' }, [
        el('button', {
          type: 'button',
          class: 'btn',
          onclick: function () {
            addPlayers(t, bulk.value.split(/[\n,]/));
            bulk.value = '';
          },
        }, ['Add pasted names']),
        t.players.length ? el('button', {
          type: 'button',
          class: 'btn subtle',
          onclick: function () {
            if (confirm('Remove all players from ' + t.name + '?')) {
              if (!confirmDestroy(t)) return;
              t.players = [];
              resetPlay(t);
              save();
              render();
            }
          },
        }, ['Clear roster']) : null,
      ]),
      rosterError ? el('p', { class: 'notice warn', text: rosterError }) : null,
    ]));

    /* Format settings */
    const maxGames = window.Model.gamesPerRound(t.players.length, t.settings.courts);
    wrap.appendChild(section('Format', [
      el('div', { class: 'grid' }, [
        field('Courts', numberInput(t.settings.courts, 1, 6, function (value) {
          updateSetting(t, 'courts', value);
        })),
        field('Round-robin rounds', numberInput(t.settings.rounds, 1, 15, function (value) {
          updateSetting(t, 'rounds', value);
        })),
        field('Play to', numberInput(t.settings.targetScore, 1, 21, function (value) {
          updateSetting(t, 'targetScore', value);
        })),
        field('Win by', numberInput(t.settings.winBy, 1, 2, function (value) {
          updateSetting(t, 'winBy', value);
        })),
      ]),
      el('p', { class: 'muted', text: formatSummary(t, maxGames) }),
    ]));

    /* Generate */
    const canGenerate = !rosterError && maxGames >= 1;
    wrap.appendChild(section('Start play', [
      el('p', { class: 'muted' }, [
        'Partners are drawn at random each round and every player carries their own ' +
        'record. After the round robin the top four go to a finals round robin — three ' +
        'games covering every partner combination — and the best two records win.',
      ]),
      el('div', { class: 'row' }, [
        el('button', {
          type: 'button',
          class: 'btn primary',
          disabled: !canGenerate,
          onclick: function () { generate(t); },
        }, [t.schedule ? 'Regenerate schedule' : 'Generate schedule']),
        t.schedule ? el('button', {
          type: 'button',
          class: 'btn subtle',
          onclick: function () {
            if (confirm('Clear the schedule, all scores and the finals for ' + t.name + '?')) {
              resetPlay(t);
              save();
              render();
            }
          },
        }, ['Reset tournament']) : null,
      ]),
      t.schedule ? el('p', { class: 'notice warn' }, [
        'Regenerating draws new pairings and erases every score already entered.',
      ]) : null,
    ]));

    return wrap;
  }

  function formatSummary(t, maxGames) {
    if (t.players.length < window.Model.MIN_PLAYERS) {
      return 'Add players to see how the rounds will look.';
    }
    if (maxGames < 1) return 'Not enough players for a game.';
    const seats = maxGames * 4;
    const sitting = t.players.length - seats;
    const perPlayer = (seats * t.settings.rounds) / t.players.length;
    return maxGames + ' game' + (maxGames === 1 ? '' : 's') + ' per round × ' +
      t.settings.rounds + ' rounds = ' + (maxGames * t.settings.rounds) + ' games. ' +
      (sitting > 0 ? sitting + ' player' + (sitting === 1 ? '' : 's') + ' sit out each round; ' : '') +
      'about ' + perPlayer.toFixed(1) + ' games each.';
  }

  function numberInput(value, min, max, onCommit) {
    return el('input', {
      type: 'number',
      inputmode: 'numeric',
      value: String(value),
      min: String(min),
      max: String(max),
      onchange: function (e) {
        const parsed = parseInt(e.target.value, 10);
        if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
          toast('Enter a number between ' + min + ' and ' + max + '.', 'error');
          e.target.value = String(value);
          return;
        }
        onCommit(parsed);
      },
    });
  }

  function field(label, control) {
    return el('label', { class: 'field' }, [el('span', { class: 'field-label', text: label }), control]);
  }

  function section(title, children) {
    return el('section', { class: 'card' }, [el('h2', { text: title })].concat(children));
  }

  /* --------------------------------------------------------- setup actions */

  function confirmDestroy(t) {
    if (!t.schedule) return true;
    return confirm('This clears the existing schedule and every score in ' + t.name + '. Continue?');
  }

  function resetPlay(t) {
    t.schedule = null;
    t.finals = null;
    t.phase = 'setup';
  }

  function addPlayers(t, rawNames) {
    const names = rawNames
      .map(function (n) { return String(n).trim(); })
      .filter(function (n) { return n.length > 0; });
    if (!names.length) return;
    if (!confirmDestroy(t)) return;

    const existing = new Set(t.players.map(function (p) { return p.name.toLowerCase(); }));
    let added = 0;
    let skipped = 0;
    names.forEach(function (name) {
      if (t.players.length >= window.Model.MAX_PLAYERS) { skipped += 1; return; }
      if (existing.has(name.toLowerCase())) { skipped += 1; return; }
      existing.add(name.toLowerCase());
      t.players.push(window.Model.createPlayer(name));
      added += 1;
    });
    if (added && t.schedule) resetPlay(t);
    save();
    render();
    if (skipped) {
      toast(skipped + ' name' + (skipped === 1 ? '' : 's') + ' skipped (duplicate or roster full).', 'warn');
    }
  }

  function removePlayer(t, playerId) {
    if (!confirmDestroy(t)) return;
    t.players = t.players.filter(function (p) { return p.id !== playerId; });
    if (t.schedule) resetPlay(t);
    save();
    render();
  }

  function updateSetting(t, key, value) {
    if (t.schedule && (key === 'courts' || key === 'rounds')) {
      if (!confirmDestroy(t)) { render(); return; }
      resetPlay(t);
    }
    t.settings[key] = value;
    save();
    render();
  }

  function generate(t) {
    const error = window.Model.rosterError(t.players);
    if (error) { toast(error, 'error'); return; }
    if (t.schedule && !confirm('Draw a new schedule? Every score entered so far is erased.')) return;
    try {
      t.schedule = window.Scheduler.generateSchedule(t.players, t.settings);
      t.finals = null;
      t.phase = 'roundRobin';
      save();
      activeView[t.id] = 'schedule';
      render();
      toast('Schedule ready.', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /* --------------------------------------------------------- schedule view */

  function renderSchedule(t) {
    if (!t.schedule) return emptyState('No schedule yet.', 'Build your roster on the Setup tab, then generate a schedule.', t, 'setup');

    const wrap = el('div', { class: 'stack' });
    const progress = window.Standings.roundRobinProgress(t);

    wrap.appendChild(el('section', { class: 'card' }, [
      el('div', { class: 'row spread' }, [
        el('h2', { text: 'Round robin' }),
        el('span', { class: 'pill', id: 'progressPill', text: progress.done + ' of ' + progress.total + ' games' }),
      ]),
      el('div', { class: 'progress' }, [
        el('div', {
          class: 'progress-fill',
          id: 'progressFill',
          style: 'width:' + (progress.total ? (progress.done / progress.total) * 100 : 0) + '%',
        }),
      ]),
      el('p', { class: 'muted', text: 'Enter the final score for each game. Games are to ' +
        t.settings.targetScore + ', win by ' + t.settings.winBy + '.' }),
      el('div', { class: 'row' }, [
        el('button', {
          type: 'button',
          class: 'btn subtle',
          onclick: function () {
            if (!confirm('Clear every score in ' + t.name + '? The pairings stay as they are.')) return;
            t.schedule.forEach(function (round) {
              round.games.forEach(function (g) { g.scoreA = null; g.scoreB = null; });
            });
            t.finals = null;
            save();
            render();
          },
        }, ['Clear all scores']),
      ]),
    ]));

    t.schedule.forEach(function (round) {
      wrap.appendChild(renderRoundCard(t, round));
    });
    return wrap;
  }

  function renderRoundCard(t, round) {
    const done = round.games.filter(window.Model.isGameComplete).length;
    return el('section', { class: 'card round' }, [
      el('div', { class: 'row spread' }, [
        el('h2', { text: 'Round ' + round.round }),
        el('span', { class: 'pill' + (done === round.games.length ? ' done' : ''),
          text: done + '/' + round.games.length }),
      ]),
      el('div', { class: 'games' }, round.games.map(function (game) {
        return renderGameCard(t, game, 'Court ' + game.court);
      })),
      round.byes.length ? el('p', { class: 'byes' }, [
        el('strong', { text: 'Sitting out: ' }),
        round.byes.map(function (id) { return nameOf(t, id); }).join(', '),
      ]) : null,
    ]);
  }

  function renderGameCard(t, game, label, context) {
    const card = el('div', {
      class: 'game' + (window.Model.isGameComplete(game) ? ' complete' : ''),
      'data-game': game.id,
    });
    const errorNode = el('p', { class: 'game-error' });

    function teamSide(ids, side) {
      const isWinner = window.Model.isGameComplete(game) &&
        (side === 'A' ? game.scoreA > game.scoreB : game.scoreB > game.scoreA);
      return el('div', { class: 'team' + (isWinner ? ' winner' : '') }, [
        el('span', { class: 'team-names', text: ids.map(function (id) { return nameOf(t, id); }).join(' & ') }),
        scoreInput(t, game, side, errorNode, card, context),
      ]);
    }

    card.appendChild(el('span', { class: 'game-label', text: label }));
    card.appendChild(el('div', { class: 'teams' }, [
      teamSide(game.teamA, 'A'),
      el('span', { class: 'vs', text: 'vs' }),
      teamSide(game.teamB, 'B'),
    ]));
    card.appendChild(errorNode);
    return card;
  }

  function scoreInput(t, game, side, errorNode, card, context) {
    const key = side === 'A' ? 'scoreA' : 'scoreB';
    return el('input', {
      type: 'number',
      class: 'score',
      inputmode: 'numeric',
      min: '0',
      'aria-label': 'Score for team ' + side,
      value: game[key] === null || game[key] === undefined ? '' : String(game[key]),
      onfocus: function (e) { e.target.select(); },
      onchange: function (e) { commitScore(t, game, side, e.target, errorNode, card, context); },
    });
  }

  function commitScore(t, game, side, input, errorNode, card, context) {
    const key = side === 'A' ? 'scoreA' : 'scoreB';
    const raw = input.value.trim();

    if (raw === '') {
      game[key] = null;
      finishScoreEdit(t, game, card, errorNode, null, context);
      return;
    }
    const parsed = parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      finishScoreEdit(t, game, card, errorNode, 'Scores must be whole numbers of 0 or more.', context);
      return;
    }
    game[key] = parsed;

    const other = side === 'A' ? game.scoreB : game.scoreA;
    if (other === null || other === undefined) {
      // Half-entered scores are fine; nothing counts until both are in.
      finishScoreEdit(t, game, card, errorNode, null, context);
      return;
    }
    finishScoreEdit(t, game, card, errorNode, window.Model.validateScore(
      game.scoreA, game.scoreB, t.settings.targetScore, t.settings.winBy), context);
  }

  /* Saves and refreshes just this card, so entering scores never steals focus
     from the field the user tabbed into. */
  function finishScoreEdit(t, game, card, errorNode, problem, context) {
    errorNode.textContent = problem || '';
    card.classList.toggle('invalid', !!problem);
    if (problem) return;

    save();
    const complete = window.Model.isGameComplete(game);
    card.classList.toggle('complete', complete);
    const teams = card.querySelectorAll('.team');
    if (teams.length === 2) {
      teams[0].classList.toggle('winner', complete && game.scoreA > game.scoreB);
      teams[1].classList.toggle('winner', complete && game.scoreB > game.scoreA);
    }
    if (context === 'finals') refreshFinals(t);
    else refreshProgress(t);
  }

  /* Keeps the finals table live without a full re-render, except on the one
     transition that adds or removes the champions banner. */
  function refreshFinals(t) {
    renderTabs();
    const nowComplete = window.Finals.isComplete(t.finals);
    const bannerShown = !!document.querySelector('.champions');
    if (nowComplete !== bannerShown) { render(); return; }

    const body = document.getElementById('finalsTableBody');
    if (!body) return;
    const fresh = buildFinalsTableBody(t, nowComplete);
    body.parentNode.replaceChild(fresh, body);
  }

  function refreshProgress(t) {
    const progress = window.Standings.roundRobinProgress(t);
    const pill = document.getElementById('progressPill');
    const fill = document.getElementById('progressFill');
    if (pill) pill.textContent = progress.done + ' of ' + progress.total + ' games';
    if (fill) fill.style.width = (progress.total ? (progress.done / progress.total) * 100 : 0) + '%';

    // Per-round counters and the tournament tab summary.
    document.querySelectorAll('.round').forEach(function (node, index) {
      const round = t.schedule && t.schedule[index];
      if (!round) return;
      const pillNode = node.querySelector('.pill');
      const done = round.games.filter(window.Model.isGameComplete).length;
      if (pillNode) {
        pillNode.textContent = done + '/' + round.games.length;
        pillNode.classList.toggle('done', done === round.games.length);
      }
    });
    renderTabs();
  }

  /* -------------------------------------------------------- standings view */

  function renderStandings(t) {
    if (!t.schedule) return emptyState('No standings yet.', 'Generate a schedule to start tracking results.', t, 'setup');

    const rows = window.Standings.compute(t);
    const progress = window.Standings.roundRobinProgress(t);
    const table = el('table', { class: 'table standings' }, [
      el('thead', {}, [el('tr', {}, [
        th('#'), th('Player'), th('GP'), th('W'), th('L'), th('Win %'),
        th('PF'), th('PA'), th('Diff'), th('Byes'),
      ])]),
      el('tbody', {}, rows.map(function (row, index) {
        const classes = ['standings-row'];
        if (index < 4) classes.push('qualifier');
        if (index === 3) classes.push('cut');
        return el('tr', { class: classes.join(' ') }, [
          td(String(row.rank) + (row.tied ? '=' : '')),
          el('td', { class: 'player-cell' }, [
            row.name,
            index < 4 ? el('span', { class: 'badge', text: 'finals' }) : null,
          ]),
          td(String(row.gp)),
          td(String(row.w)),
          td(String(row.l)),
          td(row.gp ? (row.winPct * 100).toFixed(0) + '%' : '—'),
          td(String(row.pf)),
          td(String(row.pa)),
          td((row.diff > 0 ? '+' : '') + row.diff),
          td(String(row.byes)),
        ]);
      })),
    ]);

    return el('div', { class: 'stack' }, [
      el('section', { class: 'card' }, [
        el('div', { class: 'row spread' }, [
          el('h2', { text: 'Standings' }),
          el('span', { class: 'pill', text: progress.done + ' of ' + progress.total + ' games' }),
        ]),
        el('p', { class: 'muted', text: 'Ranked by win percentage, then point differential, ' +
          'then points scored. The top four advance to the finals.' }),
        el('div', { class: 'table-wrap' }, [table]),
        window.Standings.tieAtCutLine(rows) ? el('p', { class: 'notice warn' }, [
          'Players 4 and 5 are dead even. Settle it on court, or pick the fourth ' +
          'finalist by hand on the Finals tab.',
        ]) : null,
      ]),
    ]);
  }

  function th(text) { return el('th', { text: text }); }
  function td(text) { return el('td', { text: text }); }

  /* ----------------------------------------------------------- finals view */

  function renderFinals(t) {
    if (!t.schedule) return emptyState('No finals yet.', 'Generate a schedule and play the round robin first.', t, 'setup');

    const wrap = el('div', { class: 'stack' });
    const progress = window.Standings.roundRobinProgress(t);
    const byId = playersById(t);

    if (!t.finals) {
      wrap.appendChild(renderFinalistPicker(t, progress));
      return wrap;
    }

    const results = window.Finals.compute(t.finals, byId);
    const complete = window.Finals.isComplete(t.finals);

    if (complete) {
      const winners = results.slice(0, 2);
      wrap.appendChild(el('section', { class: 'card champions' }, [
        el('h2', { text: '🏆 Champions' }),
        el('div', { class: 'champion-names' }, [
          el('span', { text: winners[0].name }),
          el('span', { class: 'amp', text: '&' }),
          el('span', { text: winners[1].name }),
        ]),
        el('p', { class: 'muted', text: 'Top two records in the finals round robin.' }),
      ]));
    }

    wrap.appendChild(el('section', { class: 'card' }, [
      el('div', { class: 'row spread' }, [
        el('h2', { text: 'Finals' }),
        el('span', { class: 'pill', text: 'Top 4 · 3 games' }),
      ]),
      el('p', { class: 'muted', text: 'Every finalist partners each other finalist exactly ' +
        'once. Games to ' + t.settings.targetScore + ', win by ' + t.settings.winBy + '.' }),
      el('div', { class: 'games' }, t.finals.games.map(function (game) {
        return renderGameCard(t, game, 'Game ' + game.round, 'finals');
      })),
      el('div', { class: 'row' }, [
        el('button', {
          type: 'button',
          class: 'btn subtle',
          onclick: function () {
            if (!confirm('Reset the finals for ' + t.name + '? Round-robin results are kept.')) return;
            t.finals = null;
            t.phase = 'roundRobin';
            save();
            render();
          },
        }, ['Reset finals']),
      ]),
    ]));

    wrap.appendChild(el('section', { class: 'card' }, [
      el('h2', { text: 'Finals standings' }),
      el('div', { class: 'table-wrap' }, [
        el('table', { class: 'table finals-table' }, [
          el('thead', {}, [el('tr', {}, [
            th('#'), th('Player'), th('Seed'), th('W'), th('L'), th('PF'), th('PA'), th('Diff'),
          ])]),
          buildFinalsTableBody(t, complete),
        ]),
      ]),
    ]));

    return wrap;
  }

  function buildFinalsTableBody(t, complete) {
    const results = window.Finals.compute(t.finals, playersById(t));
    return el('tbody', { id: 'finalsTableBody' }, results.map(function (row) {
      return el('tr', { class: complete && row.place <= 2 ? 'qualifier' : '' }, [
        td(String(row.place)),
        el('td', { class: 'player-cell' }, [
          row.name,
          complete && row.place <= 2 ? el('span', { class: 'badge gold', text: 'winner' }) : null,
        ]),
        td('#' + row.seed),
        td(String(row.w)),
        td(String(row.l)),
        td(String(row.pf)),
        td(String(row.pa)),
        td((row.diff > 0 ? '+' : '') + row.diff),
      ]);
    }));
  }

  function renderFinalistPicker(t, progress) {
    const standings = window.Standings.compute(t);
    const seeded = standings.slice(0, 4).map(function (row) { return row.playerId; });
    const selects = [];

    const options = t.players.map(function (p) { return { id: p.id, name: p.name }; });

    function selectFor(index) {
      const select = el('select', {
        onchange: function () { /* value read on submit */ },
      }, options.map(function (opt) {
        return el('option', {
          value: opt.id,
          selected: opt.id === seeded[index],
        }, [opt.name]);
      }));
      selects.push(select);
      return field('Seed ' + (index + 1), select);
    }

    return el('section', { class: 'card' }, [
      el('h2', { text: 'Set the finalists' }),
      progress.complete
        ? el('p', { class: 'muted', text: 'Round robin complete. The top four from the ' +
            'standings are pre-selected — adjust them if you settled a tie on court.' })
        : el('p', { class: 'notice warn', text: (progress.total - progress.done) +
            ' round-robin game(s) still have no score. You can start the finals anyway, ' +
            'but the seeding below is based on what has been entered so far.' }),
      el('div', { class: 'grid' }, [selectFor(0), selectFor(1), selectFor(2), selectFor(3)]),
      el('div', { class: 'row' }, [
        el('button', {
          type: 'button',
          class: 'btn primary',
          onclick: function () {
            const seeds = selects.map(function (s) { return s.value; });
            try {
              t.finals = window.Finals.start(seeds);
              t.phase = 'finals';
              save();
              render();
              toast('Finals set.', 'ok');
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        }, ['Start finals']),
      ]),
    ]);
  }

  /* ------------------------------------------------------------- data view */

  function snapshotStore() {
    return window.Snapshots && window.Snapshots.store;
  }

  /* One line describing what a save contains, shown in the list. */
  function stateSummary(snapshotState) {
    return snapshotState.tournaments.map(function (t) {
      return t.name + ' (' + tournamentSummary(t) + ')';
    }).join(' · ');
  }

  function formatWhen(ts) {
    const date = new Date(ts);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ', ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function defaultSaveName() {
    const now = new Date();
    return now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' + now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function renderData() {
    const store = snapshotStore();
    const wrap = el('div', { class: 'stack' });

    if (!store) {
      wrap.appendChild(section('Saves unavailable', [
        el('p', { class: 'notice warn', text: 'This browser is blocking local storage, so ' +
          'saves cannot be kept. Use Export below to keep a copy as a file instead.' }),
      ]));
    }

    /* --- Save --- */
    const nameInput = el('input', {
      type: 'text',
      value: defaultSaveName(),
      maxlength: '60',
      placeholder: 'Name this save',
      onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); doSave(); } },
    });

    function doSave() {
      if (!store) { toast('Local storage is unavailable in this browser.', 'error'); return; }
      const result = store.add(nameInput.value, state, stateSummary(state));
      if (!result.ok) { toast(result.error, 'error'); return; }
      toast('Saved “' + result.snapshot.name + '”.', 'ok');
      render();
    }

    wrap.appendChild(section('Save', [
      el('p', { class: 'muted', text: 'Takes a snapshot of both tournaments as they are ' +
        'right now — rosters, settings, every score and the finals. Restore it later to ' +
        'put everything back. Play around freely in between.' }),
      el('div', { class: 'row' }, [
        el('div', { class: 'grow' }, [nameInput]),
        el('button', { type: 'button', class: 'btn primary', onclick: doSave }, ['Save']),
      ]),
    ]));

    /* --- Restore --- */
    const saves = store ? store.list() : [];
    wrap.appendChild(section('Saved states' + (saves.length ? ' (' + saves.length + ')' : ''), [
      saves.length
        ? el('ul', { class: 'snapshot-list' }, saves.map(function (snap) {
            return el('li', { class: 'snapshot' }, [
              el('div', { class: 'snapshot-text' }, [
                el('span', { class: 'snapshot-name', text: snap.name }),
                el('span', { class: 'snapshot-meta', text: formatWhen(snap.savedAt) }),
                el('span', { class: 'snapshot-meta', text: snap.summary || '' }),
              ]),
              el('div', { class: 'row' }, [
                el('button', {
                  type: 'button',
                  class: 'btn',
                  onclick: function () { doRestore(snap); },
                }, ['Restore']),
                el('button', {
                  type: 'button',
                  class: 'icon-btn',
                  title: 'Delete this save',
                  onclick: function () {
                    if (!confirm('Delete the save “' + snap.name + '”?')) return;
                    store.remove(snap.id);
                    render();
                    toast('Save deleted.', 'ok');
                  },
                }, ['✕']),
              ]),
            ]);
          }))
        : el('p', { class: 'muted', text: 'No saves yet.' }),
    ]));

    /* --- File backup --- */
    const fileInput = el('input', {
      type: 'file',
      accept: 'application/json,.json',
      class: 'file-input',
      onchange: function (e) {
        const file = e.target.files && e.target.files[0];
        if (file) importFile(file);
        e.target.value = '';
      },
    });

    wrap.appendChild(section('Backup file', [
      el('p', { class: 'muted', text: 'Saves above live in this browser only. Export a file ' +
        'to move a tournament to another device, or to keep a copy that survives clearing ' +
        'your browser data.' }),
      el('div', { class: 'row' }, [
        el('button', { type: 'button', class: 'btn', onclick: exportJson }, ['Export to file']),
        el('button', {
          type: 'button',
          class: 'btn',
          onclick: function () { fileInput.click(); },
        }, ['Import from file']),
        fileInput,
      ]),
    ]));

    /* --- Share --- */
    wrap.appendChild(renderShareSection());

    /* --- Testing --- */
    const active = activeTournament();
    const pending = window.Demo.countFillable(active);
    const total = window.Demo.countFillable(active, { overwrite: true });

    wrap.appendChild(section('Testing', [
      el('p', { class: 'muted', text: 'Plays out ' + active.name + ' with random results ' +
        'so you can see standings, ties and the finals without typing scores. Every score ' +
        'it writes obeys the same rules as one you type.' }),
      !active.schedule
        ? el('p', { class: 'notice warn', text: 'Generate a schedule on the Setup tab first.' })
        : el('div', { class: 'row' }, [
            el('button', {
              type: 'button',
              class: 'btn',
              disabled: pending === 0,
              onclick: function () { doFill(active, false); },
            }, [pending ? 'Fill ' + pending + ' empty game' + (pending === 1 ? '' : 's') : 'Nothing left to fill']),
            el('button', {
              type: 'button',
              class: 'btn subtle',
              disabled: total === 0,
              onclick: function () { doFill(active, true); },
            }, ['Re-roll all ' + total]),
          ]),
    ]));

    /* --- Kill --- */
    wrap.appendChild(section('Kill', [
      el('p', { class: 'muted', text: 'Wipes both tournaments back to empty — rosters, ' +
        'schedules, scores, finals. Your saved states above are kept, so this is ' +
        'recoverable as long as you saved first.' }),
      el('div', { class: 'row' }, [
        el('button', { type: 'button', class: 'btn danger', onclick: doKill }, ['Kill everything']),
      ]),
    ]));

    return wrap;
  }

  function doRestore(snap) {
    const store = snapshotStore();
    if (!confirm('Restore “' + snap.name + '”? This replaces both tournaments as they are now.')) return;
    const restored = store.restore(snap.id);
    if (!restored) { toast('That save could not be read.', 'error'); return; }
    state = migrate(restored);
    save();
    render();
    toast('Restored “' + snap.name + '”.', 'ok');
  }

  function doFill(t, overwrite) {
    if (overwrite && !confirm('Replace every score in ' + t.name + ' with a random result?')) return;
    const result = window.Demo.fill(t, { overwrite: overwrite });
    if (!result.total) { toast('Nothing to fill.', 'warn'); return; }
    save();
    render();
    toast('Filled ' + result.total + ' game' + (result.total === 1 ? '' : 's') +
      (result.finals ? ' (including the finals)' : '') + '.', 'ok');
  }

  function doKill() {
    if (!confirm('Wipe both tournaments and start over? Saved states are kept.')) return;
    state = window.Model.defaultState();
    save();
    render();
    toast('Everything cleared.', 'ok');
  }

  function importFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (err) {
        toast('That file is not valid JSON.', 'error');
        return;
      }
      if (!parsed || !Array.isArray(parsed.tournaments) || parsed.tournaments.length < 2) {
        toast('That file does not look like a tournament export.', 'error');
        return;
      }
      if (!confirm('Load this file? It replaces both tournaments as they are now.')) return;
      state = migrate(parsed);
      save();
      render();
      toast('Loaded from file.', 'ok');
    };
    reader.onerror = function () { toast('Could not read that file.', 'error'); };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------ sharing UI */

  const SHARE_STATUS_LABELS = {
    synced: 'Everyone watching is up to date',
    pending: 'Sending…',
    offline: 'No connection — will send when you are back online',
    error: 'Could not reach the server — will keep trying',
    idle: '',
  };

  function showShareStatus(status) {
    const node = document.getElementById('shareStatus');
    if (!node) return;
    node.textContent = SHARE_STATUS_LABELS[status] || '';
    node.className = 'share-status ' + status;
  }

  /* Renders a QR into a container. Long snapshot payloads use the lowest error
     correction so the code stays coarse enough to scan off a phone screen. */
  function qrInto(container, text, dense) {
    container.innerHTML = '';
    try {
      const qr = window.qrcode(0, dense ? 'L' : 'M');
      qr.addData(text);
      qr.make();
      container.innerHTML = qr.createSvgTag({ cellSize: dense ? 3 : 5, margin: 8, scalable: true });
    } catch (err) {
      container.appendChild(el('p', { class: 'notice warn',
        text: 'Too much data for one QR code. Use the link instead.' }));
    }
  }

  function shareResult(url, heading, note, dense) {
    const qrBox = el('div', { class: 'qr' });
    qrInto(qrBox, url, dense);
    return el('div', { class: 'share-result' }, [
      el('h3', { text: heading }),
      el('p', { class: 'muted', text: note }),
      qrBox,
      el('input', { type: 'text', readonly: true, value: url, class: 'share-url',
        onfocus: function (e) { e.target.select(); } }),
      el('div', { class: 'row' }, [
        el('button', {
          type: 'button', class: 'btn',
          onclick: function () {
            if (navigator.clipboard) {
              navigator.clipboard.writeText(url)
                .then(function () { toast('Link copied.', 'ok'); })
                .catch(function () { toast('Select the link and copy it.', 'warn'); });
            } else {
              toast('Select the link and copy it.', 'warn');
            }
          },
        }, ['Copy link']),
        navigator.share ? el('button', {
          type: 'button', class: 'btn',
          onclick: function () { navigator.share({ title: 'Tournament standings', url: url }).catch(function () {}); },
        }, ['Share…']) : null,
      ]),
    ]);
  }

  function renderShareSection() {
    const t = activeTournament();
    const output = el('div', { id: 'shareOutput' });
    const children = [];

    children.push(el('p', { class: 'muted', text: 'Let players follow along on their own ' +
      'phones. They get a read-only board — they cannot change scores.' }));

    /* Snapshot: no server, no signal, works anywhere. */
    children.push(el('div', { class: 'share-option' }, [
      el('h3', { text: 'QR code — works with no internet' }),
      el('p', { class: 'muted', text: 'Puts the current standings inside the link itself. ' +
        'Hold up the code, they scan it, they see the table. Nothing is sent anywhere. ' +
        'It is a snapshot, so show a fresh code after each round.' }),
      el('div', { class: 'row' }, [
        el('button', {
          type: 'button', class: 'btn primary',
          disabled: !t.schedule,
          onclick: function () {
            const url = window.Share.snapshotUrl(window.location.href, t);
            output.innerHTML = '';
            output.appendChild(shareResult(url, 'Scan this',
              'Standings for ' + t.name + ' as of right now.', true));
          },
        }, [t.schedule ? 'Show standings QR' : 'Generate a schedule first']),
      ]),
    ]));

    /* Live: needs a database configured and a connection at both ends. */
    if (window.Sync.enabled()) {
      const on = publisher && publisher.isPublishing();
      children.push(el('div', { class: 'share-option' }, [
        el('h3', { text: 'Live link — updates as you score' }),
        el('p', { class: 'muted', text: 'Publishes this tournament so watchers see scores ' +
          'appear as you type them. Needs a connection on your phone and theirs. ' +
          'If yours drops, scoring carries on as normal and catches up later.' }),
        el('p', {
          class: 'share-status ' + (publisher ? publisher.status() : 'idle'),
          id: 'shareStatus',
          text: publisher ? (SHARE_STATUS_LABELS[publisher.status()] || '') : '',
        }),
        el('div', { class: 'row' }, [
          on ? el('button', {
            type: 'button', class: 'btn subtle',
            onclick: function () {
              if (!confirm('Stop publishing? The link stops working for anyone watching.')) return;
              publisher.remove();
              publisher.stop();
              if (window.Storage.saveShareId) window.Storage.saveShareId(null);
              render();
              toast('Publishing stopped.', 'ok');
            },
          }, ['Stop publishing']) : el('button', {
            type: 'button', class: 'btn primary',
            onclick: function () {
              const id = window.Share.newShareId();
              publisher.start(id);
              publisher.publish(t);
              if (window.Storage.saveShareId) window.Storage.saveShareId(id);
              render();
              toast('Published. Share the link.', 'ok');
            },
          }, ['Publish live']),
          on ? el('button', {
            type: 'button', class: 'btn',
            onclick: function () {
              const url = window.Share.liveUrl(window.location.href, publisher.shareId());
              output.innerHTML = '';
              output.appendChild(shareResult(url, 'Live board',
                'Anyone with this link sees scores as you enter them.', false));
            },
          }, ['Show link and QR']) : null,
        ]),
      ]));
    } else {
      children.push(el('div', { class: 'share-option' }, [
        el('h3', { text: 'Live link — not set up' }),
        el('p', { class: 'muted', text: 'Live sharing needs a database URL in js/config.js. ' +
          'Until then the QR code above covers spectators, and needs no internet at all.' }),
      ]));
    }

    children.push(output);
    return section('Share with players', children);
  }

  /* -------------------------------------------------------- viewer (shared) */

  function viewerChrome(title, subtitle) {
    document.getElementById('tournamentTabs').innerHTML = '';
    document.getElementById('viewNav').innerHTML = '';
    document.querySelector('.app-header').classList.add('viewer');
    document.getElementById('tagline').textContent = subtitle || '';
    document.querySelector('.app-title h1').textContent = title;
    const footerActions = document.querySelector('.footer-actions');
    if (footerActions) footerActions.innerHTML = '';
  }

  /* Standings table built from plain rows, so it serves both the live feed and
     a decoded snapshot without either needing a full tournament object. */
  function viewerStandingsTable(rows, marked) {
    return el('div', { class: 'table-wrap' }, [
      el('table', { class: 'table standings' }, [
        el('thead', {}, [el('tr', {}, [
          th('#'), th('Player'), th('GP'), th('W'), th('L'), th('Win %'),
          th('PF'), th('PA'), th('Diff'), th('Byes'),
        ])]),
        el('tbody', {}, rows.map(function (row, i) {
          const classes = [];
          if (marked && i < 4) classes.push('qualifier');
          if (marked && i === 3) classes.push('cut');
          return el('tr', { class: classes.join(' ') }, [
            td(String(row.rank || i + 1) + (row.tied ? '=' : '')),
            el('td', { class: 'player-cell' }, [
              row.name,
              marked && i < 4 ? el('span', { class: 'badge', text: 'finals' }) : null,
            ]),
            td(String(row.gp)),
            td(String(row.w)),
            td(String(row.l)),
            td(row.gp ? (row.winPct * 100).toFixed(0) + '%' : '—'),
            td(String(row.pf)),
            td(String(row.pa)),
            td((row.diff > 0 ? '+' : '') + row.diff),
            td(String(row.byes)),
          ]);
        })),
      ]),
    ]);
  }

  function championsCard(names) {
    return el('section', { class: 'card champions' }, [
      el('h2', { text: '🏆 Champions' }),
      el('div', { class: 'champion-names' }, [
        el('span', { text: names[0] }),
        el('span', { class: 'amp', text: '&' }),
        el('span', { text: names[1] }),
      ]),
    ]);
  }

  /* ------------------------------------------------------ snapshot viewer */

  function startSnapshotViewer(payload) {
    const snap = window.Share.decodeSnapshot(payload);
    const host = document.getElementById('view');

    if (!snap) {
      viewerChrome('Pickleball Tournament', '');
      host.appendChild(section('That link did not work', [
        el('p', { class: 'muted', text: 'The code may have been cut off while scanning. ' +
          'Ask whoever is running the tournament to show it again.' }),
      ]));
      return;
    }

    viewerChrome(snap.name, 'Standings · view only');
    const wrap = el('div', { class: 'stack' });
    if (snap.champions && snap.champions.length === 2) wrap.appendChild(championsCard(snap.champions));
    wrap.appendChild(el('section', { class: 'card' }, [
      el('div', { class: 'row spread' }, [
        el('h2', { text: 'Standings' }),
        el('span', { class: 'pill', text: snap.done + ' of ' + snap.total + ' games' }),
      ]),
      el('p', { class: 'muted', text: 'A snapshot, not a live feed — scan the code again ' +
        'for the latest. Top four go to the finals.' }),
      viewerStandingsTable(snap.rows, true),
    ]));
    host.appendChild(wrap);
    document.getElementById('storageNote').textContent = 'Snapshot · nothing saved';
  }

  /* ---------------------------------------------------------- live viewer */

  function startLiveViewer(shareId) {
    viewerChrome('Pickleball Tournament', 'Live · view only');
    const host = document.getElementById('view');
    host.appendChild(el('section', { class: 'card' }, [
      el('h2', { text: 'Connecting…' }),
      el('p', { class: 'muted', text: 'Fetching the live board.' }),
    ]));

    if (!window.Sync.enabled()) {
      host.innerHTML = '';
      host.appendChild(section('Live sharing is not set up', [
        el('p', { class: 'muted', text: 'This copy of the app has no database configured.' }),
      ]));
      return;
    }

    viewer = window.Sync.createViewer(shareId, function (data) {
      renderLive(data);
    }, function (status) {
      const node = document.getElementById('liveStatus');
      const labels = {
        live: 'Live', connecting: 'Connecting…',
        offline: 'Reconnecting…', missing: 'Not found',
      };
      if (node) node.textContent = labels[status] || '';
      if (status === 'missing') {
        host.innerHTML = '';
        host.appendChild(section('Nothing here', [
          el('p', { class: 'muted', text: 'This board has finished or the link is wrong. ' +
            'Ask for a new one.' }),
        ]));
      }
    });
  }

  function renderLive(data) {
    const host = document.getElementById('view');
    // The published shape matches a tournament closely enough to reuse the
    // standings and finals maths directly.
    const t = {
      name: data.name || 'Tournament',
      settings: data.settings || window.Model.DEFAULT_SETTINGS,
      players: data.players || [],
      schedule: data.schedule || null,
      finals: data.finals || null,
    };
    document.querySelector('.app-title h1').textContent = t.name;

    const rows = window.Standings.compute(t);
    const progress = window.Standings.roundRobinProgress(t);
    const byId = playersById(t);
    const champions = window.Finals.isComplete(t.finals)
      ? window.Finals.champions(t.finals, byId).map(function (c) { return c.name; })
      : null;

    const wrap = el('div', { class: 'stack' });
    if (champions) wrap.appendChild(championsCard(champions));

    wrap.appendChild(el('section', { class: 'card' }, [
      el('div', { class: 'row spread' }, [
        el('h2', { text: 'Standings' }),
        el('span', { class: 'pill', id: 'liveStatus', text: 'Live' }),
      ]),
      el('p', { class: 'muted', text: progress.done + ' of ' + progress.total +
        ' games played. Top four go to the finals.' }),
      viewerStandingsTable(rows, true),
    ]));

    /* The round in progress is what a spectator actually wants to see. */
    const current = (t.schedule || []).find(function (round) {
      return round.games.some(function (g) { return !window.Model.isGameComplete(g); });
    }) || (t.schedule || [])[(t.schedule || []).length - 1];

    if (current) {
      wrap.appendChild(el('section', { class: 'card' }, [
        el('h2', { text: 'Round ' + current.round }),
        el('div', { class: 'games' }, current.games.map(function (game) {
          const done = window.Model.isGameComplete(game);
          return el('div', { class: 'game' + (done ? ' complete' : '') }, [
            el('span', { class: 'game-label', text: 'Court ' + game.court }),
            el('div', { class: 'teams' }, [
              el('div', { class: 'team' + (done && game.scoreA > game.scoreB ? ' winner' : '') }, [
                el('span', { class: 'team-names', text: game.teamA.map(function (id) { return nameOf(t, id); }).join(' & ') }),
                el('span', { class: 'score-text', text: done ? String(game.scoreA) : '–' }),
              ]),
              el('span', { class: 'vs', text: 'vs' }),
              el('div', { class: 'team' + (done && game.scoreB > game.scoreA ? ' winner' : '') }, [
                el('span', { class: 'team-names', text: game.teamB.map(function (id) { return nameOf(t, id); }).join(' & ') }),
                el('span', { class: 'score-text', text: done ? String(game.scoreB) : '–' }),
              ]),
            ]),
          ]);
        })),
        current.byes && current.byes.length ? el('p', { class: 'byes' }, [
          el('strong', { text: 'Sitting out: ' }),
          current.byes.map(function (id) { return nameOf(t, id); }).join(', '),
        ]) : null,
      ]));
    }

    host.innerHTML = '';
    host.appendChild(wrap);
    document.getElementById('storageNote').textContent = 'Live board · view only';
  }

  /* ---------------------------------------------------------------- shared */

  function emptyState(title, body, t, gotoView) {
    return el('section', { class: 'card empty' }, [
      el('h2', { text: title }),
      el('p', { class: 'muted', text: body }),
      el('button', {
        type: 'button',
        class: 'btn primary',
        onclick: function () { activeView[t.id] = gotoView; render(); },
      }, ['Go to Setup']),
    ]);
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: 'pickleball-tournaments.json' });
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /* ----------------------------------------------------------------- start */

  function migrate(loaded) {
    if (!loaded || !Array.isArray(loaded.tournaments) || loaded.tournaments.length < 2) {
      return window.Model.defaultState();
    }
    loaded.tournaments.forEach(function (t, index) {
      t.settings = Object.assign({}, window.Model.DEFAULT_SETTINGS, t.settings || {});
      t.players = t.players || [];
      // Carry state saved under the old placeholder names over to the new
      // defaults, while leaving any name the user chose alone.
      if (t.name === window.Model.LEGACY_NAMES[index]) {
        t.name = window.Model.DEFAULT_NAMES[index];
      }
    });
    if (!loaded.tournaments.some(function (t) { return t.id === loaded.activeTournamentId; })) {
      loaded.activeTournamentId = loaded.tournaments[0].id;
    }
    return loaded;
  }

  function start() {
    // Opening a share link from an already-open tab only changes the fragment,
    // which is a same-document navigation — without this the app would stay in
    // whatever mode it booted in and quietly ignore the link.
    window.addEventListener('hashchange', function () { window.location.reload(); });

    const mode = window.Share.readMode(window.location.hash);
    if (mode.mode === 'snapshot') return startSnapshotViewer(mode.payload);
    if (mode.mode === 'live') return startLiveViewer(mode.shareId);
    return startAdmin();
  }

  function startAdmin() {
    state = migrate(window.Storage.load());
    document.getElementById('storageNote').textContent = window.Storage.describe();
    document.getElementById('exportBtn').addEventListener('click', exportJson);
    document.getElementById('printBtn').addEventListener('click', function () { window.print(); });

    if (window.Sync.enabled()) {
      publisher = window.Sync.createPublisher(function (status) { showShareStatus(status); });
      const saved = window.Storage.loadShareId && window.Storage.loadShareId();
      if (saved) {
        publisher.start(saved);
        publisher.publish(activeTournament());
      }
    }

    render();
    save();
  }

  /* Called once the service worker registers, so the footer can say plainly
     whether the app will still open with no connection. */
  function markOfflineReady() {
    const node = document.getElementById('offlineNote');
    if (node) node.textContent = 'Works offline';
  }

  window.App = {
    start: start,
    getState: function () { return state; },
    markOfflineReady: markOfflineReady,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window, document);
