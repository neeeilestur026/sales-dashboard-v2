/* ═══════════════════════════════════════════════
   hr-home.js — HR-Marketing Dashboard Home
   ═══════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireHR();
  if (!session) return;
  renderNavbar('hr-home');

  // Greeting
  document.getElementById('greeting').textContent = 'Welcome to Hi-Escorp, ' + (session.fullName || session.name) + '!';

  // Load all stats in parallel
  try {
    const [summaryRes, taskRes, recRes, leaveRes, campaignRes, bdayRes] = await Promise.allSettled([
      apiGetHRSummary(),
      apiGetHRTaskStats(),
      apiGetRecruitmentStats(),
      apiGetLeaveStats(),
      apiGetCampaignStats(),
      apiGetBirthdayAnniversary()
    ]);

    // HR Summary
    if (summaryRes.status === 'fulfilled' && summaryRes.value.success) {
      const s = summaryRes.value.data;
      document.getElementById('statEmployees').textContent = s.totalEmployees || 0;
      document.getElementById('statOpen').textContent = s.openPositions || 0;
      document.getElementById('empCount').textContent = s.totalEmployees || 0;
    }

    // Task stats
    if (taskRes.status === 'fulfilled' && taskRes.value.success) {
      const t = taskRes.value.data;
      const pending = (t.pending || 0) + (t.inProgress || 0);
      document.getElementById('statTasksPending').textContent = pending;
      document.getElementById('statTasksDone').textContent = t.completed || 0;
      document.getElementById('taskCount').textContent = pending;
    }

    // Recruitment stats
    if (recRes.status === 'fulfilled' && recRes.value.success) {
      const r = recRes.value.data;
      const active = r.total - (r.byStage['Complete'] || 0);
      document.getElementById('pipelineCount').textContent = active;
    }

    // Leave stats
    if (leaveRes.status === 'fulfilled' && leaveRes.value.success) {
      const l = leaveRes.value.data;
      document.getElementById('statLeave').textContent = l.pending || 0;
      const el = document.getElementById('leaveCount');
      if (el) el.textContent = l.pending || 0;
    }

    // Campaign stats
    if (campaignRes.status === 'fulfilled' && campaignRes.value.success) {
      const c = campaignRes.value.data;
      document.getElementById('statCampaigns').textContent = c.active || 0;
      const el = document.getElementById('campaignCount');
      if (el) el.textContent = c.active || 0;
    }

    // Birthday/Anniversary
    renderBirthdays(bdayRes.status === 'fulfilled' && bdayRes.value.success ? bdayRes.value.data : []);

    // Today's overview
    renderTodayOverview(summaryRes, taskRes, recRes, leaveRes, campaignRes);

  } catch (err) {
    console.error('Error loading dashboard stats:', err);
  }

  // Check daily report status
  checkReportStatus(session);
});

async function checkReportStatus(session) {
  try {
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const yyyy = today.getFullYear();
    const dateStr = `${mm}/${dd}/${yyyy}`;

    const result = await apiGetHRDailyReports({ hrName: session.name, date: dateStr });
    const banner = document.getElementById('alertBanner');

    if (result.success && result.data && result.data.length > 0) {
      banner.className = 'alert-banner success';
      banner.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Daily report submitted today. Great job!';
      banner.style.display = 'flex';
    } else {
      banner.className = 'alert-banner warning';
      banner.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> You haven\'t submitted today\'s daily report yet. <a href="hr-daily-report.html" style="color:#eab308;font-weight:700;margin-left:0.25rem;">Submit now</a>';
      banner.style.display = 'flex';
    }
  } catch (err) {
    // ignore
  }
}

function renderTodayOverview(summaryRes, taskRes, recRes, leaveRes, campaignRes) {
  const container = document.getElementById('todayOverview');
  const items = [];

  if (summaryRes.status === 'fulfilled' && summaryRes.value.success) {
    const s = summaryRes.value.data;
    items.push({ label: 'Total Employees', value: s.totalEmployees || 0 });
    items.push({ label: 'Onboarding', value: s.onboarding || 0 });
  }
  if (recRes.status === 'fulfilled' && recRes.value.success) {
    const r = recRes.value.data;
    items.push({ label: 'Active Candidates', value: r.total - (r.byStage['Complete'] || 0) });
  }
  if (taskRes.status === 'fulfilled' && taskRes.value.success) {
    const t = taskRes.value.data;
    items.push({ label: 'Tasks Completed', value: t.completed || 0 });
    items.push({ label: 'Tasks In Progress', value: t.inProgress || 0 });
  }
  if (leaveRes.status === 'fulfilled' && leaveRes.value.success) {
    const l = leaveRes.value.data;
    items.push({ label: 'Leave Requests', value: l.total || 0 });
    items.push({ label: 'Leave Pending Approval', value: l.pending || 0 });
  }
  if (campaignRes.status === 'fulfilled' && campaignRes.value.success) {
    const c = campaignRes.value.data;
    items.push({ label: 'Total Leads', value: c.totalLeads || 0 });
  }

  if (items.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted);">No data available</div>';
    return;
  }

  container.innerHTML = items.map(i =>
    '<div class="overview-item"><span class="overview-label">' + esc(i.label) + '</span><span class="overview-value">' + i.value + '</span></div>'
  ).join('');
}

function renderBirthdays(events) {
  const container = document.getElementById('birthdayList');
  if (!events || events.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted);font-size:0.82rem;">No upcoming birthdays or anniversaries in the next 30 days.</div>';
    return;
  }

  container.innerHTML = events.map(e => {
    const isToday = e.daysAway === 0;
    const badgeCls = isToday ? 'bday-today' : 'bday-soon';
    const badgeText = isToday ? 'Today!' : e.daysAway + ' day' + (e.daysAway !== 1 ? 's' : '');
    const bgColor = e.type === 'Birthday' ? 'rgba(236,72,153,0.15)' : 'rgba(59,130,246,0.15)';
    const fgColor = e.type === 'Birthday' ? '#ec4899' : '#3b82f6';
    const initials = e.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

    return '<div class="bday-item">' +
      '<div class="bday-avatar" style="background:' + bgColor + ';color:' + fgColor + ';">' + initials + '</div>' +
      '<div class="bday-info"><div class="bday-name">' + esc(e.name) + '</div>' +
      '<div class="bday-detail">' + esc(e.type) + (e.detail ? ' &middot; ' + esc(e.detail) : '') + ' &middot; ' + esc(e.date) + '</div></div>' +
      '<span class="bday-badge ' + badgeCls + '">' + badgeText + '</span>' +
      '</div>';
  }).join('');
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
