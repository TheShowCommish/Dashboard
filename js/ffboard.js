/* ============================================================
   ffboard.js — the whole draft on one screen, and editable.

   A grid of rounds down, seats across, snaked the way the picks
   actually ran. Click any cell to select it; then either pick a
   player out of the list to put him there, or clear it. That covers
   the two things that go wrong on draft night: somebody misheard a
   pick, and somebody clicked the wrong row.

   Team names are editable in place — a board that says "Kyle" beats
   one that says "Team 7" when you are trying to remember who still
   needs a quarterback.
   ============================================================ */

const FFBoard = (() => {

  const modal = () => document.getElementById('ffBoardModal');
  const body  = () => document.getElementById('ffBoardBody');

  let selected = null;      // pick number currently being edited
  let search   = '';

  /* Position drives the colour of a cell, so the shape of a roster — four
     running backs and no quarterback — is visible without reading a word. */
  const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

  function open(){
    selected = null;
    search = '';
    render();
    const m = modal();
    if(m) m.hidden = false;
  }

  function close(){
    const m = modal();
    if(m) m.hidden = true;
    selected = null;
  }

  function render(){
    const b = body();
    if(!b) return;

    const teams  = FFDraft.teamCount();
    const rounds = FFDraft.rounds();
    const picks  = FFDraft.picks();
    const names  = FFDraft.names();
    const mine   = FFDraft.slot();
    const clock  = FFDraft.clock();
    const index  = FFData.bundle ? FFData.bundle.index : new Map();

    const filled = picks.filter(Boolean).length;

    /* ---- the grid ---- */
    let grid = '<div class="ffb-grid" style="--seats:' + teams + '">';

    grid += '<span class="ffb-corner">Rd</span>';
    for(let s = 1; s <= teams; s++)
      grid += '<button class="ffb-team' + (s === mine ? ' is-mine' : '') +
              '" data-rename="' + s + '" title="Click to rename">' + esc(names[s - 1]) + '</button>';

    for(let r = 1; r <= rounds; r++){
      grid += '<span class="ffb-round">' + r + '</span>';
      /* Even rounds run right to left, so the cells are laid out in seat
         order but filled from the snake — which is what makes a printed
         board readable: one column per seat, top to bottom. */
      for(let s = 1; s <= teams; s++){
        const pick = FFData.pickOf(r, s, teams);
        const key = picks[pick - 1] || null;
        const p = key ? index.get(key) : null;
        const isNow = pick === clock.next && !clock.done;
        const cls = ['ffb-cell'];
        if(s === mine) cls.push('is-mine');
        if(selected === pick) cls.push('is-sel');
        if(isNow) cls.push('is-now');
        if(p) cls.push('pos-' + p.pos);
        else cls.push('is-empty');

        grid += '<button class="' + cls.join(' ') + '" data-pick="' + pick + '" title="Round ' + r +
                ', pick ' + pick + ' · ' + esc(names[s - 1]) + (p ? ' · ' + esc(p.name) : ' · empty') + '">' +
          '<i class="ffb-no">' + pick + '</i>' +
          (p ? '<b>' + esc(shortName(p.name)) + '</b><em>' + esc(p.pos) + ' ' + esc(p.team) + '</em>'
             : '<b class="ffb-dash">—</b>') +
          '</button>';
      }
    }
    grid += '</div>';

    /* ---- the editor for whichever cell is selected ---- */
    let editor;
    if(selected == null){
      editor = '<p class="empty">Click any cell to change who was taken there. ' +
               filled + ' of ' + (teams * rounds) + ' picks are in.</p>';
    }else{
      const at = FFData.onClock(selected, teams);
      const cur = picks[selected - 1] ? index.get(picks[selected - 1]) : null;
      editor =
        '<div class="ffb-edit">' +
          '<div class="ffb-edit-head">' +
            '<b>Pick ' + selected + '</b> · round ' + at.round + ' · ' + esc(names[at.slot - 1]) +
            (cur ? ' · currently <b>' + esc(cur.name) + '</b>' : ' · currently empty') +
          '</div>' +
          '<div class="ffb-edit-tools">' +
            '<input id="ffbSearch" class="td-input" type="search" placeholder="Player to put here…" ' +
              'value="' + esc(search) + '" autocomplete="off">' +
            (cur ? '<button class="ghost-btn sm" id="ffbClear">Clear this pick</button>' : '') +
            '<button class="ghost-btn sm" id="ffbCancel">Done</button>' +
          '</div>' +
          '<div class="ffb-hits">' + hits() + '</div>' +
        '</div>';
    }

    b.innerHTML =
      '<h2>Draft board <span class="chip">' + filled + '/' + (teams * rounds) + ' picks</span></h2>' +
      '<div class="ffb-scroll">' + grid + '</div>' +
      editor;

    wire();
  }

  /* Who could go in the selected cell. Anyone already drafted elsewhere is
     shown but marked, because moving a player from one seat to another is a
     correction people actually need to make. */
  function hits(){
    const b = FFData.bundle;
    if(!b) return '';
    const q = FFData.norm(search);
    if(!q) return '<p class="empty">Type a name.</p>';

    const picks = FFDraft.picks();
    const takenAt = new Map();
    picks.forEach((k, i) => { if(k) takenAt.set(k, i + 1); });

    const list = b.players
      .filter(p => p.adp && FFData.norm(p.name).includes(q))
      .sort((x, y) => x.adp.adp - y.adp.adp)
      .slice(0, 12);

    if(!list.length) return '<p class="empty">Nobody by that name is being drafted.</p>';

    return list.map(p => {
      const at = takenAt.get(p.key);
      return '<button class="ffb-hit" data-put="' + esc(p.key) + '">' +
        '<b>' + esc(p.name) + '</b>' +
        '<span>' + esc(p.pos) + ' · ' + esc(p.team) + ' · ADP ' + esc(p.adp.slot) +
        (at ? ' · <i class="warn">already at pick ' + at + '</i>' : '') + '</span></button>';
    }).join('');
  }

  function shortName(name){
    const bits = String(name || '').split(' ');
    if(bits.length < 2) return name;
    return bits[0][0] + '. ' + bits.slice(1).join(' ');
  }

  function rename(seat){
    const names = FFDraft.names();
    const next = prompt('Name for seat ' + seat + ':', names[seat - 1]);
    if(next == null) return;
    const saved = (Store.get('draft.names', null) || []).slice();
    while(saved.length < FFDraft.teamCount()) saved.push(null);
    saved[seat - 1] = next.trim() || null;
    Store.set('draft.names', saved);
    render();
    FFDraft.render();
  }

  function wire(){
    const b = body();
    if(!b) return;

    b.onclick = e => {
      const ren = e.target.closest('[data-rename]');
      if(ren) return rename(Number(ren.dataset.rename));

      const cell = e.target.closest('[data-pick]');
      if(cell){
        const n = Number(cell.dataset.pick);
        selected = (selected === n) ? null : n;
        search = '';
        return render();
      }

      const put = e.target.closest('[data-put]');
      if(put && selected != null){
        FFDraft.take(put.dataset.put, selected);
        search = '';
        return render();
      }

      if(e.target.closest('#ffbClear') && selected != null){
        FFDraft.clearPick(selected);
        return render();
      }
      if(e.target.closest('#ffbCancel')){ selected = null; return render(); }
    };

    const box = b.querySelector('#ffbSearch');
    if(box){
      box.oninput = () => {
        search = box.value;
        const host = b.querySelector('.ffb-hits');
        if(host) host.innerHTML = hits();
      };
      box.focus();
    }
  }

  return {open, close, render};
})();

window.FFBoard = FFBoard;
