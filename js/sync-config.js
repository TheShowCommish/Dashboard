/* ============================================================
   sync-config.js — where this deck's Supabase project lives.

   FILL THESE IN ONCE AND COMMIT THE FILE. Both values are meant to be
   public: the anon key is a client key, it identifies the project and
   nothing else, and every device that loads the dashboard needs it
   before it can even offer you a sign-in box. Supabase's own docs ship
   it in the page.

   What actually protects your data is row-level security plus your
   login — see tools/supabase-setup.sql. With the policy in that file, a
   stranger holding this key can do precisely nothing: every row is
   fenced to the user id on the JWT, and they have no JWT.

   What must NEVER go in here: the service_role key. That one bypasses
   row-level security entirely and belongs on a server, not in a page.
   If a key you are about to paste is labelled service_role, stop.

   Committing it is what lets a phone work by opening the page and
   tapping "email me a link", instead of you typing a JWT on a phone
   keyboard in a supermarket car park. Settings -> Sync can still
   override both per device, which is how you point one browser at a
   staging project without disturbing the wall display.
   ============================================================ */

window.DECK_SYNC = {
  url:  '',      // e.g. 'https://abcdefghijklm.supabase.co'
  anon: ''       // the anon / publishable key, the long eyJ... string
};
