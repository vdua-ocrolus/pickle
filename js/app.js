/* UI layer: tabs, roster setup, schedule, standings and finals. */
(function (window, document) {
  'use strict';

  const VIEWS = [
    { id: 'setup', label: 'Setup' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'standings', label: 'Standings' },
    { id: 'finals', label: 'Finals' },
  ];

  let state = null;
  const activeView = {}; // tournamentId -> view id, kept in memory only

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
        table,
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
      el('table', { class: 'table' }, [
        el('thead', {}, [el('tr', {}, [
          th('#'), th('Player'), th('Seed'), th('W'), th('L'), th('PF'), th('PA'), th('Diff'),
        ])]),
        buildFinalsTableBody(t, complete),
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
    loaded.tournaments.forEach(function (t) {
      t.settings = Object.assign({}, window.Model.DEFAULT_SETTINGS, t.settings || {});
      t.players = t.players || [];
    });
    if (!loaded.tournaments.some(function (t) { return t.id === loaded.activeTournamentId; })) {
      loaded.activeTournamentId = loaded.tournaments[0].id;
    }
    return loaded;
  }

  function start() {
    state = migrate(window.Storage.load());
    document.getElementById('storageNote').textContent = window.Storage.describe();
    document.getElementById('exportBtn').addEventListener('click', exportJson);
    document.getElementById('printBtn').addEventListener('click', function () { window.print(); });
    render();
    save();
  }

  window.App = { start: start, getState: function () { return state; } };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window, document);
