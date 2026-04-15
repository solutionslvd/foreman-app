// ═══════════════════════════════════════════════════════════════════════════
// CRM MODULE v3.0 — Full Customer Relationship Management System
// ═══════════════════════════════════════════════════════════════════════════

// ── CRM Store Initialization ──────────────────────────────────────────────
function initCRMStore() {
  if (!store.crmContacts) store.crmContacts = [];
  if (!store.crmLeads) store.crmLeads = [];
  if (!store.crmDeals) store.crmDeals = [];
  if (!store.crmActivities) store.crmActivities = [];
  if (!store.crmFollowups) store.crmFollowups = [];
}

// ── CRM Init ─────────────────────────────────────────────────────────────
function initCRM() {
  initCRMStore();
  showCRMTab('pipeline');
  updateCRMKPIs();
}

function showCRMTab(tab) {
  document.querySelectorAll('.crm-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.crm-panel').forEach(p => p.classList.remove('active'));
  const tabEl = document.querySelector(`.crm-tab[data-tab="${tab}"]`);
  const panelEl = document.getElementById(`crm-panel-${tab}`);
  if (tabEl) tabEl.classList.add('active');
  if (panelEl) panelEl.classList.add('active');
  if (tab === 'pipeline') renderPipelineBoard();
  else if (tab === 'contacts') renderCRMContacts();
  else if (tab === 'deals') renderCRMDeals();
  else if (tab === 'activities') renderCRMActivities();
  else if (tab === 'analytics') renderCRMAnalytics();
}

// ── KPI Strip ─────────────────────────────────────────────────────────────
function updateCRMKPIs() {
  initCRMStore();
  const contacts = store.crmContacts || [];
  const leads = store.crmLeads || [];
  const deals = store.crmDeals || [];
  const followups = store.crmFollowups || [];

  const activeLeads = leads.filter(l => !['Won','Lost'].includes(l.stage)).length;
  const pipelineValue = leads.filter(l => !['Won','Lost'].includes(l.stage))
    .reduce((s, l) => s + (parseFloat(l.value) || 0), 0);
  const today = new Date().toISOString().slice(0,10);
  const wonThisMonth = leads.filter(l => {
    if (l.stage !== 'Won') return false;
    const d = (l.won_date || l.updated_at || '').slice(0,7);
    return d === today.slice(0,7);
  }).reduce((s,l) => s + (parseFloat(l.value)||0), 0);
  const followupsDue = followups.filter(f => f.date <= today && f.status !== 'done').length;
  const totalClosed = leads.filter(l => ['Won','Lost'].includes(l.stage)).length;
  const wonCount = leads.filter(l => l.stage === 'Won').length;
  const winRate = totalClosed > 0 ? Math.round((wonCount / totalClosed) * 100) : 0;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('crm-kpi-contacts', contacts.length);
  set('crm-kpi-leads', activeLeads);
  set('crm-kpi-pipeline', '$' + formatNum(pipelineValue));
  set('crm-kpi-won', '$' + formatNum(wonThisMonth));
  set('crm-kpi-followups', followupsDue);
  set('crm-kpi-winrate', winRate + '%');
}

function formatNum(n) {
  if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n/1000).toFixed(1) + 'K';
  return n.toLocaleString('en-CA');
}

// ════════════════════════════════════════════════════════════════════════════
// PIPELINE (KANBAN)
// ════════════════════════════════════════════════════════════════════════════

const PIPELINE_STAGES = ['New','Contacted','Qualified','Quote Sent','Negotiation','Won','Lost'];

const STAGE_COLORS = {
  'New': '#6366f1', 'Contacted': '#3b82f6', 'Qualified': '#f59e0b',
  'Quote Sent': '#8b5cf6', 'Negotiation': '#f97316', 'Won': '#22c55e', 'Lost': '#ef4444'
};

function renderPipelineBoard() {
  initCRMStore();
  const board = document.getElementById('pipeline-board');
  if (!board) return;

  const leads = store.crmLeads || [];
  const filterStage = document.getElementById('pipeline-filter-stage')?.value || '';
  const filterSearch = (document.getElementById('pipeline-search')?.value || '').toLowerCase();

  const filtered = leads.filter(l => {
    if (filterStage && l.stage !== filterStage) return false;
    if (filterSearch) {
      const hay = (l.title + ' ' + (l.contact_name||'') + ' ' + (l.company||'')).toLowerCase();
      if (!hay.includes(filterSearch)) return false;
    }
    return true;
  });

  board.innerHTML = PIPELINE_STAGES.map(stage => {
    const stageLeads = filtered.filter(l => l.stage === stage);
    const stageValue = stageLeads.reduce((s,l) => s + (parseFloat(l.value)||0), 0);
    const color = STAGE_COLORS[stage] || '#6b7280';
    return `
    <div class="pipeline-stage" data-stage="${stage}">
      <div class="pipeline-stage-header" style="border-top:3px solid ${color}">
        <div class="pipeline-stage-title">
          <span class="pipeline-stage-name">${stage}</span>
          <span class="pipeline-stage-count">${stageLeads.length}</span>
        </div>
        <div class="pipeline-stage-value">$${formatNum(stageValue)}</div>
      </div>
      <div class="pipeline-drop-zone" id="drop-${stage}" 
           ondragover="event.preventDefault(); this.classList.add('drag-over')"
           ondragleave="this.classList.remove('drag-over')"
           ondrop="dropOnStage(event, '${stage}')">
        ${stageLeads.length === 0 ? `<div class="pipeline-empty">Drop leads here</div>` : ''}
        ${stageLeads.map(l => renderPipelineCard(l)).join('')}
      </div>
      <button class="pipeline-add-btn" onclick="openAddLeadModal('${stage}')">+ Add Lead</button>
    </div>`;
  }).join('');

  // Re-attach drag events
  board.querySelectorAll('.pipeline-card').forEach(card => {
    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('leadId', card.dataset.leadId);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', e => {
      card.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
  });
}

function renderPipelineCard(lead) {
  const priorityColors = { High:'#ef4444', Medium:'#f59e0b', Low:'#22c55e' };
  const pColor = priorityColors[lead.priority] || '#6b7280';
  const closeDate = lead.close_date ? new Date(lead.close_date).toLocaleDateString('en-CA',{month:'short',day:'numeric'}) : '';
  const daysUntilClose = lead.close_date ? Math.ceil((new Date(lead.close_date) - new Date()) / 86400000) : null;
  const overdue = daysUntilClose !== null && daysUntilClose < 0;
  return `
  <div class="pipeline-card" draggable="true" data-lead-id="${lead.id}"
       onclick="openLeadDetail('${lead.id}')">
    <div class="pipeline-card-header">
      <div class="pipeline-card-title">${escHtml(lead.title)}</div>
      <span class="pipeline-priority-dot" style="background:${pColor}" title="${lead.priority||'Medium'} priority"></span>
    </div>
    ${lead.company ? `<div class="pipeline-card-company">🏢 ${escHtml(lead.company)}</div>` : ''}
    ${lead.contact_name ? `<div class="pipeline-card-contact">👤 ${escHtml(lead.contact_name)}</div>` : ''}
    <div class="pipeline-card-footer">
      <span class="pipeline-card-value">$${formatNum(parseFloat(lead.value)||0)}</span>
      ${closeDate ? `<span class="pipeline-card-date ${overdue?'overdue':''}" title="Close date">${overdue?'⚠️ ':''}${closeDate}</span>` : ''}
    </div>
    ${lead.probability ? `<div class="pipeline-progress"><div class="pipeline-progress-bar" style="width:${lead.probability}%"></div></div>` : ''}
  </div>`;
}

