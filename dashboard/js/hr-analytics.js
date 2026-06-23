/* ═══════════════════════════════════════════════
   hr-analytics.js — HR-Marketing Analytics Dashboard
   ═══════════════════════════════════════════════ */

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireHROrAdmin();
  if (!session) return;
  renderNavbar('hr-analytics');
  await loadAnalytics();
});

/* ─── Main Loader ─────────────────────────────── */

async function loadAnalytics() {
  try {
    const [analyticsRes, bdayRes] = await Promise.allSettled([
      apiGetHRAnalytics(),
      apiGetBirthdayAnniversary()
    ]);

    // Analytics overview
    if (analyticsRes.status === 'fulfilled' && analyticsRes.value.success) {
      const d = analyticsRes.value.data;
      renderOverview(d);
      renderDepartmentChart(d.departmentBreakdown || {});
      renderRecruitmentFunnel(d.recruitmentFunnel || {});
      renderTaskProgress(d.taskCompletion || { done: 0, total: 0 });
    } else {
      document.getElementById('deptChart').innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);">Unable to load analytics data.</div>';
      document.getElementById('funnelChart').innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);">Unable to load funnel data.</div>';
      document.getElementById('taskProgress').innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);">Unable to load task data.</div>';
    }

    // Birthdays & Anniversaries
    if (bdayRes.status === 'fulfilled' && bdayRes.value.success) {
      renderBirthdays(bdayRes.value.data || []);
    } else {
      document.getElementById('bdayContainer').innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);">Unable to load birthday data.</div>';
    }
  } catch (err) {
    console.error('Error loading analytics:', err);
  }
}

/* ─── Render Overview Stat Cards ─────────────── */

function renderOverview(data) {
  const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };

  el('statEmployees', data.totalEmployees || 0);
  el('statGrievances', data.openGrievances || 0);
  el('statLeave', data.leavePending || 0);
  el('statCampaigns', data.activeCampaigns || 0);
  el('statLeads', data.totalLeads || 0);

  // Task completion rate as percentage
  const tc = data.taskCompletion || { done: 0, total: 0 };
  const rate = tc.total > 0 ? Math.round((tc.done / tc.total) * 100) : 0;
  el('statTaskRate', rate + '%');
}

/* ─── Department Horizontal Bar Chart ────────── */

function renderDepartmentChart(deptBreakdown) {
  const container = document.getElementById('deptChart');
  const entries = Object.entries(deptBreakdown);

  if (entries.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);">No department data available.</div>';
    return;
  }

  // Sort descending by count
  entries.sort((a, b) => b[1] - a[1]);
  const max = entries[0][1] || 1;

  let html = '';
  entries.forEach(([dept, count]) => {
    const pct = Math.max((count / max) * 100, 4);
    html += '<div class="dept-bar-row">' +
      '<span class="dept-bar-label" title="' + esc(dept) + '">' + esc(dept) + '</span>' +
      '<div class="dept-bar-track">' +
        '<div class="dept-bar-fill" style="width:' + pct + '%;">' + count + '</div>' +
      '</div>' +
    '</div>';
  });

  container.innerHTML = html;
}

/* ─── Recruitment Funnel ─────────────────────── */

function renderRecruitmentFunnel(funnelData) {
  const container = document.getElementById('funnelChart');
  const stages = [
    { key: 'Job Posted',        color: '#94a3b8' },
    { key: 'Resume Screening',  color: '#eab308' },
    { key: 'Initial Interview', color: '#3b82f6' },
    { key: 'Final Interview',   color: '#a855f7' },
    { key: 'Job Offer',         color: '#f97316' },
    { key: 'Onboarding',        color: '#ec4899' },
    { key: 'Complete',          color: '#22c55e' }
  ];

  const total = stages.reduce((sum, s) => sum + (funnelData[s.key] || 0), 0);
  if (total === 0) {
    container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);">No recruitment data available.</div>';
    return;
  }

  // Build funnel with decreasing widths
  const widthStart = 100;
  const widthEnd = 40;
  const stepDecrement = (widthStart - widthEnd) / Math.max(stages.length - 1, 1);

  let html = '<div class="funnel-container">';
  stages.forEach((s, i) => {
    const count = funnelData[s.key] || 0;
    const w = Math.round(widthStart - (stepDecrement * i));
    html += '<div class="funnel-step" style="' +
      'width:' + w + '%;' +
      'background:' + s.color + ';' +
      'margin-bottom:2px;' +
      '">' +
      '<span class="funnel-count">' + count + '</span>' +
      '<span class="funnel-label">' + esc(s.key) + '</span>' +
    '</div>';
  });
  html += '</div>';

  container.innerHTML = html;
}

/* ─── Birthdays & Anniversaries ──────────────── */

function renderBirthdays(events) {
  const container = document.getElementById('bdayContainer');

  if (!events || events.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);">No upcoming birthdays or anniversaries.</div>';
    return;
  }

  let html = '<ul class="bday-list">';
  events.forEach(ev => {
    const isToday = ev.daysAway === 0;
    const typeClass = (ev.type || '').toLowerCase() === 'birthday' ? 'bday-type-birthday' : 'bday-type-anniversary';
    const badgeClass = isToday ? 'bday-badge today-badge' : 'bday-badge';
    const badgeText = isToday ? 'Today' : (ev.daysAway === 1 ? '1 day' : ev.daysAway + ' days');

    html += '<li class="bday-item' + (isToday ? ' today' : '') + '">' +
      '<span class="bday-type ' + typeClass + '">' + esc(ev.type) + '</span>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-weight:600;">' + esc(ev.name) + '</div>' +
        '<div class="bday-detail">' + esc(ev.date) + (ev.detail ? ' &middot; ' + esc(ev.detail) : '') + '</div>' +
      '</div>' +
      '<span class="' + badgeClass + '">' + badgeText + '</span>' +
    '</li>';
  });
  html += '</ul>';

  container.innerHTML = html;
}

/* ─── Task Completion Progress Bar ───────────── */

function renderTaskProgress(taskData) {
  const container = document.getElementById('taskProgress');
  const done = taskData.done || 0;
  const total = taskData.total || 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  let html = '<div class="progress-info">' +
    '<span>Completed</span>' +
    '<strong>' + done + ' / ' + total + '</strong>' +
  '</div>' +
  '<div class="progress-track">' +
    '<div class="progress-fill" style="width:' + Math.max(pct, 2) + '%;">' + pct + '%</div>' +
  '</div>' +
  '<div style="text-align:center;margin-top:0.5rem;font-size:0.78rem;color:var(--text-muted,#64748b);">' +
    (total === 0 ? 'No tasks recorded' : pct + '% of tasks completed') +
  '</div>';

  container.innerHTML = html;
}
