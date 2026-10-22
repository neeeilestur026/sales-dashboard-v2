/* index-inline.js — A359 · the sign-in page's own script, moved verbatim out of index.html (as A305 did for the
   largest inline scripts) so it is cached and the inline budget only shrinks; A359 adds the pulse while signing in.
   A classic script, not wrapped: the form's onsubmit calls handleLogin. It runs at the same point in the page. */
// Auto-redirect if already logged in
(function() {
  const session = getSession();
  /* A277 — was a hand-rolled copy of _homeForRole that had drifted: it had no 'marketing'
     branch, so a marketing user reopening the tab landed on the sales dashboard and was
     bounced. The fresh-login path below already used the real one. */
  if (session) window.location.href = flowAfterLogin(session.role);
  else if (typeof hxClearCaches === 'function') hxClearCaches();   // A304: no stale rows for the next sign-in
})();

// A359 — the pulse that covers the page while signing in; a no-op if its script did not load
const loader = window.LoginLoader || { start() {}, stop() {} };

async function handleLogin(e) {
  e.preventDefault();

  const user = document.getElementById('username').value.trim();
  const pass = document.getElementById('password').value;
  const errorMsg = document.getElementById('errorMsg');
  const errorText = document.getElementById('errorText');
  const loginBtn = document.getElementById('loginBtn');
  const loginBtnText = document.getElementById('loginBtnText');
  const loginSpinner = document.getElementById('loginSpinner');

  // Hide previous error
  errorMsg.classList.remove('visible');

  // Show loading state
  loginBtn.disabled = true;
  loginBtnText.textContent = 'Signing in...';
  loginSpinner.style.display = 'block';
  loader.start();

  try {
    const result = await apiLogin(user, pass);

    if (result.success) {
      saveSession(result);
      // Single source of truth for role→home (covers marketing etc. — auth.js); the pulse stays up until it opens
      window.location.href = flowAfterLogin(result.role);
    } else {
      loader.stop();
      errorText.textContent = result.message || 'Invalid username or password';
      errorMsg.classList.add('visible');
    }
  } catch (err) {
    loader.stop();
    errorText.textContent = 'Unable to connect to server. Please try again.';
    errorMsg.classList.add('visible');
  } finally {
    loginBtn.disabled = false;
    loginBtnText.textContent = 'Sign In';
    loginSpinner.style.display = 'none';
  }
}