function dropOnStage(event, newStage) {
  event.preventDefault();
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  const leadId = event.dataTransfer.getData('leadId');
  if (!leadId) return;
  const lead = (store.crmLeads || []).find(l => l.id === leadId);
  if (!lead) return;
  const oldStage = lead.stage;
  lead.stage = newStage;
  lead.updated_at = new Date().toISOString();
  if (newStage === 'Won') lead.won_date = new Date().toISOString();
  saveStore();
  renderPipelineBoard();
  updateCRMKPIs();
  if (oldStage !== newStage) {
    // Log stage change activity
    logAutoActivity({ type: 'note', lead_id: leadId, subject: `Stage changed: ${oldStage} → ${newStage}`, notes: '' });
    showToast(`Lead moved to ${newStage}`, 'success');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CONTACTS
// ════════════════════════════════════════════════════════════════════════════

function renderCRMContacts() {
  initCRMStore();
  const contacts = store.crmContacts || [];
  const search = (document.getElementById('contacts-search')?.value || '').toLowerCase();
  const typeFilter = document.getElementById('contacts-type-filter')?.value || '';

  const filtered = contacts.filter(c => {
    if (typeFilter && c.type !== typeFilter) return false;
    if (search) {
      const hay = `${c.first_name} ${c.last_name} ${c.company||''} ${c.email||''} ${c.phone||''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const grid = document.getElementById('contacts-grid');
  if (!grid) return;

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="crm-empty-state" style="grid-column:1/-1">
      <div style="font-size:3rem">👥</div>
      <h3>No Contacts Yet</h3>
      <p>Add your first contact to start building your network</p>
      <button class="btn btn-primary" onclick="openAddContactModal()">+ Add Contact</button>
    </div>`;
    return;
  }

  grid.innerHTML = filtered.map(c => renderContactCard(c)).join('');
}

function renderContactCard(c) {
  const initials = ((c.first_name||'?')[0] + (c.last_name||'?')[0]).toUpperCase();
  const typeClass = (c.type||'lead').toLowerCase().replace(' ','-');
  const activities = (store.crmActivities||[]).filter(a => a.contact_id === c.id).length;
  const leads = (store.crmLeads||[]).filter(l => l.contact_id === c.id).length;
  return `
  <div class="contact-card" onclick="openContactDetail('${c.id}')">
    <div class="contact-card-header">
      <div class="contact-avatar">${initials}</div>
      <div class="contact-card-info">
        <div class="contact-card-name">${escHtml(c.first_name)} ${escHtml(c.last_name)}</div>
        <div class="contact-card-company">${escHtml(c.company||'—')}</div>
      </div>
      <div class="contact-card-actions" onclick="event.stopPropagation()">
        <button class="icon-btn" onclick="editCRMContact('${c.id}')" title="Edit">✏️</button>
        <button class="icon-btn" onclick="deleteCRMContact('${c.id}')" title="Delete">🗑️</button>
      </div>
    </div>
    <div class="contact-tags">
      <span class="contact-tag ${typeClass}">${c.type||'Lead'}</span>
      ${c.temperature ? `<span class="contact-tag ${c.temperature.toLowerCase()}">${c.temperature}</span>` : ''}
    </div>
    ${c.email ? `<div class="contact-detail-row">📧 <a href="mailto:${c.email}" onclick="event.stopPropagation()">${escHtml(c.email)}</a></div>` : ''}
    ${c.phone ? `<div class="contact-detail-row">📞 <a href="tel:${c.phone}" onclick="event.stopPropagation()">${escHtml(c.phone)}</a></div>` : ''}
    ${c.location ? `<div class="contact-detail-row">📍 ${escHtml(c.location)}</div>` : ''}
    <div class="contact-card-footer">
      <span>📝 ${leads} lead${leads!==1?'s':''}</span>
      <span>🎯 ${activities} activit${activities!==1?'ies':'y'}</span>
      <span class="contact-date">${c.created_at ? new Date(c.created_at).toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'}) : ''}</span>
    </div>
  </div>`;
}

// ── Contact CRUD ──────────────────────────────────────────────────────────
function openAddContactModal(preType) {
  initCRMStore();
  crmCurrentEditContactId = null;
  const form = document.getElementById('crm-contact-form');
  if (form) form.reset();
  if (preType) { const t = document.getElementById('contact-type'); if(t) t.value = preType; }
  document.getElementById('crm-contact-modal-title').textContent = 'Add Contact';
  openModal('crm-contact-modal');
}

function editCRMContact(contactId) {
  initCRMStore();
  const c = (store.crmContacts||[]).find(c => c.id === contactId);
  if (!c) return;
  crmCurrentEditContactId = contactId;
  document.getElementById('crm-contact-modal-title').textContent = 'Edit Contact';
  setField('contact-first-name', c.first_name);
  setField('contact-last-name', c.last_name);
  setField('contact-company', c.company);
  setField('contact-type', c.type);
  setField('contact-email', c.email);
  setField('contact-phone', c.phone);
  setField('contact-location', c.location);
  setField('contact-temperature', c.temperature);
  setField('contact-source', c.source);
  setField('contact-owner', c.owner);
  setField('contact-address', c.address);
  setField('contact-notes', c.notes);
  openModal('crm-contact-modal');
}

function saveCRMContact() {
  initCRMStore();
  const firstName = document.getElementById('contact-first-name')?.value.trim();
  const lastName = document.getElementById('contact-last-name')?.value.trim();
  if (!firstName && !lastName) { showToast('Name is required', 'error'); return; }

  const contactData = {
    first_name: firstName || '',
    last_name: lastName || '',
    company: getField('contact-company'),
    type: getField('contact-type') || 'Lead',
    email: getField('contact-email'),
    phone: getField('contact-phone'),
    location: getField('contact-location'),
    temperature: getField('contact-temperature') || 'Warm',
    source: getField('contact-source'),
    owner: getField('contact-owner'),
    address: getField('contact-address'),
    notes: getField('contact-notes'),
    updated_at: new Date().toISOString()
  };

  if (crmCurrentEditContactId) {
    const idx = store.crmContacts.findIndex(c => c.id === crmCurrentEditContactId);
    if (idx >= 0) {
      store.crmContacts[idx] = { ...store.crmContacts[idx], ...contactData };
      showToast('Contact updated', 'success');
    }
  } else {
    const newContact = { id: 'cnt_' + Date.now(), ...contactData, created_at: new Date().toISOString() };
    store.crmContacts.push(newContact);
    showToast('Contact added', 'success');
    logAutoActivity({ type: 'note', contact_id: newContact.id, subject: 'Contact created', notes: '' });
  }

  saveStore();
  closeModal('crm-contact-modal');
  renderCRMContacts();
  updateCRMKPIs();
  populateCRMContactDropdowns();
}

function deleteCRMContact(contactId) {
  if (!confirm('Delete this contact? All associated activities will also be removed.')) return;
  store.crmContacts = (store.crmContacts||[]).filter(c => c.id !== contactId);
  store.crmActivities = (store.crmActivities||[]).filter(a => a.contact_id !== contactId);
  store.crmFollowups = (store.crmFollowups||[]).filter(f => f.contact_id !== contactId);
  saveStore();
  renderCRMContacts();
  updateCRMKPIs();
  showToast('Contact deleted', 'info');
}

// ── Contact Detail View ───────────────────────────────────────────────────
function openContactDetail(contactId) {
  initCRMStore();
  const c = (store.crmContacts||[]).find(c => c.id === contactId);
  if (!c) return;
  crmCurrentContactId = contactId;

  const initials = ((c.first_name||'?')[0] + (c.last_name||'?')[0]).toUpperCase();
  const leads = (store.crmLeads||[]).filter(l => l.contact_id === contactId);
  const activities = (store.crmActivities||[]).filter(a => a.contact_id === contactId);
  const followups = (store.crmFollowups||[]).filter(f => f.contact_id === contactId);

  const modal = document.getElementById('crm-contact-detail-modal');
  if (!modal) return;

  const leadsValue = leads.filter(l => !['Won','Lost'].includes(l.stage)).reduce((s,l) => s + (parseFloat(l.value)||0), 0);

  modal.querySelector('#contact-detail-body').innerHTML = `
    <div class="contact-detail-header">
      <div class="contact-detail-avatar">${initials}</div>
      <div class="contact-detail-info">
        <h2>${escHtml(c.first_name)} ${escHtml(c.last_name)}</h2>
        <div class="contact-detail-meta">${escHtml(c.company||'')}${c.type?` · <span class="contact-tag ${c.type.toLowerCase()}">${c.type}</span>`:''}</div>
        ${c.temperature ? `<span class="contact-tag ${c.temperature.toLowerCase()}">${c.temperature}</span>` : ''}
      </div>
      <div class="contact-detail-actions">
        <button class="btn btn-primary" onclick="openLogActivityModal('${contactId}')">+ Log Activity</button>
        <button class="btn btn-secondary" onclick="openScheduleFollowupModal('${contactId}')">📅 Follow-up</button>
        <button class="btn btn-secondary" onclick="openAddLeadModal(null, '${contactId}')">+ Add Lead</button>
      </div>
    </div>

    <div class="contact-detail-grid">
      <div class="contact-info-section">
        <h4>Contact Info</h4>
        <div class="contact-info-rows">
          ${c.email ? `<div class="contact-info-row"><span>📧 Email</span><a href="mailto:${c.email}">${escHtml(c.email)}</a></div>` : ''}
          ${c.phone ? `<div class="contact-info-row"><span>📞 Phone</span><a href="tel:${c.phone}">${escHtml(c.phone)}</a></div>` : ''}
          ${c.location ? `<div class="contact-info-row"><span>📍 Location</span><span>${escHtml(c.location)}</span></div>` : ''}
          ${c.source ? `<div class="contact-info-row"><span>🔗 Source</span><span>${escHtml(c.source)}</span></div>` : ''}
          ${c.owner ? `<div class="contact-info-row"><span>👤 Owner</span><span>${escHtml(c.owner)}</span></div>` : ''}
          ${c.address ? `<div class="contact-info-row"><span>🏠 Address</span><span>${escHtml(c.address)}</span></div>` : ''}
        </div>
        ${c.notes ? `<div class="contact-notes-box"><h5>Notes</h5><p>${escHtml(c.notes)}</p></div>` : ''}
      </div>

      <div class="contact-stats-section">
        <div class="contact-stat-cards">
          <div class="contact-stat-card"><div class="contact-stat-num">${leads.length}</div><div class="contact-stat-label">Leads</div></div>
          <div class="contact-stat-card"><div class="contact-stat-num">$${formatNum(leadsValue)}</div><div class="contact-stat-label">Pipeline</div></div>
          <div class="contact-stat-card"><div class="contact-stat-num">${activities.length}</div><div class="contact-stat-label">Activities</div></div>
          <div class="contact-stat-card"><div class="contact-stat-num">${followups.filter(f=>f.status!=='done').length}</div><div class="contact-stat-label">Follow-ups Due</div></div>
        </div>
      </div>
    </div>

    ${leads.length > 0 ? `
    <div class="contact-section-block">
      <h4>Leads & Opportunities</h4>
      <div class="contact-leads-list">
        ${leads.map(l => `
          <div class="contact-lead-row" onclick="openLeadDetail('${l.id}')">
            <div class="contact-lead-title">${escHtml(l.title)}</div>
            <span class="pipeline-stage-badge" style="background:${STAGE_COLORS[l.stage]||'#6b7280'}">${l.stage}</span>
            <div class="contact-lead-value">$${formatNum(parseFloat(l.value)||0)}</div>
          </div>`).join('')}
      </div>
    </div>` : ''}

    ${activities.length > 0 ? `
    <div class="contact-section-block">
      <h4>Activity History</h4>
      <div class="activity-feed">
        ${activities.slice().reverse().slice(0,10).map(a => renderActivityItem(a)).join('')}
      </div>
    </div>` : ''}

    ${followups.filter(f=>f.status!=='done').length > 0 ? `
    <div class="contact-section-block">
      <h4>Upcoming Follow-ups</h4>
      ${followups.filter(f=>f.status!=='done').map(f => `
        <div class="followup-row">
          <span class="followup-type">${f.type||'Call'}</span>
          <span>${escHtml(f.note||'')}</span>
          <span class="followup-date">${f.date||''} ${f.time||''}</span>
          <button class="btn btn-sm btn-success" onclick="completeCRMFollowup('${f.id}')">Done</button>
        </div>`).join('')}
    </div>` : ''}
  `;

  openModal('crm-contact-detail-modal');
}

// ════════════════════════════════════════════════════════════════════════════
// LEADS / PIPELINE CRUD
// ════════════════════════════════════════════════════════════════════════════

function openAddLeadModal(stage, contactId) {
  initCRMStore();
  crmCurrentEditLeadId = null;
  const form = document.getElementById('crm-lead-form');
  if (form) form.reset();
  if (stage) { const s = document.getElementById('lead-stage'); if(s) s.value = stage; }
  if (contactId) { const c = document.getElementById('lead-contact'); if(c) c.value = contactId; }
  document.getElementById('crm-lead-modal-title').textContent = 'Add Lead';
  populateCRMContactDropdowns();
  openModal('crm-lead-modal');
}

function editCRMLead(leadId) {
  initCRMStore();
  const l = (store.crmLeads||[]).find(l => l.id === leadId);
  if (!l) return;
  crmCurrentEditLeadId = leadId;
  document.getElementById('crm-lead-modal-title').textContent = 'Edit Lead';
  setField('lead-title', l.title);
  setField('lead-contact', l.contact_id);
  setField('lead-stage', l.stage);
  setField('lead-value', l.value);
  setField('lead-priority', l.priority);
  setField('lead-close-date', l.close_date);
  setField('lead-trade', l.trade);
  setField('lead-probability', l.probability);
  setField('lead-address', l.address);
  setField('lead-description', l.description);
  populateCRMContactDropdowns();
  openModal('crm-lead-modal');
}

function saveCRMLead() {
  initCRMStore();
  const title = document.getElementById('lead-title')?.value.trim();
  if (!title) { showToast('Lead title is required', 'error'); return; }

  const contactId = getField('lead-contact');
  const contact = (store.crmContacts||[]).find(c => c.id === contactId);

  const leadData = {
    title,
    contact_id: contactId,
    contact_name: contact ? `${contact.first_name} ${contact.last_name}` : '',
    company: contact?.company || '',
    stage: getField('lead-stage') || 'New',
    value: parseFloat(getField('lead-value')) || 0,
    priority: getField('lead-priority') || 'Medium',
    close_date: getField('lead-close-date'),
    trade: getField('lead-trade'),
    probability: parseInt(getField('lead-probability')) || 50,
    address: getField('lead-address'),
    description: getField('lead-description'),
    updated_at: new Date().toISOString()
  };

  if (crmCurrentEditLeadId) {
    const idx = store.crmLeads.findIndex(l => l.id === crmCurrentEditLeadId);
    if (idx >= 0) { store.crmLeads[idx] = { ...store.crmLeads[idx], ...leadData }; }
    showToast('Lead updated', 'success');
  } else {
    const newLead = { id: 'lead_' + Date.now(), ...leadData, created_at: new Date().toISOString() };
    store.crmLeads.push(newLead);
    logAutoActivity({ type: 'note', lead_id: newLead.id, contact_id: contactId, subject: 'Lead created', notes: '' });
    showToast('Lead added', 'success');
  }

  saveStore();
  closeModal('crm-lead-modal');
  renderPipelineBoard();
  updateCRMKPIs();
}

function deleteCRMLead(leadId) {
  if (!confirm('Delete this lead?')) return;
  store.crmLeads = (store.crmLeads||[]).filter(l => l.id !== leadId);
  store.crmActivities = (store.crmActivities||[]).filter(a => a.lead_id !== leadId);
  saveStore();
  renderPipelineBoard();
  updateCRMKPIs();
  showToast('Lead deleted', 'info');
}

function openLeadDetail(leadId) {
  initCRMStore();
  const l = (store.crmLeads||[]).find(l => l.id === leadId);
  if (!l) return;
  const c = (store.crmContacts||[]).find(c => c.id === l.contact_id);
  const activities = (store.crmActivities||[]).filter(a => a.lead_id === leadId);

  const details = [
    ['Stage', `<span style="background:${STAGE_COLORS[l.stage]||'#6b7280'};color:#fff;padding:2px 8px;border-radius:4px">${l.stage}</span>`],
    ['Value', '$' + formatNum(parseFloat(l.value)||0)],
    ['Priority', l.priority || 'Medium'],
    ['Close Date', l.close_date || '—'],
    ['Probability', (l.probability||50) + '%'],
    ['Trade', l.trade || '—'],
    ['Address', l.address || '—'],
    ['Contact', c ? `${c.first_name} ${c.last_name}` : '—'],
    ['Company', l.company || '—'],
  ].map(([k,v]) => `<div class="contact-info-row"><span>${k}</span><span>${v}</span></div>`).join('');

  const content = `
    <div class="lead-detail-header">
      <h2>${escHtml(l.title)}</h2>
      <div class="lead-detail-actions">
        <button class="btn btn-primary" onclick="editCRMLead('${l.id}'); closeModal('crm-contact-detail-modal')">✏️ Edit</button>
        <button class="btn btn-secondary" onclick="openLogActivityModal(null, '${l.id}')">+ Log Activity</button>
        <button class="btn btn-secondary" onclick="openScheduleFollowupModal(${c?`'${c.id}'`:'null'})">📅 Follow-up</button>
        ${l.stage !== 'Won' && l.stage !== 'Lost' ? `<button class="btn btn-success" onclick="markLeadWon('${l.id}')">🏆 Mark Won</button>` : ''}
        ${l.stage !== 'Lost' && l.stage !== 'Won' ? `<button class="btn btn-danger" onclick="markLeadLost('${l.id}')">❌ Mark Lost</button>` : ''}
      </div>
    </div>
    <div class="contact-info-rows">${details}</div>
    ${l.description ? `<div class="contact-notes-box"><h5>Description</h5><p>${escHtml(l.description)}</p></div>` : ''}
    ${activities.length > 0 ? `<h4 style="margin-top:1.5rem">Activity History</h4>
      <div class="activity-feed">${activities.slice().reverse().map(a => renderActivityItem(a)).join('')}</div>` : ''}
  `;

  const body = document.getElementById('contact-detail-body');
  if (body) body.innerHTML = content;
  openModal('crm-contact-detail-modal');
}

function markLeadWon(leadId) {
  const lead = (store.crmLeads||[]).find(l => l.id === leadId);
  if (!lead) return;
  lead.stage = 'Won';
  lead.won_date = new Date().toISOString();
  lead.updated_at = new Date().toISOString();
  saveStore();
  logAutoActivity({ type: 'note', lead_id: leadId, contact_id: lead.contact_id, subject: '🏆 Lead marked as Won', notes: '' });
  closeModal('crm-contact-detail-modal');
  renderPipelineBoard();
  updateCRMKPIs();
  showToast('🏆 Lead marked as Won!', 'success');
}

function markLeadLost(leadId) {
  const reason = prompt('Reason for losing this lead (optional):');
  const lead = (store.crmLeads||[]).find(l => l.id === leadId);
  if (!lead) return;
  lead.stage = 'Lost';
  lead.updated_at = new Date().toISOString();
  saveStore();
  logAutoActivity({ type: 'note', lead_id: leadId, contact_id: lead.contact_id, subject: '❌ Lead marked as Lost', notes: reason || '' });
  closeModal('crm-contact-detail-modal');
  renderPipelineBoard();
  updateCRMKPIs();
  showToast('Lead marked as Lost', 'info');
}

// ════════════════════════════════════════════════════════════════════════════
// DEALS
// ════════════════════════════════════════════════════════════════════════════

function renderCRMDeals() {
  initCRMStore();
  const deals = store.crmDeals || [];
  const search = (document.getElementById('deals-search')?.value || '').toLowerCase();
  const stageFilter = document.getElementById('deals-stage-filter')?.value || '';

  const filtered = deals.filter(d => {
    if (stageFilter && d.stage !== stageFilter) return false;
    if (search) {
      const hay = `${d.name} ${d.contact_name||''} ${d.project||''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const list = document.getElementById('deals-list');
  if (!list) return;

  if (filtered.length === 0) {
    list.innerHTML = `<div class="crm-empty-state">
      <div style="font-size:3rem">🤝</div>
      <h3>No Deals Yet</h3>
      <p>Track your deals and projects here</p>
      <button class="btn btn-primary" onclick="openAddDealModal()">+ Add Deal</button>
    </div>`;
    return;
  }

  list.innerHTML = `
    <div class="deals-table-wrap">
      <table class="crm-table">
        <thead>
          <tr>
            <th>Deal Name</th><th>Contact</th><th>Value</th><th>Stage</th>
            <th>Close Date</th><th>Probability</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(d => {
            const closeDate = d.close_date ? new Date(d.close_date).toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'}) : '—';
            const overdue = d.close_date && new Date(d.close_date) < new Date() && !['Won','Lost'].includes(d.stage);
            return `<tr class="${overdue?'overdue-row':''}">
              <td><strong>${escHtml(d.name)}</strong>${d.type?`<br><small>${escHtml(d.type)}</small>`:''}</td>
              <td>${escHtml(d.contact_name||'—')}</td>
              <td>$${formatNum(parseFloat(d.value)||0)}</td>
              <td><span class="pipeline-stage-badge" style="background:${STAGE_COLORS[d.stage]||'#6b7280'}">${d.stage}</span></td>
              <td class="${overdue?'text-danger':''}">${closeDate}</td>
              <td>
                <div class="deal-progress-wrap">
                  <div class="deal-progress-bar" style="width:${d.probability||50}%"></div>
                  <span>${d.probability||50}%</span>
                </div>
              </td>
              <td>
                <button class="btn btn-sm btn-outline" onclick="editCRMDeal('${d.id}')">✏️</button>
                <button class="btn btn-sm btn-outline" onclick="deleteCRMDeal('${d.id}')" style="color:#ef4444;border-color:#ef4444">🗑</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function openAddDealModal() {
  initCRMStore();
  crmCurrentEditDealId = null;
  const form = document.getElementById('crm-deal-form');
  if (form) form.reset();
  document.getElementById('crm-deal-modal-title').textContent = 'Add Deal';
  populateCRMContactDropdowns();
  openModal('crm-deal-modal');
}

function editCRMDeal(dealId) {
  initCRMStore();
  const d = (store.crmDeals||[]).find(d => d.id === dealId);
  if (!d) return;
  crmCurrentEditDealId = dealId;
  document.getElementById('crm-deal-modal-title').textContent = 'Edit Deal';
  setField('deal-name', d.name);
  setField('deal-contact', d.contact_id);
  setField('deal-value', d.value);
  setField('deal-stage', d.stage);
  setField('deal-close-date', d.close_date);
  setField('deal-probability', d.probability);
  setField('deal-project', d.project);
  setField('deal-type', d.type);
  setField('deal-notes', d.notes);
  populateCRMContactDropdowns();
  openModal('crm-deal-modal');
}

function saveCRMDeal() {
  initCRMStore();
  const name = document.getElementById('deal-name')?.value.trim();
  if (!name) { showToast('Deal name is required', 'error'); return; }

  const contactId = getField('deal-contact');
  const contact = (store.crmContacts||[]).find(c => c.id === contactId);

  const dealData = {
    name,
    contact_id: contactId,
    contact_name: contact ? `${contact.first_name} ${contact.last_name}` : '',
    value: parseFloat(getField('deal-value')) || 0,
    stage: getField('deal-stage') || 'New',
    close_date: getField('deal-close-date'),
    probability: parseInt(getField('deal-probability')) || 50,
    project: getField('deal-project'),
    type: getField('deal-type'),
    notes: getField('deal-notes'),
    updated_at: new Date().toISOString()
  };

  if (crmCurrentEditDealId) {
    const idx = store.crmDeals.findIndex(d => d.id === crmCurrentEditDealId);
    if (idx >= 0) store.crmDeals[idx] = { ...store.crmDeals[idx], ...dealData };
    showToast('Deal updated', 'success');
  } else {
    store.crmDeals.push({ id: 'deal_' + Date.now(), ...dealData, created_at: new Date().toISOString() });
    showToast('Deal added', 'success');
  }

  saveStore();
  closeModal('crm-deal-modal');
  renderCRMDeals();
  updateCRMKPIs();
}

function deleteCRMDeal(dealId) {
  if (!confirm('Delete this deal?')) return;
  store.crmDeals = (store.crmDeals||[]).filter(d => d.id !== dealId);
  saveStore();
  renderCRMDeals();
  showToast('Deal deleted', 'info');
}

// ════════════════════════════════════════════════════════════════════════════
// ACTIVITIES
// ════════════════════════════════════════════════════════════════════════════

const ACTIVITY_ICONS = { call:'📞', email:'📧', meeting:'🤝', note:'📝', quote:'💰', followup:'📅', stage_change:'🔄' };
const ACTIVITY_COLORS = { call:'#3b82f6', email:'#8b5cf6', meeting:'#22c55e', note:'#f59e0b', quote:'#ef4444', followup:'#06b6d4', stage_change:'#6b7280' };

function renderCRMActivities() {
  initCRMStore();
  const activities = store.crmActivities || [];
  const search = (document.getElementById('activities-search')?.value || '').toLowerCase();
  const typeFilter = document.getElementById('activities-type-filter')?.value || '';

  const filtered = activities.filter(a => {
    if (typeFilter && a.type !== typeFilter) return false;
    if (search) {
      const hay = `${a.subject||''} ${a.notes||''} ${a.contact_name||''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  }).slice().reverse();

  const feed = document.getElementById('activities-feed');
  if (!feed) return;

  if (filtered.length === 0) {
    feed.innerHTML = `<div class="crm-empty-state">
      <div style="font-size:3rem">🎯</div>
      <h3>No Activities Yet</h3>
      <p>Log calls, emails, meetings, and notes to track your interactions</p>
      <button class="btn btn-primary" onclick="openLogActivityModal()">+ Log Activity</button>
    </div>`;
    return;
  }

  feed.innerHTML = filtered.map(a => renderActivityItem(a, true)).join('');
}

function renderActivityItem(a, showDelete) {
  const icon = ACTIVITY_ICONS[a.type] || '📌';
  const color = ACTIVITY_COLORS[a.type] || '#6b7280';
  const timeStr = a.date ? new Date(a.date).toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'}) : '';
  const contact = a.contact_id ? (store.crmContacts||[]).find(c => c.id === a.contact_id) : null;
  const contactName = contact ? `${contact.first_name} ${contact.last_name}` : (a.contact_name || '');
  return `
  <div class="activity-item-crm">
    <div class="activity-dot" style="background:${color}">${icon}</div>
    <div class="activity-item-content">
      <div class="activity-item-header">
        <strong>${escHtml(a.subject||a.type)}</strong>
        <span class="activity-item-time">${timeStr}</span>
        ${showDelete ? `<button class="icon-btn-sm" onclick="deleteActivity('${a.id}')" title="Delete">🗑</button>` : ''}
      </div>
      ${contactName ? `<div class="activity-item-contact">👤 ${escHtml(contactName)}</div>` : ''}
      ${a.notes ? `<div class="activity-item-notes">${escHtml(a.notes)}</div>` : ''}
      ${a.outcome ? `<div class="activity-item-outcome">Outcome: ${escHtml(a.outcome)}</div>` : ''}
      ${a.duration ? `<div class="activity-item-duration">⏱ ${a.duration} min</div>` : ''}
    </div>
  </div>`;
}

function deleteActivity(activityId) {
  if (!confirm('Delete this activity?')) return;
  store.crmActivities = (store.crmActivities||[]).filter(a => a.id !== activityId);
  saveStore();
  renderCRMActivities();
  showToast('Activity deleted', 'info');
}

let selectedActivityType = 'call';

function openLogActivityModal(contactId, leadId) {
  initCRMStore();
  crmCurrentActivityContactId = contactId || null;
  crmCurrentActivityLeadId = leadId || null;
  const form = document.getElementById('crm-activity-form');
  if (form) form.reset();
  selectedActivityType = 'call';
  document.querySelectorAll('.activity-type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === 'call');
  });
  document.getElementById('activity-type-hidden').value = 'call';
  if (contactId) {
    const c = (store.crmContacts||[]).find(c => c.id === contactId);
    if (c) setField('activity-contact', contactId);
  }
  if (leadId) {
    const l = (store.crmLeads||[]).find(l => l.id === leadId);
    if (l) setField('activity-lead', leadId);
  }
  const dateField = document.getElementById('activity-date');
  if (dateField) dateField.value = new Date().toISOString().slice(0,16);
  populateCRMContactDropdowns();
  populateCRMLeadDropdowns();
  openModal('crm-activity-modal');
}

function selectActivityType(type) {
  selectedActivityType = type;
  document.querySelectorAll('.activity-type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === type);
  });
  const hidden = document.getElementById('activity-type-hidden');
  if (hidden) hidden.value = type;
}

function saveCRMActivity() {
  initCRMStore();
  const subject = document.getElementById('activity-subject')?.value.trim();
  const type = document.getElementById('activity-type-hidden')?.value || selectedActivityType;
  if (!subject) { showToast('Subject is required', 'error'); return; }

  const contactId = getField('activity-contact') || crmCurrentActivityContactId;
  const leadId = getField('activity-lead') || crmCurrentActivityLeadId;
  const contact = contactId ? (store.crmContacts||[]).find(c => c.id === contactId) : null;

  const activity = {
    id: 'act_' + Date.now(),
    type,
    subject,
    contact_id: contactId,
    contact_name: contact ? `${contact.first_name} ${contact.last_name}` : '',
    lead_id: leadId,
    notes: getField('activity-notes'),
    date: getField('activity-date') || new Date().toISOString(),
    duration: parseInt(getField('activity-duration')) || null,
    outcome: getField('activity-outcome'),
    created_at: new Date().toISOString()
  };

  store.crmActivities = store.crmActivities || [];
  store.crmActivities.push(activity);
  saveStore();
  closeModal('crm-activity-modal');
  renderCRMActivities();
  updateCRMKPIs();
  showToast('Activity logged', 'success');

  // Refresh contact detail if open
  if (crmCurrentContactId) openContactDetail(crmCurrentContactId);
}

function logAutoActivity(data) {
  store.crmActivities = store.crmActivities || [];
  store.crmActivities.push({
    id: 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
    type: data.type || 'note',
    subject: data.subject || '',
    contact_id: data.contact_id || null,
    lead_id: data.lead_id || null,
    notes: data.notes || '',
    date: new Date().toISOString(),
    created_at: new Date().toISOString(),
    auto: true
  });
  saveStore();
}

// ════════════════════════════════════════════════════════════════════════════
// FOLLOW-UPS
// ════════════════════════════════════════════════════════════════════════════

function openScheduleFollowupModal(contactId) {
  initCRMStore();
  const form = document.getElementById('crm-followup-form');
  if (form) form.reset();
  if (contactId) setField('followup-contact', contactId);
  const dateField = document.getElementById('followup-date');
  if (dateField) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    dateField.value = tomorrow.toISOString().slice(0,10);
  }
  populateCRMContactDropdowns();
  openModal('crm-followup-modal');
}

function saveCRMFollowup() {
  initCRMStore();
  const contactId = getField('followup-contact');
  const date = getField('followup-date');
  const type = getField('followup-type') || 'Call';
  if (!date) { showToast('Date is required', 'error'); return; }

  const contact = contactId ? (store.crmContacts||[]).find(c => c.id === contactId) : null;
  const followup = {
    id: 'fu_' + Date.now(),
    contact_id: contactId,
    contact_name: contact ? `${contact.first_name} ${contact.last_name}` : '',
    type,
    date,
    time: getField('followup-time'),
    note: getField('followup-note'),
    priority: getField('followup-priority') || 'Medium',
    status: 'pending',
    created_at: new Date().toISOString()
  };

  store.crmFollowups = store.crmFollowups || [];
  store.crmFollowups.push(followup);
  saveStore();
  closeModal('crm-followup-modal');
  updateCRMKPIs();
  showToast(`Follow-up scheduled for ${date}`, 'success');

  // Log as activity
  logAutoActivity({ type: 'followup', contact_id: contactId, subject: `Follow-up scheduled: ${type}`, notes: followup.note });
}

function completeCRMFollowup(followupId) {
  const fu = (store.crmFollowups||[]).find(f => f.id === followupId);
  if (!fu) return;
  fu.status = 'done';
  fu.completed_at = new Date().toISOString();
  saveStore();
  updateCRMKPIs();
  if (crmCurrentContactId) openContactDetail(crmCurrentContactId);
  showToast('Follow-up completed!', 'success');
  logAutoActivity({ type: 'followup', contact_id: fu.contact_id, subject: `Follow-up completed: ${fu.type}`, notes: fu.note });
}

// ════════════════════════════════════════════════════════════════════════════
// CRM ANALYTICS
// ════════════════════════════════════════════════════════════════════════════

function renderCRMAnalytics() {
  initCRMStore();
  const leads = store.crmLeads || [];
  const activities = store.crmActivities || [];
  const contacts = store.crmContacts || [];

  // Pipeline by stage
  renderBarChart('pipeline-stage-chart', PIPELINE_STAGES.map(s => ({
    label: s,
    value: leads.filter(l => l.stage === s).reduce((sum,l) => sum + (parseFloat(l.value)||0), 0),
    color: STAGE_COLORS[s]
  })));

  // Leads by source
  const sourceMap = {};
  contacts.forEach(c => { if (c.source) sourceMap[c.source] = (sourceMap[c.source]||0) + 1; });
  const sourceData = Object.entries(sourceMap).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([label,value]) => ({ label, value, color: '#6366f1' }));
  renderBarChart('leads-source-chart', sourceData.length > 0 ? sourceData : [{ label: 'No data', value: 0, color: '#e5e7eb' }]);

  // Activity breakdown
  const actTypeMap = {};
  activities.forEach(a => { if (a.type && !a.auto) actTypeMap[a.type] = (actTypeMap[a.type]||0) + 1; });
  const actColors = ACTIVITY_COLORS;
  const actData = Object.entries(actTypeMap).map(([label,value]) => ({ label: label.charAt(0).toUpperCase()+label.slice(1), value, color: actColors[label]||'#6b7280' }));
  renderBarChart('activity-type-chart', actData.length > 0 ? actData : [{ label: 'No data', value: 0, color: '#e5e7eb' }]);

  // Revenue forecast (by close month)
  const monthMap = {};
  leads.filter(l => l.close_date && !['Won','Lost'].includes(l.stage)).forEach(l => {
    const month = l.close_date.slice(0,7);
    monthMap[month] = (monthMap[month]||0) + (parseFloat(l.value)||0) * ((l.probability||50)/100);
  });
  const forecastData = Object.entries(monthMap).sort(([a],[b])=>a.localeCompare(b)).slice(0,6).map(([label,value]) => ({
    label: new Date(label+'-01').toLocaleDateString('en-CA',{month:'short',year:'2-digit'}),
    value: Math.round(value),
    color: '#22c55e'
  }));
  renderBarChart('revenue-forecast-chart', forecastData.length > 0 ? forecastData : [{ label: 'No data', value: 0, color: '#e5e7eb' }]);

  // Summary stats
  const totalLeads = leads.length;
  const wonLeads = leads.filter(l => l.stage === 'Won').length;
  const lostLeads = leads.filter(l => l.stage === 'Lost').length;
  const winRate = (totalLeads > 0) ? Math.round(wonLeads / (wonLeads + lostLeads || 1) * 100) : 0;
  const avgDeal = totalLeads > 0 ? Math.round(leads.reduce((s,l)=>s+(parseFloat(l.value)||0),0) / totalLeads) : 0;
  const totalRevenue = leads.filter(l => l.stage === 'Won').reduce((s,l)=>s+(parseFloat(l.value)||0), 0);

  const stats = document.getElementById('crm-analytics-stats');
  if (stats) {
    stats.innerHTML = `
      <div class="analytics-stat-row">
        <div class="analytics-stat"><div class="analytics-stat-num">${totalLeads}</div><div class="analytics-stat-label">Total Leads</div></div>
        <div class="analytics-stat"><div class="analytics-stat-num">${wonLeads}</div><div class="analytics-stat-label">Won</div></div>
        <div class="analytics-stat"><div class="analytics-stat-num">${lostLeads}</div><div class="analytics-stat-label">Lost</div></div>
        <div class="analytics-stat"><div class="analytics-stat-num">${winRate}%</div><div class="analytics-stat-label">Win Rate</div></div>
        <div class="analytics-stat"><div class="analytics-stat-num">$${formatNum(avgDeal)}</div><div class="analytics-stat-label">Avg Deal Size</div></div>
        <div class="analytics-stat"><div class="analytics-stat-num">$${formatNum(totalRevenue)}</div><div class="analytics-stat-label">Total Won Revenue</div></div>
        <div class="analytics-stat"><div class="analytics-stat-num">${activities.filter(a=>!a.auto).length}</div><div class="analytics-stat-label">Activities Logged</div></div>
        <div class="analytics-stat"><div class="analytics-stat-num">${contacts.length}</div><div class="analytics-stat-label">Contacts</div></div>
      </div>`;
  }
}

function renderBarChart(containerId, data) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!data || data.length === 0) { container.innerHTML = '<div class="crm-no-data">No data</div>'; return; }

  const maxVal = Math.max(...data.map(d => d.value), 1);
  container.innerHTML = `
    <div class="crm-bar-chart">
      ${data.map(d => `
        <div class="crm-bar-row">
          <div class="crm-bar-label" title="${d.label}">${d.label}</div>
          <div class="crm-bar-track">
            <div class="crm-bar-fill" style="width:${Math.max((d.value/maxVal)*100,2)}%;background:${d.color||'#6366f1'}"></div>
          </div>
          <div class="crm-bar-value">${typeof d.value === 'number' && d.value >= 100 ? '$'+formatNum(d.value) : d.value}</div>
        </div>`).join('')}
    </div>`;
}

// ════════════════════════════════════════════════════════════════════════════
// HELPER UTILITIES
// ════════════════════════════════════════════════════════════════════════════

function populateCRMContactDropdowns() {
  const contacts = store.crmContacts || [];
  const opts = `<option value="">-- No Contact --</option>` + contacts.map(c =>
    `<option value="${c.id}">${escHtml(c.first_name)} ${escHtml(c.last_name)}${c.company?' ('+escHtml(c.company)+')':''}</option>`
  ).join('');
  ['lead-contact','deal-contact','activity-contact','followup-contact'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { const val = el.value; el.innerHTML = opts; el.value = val; }
  });
}

function populateCRMLeadDropdowns() {
  const leads = store.crmLeads || [];
  const opts = `<option value="">-- No Lead --</option>` + leads.map(l =>
    `<option value="${l.id}">${escHtml(l.title)} [${l.stage}]</option>`
  ).join('');
  ['activity-lead'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { const val = el.value; el.innerHTML = opts; el.value = val; }
  });
}

