/* ============================================================
   gate.js — nothing renders until somebody is signed in, and the
   phone that signs in lands on the list rather than the wall.

   WHAT THIS IS. A curtain, not a lock. The site is static files on
   GitHub Pages: anyone can read this file and every other one, and no
   amount of client-side JavaScript changes that. What actually keeps a
   stranger out of the DATA is row-level security in Supabase
   (tools/supabase-setup.sql) — every row is fenced to the user id on
   the JWT, and a visitor who never signed in has no JWT and therefore
   no rows. The gate exists so that a deck opened by the wrong person is
   an honest sign-in box instead of a convincing-looking dashboard full
   of empty panels, and so the phone flow has somewhere to start.

   If you want a real lock — the HTML itself refused to unauthenticated
   requests — that is Cloudflare Access or an equivalent in front of the
   site, not code in the page.

   THE SESSION IS THE POINT. Signing in is once per device, not once per
   visit. Supabase refresh tokens live in localStorage (see cloud.js) and
   rotate on use, so the wall display signs in the day it is hung and
   stays signed in. The gate therefore tests for the PRESENCE of a
   refresh token, not for a live network round trip: gating on a server
   call would lock the kitchen out of its own grocery list every time the
   wifi dropped, which is the exact moment the list is needed. A token
   that turns out to be dead is discovered by the first sync, and cloud.js
   reports 'signed-out' — which raises the curtain again, from below.

   ROUTING. A phone opening the site wants the grocery list; a desktop or
   a wall display wants the deck. So index.html on a small screen hands
   off to grocery.html. It is a one-way rule on purpose: opening
   grocery.html is already a decision, and bouncing a laptop off a page
   it asked for by name would be the gate second-guessing a human.

   The ?stay=1 on the two cross-links is how "Full deck" works from a
   phone without being thrown straight back. It is remembered for the tab
   (sessionStorage, not localStorage) so a reload or a rotate does not
   undo the choice, and a fresh tab tomorrow gets the default again.
   ============================================================ */

