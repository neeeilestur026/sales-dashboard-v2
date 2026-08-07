/* A208 — rank a rep's sent mail against a quotation, so attaching the right one is usually a click.
 *
 * Pure and DOM-free on purpose (the puller-selector.js precedent from A185): every rule here is a
 * judgement about someone's real mail, and a judgement that can only be checked by clicking through
 * a UI never gets checked. Everything below is exercised by a table test.
 *
 * NOTHING HERE EVER LINKS ANYTHING. It only reorders a list a person then picks from. The scores are
 * shown as plain reasons ("same domain", "matches your client ref") so a wrong suggestion is
 * obviously wrong rather than quietly authoritative.
 *
 * THE HONEST LIMIT, up front: the FIRST email to a brand-new client, on a quotation with no subject
 * and no client email on record, has nothing to score but the date. That is a genuine search-and-
 * pick. From the second quotation for that client onward the learned-domain signal puts the right
 * message at the top. This is worth saying out loud rather than promising one-click.
 */

/* Free mailboxes tell you nothing about which company someone works for, so they must never earn the
   domain points — otherwise every gmail client collides with every other. Mirrors the same list in
   blueprints/email_log.py _company_from_email. */
const QEM_PUBLIC_DOMAINS = ['gmail.com', 'yahoo.com', 'yahoo.com.ph', 'outlook.com', 'hotmail.com',
  'icloud.com', 'live.com', 'aol.com', 'protonmail.com', 'msn.com'];

const QEM_STOPWORDS = ['the', 'and', 'for', 'with', 'your', 'our', 're', 'fw', 'fwd', 'quotation',
  'quote', 'quotations', 'rfq', 'inquiry', 'enquiry', 'request', 'pls', 'please', 'good', 'day',
  'sir', 'maam', 'ma', 'am', 'hi', 'hello', 'dear', 'attached', 'attn', 'ref', 'reference'];

function qemDomain(addr) {
  const a = String(addr || '').toLowerCase().trim();
  const at = a.lastIndexOf('@');
  if (at < 0) return '';
  const d = a.slice(at + 1);
  return QEM_PUBLIC_DOMAINS.indexOf(d) >= 0 ? '' : d;
}

/** Letters and digits only, lower-cased — so '2026-419-NE-ECC' and '2026 419 ne ecc' are the same. */
function qemFlat(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function qemTokens(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && QEM_STOPWORDS.indexOf(t) < 0);
}

/** Jaccard overlap of two token sets, 0..1. Returns 0 when either side is empty — a quotation with
 *  no subject must score NOTHING here, never a penalty and never a spurious match. */
function qemOverlap(a, b) {
  const A = qemTokens(a), B = qemTokens(b);
  if (!A.length || !B.length) return 0;
  const sa = {}, sb = {};
  A.forEach(t => sa[t] = 1); B.forEach(t => sb[t] = 1);
  const ka = Object.keys(sa), kb = Object.keys(sb);
  let hit = 0;
  ka.forEach(t => { if (sb[t]) hit++; });
  const union = ka.length + kb.length - hit;
  return union ? hit / union : 0;
}

/** Every address on a message, whichever shape the feed gave us. */
function qemAddresses(msg) {
  const out = [];
  ((msg || {}).recipients || []).forEach(r => { if (r && r.addr) out.push(String(r.addr).toLowerCase()); });
  if (!out.length && (msg || {}).recipient) out.push(String(msg.recipient).toLowerCase());
  return out;
}

/** Whole days between two dates; null when either is unusable. */
function qemDays(a, b) {
  const x = String(a || '').slice(0, 10), y = String(b || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x) || !/^\d{4}-\d{2}-\d{2}$/.test(y)) return null;
  return Math.round((new Date(y + 'T00:00:00Z') - new Date(x + 'T00:00:00Z')) / 86400000);
}

/**
 * Score one sent message against one quotation.
 *
 * ctx = {
 *   clientDomains: { <canonical customer>: [domain, ...] },  // learned from confirmed links
 *   dismissed:     { <messageId>: true },                    // "not this one", remembered
 *   linked:        { <messageId>: '<quotationNo>' }          // already attached somewhere
 * }
 * Returns { score, reasons: [] }.
 */