function getField(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function setField(id, val) {
  const el = document.getElementById(id);
  if (el && val !== undefined && val !== null) el.value = val;
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/"/g,'"');
}

// CRM state variables
let crmCurrentEditContactId = null;
let crmCurrentEditLeadId = null;
let crmCurrentEditDealId = null;
let crmCurrentContactId = null;
let crmCurrentActivityContactId = null;
let crmCurrentActivityLeadId = null;

// Export CRM data
function exportCRMData() {
  initCRMStore();
  const data = {
    contacts: store.crmContacts || [],
    leads: store.crmLeads || [],
    deals: store.crmDeals || [],
    activities: store.crmActivities || [],
    followups: store.crmFollowups || [],
    exported_at: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `crm_export_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CRM data exported', 'success');
}

console.log('👥 CRM Module loaded');


// ═══════════════════════════════════════════════════════════════════════════
// THEME TOGGLE
// ═══════════════════════════════════════════════════════════════════════════

function toggleTheme() {
  const body = document.body;
  const isDark = body.classList.contains('dark-theme');
  if (isDark) {
    body.classList.remove('dark-theme');
    body.classList.add('light-theme');
    localStorage.setItem('foreman_theme', 'light');
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.textContent = '🌙';
  } else {
    body.classList.remove('light-theme');
    body.classList.add('dark-theme');
    localStorage.setItem('foreman_theme', 'dark');
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.textContent = '☀️';
  }
}

function initTheme() {
  const saved = localStorage.getItem('foreman_theme');
  const body = document.body;
  if (saved === 'light') {
    body.classList.remove('dark-theme');
    body.classList.add('light-theme');
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.textContent = '🌙';
  } else {
    body.classList.add('dark-theme');
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.textContent = '☀️';
  }
}

console.log('🌙 Theme toggle loaded');


// ═══════════════════════════════════════════════════════════════════════════
// INVOICE PREVIEW & PDF
// ═══════════════════════════════════════════════════════════════════════════

function previewInvoice() {
  const invNumEl = document.getElementById('inv-number');
  const invDateEl = document.getElementById('inv-date');
  const invDueEl = document.getElementById('inv-due');
  const invClientEl = document.getElementById('inv-client');
  const invClientAddrEl = document.getElementById('inv-client-addr');
  const invNotesEl = document.getElementById('inv-notes');
  const invTermsEl = document.getElementById('inv-terms');

  const invNumber = invNumEl?.value || 'INV-001';
  const invDate = invDateEl?.value || new Date().toISOString().slice(0,10);
  const invDue = invDueEl?.value || '';
  const clientName = invClientEl?.value || 'Client Name';
  const clientAddr = invClientAddrEl?.value || '';
  const notes = invNotesEl?.value || '';
  const terms = invTermsEl?.value || 'Net 30';

  // Gather line items from the invoice form
  const rows = document.querySelectorAll('#invoice-items-tbody tr');
  const items = [];
  rows.forEach(row => {
    const desc = row.querySelector('.inv-desc')?.value || row.querySelector('td:nth-child(1)')?.textContent || '';
    const qty = parseFloat(row.querySelector('.inv-qty')?.value || row.querySelector('td:nth-child(2)')?.textContent || 0);
    const rate = parseFloat(row.querySelector('.inv-rate')?.value || row.querySelector('td:nth-child(3)')?.textContent || 0);
    const amount = qty * rate;
    if (desc || qty || rate) items.push({ desc, qty, rate, amount });
  });

  const subtotal = items.reduce((s,i) => s + i.amount, 0);
  const taxRate = parseFloat(document.getElementById('inv-tax')?.value || 0) / 100;
  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  const profile = store.profile || {};
  const companyName = profile.company_name || profile.name || 'The Foreman AI';
  const companyAddr = profile.address || '';
  const companyPhone = profile.phone || '';
  const companyEmail = profile.email || '';

  const html = `
    <div class="invoice-preview-sheet">
      <div class="invoice-preview-header">
        <div class="invoice-company-block">
          <h1 class="invoice-company-name">${escHtml(companyName)}</h1>
          ${companyAddr ? `<div>${escHtml(companyAddr)}</div>` : ''}
          ${companyPhone ? `<div>${escHtml(companyPhone)}</div>` : ''}
          ${companyEmail ? `<div>${escHtml(companyEmail)}</div>` : ''}
        </div>
        <div class="invoice-meta-block">
          <h2 class="invoice-title">INVOICE</h2>
          <table class="invoice-meta-table">
            <tr><td>Invoice #</td><td><strong>${escHtml(invNumber)}</strong></td></tr>
            <tr><td>Date</td><td>${invDate}</td></tr>
            ${invDue ? `<tr><td>Due Date</td><td>${invDue}</td></tr>` : ''}
            <tr><td>Terms</td><td>${escHtml(terms)}</td></tr>
          </table>
        </div>
      </div>

      <div class="invoice-parties">
        <div class="invoice-bill-to">
          <h4>BILL TO</h4>
          <div class="invoice-client-name">${escHtml(clientName)}</div>
          ${clientAddr ? `<div class="invoice-client-addr">${escHtml(clientAddr).replace(/\n/g,'<br>')}</div>` : ''}
        </div>
      </div>

      <table class="invoice-items-table">
        <thead>
          <tr>
            <th class="inv-col-desc">Description</th>
            <th class="inv-col-qty">Qty</th>
            <th class="inv-col-rate">Rate</th>
            <th class="inv-col-amount">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${items.length > 0 ? items.map(item => `
            <tr>
              <td>${escHtml(item.desc)}</td>
              <td class="text-right">${item.qty}</td>
              <td class="text-right">$${item.rate.toFixed(2)}</td>
              <td class="text-right">$${item.amount.toFixed(2)}</td>
            </tr>`).join('') : `<tr><td colspan="4" class="text-center" style="color:#9ca3af;padding:2rem">No line items added</td></tr>`}
        </tbody>
        <tfoot>
          <tr class="invoice-subtotal-row"><td colspan="3">Subtotal</td><td class="text-right">$${subtotal.toFixed(2)}</td></tr>
          ${taxRate > 0 ? `<tr><td colspan="3">Tax (${(taxRate*100).toFixed(0)}%)</td><td class="text-right">$${tax.toFixed(2)}</td></tr>` : ''}
          <tr class="invoice-total-row"><td colspan="3"><strong>TOTAL</strong></td><td class="text-right"><strong>$${total.toFixed(2)}</strong></td></tr>
        </tfoot>
      </table>

      ${notes ? `<div class="invoice-notes"><strong>Notes:</strong> ${escHtml(notes)}</div>` : ''}
      <div class="invoice-footer">Thank you for your business!</div>
    </div>`;

  const preview = document.getElementById('invoice-preview-body');
  if (preview) preview.innerHTML = html;
  openModal('invoice-preview-modal');
}

function printInvoicePreview() {
  const body = document.getElementById('invoice-preview-body');
  if (!body) return;
  const printWin = window.open('', '_blank');
  printWin.document.write(`<!DOCTYPE html><html><head><title>Invoice</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #111; background: #fff; }
      .invoice-preview-sheet { max-width: 800px; margin: 0 auto; }
      .invoice-preview-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem; }
      .invoice-company-name { font-size: 1.5rem; font-weight: 700; margin: 0 0 0.5rem; color: #1e3a5f; }
      .invoice-title { font-size: 2rem; font-weight: 800; color: #1e3a5f; margin: 0; }
      .invoice-meta-table td { padding: 2px 8px; }
      .invoice-parties { margin-bottom: 1.5rem; }
      .invoice-bill-to h4 { color: #6b7280; font-size: 0.75rem; letter-spacing: 0.1em; margin: 0 0 0.25rem; }
      .invoice-client-name { font-size: 1.1rem; font-weight: 600; }
      .invoice-items-table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
      .invoice-items-table th { background: #1e3a5f; color: #fff; padding: 8px 12px; text-align: left; }
      .invoice-items-table td { padding: 8px 12px; border-bottom: 1px solid #e5e7eb; }
      .invoice-items-table tfoot td { border-top: 2px solid #e5e7eb; border-bottom: none; }
      .invoice-total-row td { font-size: 1.1rem; background: #f0f9ff; }
      .text-right { text-align: right; }
      .text-center { text-align: center; }
      .invoice-notes { background: #f9fafb; border-left: 4px solid #1e3a5f; padding: 0.75rem 1rem; margin-top: 1rem; }
      .invoice-footer { text-align: center; color: #6b7280; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; }
    </style>
  </head><body>${body.innerHTML}</body></html>`);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => { printWin.print(); }, 500);
}

console.log('📄 Invoice preview loaded');


// ═══════════════════════════════════════════════════════════════════════════
// HR: PAY STUBS, TD1, T4
// ═══════════════════════════════════════════════════════════════════════════

function generatePaystub(employeeIdxOrId) {
  const employees = store.payroll?.employees || [];
  let emp;
  if (typeof employeeIdxOrId === 'number') {
    emp = employees[employeeIdxOrId];
  } else {
    emp = employees.find(e => e.id === employeeIdxOrId) || employees[parseInt(employeeIdxOrId)];
  }
  if (!emp) { showToast('Employee not found', 'error'); return; }

  const payPeriodEnd = new Date().toISOString().slice(0, 10);
  const payPeriodStart = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const hourlyRate = parseFloat(emp.hourly_rate || emp.rate || 0);
  const hoursWorked = parseFloat(emp.hours_per_week || 80);
  const grossPay = hourlyRate * hoursWorked;

  // Canadian payroll deductions
  const cppRate = 0.0595;
  const eiRate = 0.01666;
  const federalExemption = 15705; // 2024
  const cppExemption = 3500;

  const annualGross = grossPay * 26; // bi-weekly
  const cppDeduction = Math.min(Math.max((grossPay - (cppExemption / 26)) * cppRate, 0), (grossPay * cppRate));
  const eiDeduction = Math.min(grossPay * eiRate, 1049.12 / 26);

  // Simplified federal tax (2024 rates)
  const annualTaxableIncome = Math.max(annualGross - federalExemption, 0);
  let federalTax = 0;
  if (annualTaxableIncome <= 55867) federalTax = annualTaxableIncome * 0.15;
  else if (annualTaxableIncome <= 111733) federalTax = 55867*0.15 + (annualTaxableIncome-55867)*0.205;
  else if (annualTaxableIncome <= 154906) federalTax = 55867*0.15 + 55866*0.205 + (annualTaxableIncome-111733)*0.26;
  else if (annualTaxableIncome <= 220000) federalTax = 55867*0.15 + 55866*0.205 + 43173*0.26 + (annualTaxableIncome-154906)*0.29;
  else federalTax = 55867*0.15 + 55866*0.205 + 43173*0.26 + 65094*0.29 + (annualTaxableIncome-220000)*0.33;

  const federalBasicCredit = 15705 * 0.15;
  const netFederal = Math.max((federalTax - federalBasicCredit) / 26, 0);

  // Provincial tax (Alberta 10% flat as default)
  const provincialRate = 0.10;
  const provincialExemption = 21003; // Alberta 2024
  const annualProvincial = Math.max(annualGross - provincialExemption, 0);
  const provincialTax = (annualProvincial * provincialRate) / 26;

  const totalDeductions = cppDeduction + eiDeduction + netFederal + provincialTax;
  const netPay = grossPay - totalDeductions;

  const profile = store.profile || {};
  const companyName = profile.company_name || profile.name || 'The Foreman AI';

  const html = `
    <div class="paystub-preview">
      <div class="paystub-header">
        <div class="paystub-company">
          <h2>${escHtml(companyName)}</h2>
          ${profile.address ? `<div>${escHtml(profile.address)}</div>` : ''}
        </div>
        <div class="paystub-period">
          <h3>Pay Stub</h3>
          <div>Pay Period: ${payPeriodStart} to ${payPeriodEnd}</div>
          <div>Pay Date: ${payPeriodEnd}</div>
        </div>
      </div>

      <div class="paystub-employee-info">
        <div><strong>Employee:</strong> ${escHtml(emp.name || emp.contact_name || 'N/A')}</div>
        <div><strong>Position:</strong> ${escHtml(emp.trade || emp.position || emp.role || 'Employee')}</div>
        <div><strong>Pay Type:</strong> Hourly</div>
        <div><strong>Rate:</strong> $${hourlyRate.toFixed(2)}/hr</div>
      </div>

      <div class="paystub-sections">
        <div class="paystub-section">
          <h4>Earnings</h4>
          <table class="paystub-table">
            <thead><tr><th>Description</th><th>Hours</th><th>Rate</th><th>Amount</th></tr></thead>
            <tbody>
              <tr><td>Regular Pay</td><td>${hoursWorked}</td><td>$${hourlyRate.toFixed(2)}</td><td>$${grossPay.toFixed(2)}</td></tr>
            </tbody>
          </table>
        </div>

        <div class="paystub-section">
          <h4>Deductions</h4>
          <table class="paystub-table">
            <thead><tr><th>Description</th><th>Amount</th></tr></thead>
            <tbody>
              <tr><td>CPP (5.95%)</td><td>$${cppDeduction.toFixed(2)}</td></tr>
              <tr><td>EI (1.66%)</td><td>$${eiDeduction.toFixed(2)}</td></tr>
              <tr><td>Federal Income Tax</td><td>$${netFederal.toFixed(2)}</td></tr>
              <tr><td>Provincial Income Tax</td><td>$${provincialTax.toFixed(2)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="paystub-totals">
        <div class="paystub-total-row"><span>Gross Pay</span><span>$${grossPay.toFixed(2)}</span></div>
        <div class="paystub-total-row deductions"><span>Total Deductions</span><span>- $${totalDeductions.toFixed(2)}</span></div>
        <div class="paystub-total-row net-pay"><span><strong>Net Pay</strong></span><span><strong>$${netPay.toFixed(2)}</strong></span></div>
      </div>

      <div class="paystub-ytd">
        <h4>Year-to-Date Summary</h4>
        <div class="paystub-ytd-grid">
          <div><span>YTD Gross</span><span>$${(grossPay * 12).toFixed(2)}</span></div>
          <div><span>YTD CPP</span><span>$${(cppDeduction * 12).toFixed(2)}</span></div>
          <div><span>YTD EI</span><span>$${(eiDeduction * 12).toFixed(2)}</span></div>
          <div><span>YTD Tax</span><span>$${((netFederal + provincialTax) * 12).toFixed(2)}</span></div>
          <div><span>YTD Net</span><span>$${(netPay * 12).toFixed(2)}</span></div>
        </div>
      </div>
    </div>`;

  const preview = document.getElementById('paystub-preview-body');
  if (preview) preview.innerHTML = html;
  openModal('paystub-modal');
}

function printPaystub() {
  const body = document.getElementById('paystub-preview-body');
  if (!body) return;
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Pay Stub</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #111; }
      .paystub-preview { max-width: 750px; margin: 0 auto; }
      .paystub-header { display: flex; justify-content: space-between; border-bottom: 2px solid #1e3a5f; padding-bottom: 1rem; margin-bottom: 1rem; }
      .paystub-header h2 { margin: 0; color: #1e3a5f; }
      .paystub-header h3 { margin: 0 0 0.5rem; color: #1e3a5f; font-size: 1.2rem; }
      .paystub-employee-info { display: grid; grid-template-columns: repeat(2,1fr); gap: 0.5rem; background: #f9fafb; padding: 1rem; border-radius: 6px; margin-bottom: 1.5rem; }
      .paystub-sections { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1rem; }
      .paystub-section h4 { color: #1e3a5f; margin: 0 0 0.5rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.25rem; }
      .paystub-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
      .paystub-table th { background: #1e3a5f; color: #fff; padding: 6px 8px; text-align: left; }
      .paystub-table td { padding: 4px 8px; border-bottom: 1px solid #f0f0f0; }
      .paystub-totals { border-top: 2px solid #1e3a5f; padding-top: 0.5rem; }
      .paystub-total-row { display: flex; justify-content: space-between; padding: 4px 8px; }
      .paystub-total-row.net-pay { background: #dbeafe; font-size: 1.1rem; font-weight: bold; border-radius: 4px; margin-top: 0.25rem; }
      .paystub-ytd { margin-top: 1.5rem; padding: 1rem; background: #f9fafb; border-radius: 6px; }
      .paystub-ytd h4 { margin: 0 0 0.75rem; color: #1e3a5f; }
      .paystub-ytd-grid { display: grid; grid-template-columns: repeat(5,1fr); gap: 0.5rem; }
      .paystub-ytd-grid div { display: flex; flex-direction: column; gap: 2px; font-size: 0.8rem; }
      @media print { body { padding: 0; } }
    </style>
  </head><body>${body.innerHTML}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

function generateTD1(employeeIdxOrId) {
  const employees = store.payroll?.employees || [];
  let emp;
  if (typeof employeeIdxOrId === 'number') {
    emp = employees[employeeIdxOrId];
  } else {
    emp = employees.find(e => e.id === employeeIdxOrId) || employees[parseInt(employeeIdxOrId)];
  }
  if (!emp) { showToast('Employee not found', 'error'); return; }

  const year = new Date().getFullYear();
  const profile = store.profile || {};
  const companyName = profile.company_name || profile.name || 'The Foreman AI';

  const html = `
    <div class="td1-form">
      <div class="td1-header">
        <div class="td1-gov-logo">🍁 Canada Revenue Agency</div>
        <div class="td1-form-id">
          <h2>TD1 ${year}</h2>
          <div>Personal Tax Credits Return</div>
        </div>
      </div>

      <div class="td1-employee-info">
        <div class="td1-info-row"><span>Employee:</span><strong>${escHtml(emp.name || emp.contact_name || '')}</strong></div>
        <div class="td1-info-row"><span>Employer:</span><strong>${escHtml(companyName)}</strong></div>
        <div class="td1-info-row"><span>Year:</span><strong>${year}</strong></div>
        <div class="td1-info-row"><span>Province:</span><strong>Alberta</strong></div>
      </div>

      <p class="td1-instruction">Complete this form so that your employer can determine how much federal income tax to deduct from your pay.</p>

      <div class="td1-section">
        <h4>Federal Tax Credits</h4>
        <table class="td1-table">
          <thead><tr><th>Line</th><th>Description</th><th>Claim Amount</th></tr></thead>
          <tbody>
            <tr><td>1</td><td>Basic personal amount (2024)</td><td class="td1-amount">$15,705.00</td></tr>
            <tr><td>2</td><td>Age amount (if 65+ years)</td><td class="td1-amount">$0.00</td></tr>
            <tr><td>3</td><td>Spouse or common-law partner amount</td><td class="td1-amount">$0.00</td></tr>
            <tr><td>4</td><td>Amount for eligible dependant</td><td class="td1-amount">$0.00</td></tr>
            <tr><td>5</td><td>Canada caregiver amount for infirm children under 18</td><td class="td1-amount">$0.00</td></tr>
            <tr><td>6</td><td>Amount for infirm dependants age 18 or older</td><td class="td1-amount">$0.00</td></tr>
            <tr><td>7</td><td>CPP or QPP contributions through employment</td><td class="td1-amount">$0.00</td></tr>
            <tr><td>8</td><td>CPP or QPP contributions on self-employment</td><td class="td1-amount">$0.00</td></tr>
            <tr><td>9</td><td>Employment insurance premiums</td><td class="td1-amount">$0.00</td></tr>
            <tr><td>10</td><td>Canada employment amount (up to $1,433)</td><td class="td1-amount">$1,433.00</td></tr>
            <tr><td>11</td><td>Home buyers' amount</td><td class="td1-amount">$0.00</td></tr>
            <tr><td>12</td><td>Home accessibility expenses</td><td class="td1-amount">$0.00</td></tr>
            <tr><td>13</td><td>Amounts transferred from your spouse or common-law partner</td><td class="td1-amount">$0.00</td></tr>
            <tr><td>14</td><td>Amounts transferred from a dependant</td><td class="td1-amount">$0.00</td></tr>
          </tbody>
          <tfoot>
            <tr class="td1-total-row"><td colspan="2"><strong>TOTAL CLAIM AMOUNT (Federal)</strong></td><td class="td1-amount"><strong>$17,138.00</strong></td></tr>
          </tfoot>
        </table>
      </div>

      <div class="td1-section" style="margin-top:1.5rem">
        <h4>Alberta Provincial Tax Credits (TD1AB)</h4>
        <table class="td1-table">
          <thead><tr><th>Line</th><th>Description</th><th>Claim Amount</th></tr></thead>
          <tbody>
            <tr><td>1</td><td>Basic personal amount (Alberta 2024)</td><td class="td1-amount">$21,003.00</td></tr>
            <tr><td>2</td><td>Age amount (if 65+ years)</td><td class="td1-amount">$0.00</td></tr>
            <tr><td>3</td><td>Spouse or common-law partner amount</td><td class="td1-amount">$0.00</td></tr>
            <tr><td>4</td><td>Amount for eligible dependant</td><td class="td1-amount">$0.00</td></tr>
          </tbody>
          <tfoot>
            <tr class="td1-total-row"><td colspan="2"><strong>TOTAL CLAIM AMOUNT (Provincial)</strong></td><td class="td1-amount"><strong>$21,003.00</strong></td></tr>
          </tfoot>
        </table>
      </div>

      <div class="td1-signature">
        <div class="td1-sig-line"><span>Employee Signature:</span><div class="td1-line"></div></div>
        <div class="td1-sig-line"><span>Date:</span><div class="td1-line"></div></div>
      </div>

      <div class="td1-footer">
        <p>This is a computer-generated TD1 form based on CRA guidelines. Employees should review and update as needed. For official CRA TD1 form, visit <strong>canada.ca/cra</strong></p>
      </div>
    </div>`;

  const preview = document.getElementById('td1-preview-body');
  if (preview) preview.innerHTML = html;
  openModal('td1-modal');
}

function printTD1() {
  const body = document.getElementById('td1-preview-body');
  if (!body) return;
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>TD1 Form</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; color: #111; }
      .td1-form { max-width: 750px; margin: 0 auto; }
      .td1-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #cc0000; padding-bottom: 1rem; margin-bottom: 1rem; }
      .td1-gov-logo { font-size: 1.2rem; font-weight: bold; color: #cc0000; }
      .td1-header h2 { margin: 0; font-size: 1.5rem; }
      .td1-employee-info { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; background: #f9fafb; padding: 0.75rem; border-radius: 4px; margin-bottom: 1rem; font-size: 0.9rem; }
      .td1-info-row { display: flex; gap: 0.5rem; }
      .td1-instruction { background: #fffbeb; border-left: 3px solid #f59e0b; padding: 0.5rem 1rem; margin-bottom: 1rem; font-size: 0.85rem; }
      .td1-section h4 { color: #cc0000; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.25rem; margin-bottom: 0.5rem; }
      .td1-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
      .td1-table th { background: #cc0000; color: #fff; padding: 6px 8px; text-align: left; }
      .td1-table td { padding: 5px 8px; border-bottom: 1px solid #f0f0f0; }
      .td1-amount { text-align: right; font-family: monospace; }
      .td1-total-row { background: #fff3f3; font-weight: bold; }
      .td1-signature { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-top: 2rem; }
      .td1-sig-line { display: flex; align-items: center; gap: 0.5rem; }
      .td1-line { flex: 1; border-bottom: 1px solid #000; height: 24px; }
      .td1-footer { margin-top: 1rem; font-size: 0.75rem; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 0.5rem; }
      @media print { body { margin: 0; } }
    </style>
  </head><body>${body.innerHTML}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

function generateT4(employeeIdxOrId) {
  const employees = store.payroll?.employees || [];
  let emp;
  if (typeof employeeIdxOrId === 'number') {
    emp = employees[employeeIdxOrId];
  } else {
    emp = employees.find(e => e.id === employeeIdxOrId) || employees[parseInt(employeeIdxOrId)];
  }
  if (!emp) { showToast('Employee not found', 'error'); return; }

  const year = new Date().getFullYear();
  const profile = store.profile || {};
  const companyName = profile.company_name || profile.name || 'The Foreman AI';
  const ein = profile.ein || profile.business_number || '123456789RP0001';

  // Calculate from payroll history or estimate
  const history = (store.payroll?.history || []).filter(h => {
    const empName = emp.name || emp.contact_name || '';
    return (h.employee_name === empName || h.employee_id === emp.id) && (h.date||'').startsWith(String(year));
  });

  const hourlyRate = parseFloat(emp.hourly_rate || emp.rate || 0);
  const annualGross = history.length > 0 ? history.reduce((s,h) => s + (parseFloat(h.gross||h.gross_pay)||0), 0) : hourlyRate * 80 * 26;
  const annualCPP = history.length > 0 ? history.reduce((s,h) => s + (parseFloat(h.cpp)||0), 0) : Math.min(annualGross * 0.0595, 3867.50);
  const annualEI = history.length > 0 ? history.reduce((s,h) => s + (parseFloat(h.ei)||0), 0) : Math.min(annualGross * 0.01666, 1049.12);
  const annualTax = history.length > 0 ? history.reduce((s,h) => s + (parseFloat(h.income_tax)||0), 0) : annualGross * 0.18;

  const html = `
    <div class="t4-slip">
      <div class="t4-header">
        <div class="t4-gov">🍁 Canada Revenue Agency / Agence du revenu du Canada</div>
        <h2>T4 Statement of Remuneration Paid — ${year}</h2>
      </div>

      <div class="t4-employer-box">
        <h4>Employer Information</h4>
        <div class="t4-info-grid">
          <div class="t4-box"><span class="t4-box-label">Employer Name</span><span>${escHtml(companyName)}</span></div>
          <div class="t4-box"><span class="t4-box-label">Business Number</span><span>${escHtml(ein)}</span></div>
          ${profile.address ? `<div class="t4-box"><span class="t4-box-label">Address</span><span>${escHtml(profile.address)}</span></div>` : ''}
        </div>
      </div>

      <div class="t4-employee-box">
        <h4>Employee Information</h4>
        <div class="t4-info-grid">
          <div class="t4-box"><span class="t4-box-label">Employee Name</span><span>${escHtml(emp.name || emp.contact_name || '')}</span></div>
          <div class="t4-box"><span class="t4-box-label">SIN</span><span>${escHtml(emp.sin || '*** *** ***')}</span></div>
          <div class="t4-box"><span class="t4-box-label">Province of Employment</span><span>${escHtml(emp.province || 'Alberta')}</span></div>
        </div>
      </div>

      <div class="t4-boxes-grid">
        <div class="t4-box-item">
          <div class="t4-box-num">14</div>
          <div class="t4-box-name">Employment Income</div>
          <div class="t4-box-value">$${annualGross.toFixed(2)}</div>
        </div>
        <div class="t4-box-item">
          <div class="t4-box-num">16</div>
          <div class="t4-box-name">Employee's CPP contributions</div>
          <div class="t4-box-value">$${annualCPP.toFixed(2)}</div>
        </div>
        <div class="t4-box-item">
          <div class="t4-box-num">17</div>
          <div class="t4-box-name">Employee's CPP2 contributions</div>
          <div class="t4-box-value">$0.00</div>
        </div>
        <div class="t4-box-item">
          <div class="t4-box-num">18</div>
          <div class="t4-box-name">Employee's EI premiums</div>
          <div class="t4-box-value">$${annualEI.toFixed(2)}</div>
        </div>
        <div class="t4-box-item">
          <div class="t4-box-num">22</div>
          <div class="t4-box-name">Income tax deducted</div>
          <div class="t4-box-value">$${annualTax.toFixed(2)}</div>
        </div>
        <div class="t4-box-item">
          <div class="t4-box-num">24</div>
          <div class="t4-box-name">EI insurable earnings</div>
          <div class="t4-box-value">$${Math.min(annualGross, 63200).toFixed(2)}</div>
        </div>
        <div class="t4-box-item">
          <div class="t4-box-num">26</div>
          <div class="t4-box-name">CPP/QPP pensionable earnings</div>
          <div class="t4-box-value">$${Math.min(annualGross, 68500).toFixed(2)}</div>
        </div>
        <div class="t4-box-item">
          <div class="t4-box-num">46</div>
          <div class="t4-box-name">Charitable donations</div>
          <div class="t4-box-value">$0.00</div>
        </div>
      </div>

      <div class="t4-footer">
        <p>⚠️ This is a computer-generated T4 slip for reference. File official T4 slips with CRA by the last day of February. Employees must receive their T4 by the last day of February.</p>
        <p>Tax year: ${year} | Generated: ${new Date().toLocaleDateString('en-CA')}</p>
      </div>
    </div>`;

  const preview = document.getElementById('t4-preview-body');
  if (preview) preview.innerHTML = html;
  openModal('t4-modal');
}

function printT4() {
  const body = document.getElementById('t4-preview-body');
  if (!body) return;
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>T4 Slip</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; color: #111; }
      .t4-slip { max-width: 800px; margin: 0 auto; }
      .t4-header { border-bottom: 3px solid #cc0000; padding-bottom: 1rem; margin-bottom: 1rem; }
      .t4-gov { color: #cc0000; font-weight: bold; margin-bottom: 0.5rem; }
      .t4-header h2 { margin: 0; font-size: 1.2rem; }
      .t4-employer-box, .t4-employee-box { background: #f9fafb; padding: 0.75rem; border-radius: 4px; margin-bottom: 1rem; }
      .t4-employer-box h4, .t4-employee-box h4 { margin: 0 0 0.5rem; color: #cc0000; }
      .t4-info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; }
      .t4-box { display: flex; flex-direction: column; gap: 2px; }
      .t4-box-label { font-size: 0.7rem; color: #6b7280; text-transform: uppercase; }
      .t4-boxes-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; margin-bottom: 1rem; }
      .t4-box-item { border: 1px solid #d1d5db; border-radius: 4px; padding: 0.5rem; background: #fff; }
      .t4-box-num { font-size: 0.7rem; font-weight: bold; color: #cc0000; }
      .t4-box-name { font-size: 0.7rem; color: #6b7280; margin: 2px 0; }
      .t4-box-value { font-size: 1rem; font-weight: bold; font-family: monospace; }
      .t4-footer { font-size: 0.75rem; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 0.5rem; margin-top: 1rem; }
      @media print { body { margin: 0; } }
    </style>
  </head><body>${body.innerHTML}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

console.log('📄 HR Module (Pay Stubs, TD1, T4) loaded');

// ═══════════════════════════════════════════════════════════════════════════
// CONVERT ESTIMATE/QUOTE TO INVOICE
// ═══════════════════════════════════════════════════════════════════════════

function convertEstimateToInvoice(estimateId) {
  const estimates = store.estimates || store.invoices || [];
  const estimate = estimates.find(e => e.id === estimateId && (e.type === 'estimate' || e.status === 'Estimate'));
  if (!estimate) { showToast('Estimate not found', 'error'); return; }
  if (!confirm(`Convert "${estimate.client || estimate.client_name}" estimate to invoice?`)) return;

  const newInvoice = {
    ...estimate,
    id: 'inv_' + Date.now(),
    type: 'invoice',
    status: 'Unpaid',
    converted_from: estimateId,
    date: new Date().toISOString().slice(0, 10),
    created_at: new Date().toISOString()
  };
  delete newInvoice.estimate_date;

  store.invoices = store.invoices || [];
  store.invoices.push(newInvoice);
  // Mark original as converted
  if (store.estimates) {
    const idx = store.estimates.findIndex(e => e.id === estimateId);
    if (idx >= 0) store.estimates[idx].status = 'Converted';
  }
  saveStore();
  loadInvoices();
  showToast('Estimate converted to invoice!', 'success');

  // Show conversion banner
  const banner = document.getElementById('convert-banner');
  if (banner) {
    banner.textContent = `✅ Estimate converted to Invoice #${newInvoice.id.slice(-6).toUpperCase()}`;
    banner.classList.remove('hidden');
    setTimeout(() => banner.classList.add('hidden'), 4000);
  }
}

console.log('💱 Quote-to-Invoice conversion loaded');

// ═══════════════════════════════════════════════════════════════════════════
// PATCH navigateTo FOR CRM
// ═══════════════════════════════════════════════════════════════════════════

(function patchNavigateToForCRM() {
  const _orig = navigateTo;
  navigateTo = function(page) {
    _orig(page);
    if (page === 'crm') {
      setTimeout(() => initCRM(), 50);
    }
  };
  // Also patch loadUnifiedStore to ensure CRM fields
  const _origLoad = loadUnifiedStore;
  loadUnifiedStore = function() {
    _origLoad();
    initCRMStore();
  };
})();

// Init theme on load
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(initTheme, 100);
});

console.log('✅ v3.0 CRM + HR + Theme + Invoice modules fully loaded');