const Gate = (() => {

  const PIN = 'controldeck.route.stay';

  /* A phone, or something shaped like one. Width rather than user agent:
     the question is how much room the layout has, and a narrow window on
     a desktop wants the one-column list for the same reason a phone
     does. */
  const isSmall = () => matchMedia('(max-width: 820px)').matches;

  const onGrocery = () => /grocery\.html$/i.test(location.pathname);

  /* Deliberate arrival: the cross-links carry ?stay=1. Recorded per tab
     so the URL can be scrubbed and the decision still holds. */
  function pinned(){
    try{
      if(new URLSearchParams(location.search).get('stay')){
        sessionStorage.setItem(PIN, '1');
        /* Out of the address bar: a shared or bookmarked url should be
           the page, not the page plus a routing flag. */
        history.replaceState(null, '', location.pathname);
        return true;
      }
      return sessionStorage.getItem(PIN) === '1';
    }catch{ return false; }
  }

  /* Returns true when it has sent the browser somewhere else, in which
     case the caller must not carry on booting a page that is leaving. */
  function route(){
    if(onGrocery() || pinned() || !isSmall()) return false;
    location.replace('grocery.html');
    return true;
  }

  /* ---- the curtain ---- */
  let el = null, queue = [], opened = false;

  function build(){
    if(el) return el;
    el = document.createElement('div');
    el.id = 'gate';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'gateTitle');

    /* One form, two modes. A separate "create account" screen would mean
       a second set of fields holding the same two values, and a phone
       that has to be navigated back out of when you picked wrong. */
    el.innerHTML = [
      '<form class="gate-card" novalidate>',
      '  <h1 id="gateTitle">Control Deck</h1>',
      '  <p class="gate-why">Sign in once on this device and it stays signed in.</p>',
      '  <input id="gateEmail" type="email" name="email" placeholder="you@example.com"',
      '         autocomplete="email" inputmode="email" autocapitalize="off"',
      '         spellcheck="false" aria-label="Email address">',
      /* autocomplete tells the password manager which of the two this is;
         getting it wrong is how browsers end up offering to save a new
         password over the working one. It is rewritten on mode switch. */
      '  <input id="gatePass" type="password" name="password" placeholder="Password"',
      '         autocomplete="current-password" aria-label="Password">',
      '  <button class="gate-go" type="submit">Sign in</button>',
      '  <p class="gate-note" role="status" aria-live="polite"></p>',
      '  <div class="gate-alt">',
      '    <button type="button" class="gate-link" data-mode="up">Create an account</button>',
      '    <button type="button" class="gate-link" data-forgot>Forgot password</button>',
      '  </div>',
      '</form>'
    ].join('\n');
    document.body.appendChild(el);

    const form = el.querySelector('form');
    const box  = el.querySelector('#gateEmail');
    const pass = el.querySelector('#gatePass');
    const btn  = el.querySelector('.gate-go');
    const note = el.querySelector('.gate-note');
    const why  = el.querySelector('.gate-why');
    const swap = el.querySelector('[data-mode]');
    const lost = el.querySelector('[data-forgot]');

    let mode = 'in';                        // 'in' | 'up'

    /* The address last used on this device, so the common case is a
       password and nothing else. */
    try{ box.value = (Cloud.settings || {}).lastEmail || ''; }catch{}

    function say(msg, bad){
      note.classList.toggle('is-bad', !!bad);
      note.textContent = msg || '';
    }

    function setMode(next){
      mode = next;
      const up = mode === 'up';
      btn.textContent  = up ? 'Create account' : 'Sign in';
      why.textContent  = up
        ? 'Pick a password of at least 8 characters. No email to wait for.'
        : 'Sign in once on this device and it stays signed in.';
      pass.placeholder = up ? 'New password (8+ characters)' : 'Password';
      pass.setAttribute('autocomplete', up ? 'new-password' : 'current-password');
      swap.textContent = up ? 'I already have an account' : 'Create an account';
      lost.hidden = up;
      say('');
    }
    setMode('in');

    swap.addEventListener('click', () => setMode(mode === 'up' ? 'in' : 'up'));

    /* The one thing still worth an email — and only on request, so the
       rate limit is spent on a reset rather than on every ordinary
       sign-in. */
    lost.addEventListener('click', () => {
      Cloud.signIn(box.value)
        .then(() => say('Link sent. Opening it signs you in; set a new password in Settings.'))
        .catch(err => say(err.message, true));
    });

    form.addEventListener('submit', e => {
      e.preventDefault();
      btn.disabled = true;
      say(mode === 'up' ? 'Creating…' : 'Signing in…');

      const done = () => {
        /* Signed in for real. Re-run the same decision a fresh load
           would make, so a phone that just made an account lands on the
           list rather than on the deck it was gated from. */
        if(route()) return;
        /* open() runs the page's own boot, and both pages call
           Cloud.boot() as one of their steps — doing it here too would
           run two first syncs against each other. */
        open();
        watch();
      };

      const work = mode === 'up'
        ? Cloud.signUp(box.value, pass.value).then(r => {
            /* Confirmation is on: there is no session, and cloud.js has
               already put the reason on the status. Do not open. */
            if(r && r.confirmRequired){
              say(Cloud.status.detail, true);
              btn.disabled = false;
              return;
            }
            done();
          })
        : Cloud.signInPassword(box.value, pass.value).then(done);

      work.catch(err => {
        say(err.message, true);
        btn.disabled = false;
      });
    });
    return el;
  }

  function show(why){
    build().hidden = false;
    document.documentElement.classList.add('is-gated');
    if(why){
      const note = el.querySelector('.gate-note');
      note.classList.add('is-bad');
      note.textContent = why;
    }
    /* Not on a phone: a keyboard springing up over the sign-in box the
       moment the page loads hides the thing it is there to fill in. */
    if(!isSmall()) setTimeout(() => el.querySelector('#gateEmail').focus(), 60);
  }

  function hide(){
    if(el) el.hidden = true;
    document.documentElement.classList.remove('is-gated');
  }

  /* Runs the page's own boot, exactly once. */
  function open(){
    if(opened) return;
    opened = true;
    hide();
    const fns = queue; queue = [];
    for(const fn of fns){
      try{ fn(); }catch(e){ console.error('Boot step failed after the gate:', e); }
    }
  }

  function start(){
    /* The emailed link comes back with the session in the fragment. Read
       it before anything decides whether we are signed in, or the first
       load after clicking the link shows a sign-in box to somebody who
       just signed in. */
    try{ Cloud.catchCallback(); }catch(e){ console.error(e); }

    /* No project configured at all is not a security posture, it is an
       unfinished setup — and gating it would lock the Settings drawer
       away behind a sign-in that cannot possibly work. Let it through;
       cloud.js already reports 'off' where the user can see it. */
    if(!Cloud.configured){
      console.warn('Gate: no Supabase project configured, so sign-in is not enforced.');
      return open();
    }

    if(!Cloud.signedIn) return show();

    /* Signed in, so decide where this belongs before painting a page it
       is about to leave. */
    if(route()) return;
    open();
    watch();
  }

  /* A refresh token that turns out to be spent surfaces here, minutes or
     months later. Drop the curtain again rather than leaving a screen
     that quietly shows nothing. Registered once, whether the session was
     already on the device at boot or was just typed into the curtain. */
  let watching = false;
  function watch(){
    if(watching) return;
    watching = true;
    Cloud.onStatus(st => {
      if(st.state === 'signed-out' && !Cloud.signedIn) show(st.detail);
      else if(Cloud.signedIn && el && !el.hidden) hide();
    });
  }

  /* The page hands its boot to the gate instead of to DOMContentLoaded. */
  function ready(fn){
    queue.push(fn);
    if(opened){ opened = false; open(); }
  }

  if(document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start);
  else start();

  return { ready, isSmall };
})();

window.Gate = Gate;