function qemScore(quotation, msg, ctx) {
  const q = quotation || {}, m = msg || {}, c = ctx || {};
  const reasons = [];
  let score = 0;

  // Already attached to THIS quotation, or explicitly rejected for it — sink it out of the way.
  const mid = String(m.messageId || '').toLowerCase();
  if (mid && c.dismissed && c.dismissed[mid]) return { score: -1000, reasons: ['you said not this one'] };
  if (mid && c.linked && c.linked[mid] && String(c.linked[mid]) !== String(q.quotationNo)) {
    return { score: -500, reasons: ['already linked to ' + c.linked[mid]] };
  }

  // 1. The quotation number written in the subject. Decisive, and rare — the reps' subjects are
  //    usually the client's own RFQ wording, which is exactly why this cannot be the only signal.
  const subj = qemFlat(m.subject);
  const qno = qemFlat(q.quotationNo);
  if (qno && qno.length >= 6 && subj.indexOf(qno) >= 0) {
    score += 60; reasons.push('quotation number in the subject');
  }

  // 2. Who it went to. A domain we have CONFIRMED for this client before is worth more than a
  //    guess from the client record, because it is evidence from this rep's own past behaviour.
  const key = String(q.customer || '').toLowerCase().trim();
  const domains = qemAddresses(m).map(qemDomain).filter(Boolean);
  const known = ((c.clientDomains || {})[key]) || [];
  /* The domain ON RECORD for this client, from the Clients sheet. This must be supplied through ctx:
     the quotation DTO has no such field, and an early version of this scorer read q.customerDomain,
     which is always undefined — so the second-strongest signal silently never fired and an unrelated
     "Lunch Friday?" outranked the client's own RFQ email. Caught in the browser, not in a unit test,
     because the unit test had been handing it a field the real data does not carry. */
  const onFile = qemDomain((c.clientEmails || {})[key] || q.customerDomain || '');
  if (domains.length && known.length && domains.some(d => known.indexOf(d) >= 0)) {
    score += 35; reasons.push('you have emailed ' + (q.customer || 'this client') + ' here before');
  } else if (domains.length && onFile && domains.indexOf(onFile) >= 0) {
    score += 25; reasons.push("the client's own domain");
  }

  // 3. Subject against ours. Degrades to zero on a blank subject — 22 of 77 live quotations have one.
  const sOverlap = qemOverlap(q.subject, m.subject);
  if (sOverlap > 0.15) {
    score += Math.round(20 * sOverlap);
    reasons.push('subject matches (' + Math.round(sOverlap * 100) + '%)');
  }

  /* 4. The client's OWN reference, scored SEPARATELY from our subject. This is the signal that makes
        the common case work: the rep replies to the client's RFQ, so the email subject is the
        CLIENT's wording, not ours. Folding this into (3) would lose exactly the emails we most need
        to find. */
  const rfqOnFile = (c.clientRefs || {})[key] || '';
  const refOverlap = Math.max(qemOverlap(q.clientRefNo, m.subject), qemOverlap(rfqOnFile, m.subject));
  const refFlat = qemFlat(q.clientRefNo) || qemFlat(rfqOnFile);
  if (refFlat && refFlat.length >= 4 && subj.indexOf(refFlat) >= 0) {
    score += 15; reasons.push('your client reference is in the subject');
  } else if (refOverlap > 0.2) {
    score += Math.round(15 * refOverlap); reasons.push('matches your client reference');
  }

  // 5. When it was sent, relative to approval. A quotation cannot be emailed before it exists.
  const anchor = String(q.approvedAt || q.date || '').slice(0, 10);
  const when = String(m.sentAt || m.date || '').slice(0, 10);
  const gap = qemDays(anchor, when);
  if (gap !== null) {
    if (gap < -1) { score -= 30; reasons.push('sent before the quotation was approved'); }
    else if (gap <= 1) { score += 20; reasons.push('sent the same day'); }
    else if (gap <= 3) { score += 12; reasons.push('sent within 3 days'); }
    else if (gap <= 7) { score += 6; reasons.push('sent within a week'); }
    else if (gap <= 14) { score += 2; }
  }
  return { score: score, reasons: reasons };
}

/** Rank a rep's sent messages for one quotation, best first. Never filters — a low score is still
 *  offered, just further down, because the person picking knows things this does not. */
function qemRank(quotation, messages, ctx) {
  return (messages || [])
    .map(m => {
      const s = qemScore(quotation, m, ctx);
      return { msg: m, score: s.score, reasons: s.reasons };
    })
    .sort((a, b) => (b.score - a.score) ||
      String(b.msg.sentAt || b.msg.date || '').localeCompare(String(a.msg.sentAt || a.msg.date || '')));
}

/** The reverse: rank quotations for one message, for the mailbox page's Attach button. */
function qemRankQuotations(msg, quotations, ctx) {
  return (quotations || [])
    .map(q => {
      const s = qemScore(q, msg, ctx);
      return { quotation: q, score: s.score, reasons: s.reasons };
    })
    .sort((a, b) => (b.score - a.score) ||
      String(b.quotation.date || '').localeCompare(String(a.quotation.date || '')));
}

/** Only pre-select when we are BOTH confident and unambiguous. A suggestion that is merely the least
 *  bad option must not look like an answer. */
function qemIsConfident(ranked) {
  if (!ranked || !ranked.length) return false;
  const top = ranked[0], next = ranked[1];
  return top.score >= 70 && (!next || (top.score - next.score) >= 25);
}

/** Learn which domains a client actually uses, from links already confirmed. This is what turns the
 *  second and every later quotation for a client into one click. */
function qemLearnDomains(links, quotationsByNo) {
  const out = {};
  (links || []).forEach(l => {
    if (String(l.status || 'Active') !== 'Active') return;
    const q = (quotationsByNo || {})[String(l.quotationNo)];
    if (!q || !q.customer) return;
    const key = String(q.customer).toLowerCase().trim();
    String(l.to || '').split(/[,;]/).forEach(a => {
      const d = qemDomain(a);
      if (!d) return;
      out[key] = out[key] || [];
      if (out[key].indexOf(d) < 0) out[key].push(d);
    });
  });
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { qemScore, qemRank, qemRankQuotations, qemIsConfident, qemLearnDomains,
    qemDomain, qemOverlap, qemTokens, qemFlat, qemDays, qemAddresses };
}
