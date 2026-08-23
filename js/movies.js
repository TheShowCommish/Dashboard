/* ============================================================
   movies.js — upcoming theatrical releases from TMDB.
   ============================================================ */

const Movies = (() => {
  const body = document.getElementById('moviesBody');

  async function load(){
    const key = Store.get('keys.tmdb','');
    if(!key) return tileError(body,'Add a TMDB key in Settings.');

    try{
      const d = await getJSON(
        `https://api.themoviedb.org/3/movie/upcoming?language=en-US&page=1&region=US&api_key=${key}`);

      const soon = (d.results||[])
        .filter(m => m.release_date && new Date(m.release_date+'T12:00:00') >= new Date(Date.now()-864e5))
        .sort((a,b) => a.release_date.localeCompare(b.release_date))
        .slice(0,8);

      if(!soon.length) return tileError(body,'No upcoming releases listed right now.');

      body.innerHTML = soon.map(m => {
        const d0 = new Date(m.release_date+'T12:00:00');
        const days = Math.round((d0 - Date.now())/864e5);
        return `<div class="row">
          <span class="row-main">
            <span class="row-title">${esc(m.title)}</span>
            <span class="row-sub">${d0.toLocaleDateString(undefined,{month:'short',day:'numeric'})}${
              m.vote_count > 40 ? ` · ${m.vote_average.toFixed(1)}★` : ''}</span>
          </span>
          <span class="row-side"><span class="chip ${days<=7?'warn':''}">${days<=0?'out now':days+'d'}</span></span>
        </div>`;
      }).join('');
    }catch(e){
      tileError(body,`Movies failed to load (${e.message}). Check the TMDB key.`);
    }
  }

  return { load };
})();
