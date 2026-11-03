/* bulletin-model.js — A390 · the bulletin board page's words and rules (bulletin.html), pure and tested in node
 * (tests/flow/bulletin-page.js). No DOM, no network: js/bulletin-page.js draws what these return; FlowAPI decides. */

const BBM_ROLES = [['sales', 'Sales'], ['admin', 'Admin'], ['accounting', 'Accounting'], ['management', 'Management'], ['director', 'Director'],
                   ['hr', 'HR'], ['marketing', 'Marketing'], ['leadgen', 'Lead generation'], ['warehouse', 'Warehouse']];
const BBM_KINDS = ['Announcement', 'Memo', 'Policy update'];
const BBM_MAX_MB = 10;
const BBM_TYPES = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'image/gif': 1, 'application/pdf': 1,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 1, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 1,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 1, 'text/plain': 1, 'text/csv': 1 };

function _bbmRaw(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }
/** "Everyone", or the roles in words: "Sales and Accounting", "Sales, Admin and HR". */
function bbmAudienceLabel(aud) {
  const a = (aud || []).filter(Boolean);
  if (!a.length || a.indexOf('all') >= 0) return 'Everyone';
  const names = a.map(r => (BBM_ROLES.find(x => x[0] === r) || [r, r])[1]);
  return names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}
/** Who has and has not seen a post: the roster (apiGetUsers) narrowed to the post's audience, without its author. */
function bbmSeen(item, roster) {
  const acks = (item && item.acks) || [], aud = (item && item.audience) || ['all'], all = aud.indexOf('all') >= 0;
  const got = {};
  acks.forEach(a => { got[_bbmRaw(a.username) || _bbmRaw(a.name)] = a; });
  const people = (roster || []).map(u => ({ username: String(u.username || ''), name: String(u.fullName || u.name || u.username || '').trim(), role: String(u.role || '').toLowerCase() }))
    .filter(u => u.name && (all || aud.indexOf(u.role) >= 0) && _bbmRaw(u.name) !== _bbmRaw(item && item.createdBy));
  const seen = acks.map(a => ({ name: a.name || a.username, role: a.role, at: a.at }));
  const notYet = people.filter(u => !got[_bbmRaw(u.username)] && !got[_bbmRaw(u.name)]);
  const byRole = {};
  notYet.forEach(u => { (byRole[u.role] = byRole[u.role] || []).push(u.name); });
  return { seen, notYet, byRole, total: people.length || null };
}
/** The composer's checks, as the person types (the server checks the same and decides). */
function bbmFormCheck(f, today) {
  const t = String(f.title || '').trim(), b = String(f.body || '');
  if (!t) return 'Give the announcement a title.';
  if (t.length > 120) return 'Keep the title under 120 characters.';
  if (b.length > 3000) return 'Keep the message under 3000 characters, or attach it as a file.';
  if (!b.trim() && !f.hasFile) return 'Write the message, or attach a file.';
  if (f.showUntil && f.showUntil < today) return 'Show until is in the past.';
  if (!f.everyone && !(f.roles || []).length) return 'Pick who it is for, or Everyone.';
  return '';
}
/** A picked file: refused before it is read when it is too large or of a type the board does not take. */
function bbmFileCheck(file) {
  if (!file) return '';
  if (!BBM_TYPES[String(file.type || '').toLowerCase()]) return 'Attach a picture, a PDF, or a Word, Excel, PowerPoint or text file.';
  if (file.size > BBM_MAX_MB * 1048576) return 'The file is over ' + BBM_MAX_MB + ' MB.';
  return '';
}
/** saveBulletin's params from the composer. */
function bbmParams(f) {
  return { title: String(f.title || '').trim(), body: String(f.body || ''), kind: f.kind || 'Announcement', audience: f.everyone ? 'all' : (f.roles || []).join(','),
           pinned: !!f.pinned, showUntil: f.showUntil || '' };
}
/** Search over the title, the message, the writer and the file's name. */
function bbmFilter(items, q) {
  const words = _bbmRaw(q).split(' ').filter(Boolean);
  if (!words.length) return items || [];
  return (items || []).filter(it => {
    const hay = _bbmRaw([it.title, it.body, it.createdBy, it.kind, it.file && it.file.name].join(' '));
    return words.every(w => hay.indexOf(w) >= 0);
  });
}
/** "Seen by 12 of 30", or "Seen by 12" when the roster could not be read. */
function bbmSeenLine(s) { return s.total ? 'Seen by ' + s.seen.length + ' of ' + (s.total) : 'Seen by ' + s.seen.length; }

if (typeof module !== 'undefined' && module.exports) module.exports = { BBM_ROLES, BBM_KINDS, BBM_MAX_MB, BBM_TYPES, bbmAudienceLabel, bbmSeen, bbmFormCheck, bbmFileCheck, bbmParams, bbmFilter, bbmSeenLine };
