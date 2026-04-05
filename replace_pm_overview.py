new_func = '''function renderPMOverview() {
  const container = document.getElementById('pm-overview-content');
  if (!container) return;

  const tasks    = store.pmTasks    || [];
  const risks    = store.pmRisks    || [];
  const issues   = store.pmIssues   || [];
  const projects = store.projects   || [];
  const now      = new Date();

  // ── Task stats ──────────────────────────────────────────────
  const total      = tasks.length;
  const done       = tasks.filter(t => t.status === 'done').length;
  const inProgress = tasks.filter(t => t.status === 'inprogress').length;
  const todo       = tasks.filter(t => t.status === 'todo').length;
  const overdue    = tasks.filter(t => t.dueDate && new Date(t.dueDate) < now && t.status !== 'done').length;
  const pctDone    = total > 0 ? Math.round((done / total) * 100) : 0;

  // ── Budget stats ─────────────────────────────────────────────
  const totalBudget  = projects.reduce((s, p) => s + (parseFloat(p.budget || p.contract_value) || 0), 0);
  const totalSpent   = projects.reduce((s, p) => s + (parseFloat(p.spent) || 0), 0);
  const budgetUsed   = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

  // ── Risk stats ───────────────────────────────────────────────
  const activeRisks  = risks.filter(r => r.status !== 'mitigated' && r.status !== 'closed');
  const criticalR    = activeRisks.filter(r => (r.score || getRiskScore(r.impact, r.likelihood)) >= 9).length;
  const highR        = activeRisks.filter(r => { const s = r.score || getRiskScore(r.impact, r.likelihood); return s >= 6 && s < 9; }).length;
  const mediumR      = activeRisks.filter(r => { const s = r.score || getRiskScore(r.impact, r.likelihood); return s >= 4 && s < 6; }).length;

  // ── Health score ─────────────────────────────────────────────
  const scheduleHealth = total > 0 ? Math.max(0, Math.round(100 - (overdue / total) * 100)) : 100;
  const budgetHealth   = totalBudget > 0 ? Math.max(0, 100 - budgetUsed) : 100;
  const qualityHealth  = total > 0 ? Math.round(((done + tasks.filter(t=>t.status==='review').length) / total) * 100) : 100;
  const riskHealth     = Math.max(0, 100 - (criticalR * 20 + highR * 10 + mediumR * 5));
  const healthScore    = Math.round((scheduleHealth + budgetHealth + qualityHealth + riskHealth) / 4);
  const healthBadge    = healthScore >= 75 ? 'healthy' : healthScore >= 50 ? 'warning' : 'critical';
  const healthColor    = healthScore >= 75 ? '#10b981' : healthScore >= 50 ? '#f59e0b' : '#ef4444';

  // ── Activity feed ─────────────────────────────────────────────
  const recentActivity = (store.pmActivities || []).slice(-5).reverse();

  // ── Alerts ───────────────────────────────────────────────────
  const pmNotifs = [];
  tasks.forEach(t => {
    if (t.status === 'done' || !t.dueDate) return;
    const diff = Math.floor((now - new Date(t.dueDate)) / 86400000);
    if (diff > 0)       pmNotifs.push({ icon: '🚨', text: `"${t.title}" is ${diff}d overdue`, cls: 'critical' });
    else if (diff >= -1) pmNotifs.push({ icon: '⏰', text: `"${t.title}" due ${diff === 0 ? 'today' : 'tomorrow'}`, cls: 'warning' });
  });
  issues.filter(i => i.status === 'open' && (i.priority === 'critical' || i.priority === 'high')).forEach(i => {
    pmNotifs.push({ icon: '🔴', text: `${capitalize(i.priority)} issue: "${i.title}"`, cls: 'high' });
  });
  if (activeRisks.length > 0 && criticalR > 0) {
    pmNotifs.push({ icon: '⚠️', text: `${criticalR} critical risk${criticalR > 1 ? 's' : ''} require attention`, cls: 'warning' });
  }

  // ── AI Insights ───────────────────────────────────────────────
  const insights = [];
  if (overdue > 0) {
    insights.push({ icon: '📅', cls: 'schedule', title: 'Schedule Alert', text: `${overdue} task${overdue > 1 ? 's are' : ' is'} overdue. Review Tasks tab to reassign or update deadlines.` });
  } else if (total > 0) {
    insights.push({ icon: '📅', cls: 'schedule', title: 'On Schedule', text: `All ${total} tasks are within their deadlines. ${inProgress} currently in progress.` });
  }
  if (totalBudget > 0) {
    const budgetMsg = budgetUsed > 90 ? `Budget ${budgetUsed}% used — approaching limit. Review spend before adding costs.`
      : budgetUsed > 75 ? `Budget ${budgetUsed}% used. Monitor upcoming expenses closely.`
      : `Budget ${budgetUsed}% used across ${projects.length} project${projects.length !== 1 ? 's' : ''}. Spend is healthy.`;
    insights.push({ icon: '💰', cls: 'budget', title: 'Budget Forecast', text: budgetMsg });
  }
  if (activeRisks.length > 0) {
    insights.push({ icon: '⚠️', cls: 'risk', title: 'Risk Monitor', text: `${activeRisks.length} active risk${activeRisks.length > 1 ? 's' : ''}${criticalR > 0 ? ` including ${criticalR} critical` : ''}. Review Risks tab.` });
  }
  if (insights.length === 0) {
    insights.push({ icon: '🤖', cls: 'info', title: 'All Systems Good', text: 'No active alerts. Add projects and tasks to get AI-powered insights on schedule, budget, and risk.' });
  }

  const fmt$ = v => v >= 1000000 ? '$' + (v/1000000).toFixed(1) + 'M'
    : v >= 1000 ? '$' + (v/1000).toFixed(0) + 'K'
    : '$' + v.toFixed(0);

  // ── Empty state ───────────────────────────────────────────────
  if (projects.length === 0 && tasks.length === 0) {
    container.innerHTML = `
      <div class="pm-empty-state">
        <div class="pm-empty-icon">🪖</div>
        <h3>No Projects Yet</h3>
        <p>Add a project from the <strong>Projects</strong> tab and it will automatically appear here with tasks, schedule, and tracking.</p>
        <button class="btn btn-primary" onclick="navigateTo('projects')">➕ Add Your First Project</button>
      </div>`;
    return;
  }

  container.innerHTML = `
    <!-- KPI Strip -->
    <div class="pm-kpi-strip">
      <div class="pm-kpi-card">
        <div class="pm-kpi-icon" style="color:${healthColor}">🪖</div>
        <div class="pm-kpi-value" style="color:${healthColor}">${healthScore}%</div>
        <div class="pm-kpi-label">Project Health</div>
        <div class="pm-kpi-badge ${healthBadge}">${healthScore >= 75 ? 'On Track' : healthScore >= 50 ? 'At Risk' : 'Critical'}</div>
      </div>
      <div class="pm-kpi-card">
        <div class="pm-kpi-icon">✅</div>
        <div class="pm-kpi-value">${done}<span class="pm-kpi-sub">/${total}</span></div>
        <div class="pm-kpi-label">Tasks Done</div>
        <div class="pm-kpi-progress"><div style="width:${pctDone}%;background:#10b981"></div></div>
      </div>
      <div class="pm-kpi-card ${inProgress > 0 ? 'active' : ''}">
        <div class="pm-kpi-icon">🔨</div>
        <div class="pm-kpi-value">${inProgress}</div>
        <div class="pm-kpi-label">In Progress</div>
        <div class="pm-kpi-progress"><div style="width:${total > 0 ? Math.round(inProgress/total*100) : 0}%;background:#2563eb"></div></div>
      </div>
      <div class="pm-kpi-card ${overdue > 0 ? 'danger' : ''}">
        <div class="pm-kpi-icon">${overdue > 0 ? '🚨' : '📅'}</div>
        <div class="pm-kpi-value" style="${overdue > 0 ? 'color:#ef4444' : ''}">${overdue}</div>
        <div class="pm-kpi-label">Overdue</div>
        ${overdue > 0 ? '<div class="pm-kpi-badge critical">Needs Attention</div>' : '<div class="pm-kpi-badge healthy">All Good</div>'}
      </div>
      <div class="pm-kpi-card">
        <div class="pm-kpi-icon">💰</div>
        <div class="pm-kpi-value">${totalBudget > 0 ? budgetUsed + '%' : '—'}</div>
        <div class="pm-kpi-label">Budget Used</div>
        ${totalBudget > 0 ? `<div class="pm-kpi-progress"><div style="width:${Math.min(budgetUsed,100)}%;background:${budgetUsed > 90 ? '#ef4444' : budgetUsed > 75 ? '#f59e0b' : '#10b981'}"></div></div>` : '<div class="pm-kpi-badge healthy">Not Set</div>'}
      </div>
      <div class="pm-kpi-card ${activeRisks.length > 0 ? (criticalR > 0 ? 'danger' : 'warn') : ''}">
        <div class="pm-kpi-icon">${criticalR > 0 ? '🔴' : activeRisks.length > 0 ? '⚠️' : '🛡️'}</div>
        <div class="pm-kpi-value" style="${criticalR > 0 ? 'color:#ef4444' : ''}">${activeRisks.length}</div>
        <div class="pm-kpi-label">Active Risks</div>
        ${criticalR > 0 ? `<div class="pm-kpi-badge critical">${criticalR} Critical</div>` : `<div class="pm-kpi-badge ${activeRisks.length === 0 ? 'healthy' : 'warning'}">${activeRisks.length === 0 ? 'Clear' : highR + ' High'}</div>`}
      </div>
    </div>

    <!-- Projects + Alerts row -->
    <div class="pm-overview-row">
      <!-- Active Projects -->
      <div class="pm-widget pm-projects-widget">
        <div class="pm-widget-header">
          <h3>🏗️ Active Projects</h3>
          <button class="btn btn-sm btn-outline" onclick="navigateTo('projects')">Manage</button>
        </div>
        ${projects.length > 0 ? `
        <div class="pm-projects-list">
          ${projects.slice(0, 5).map(p => {
            const pTasks = tasks.filter(t => String(t.projectId) === String(p.id));
            const pDone  = pTasks.filter(t => t.status === 'done').length;
            const pTotal = pTasks.length;
            const pPct   = pTotal > 0 ? Math.round((pDone / pTotal) * 100) : 0;
            const pBudget = parseFloat(p.budget || p.contract_value) || 0;
            const statusCls = p.status === 'completed' ? 'done' : p.status === 'active' ? 'inprogress' : 'todo';
            return `
            <div class="pm-project-row" onclick="navigateTo('projects')" style="cursor:pointer">
              <div class="pm-project-info">
                <span class="pm-project-name">${p.name || 'Untitled Project'}</span>
                <span class="pm-project-client">${p.client_name || ''}</span>
              </div>
              <div class="pm-project-progress">
                <div class="pm-proj-bar-row">
                  <span class="pm-proj-tasks">${pDone}/${pTotal} tasks</span>
                  <span class="pm-proj-pct">${pPct}%</span>
                </div>
                <div class="pm-proj-bar-bg">
                  <div class="pm-proj-bar-fill" style="width:${pPct}%;background:${pPct >= 75 ? '#10b981' : '#2563eb'}"></div>
                </div>
              </div>
              <div class="pm-project-meta">
                ${pBudget > 0 ? `<span class="pm-project-budget">${fmt$(pBudget)}</span>` : ''}
                <span class="status-badge ${statusCls}">${capitalize(p.status || 'active')}</span>
              </div>
            </div>`;
          }).join('')}
        </div>` : `<div class="pm-empty-mini"><p>No projects yet. <button class="btn btn-sm btn-primary" onclick="navigateTo('projects')">Add Project</button></p></div>`}
      </div>

      <!-- Alerts column -->
      <div class="pm-widget pm-alerts-widget">
        <div class="pm-widget-header">
          <h3>🔔 Alerts</h3>
          ${pmNotifs.length > 0 ? `<span class="notification-badge">${pmNotifs.length}</span>` : ''}
        </div>
        <div class="notification-list">
          ${pmNotifs.length > 0
            ? pmNotifs.slice(0, 6).map(n => `
              <div class="notification-item ${n.cls}">
                <span class="notif-icon">${n.icon}</span>
                <div class="notif-text">${n.text}</div>
              </div>`).join('')
            : `<div class="pm-empty-mini"><p>✅ No active alerts. All tasks and issues are on track.</p></div>`}
        </div>
        ${recentActivity.length > 0 ? `
        <div class="pm-widget-header" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
          <h3>📝 Recent Activity</h3>
        </div>
        <div class="activity-feed">
          ${recentActivity.slice(0, 3).map(a => `
            <div class="activity-item">
              <div class="activity-avatar">${a.initials || '?'}</div>
              <div class="activity-content">
                <div class="activity-text">${a.text || a.action || ''}</div>
                <div class="activity-time">${a.time || a.date || ''}</div>
              </div>
            </div>`).join('')}
        </div>` : ''}
      </div>
    </div>

    <!-- AI Insights -->
    <div class="pm-widget ai-insights-panel">
      <div class="pm-widget-header">
        <h3>🤖 AI Insights</h3>
        <span class="ai-badge">Foreman AI</span>
      </div>
      <div class="ai-insights-grid">
        ${insights.map(i => `
          <div class="ai-insight ${i.cls}">
            <div class="insight-icon">${i.icon}</div>
            <div class="insight-content">
              <div class="insight-title">${i.title}</div>
              <div class="insight-text">${i.text}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>
  `;
}

'''

with open('web/app.js', 'r') as f:
    content = f.read()

start_marker = "function renderPMOverview() {"
end_marker = "// Add tasks from project creation"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

new_content = content[:start_idx] + new_func + content[end_idx:]

with open('web/app.js', 'w') as f:
    f.write(new_content)

print(f"Done. Replaced {end_idx - start_idx} chars with {len(new_func)} chars")
print(f"New JS file size: {len(new_content)} chars")