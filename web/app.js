/* ═══════════════════════════════════════════════════════════
   The Foreman AI - App JavaScript v3.0
   Full mobile-first PWA with admin settings, RBAC, QB financials
═══════════════════════════════════════════════════════════ */

const API = '';  // Same origin
let authToken = null;
let isAdmin = false;
let currentUser = null;
let currentPage = 'dashboard';
let timerInterval = null;
let timerSeconds = 0;
let timerRunning = false;
let currentReport = 'pl';
let recognition = null;
let voiceActive = false;

// ── Local Data Store (in-memory, syncs with API) ────────
const store = {
  projects: [],
  invoices: [],
  expenses: [],
  transactions: [],
  users: [],
  settings: {},
  // BUG-008/013/014 FIX: Unified store — all data in one place
  payroll: {
    employees: [],
    contractors: [],
    history: [],
    transactions: [],
    backdateData: {}
  },
  receipts: [],
  profile: {},
  documents: [],
  timeEntries: [],
  leads: [],
};

// ── BUG-008 FIX: Load ALL data from single foreman_store key ─────────────────
function loadUnifiedStore() {
  try {
    const saved = localStorage.getItem('foreman_store');
    if (saved) {
      const parsed = JSON.parse(saved);
      Object.assign(store, parsed);
      // Ensure nested objects exist
      if (!store.payroll) store.payroll = { employees: [], contractors: [], history: [], transactions: [], backdateData: {} };
      if (!store.receipts) store.receipts = [];
      if (!store.profile) store.profile = {};
      if (!store.documents) store.documents = [];
      if (!store.timeEntries) store.timeEntries = [];
      if (!store.leads) store.leads = [];
      if (!store.crmContacts) store.crmContacts = [];
      if (!store.crmLeads) store.crmLeads = [];
      if (!store.crmDeals) store.crmDeals = [];
      if (!store.crmActivities) store.crmActivities = [];
      if (!store.crmFollowups) store.crmFollowups = [];
    } else {
      // Migrate legacy fragmented keys into unified store
      migrateLegacyStorage();
    }
  } catch(e) { console.warn('loadUnifiedStore error:', e); }
}

// ── saveStore: persist the unified store to localStorage ──────────────────
function saveStore() {
  try {
    localStorage.setItem('foreman_store', JSON.stringify(store));
  } catch(e) { console.warn('saveStore error:', e); }
}

// ── BUG-008 FIX: Migrate old fragmented keys into unified store ───────────────
function migrateLegacyStorage() {
  const legacyKeys = {
    'foreman_employees':       (v) => { store.payroll.employees = v; },
    'foreman_contractors':     (v) => { store.payroll.contractors = v; },
    'foreman_payroll_history': (v) => { store.payroll.history = v; },
    'foreman_transactions':    (v) => { store.payroll.transactions = v; },
    'foreman_backdate':        (v) => { store.payroll.backdateData = v; },
    'receiptStore':            (v) => { store.receipts = v; },
    'acctStore':               (v) => { store.transactions = v; },
    'userProfile':             (v) => { store.profile = v; },
  };
  let migrated = false;
  Object.entries(legacyKeys).forEach(([key, setter]) => {
    const raw = localStorage.getItem(key);
    if (raw) {
      try { setter(JSON.parse(raw)); migrated = true; } catch(e) {}
    }
  });
  if (migrated) {
    localStorage.setItem('foreman_store', JSON.stringify(store));
    // Clean up old keys
    Object.keys(legacyKeys).forEach(k => localStorage.removeItem(k));
    console.log('✅ Legacy storage migrated to unified store');
  }
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  // BUG-008 FIX: Load unified store first (migrates legacy keys if needed)
  loadUnifiedStore();

  // Load public settings (branding)
  await loadPublicSettings();

  // Check for saved session
  const savedToken = localStorage.getItem('foreman_token');
  const savedIsAdmin = localStorage.getItem('foreman_is_admin') === 'true';
  const savedUser = localStorage.getItem('foreman_user');

  if (savedToken) {
    authToken = savedToken;
    isAdmin = savedIsAdmin;
    if (savedUser) {
      try { currentUser = JSON.parse(savedUser); } catch(e) {}
    }
    showApp();
  } else {
    showAuth();
  }

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Set default dates for reports
  const today = new Date();
  const yearStart = `${today.getFullYear()}-01-01`;
  const todayStr = today.toISOString().split('T')[0];
  const fromEl = document.getElementById('report-from');
  const toEl = document.getElementById('report-to');
  if (fromEl) fromEl.value = yearStart;
  if (toEl) toEl.value = todayStr;

  // Set today's date on forms
  const invDate = document.getElementById('inv-date');
  const expDate = document.getElementById('exp-date');
  if (invDate) invDate.value = todayStr;
  if (expDate) expDate.value = todayStr;

  // Init voice recognition
  initVoiceRecognition();

  // Start SSE data stream connection (keeps server alive + enables real-time updates)
  startDataStream();
});

// ── SSE Data Stream ──────────────────────────────────────────────────────────
let _sseConnection = null;
let _sseReconnectTimer = null;

function startDataStream() {
  if (typeof EventSource === 'undefined') return; // SSE not supported
  
  function connect() {
    try {
      if (_sseConnection) {
        _sseConnection.close();
        _sseConnection = null;
      }
      
      _sseConnection = new EventSource('/api/stream');
      
      _sseConnection.onopen = () => {
        console.log('📡 Data stream connected');
        if (_sseReconnectTimer) {
          clearTimeout(_sseReconnectTimer);
          _sseReconnectTimer = null;
        }
      };
      
      _sseConnection.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'connected') {
            console.log('✅ Stream active:', data.message);
          }
          // Heartbeat keeps connection alive — no UI update needed
        } catch(e) {}
      };
      
      _sseConnection.onerror = () => {
        _sseConnection.close();
        _sseConnection = null;
        // Reconnect after 30 seconds
        _sseReconnectTimer = setTimeout(connect, 30000);
      };
    } catch(e) {
      // Reconnect after 60 seconds on error
      _sseReconnectTimer = setTimeout(connect, 60000);
    }
  }
  
  connect();
}

// ═══════════════════════════════════════════════════════════
// PUBLIC SETTINGS / BRANDING
// ═══════════════════════════════════════════════════════════
async function loadPublicSettings() {
  try {
    const res = await fetch(`${API}/api/settings/public`);
    if (res.ok) {
      const s = await res.json();
      store.settings = s;
      applyBranding(s);
    }
  } catch(e) {
    // Use defaults
  }
}

function applyBranding(s) {
  if (!s) return;
  // App name — migrate legacy names
  let appName = s.app_name || 'The Foreman AI';
  if (appName === 'BuildAI' || appName === 'BuildAI Alberta' || appName === 'Foreman') {
    appName = 'The Foreman AI';
  }
  document.querySelectorAll('#header-app-name, #sidebar-app-name').forEach(el => el.textContent = appName);
  document.title = appName;

  // Colors
  if (s.primary_color) {
    document.documentElement.style.setProperty('--primary', s.primary_color);
    document.documentElement.style.setProperty('--primary-dark', darkenColor(s.primary_color, 20));
    document.documentElement.style.setProperty('--primary-light', hexToRgba(s.primary_color, 0.15));
  }
  if (s.accent_color) {
    document.documentElement.style.setProperty('--accent', s.accent_color);
  }

  // AI greeting
  if (s.greeting_message) {
    const greetEl = document.getElementById('ai-greeting');
    if (greetEl) greetEl.textContent = s.greeting_message;
  }

  // Theme
  if (s.dark_mode_default === false) {
    document.body.classList.remove('dark-theme');
    document.body.classList.add('light-theme');
  }
}

// ═══════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════
function showAuth() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('main-app').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');
  setupUserUI();
  loadDashboard();
  // Refresh notification badge on every app load
  setTimeout(updateNotifBadge, 300);
}

function showForm(formId) {
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.getElementById(formId).classList.add('active');
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');

  if (!email || !password) {
    showError(errEl, 'Please enter email and password');
    return;
  }

  try {
    const res = await fetch(`${API}/api/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok) {
      authToken = data.token;
      isAdmin = false;
      currentUser = data.user;
      saveSession();
      showApp();
    } else {
      showError(errEl, data.detail || 'Login failed');
    }
  } catch(e) {
    showError(errEl, 'Connection error. Please try again.');
  }
}

async function handleAdminLogin() {
  const username = document.getElementById('admin-username').value.trim();
  const password = document.getElementById('admin-password').value;
  const errEl = document.getElementById('admin-login-error');

  if (!username || !password) {
    showError(errEl, 'Please enter username and password');
    return;
  }

  try {
    const res = await fetch(`${API}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok) {
      authToken = data.token;
      isAdmin = true;
      currentUser = { username, role: 'admin', business_name: 'Admin', contact_name: 'Admin' };
      saveSession();
      showApp();
    } else {
      showError(errEl, data.detail || 'Admin login failed');
    }
  } catch(e) {
    showError(errEl, 'Connection error. Please try again.');
  }
}

async function handleRegister() {
  const name = document.getElementById('reg-name').value.trim();
  const business = document.getElementById('reg-business').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const trade = document.getElementById('reg-trade').value;
  const phone = document.getElementById('reg-phone').value.trim();
  const plan = document.getElementById('reg-plan').value;
  const password = document.getElementById('reg-password').value;
  const errEl = document.getElementById('reg-error');

  if (!name || !business || !email || !password) {
    showError(errEl, 'Please fill in all required fields');
    return;
  }
  if (password.length < 8) {
    showError(errEl, 'Password must be at least 8 characters');
    return;
  }

  try {
    const res = await fetch(`${API}/api/users/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, business_name: business, trade, contact_name: name, phone, plan })
    });
    const data = await res.json();
    if (res.ok) {
      // Auto-login
      const loginRes = await fetch(`${API}/api/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const loginData = await loginRes.json();
      if (loginRes.ok) {
        authToken = loginData.token;
        isAdmin = false;
        currentUser = loginData.user;
        saveSession();
        showApp();
      }
    } else {
      showError(errEl, data.detail || 'Registration failed');
    }
  } catch(e) {
    showError(errEl, 'Connection error. Please try again.');
  }
}

function handleLogout() {
  authToken = null;
  isAdmin = false;
  currentUser = null;
  localStorage.removeItem('foreman_token');
  localStorage.removeItem('foreman_is_admin');
  localStorage.removeItem('foreman_user');
  showAuth();
  showForm('login-form');
  toggleUserMenu();
}

function saveSession() {
  localStorage.setItem('foreman_token', authToken);
  localStorage.setItem('foreman_is_admin', isAdmin.toString());
  if (currentUser) localStorage.setItem('foreman_user', JSON.stringify(currentUser));
}

// ═══════════════════════════════════════════════════════════
// USER UI SETUP
// ═══════════════════════════════════════════════════════════
function setupUserUI() {
  const name = isAdmin ? 'Admin' : (currentUser?.contact_name || currentUser?.business_name || 'User');
  const role = isAdmin ? 'Administrator' : (currentUser?.role || 'User');
  const initial = name.charAt(0).toUpperCase();

  // Update all name/role displays
  document.querySelectorAll('#menu-user-name, #sidebar-user-name').forEach(el => el.textContent = name);
  document.querySelectorAll('#menu-user-role, #sidebar-user-role').forEach(el => el.textContent = role);
  document.querySelectorAll('#user-avatar, #menu-avatar, #sidebar-avatar').forEach(el => el.textContent = initial);

  // Show admin-only sections
  if (isAdmin) {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    document.getElementById('admin-nav-section').classList.remove('hidden');
  }

  // Load admin settings if admin
  if (isAdmin) {
    loadAdminSettings();
    loadUsers();
  }

  // Profile page
  const pName = document.getElementById('p-name');
  const pEmail = document.getElementById('p-email');
  if (pName) pName.value = name;
  if (pEmail) pEmail.value = currentUser?.email || '';
}

// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════
function navigateTo(page) {
  // Check admin-only pages
  const adminPages = ['admin-settings', 'user-management', 'billing'];
  if (adminPages.includes(page) && !isAdmin) {
    showToast('Admin access required', 'error');
    return;
  }

  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  // Show target page
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) {
    pageEl.classList.add('active');
    currentPage = page;
  }

  // Update nav items
  document.querySelectorAll('.nav-item, .bn-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  // Close sidebar on mobile
  const sidebar = document.getElementById('sidebar');
  if (sidebar.classList.contains('open') && window.innerWidth < 1024) {
    toggleSidebar();
  }

  // Page-specific loads
  if (page === 'dashboard') loadDashboard();
  else if (page === 'reports') initReports();
  else if (page === 'user-management') loadUsers();
  else if (page === 'admin-settings') loadAdminSettings();
  else if (page === 'invoices') loadInvoices();
  else if (page === 'expenses') loadExpenses();
  else if (page === 'payroll') initPayroll();
  else if (page === 'accounting') initAccounting();
  else if (page === 'profile') loadProfile();
  else if (page === 'documents') initDocuments();
  else if (page === 'projects') renderProjects();
  else if (page === 'time-tracking') initTimeTracking();
  else if (page === 'ai-chat') { renderDynamicChatSuggestions(); }
  else if (page === 'compliance') loadCompliance();
  else if (page === 'billing') loadBilling();
  else if (page === 'delays') renderDelaysPage();
  else if (page === 'safety-forms') { populateSafetyFormProjects(); }
  else if (page === 'crm') { setTimeout(() => initCRM(), 50); }

  // Scroll to top
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  const appMain = document.getElementById('app-main');
  if (appMain) appMain.scrollTop = 0;
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

function toggleUserMenu() {
  document.getElementById('user-menu').classList.toggle('hidden');
}

// Close menus on outside click
document.addEventListener('click', (e) => {
  const userMenu = document.getElementById('user-menu');
  const userAvatar = document.getElementById('user-avatar');
  if (userMenu && !userMenu.contains(e.target) && !userAvatar?.contains(e.target)) {
    userMenu.classList.add('hidden');
  }
});

// ═══════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════
async function loadDashboard() {
  try {
    const res = await apiGet('/api/ledger/reports/dashboard-summary');
    if (res) {
      document.getElementById('kpi-revenue').textContent = formatCurrency(res.ytd?.revenue || 0);
      document.getElementById('kpi-profit').textContent = formatCurrency(res.ytd?.net_income || 0);
      document.getElementById('kpi-margin').textContent = `${res.ytd?.gross_margin || 0}% margin`;
      document.getElementById('kpi-ar').textContent = formatCurrency(res.ar_outstanding || 0);
      document.getElementById('kpi-ar-overdue').textContent = `${formatCurrency(res.ar_overdue || 0)} overdue`;
      document.getElementById('kpi-bank').textContent = formatCurrency(res.bank_balance || 0);

      const profitEl = document.getElementById('kpi-profit');
      if (res.ytd?.net_income < 0) profitEl.style.color = 'var(--danger)';
      else profitEl.style.color = 'var(--accent)';
    }
  } catch(e) {}

  // Load recent transactions
  try {
    const txns = await apiGet('/api/ledger/transactions?limit=5');
    if (txns?.transactions?.length > 0) {
      const container = document.getElementById('recent-transactions');
      container.innerHTML = txns.transactions.map(t => `
        <div class="activity-item">
          <span class="ai-icon">${getTransactionIcon(t.transaction_type)}</span>
          <div class="ai-desc">
            <div>${t.description}</div>
            <div style="font-size:11px;color:var(--text-muted)">${t.date}</div>
          </div>
          <span class="ai-amount ${t.transaction_type === 'expense' ? 'negative' : 'positive'}">
            ${t.transaction_type === 'expense' ? '-' : '+'}${formatCurrency(t.total_amount)}
          </span>
        </div>
      `).join('');
    }
  } catch(e) {}
}

function refreshDashboard() {
  loadDashboard();
  showToast('Dashboard refreshed', 'success');
}

function getTransactionIcon(type) {
  const icons = { invoice: '📄', expense: '💳', payroll: '👷', payment_received: '💰', general: '📊' };
  return icons[type] || '📊';
}

// ═══════════════════════════════════════════════════════════
// AI CHAT
// ═══════════════════════════════════════════════════════════

function showTyping() {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-message ai';
  div.id = 'typing-indicator';
  div.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="msg-bubble">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function hideTyping() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

function clearChat() {
  const container = document.getElementById('chat-messages');
  const greeting = container.querySelector('.chat-message.ai');
  container.innerHTML = '';
  if (greeting) container.appendChild(greeting);
}

function sendQuickPrompt(prompt) {
  document.getElementById('chat-input').value = prompt;
  sendMessage();
}

// BUG-020 FIX: Dynamic chat suggestions based on live store data
function renderDynamicChatSuggestions() {
  const container = document.getElementById('ai-quick-prompts');
  if (!container) return;

  const today = new Date().toISOString().split('T')[0];
  const suggestions = [];

  // --- Data-aware suggestions ---
  const invoices = store.invoices || [];
  const unpaid = invoices.filter(i => i.status && !['paid','Paid'].includes(i.status));
  if (unpaid.length > 0) {
    suggestions.push({
      icon: '💰',
      label: `${unpaid.length} Unpaid Invoice${unpaid.length > 1 ? 's' : ''}`,
      prompt: `What invoices are outstanding? I have ${unpaid.length} unpaid.`
    });
  } else {
    suggestions.push({ icon: '💰', label: 'Outstanding Invoices', prompt: 'What invoices are outstanding?' });
  }

  const projects = store.projects || [];
  const active = projects.filter(p => ['active','In Progress'].includes(p.status));
  const overdue = active.filter(p => p.scheduled_finish_date && p.scheduled_finish_date < today);
  if (overdue.length > 0) {
    suggestions.push({
      icon: '⚠️',
      label: `${overdue.length} Overdue Project${overdue.length > 1 ? 's' : ''}`,
      prompt: `I have ${overdue.length} project(s) past their finish date. What should I do?`
    });
  } else if (active.length > 0) {
    suggestions.push({
      icon: '📋',
      label: `${active.length} Active Project${active.length > 1 ? 's' : ''}`,
      prompt: `Summarize my ${active.length} active project${active.length > 1 ? 's' : ''}`
    });
  } else {
    suggestions.push({ icon: '📋', label: 'Active Projects', prompt: 'Summarize my active projects' });
  }

  // --- Trade-aware suggestions ---
  const trade = (currentUser && currentUser.trade) || 'general_contracting';
  const tradeLabel = {
    framing: 'framing', carpentry: 'carpentry', electrical: 'electrical',
    plumbing: 'plumbing', roofing: 'roofing', concrete: 'concrete',
    general_contracting: 'general contracting'
  }[trade] || trade;

  suggestions.push({
    icon: '📝',
    label: 'Write Quote',
    prompt: `Help me write a professional quote for a ${tradeLabel} job`
  });

  // --- Seasonal / time-aware suggestions ---
  const month = new Date().getMonth() + 1; // 1-12
  const day = new Date().getDate();

  if ([1, 4, 7, 10].includes(month) && day <= 31) {
    suggestions.push({ icon: '🧾', label: 'GST Remittance', prompt: 'Help me calculate my GST remittance for this quarter' });
  } else {
    suggestions.push({ icon: '🧾', label: 'GST Help', prompt: 'How do I calculate GST on a construction invoice?' });
  }

  if (day <= 15) {
    suggestions.push({ icon: '💳', label: 'Payroll Deductions', prompt: 'What payroll deductions are due by the 15th?' });
  } else {
    suggestions.push({ icon: '⚠️', label: 'WCB Info', prompt: 'What WCB requirements do I need for my workers?' });
  }

  suggestions.push({ icon: '🏗️', label: 'Permits', prompt: 'What permits do I need for this construction project?' });

  // --- Render ---
  container.innerHTML = suggestions.slice(0, 6).map(s =>
    `<button onclick="sendQuickPrompt(${JSON.stringify(s.prompt)})">${s.icon} ${s.label}</button>`
  ).join('');
}

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// AI Floating Panel
function toggleAIPanel() {
  document.getElementById('ai-panel').classList.toggle('hidden');
}

async function sendPanelMessage() {
  const input = document.getElementById('ai-panel-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';

  const msgs = document.getElementById('ai-panel-messages');
  msgs.innerHTML += `<div style="text-align:right;margin-bottom:6px;color:var(--text-secondary)">${escapeHtml(msg)}</div>`;

  try {
    const res = await fetch(`${API}/api/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ message: msg })
    });
    const data = await res.json();
    msgs.innerHTML += `<div style="margin-bottom:6px;color:var(--text-primary)">${escapeHtml(data.response || 'Got it!')}</div>`;
  } catch(e) {
    msgs.innerHTML += `<div style="margin-bottom:6px;color:var(--text-muted)">AI response unavailable</div>`;
  }
  msgs.scrollTop = msgs.scrollHeight;
}

function handlePanelKey(e) {
  if (e.key === 'Enter') sendPanelMessage();
}

// ═══════════════════════════════════════════════════════════
// VOICE RECOGNITION
// ═══════════════════════════════════════════════════════════
function initVoiceRecognition() {
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-CA';

    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      document.getElementById('chat-input').value = transcript;
      stopVoice();
      sendMessage();
    };
    recognition.onerror = () => stopVoice();
    recognition.onend = () => stopVoice();
  }
}

function toggleVoice() {
  if (!recognition) { showToast('Voice not supported on this browser', 'warning'); return; }
  if (voiceActive) stopVoice();
  else startVoice();
}

function startVoice() {
  voiceActive = true;
  recognition.start();
  document.getElementById('voice-btn').classList.add('recording');
  document.getElementById('voice-btn').textContent = '🔴';
}

function stopVoice() {
  voiceActive = false;
  if (recognition) recognition.stop();
  const btn = document.getElementById('voice-btn');
  if (btn) { btn.classList.remove('recording'); btn.textContent = '🎤'; }
}

// ═══════════════════════════════════════════════════════════
// INVOICES
// ═══════════════════════════════════════════════════════════
// Invoice Line Item Builder
let invLineCount = 0;
let estLineCount = 0;

function addInvoiceLine() {
  invLineCount++;
  const id = invLineCount;
  const tbody = document.getElementById('inv-lines-body');
  const tr = document.createElement('tr');
  tr.className = 'inv-line-row';
  tr.id = 'inv-line-' + id;
  tr.innerHTML = `
    <td><input type="text" placeholder="Description of work or material" id="il-desc-${id}"></td>
    <td><input type="number" value="1" min="0" step="0.01" id="il-qty-${id}" oninput="calcInvLine(${id})"></td>
    <td>
      <select id="il-unit-${id}" style="font-size:.78rem">
        <option value="hr">hr</option>
        <option value="ea">ea</option>
        <option value="lf">lf</option>
        <option value="sf">sf</option>
        <option value="ls">ls</option>
        <option value="day">day</option>
        <option value="wk">wk</option>
        <option value="m">m</option>
        <option value="m2">m²</option>
        <option value="tonne">tonne</option>
      </select>
    </td>
    <td><input type="number" value="0.00" min="0" step="0.01" id="il-rate-${id}" oninput="calcInvLine(${id})"></td>
    <td class="price-cell" id="il-price-${id}">$0.00</td>
    <td class="gst-toggle">
      <input type="checkbox" id="il-gst-${id}" checked onchange="calcInvTotals()">
      <label for="il-gst-${id}" style="font-size:.7rem;cursor:pointer">GST</label>
    </td>
    <td><button class="remove-line" onclick="removeInvLine(${id})">✕</button></td>
  `;
  tbody.appendChild(tr);
  calcInvTotals();
}

function removeInvLine(id) {
  const el = document.getElementById('inv-line-' + id);
  if (el) el.remove();
  calcInvTotals();
}

function calcInvLine(id) {
  const qty = parseFloat(document.getElementById('il-qty-' + id)?.value) || 0;
  const rate = parseFloat(document.getElementById('il-rate-' + id)?.value) || 0;
  const price = qty * rate;
  const priceEl = document.getElementById('il-price-' + id);
  if (priceEl) priceEl.textContent = '$' + price.toFixed(2);
  calcInvTotals();
}

function calcInvTotals() {
  let subtotal = 0, gstTotal = 0;
  document.querySelectorAll('#inv-lines-body .inv-line-row').forEach(row => {
    const id = row.id.replace('inv-line-', '');
    const qty = parseFloat(document.getElementById('il-qty-' + id)?.value) || 0;
    const rate = parseFloat(document.getElementById('il-rate-' + id)?.value) || 0;
    const price = qty * rate;
    subtotal += price;
    const gstChecked = document.getElementById('il-gst-' + id)?.checked;
    if (gstChecked) gstTotal += price * 0.05;
  });
  const grand = subtotal + gstTotal;
  document.getElementById('inv-subtotal').textContent = '$' + subtotal.toFixed(2);
  document.getElementById('inv-gst-total').textContent = '$' + gstTotal.toFixed(2);
  document.getElementById('inv-grand-total').textContent = '$' + grand.toFixed(2);
}

function getInvLines() {
  const lines = [];
  document.querySelectorAll('#inv-lines-body .inv-line-row').forEach(row => {
    const id = row.id.replace('inv-line-', '');
    const qty = parseFloat(document.getElementById('il-qty-' + id)?.value) || 0;
    const rate = parseFloat(document.getElementById('il-rate-' + id)?.value) || 0;
    lines.push({
      description: document.getElementById('il-desc-' + id)?.value || '',
      quantity: qty,
      unit: document.getElementById('il-unit-' + id)?.value || 'ea',
      rate: rate,
      price: qty * rate,
      gst_exempt: !(document.getElementById('il-gst-' + id)?.checked)
    });
  });
  return lines;
}

// Estimate Line Item Builder
function addEstimateLine() {
  estLineCount++;
  const id = estLineCount;
  const tbody = document.getElementById('est-lines-body');
  const tr = document.createElement('tr');
  tr.className = 'inv-line-row';
  tr.id = 'est-line-' + id;
  tr.innerHTML = `
    <td><input type="text" placeholder="Description of work or material" id="el-desc-${id}"></td>
    <td><input type="number" value="1" min="0" step="0.01" id="el-qty-${id}" oninput="calcEstLine(${id})"></td>
    <td>
      <select id="el-unit-${id}" style="font-size:.78rem">
        <option value="hr">hr</option>
        <option value="ea">ea</option>
        <option value="lf">lf</option>
        <option value="sf">sf</option>
        <option value="ls">ls</option>
        <option value="day">day</option>
        <option value="wk">wk</option>
        <option value="m">m</option>
        <option value="m2">m²</option>
        <option value="tonne">tonne</option>
      </select>
    </td>
    <td><input type="number" value="0.00" min="0" step="0.01" id="el-rate-${id}" oninput="calcEstLine(${id})"></td>
    <td class="price-cell" id="el-price-${id}">$0.00</td>
    <td class="gst-toggle">
      <input type="checkbox" id="el-gst-${id}" checked onchange="calcEstTotals()">
      <label for="el-gst-${id}" style="font-size:.7rem;cursor:pointer">GST</label>
    </td>
    <td><button class="remove-line" onclick="removeEstLine(${id})">✕</button></td>
  `;
  tbody.appendChild(tr);
  calcEstTotals();
}

function removeEstLine(id) {
  const el = document.getElementById('est-line-' + id);
  if (el) el.remove();
  calcEstTotals();
}

function calcEstLine(id) {
  const qty = parseFloat(document.getElementById('el-qty-' + id)?.value) || 0;
  const rate = parseFloat(document.getElementById('el-rate-' + id)?.value) || 0;
  const price = qty * rate;
  const priceEl = document.getElementById('el-price-' + id);
  if (priceEl) priceEl.textContent = '$' + price.toFixed(2);
  calcEstTotals();
}

function calcEstTotals() {
  let subtotal = 0, gstTotal = 0;
  document.querySelectorAll('#est-lines-body .inv-line-row').forEach(row => {
    const id = row.id.replace('est-line-', '');
    const qty = parseFloat(document.getElementById('el-qty-' + id)?.value) || 0;
    const rate = parseFloat(document.getElementById('el-rate-' + id)?.value) || 0;
    const price = qty * rate;
    subtotal += price;
    const gstChecked = document.getElementById('el-gst-' + id)?.checked;
    if (gstChecked) gstTotal += price * 0.05;
  });
  const grand = subtotal + gstTotal;
  document.getElementById('est-subtotal').textContent = '$' + subtotal.toFixed(2);
  document.getElementById('est-gst-total').textContent = '$' + gstTotal.toFixed(2);
  document.getElementById('est-grand-total').textContent = '$' + grand.toFixed(2);
}

function getEstLines() {
  const lines = [];
  document.querySelectorAll('#est-lines-body .inv-line-row').forEach(row => {
    const id = row.id.replace('est-line-', '');
    const qty = parseFloat(document.getElementById('el-qty-' + id)?.value) || 0;
    const rate = parseFloat(document.getElementById('el-rate-' + id)?.value) || 0;
    lines.push({
      description: document.getElementById('el-desc-' + id)?.value || '',
      quantity: qty,
      unit: document.getElementById('el-unit-' + id)?.value || 'ea',
      rate: rate,
      price: qty * rate,
      gst_exempt: !(document.getElementById('el-gst-' + id)?.checked)
    });
  });
  return lines;
}

function openInvoiceModal() {
  invLineCount = 0;
  document.getElementById('inv-lines-body').innerHTML = '';
  document.getElementById('inv-customer').value = '';
  document.getElementById('inv-notes').value = '';
  document.getElementById('inv-subtotal').textContent = '$0.00';
  document.getElementById('inv-gst-total').textContent = '$0.00';
  document.getElementById('inv-grand-total').textContent = '$0.00';
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('inv-date').value = today;
  const due = new Date(); due.setDate(due.getDate() + 30);
  document.getElementById('inv-due-date').value = due.toISOString().split('T')[0];
  // Populate projects dropdown
  const projSel = document.getElementById('inv-project');
  if (projSel) {
    projSel.innerHTML = '<option value="">Select project...</option>';
    if (store.projects && store.projects.length) {
      store.projects.forEach(function(p) {
        const id = p.id || p.project_id || '';
        const name = p.name || p.project_name || 'Unnamed Project';
        const client = p.client_name || p.client || '';
        const label = name + (client ? ' - ' + client : '');
        projSel.innerHTML += '<option value="' + id + '">' + label + '</option>';
      });
    }
  }
  addInvoiceLine();
  openModal('new-invoice-modal');
}

function calcInvoiceGST() { calcInvTotals(); }

async function createInvoice() {
  const customer = document.getElementById('inv-customer').value.trim();
  const lines = getInvLines();
  const date = document.getElementById('inv-date').value;
  const dueDate = document.getElementById('inv-due-date').value;
  const notes = document.getElementById('inv-notes').value.trim();
  const projectId = document.getElementById('inv-project').value;

  if (!customer) { showToast('Customer name is required', 'error'); return; }
  if (!lines.length) { showToast('Add at least one line item', 'error'); return; }

  let subtotal = 0, gstTotal = 0;
  lines.forEach(l => {
    subtotal += l.price;
    if (!l.gst_exempt) gstTotal += l.price * 0.05;
  });
  const total = subtotal + gstTotal;

  try {
    const payload = {
      client_name: customer,
      project_id: projectId || null,
      line_items: lines,
      date: date || new Date().toISOString().split('T')[0],
      due_date: dueDate,
      notes: notes,
      payment_terms: document.getElementById('inv-terms').value
    };
    let res;
    try {
      res = await apiPost('/api/projects/invoice/standalone', payload);
    } catch(e) {
      res = await apiPost('/api/ledger/transactions/invoice', {
        customer_name: customer,
        amount: subtotal,
        gst_amount: gstTotal,
        date: date || new Date().toISOString().split('T')[0],
        notes: notes
      });
    }
    if (res) {
      store.invoices.push(res);
      closeModal('new-invoice-modal');
      showToast('Invoice created! Total: $' + total.toFixed(2), 'success');
      loadInvoices();
      loadDashboard();
    }
  } catch(e) {
    showToast('Error creating invoice: ' + e.message, 'error');
  }
}

async function createEstimate() {
  const customer = document.getElementById('est-customer').value.trim();
  const lines = getEstLines();
  const date = document.getElementById('est-date').value;
  const validUntil = document.getElementById('est-valid-until').value;
  const notes = document.getElementById('est-notes').value.trim();
  const projectDesc = document.getElementById('est-project-desc').value.trim();

  if (!customer) { showToast('Client name is required', 'error'); return; }
  if (!lines.length) { showToast('Add at least one line item', 'error'); return; }

  let subtotal = 0, gstTotal = 0;
  lines.forEach(l => {
    subtotal += l.price;
    if (!l.gst_exempt) gstTotal += l.price * 0.05;
  });
  const total = subtotal + gstTotal;

  try {
    const payload = {
      client_name: customer,
      project_description: projectDesc,
      line_items: lines,
      date: date || new Date().toISOString().split('T')[0],
      valid_until: validUntil,
      notes: notes
    };
    let res;
    try {
      res = await apiPost('/api/projects/estimate', payload);
    } catch(e) {
      res = { id: Date.now(), estimate_number: 'EST-' + Date.now(), subtotal, gst_total: gstTotal, total };
    }
    if (res) {
      closeModal('new-estimate-modal');
      showToast('Estimate created! Total: $' + total.toFixed(2), 'success');
    }
  } catch(e) {
    showToast('Error creating estimate: ' + e.message, 'error');
  }
}

async function loadInvoices() {
  try {
    const data = await apiGet('/api/ledger/transactions?transaction_type=invoice');
    const container = document.getElementById('invoices-list');
    if (!data?.transactions?.length) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-icon">📄</div>
        <h3>No Invoices Yet</h3>
        <p>Create your first invoice</p>
        <button class="btn-primary" onclick="openModal('new-invoice-modal')">+ New Invoice</button>
      </div>`;
      return;
    }

    let total = 0, paid = 0;
    data.transactions.forEach(t => { total += t.total_amount; });

    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Invoice #</th>
            <th>Customer</th>
            <th>Date</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${data.transactions.map(t => `
            <tr>
              <td><strong>${t.reference || t.id || 'N/A'}</strong></td>
              <td>${t.description ? t.description.replace('Invoice ', '').split(' - ')[1] || t.description : t.client_name || 'Unknown'}</td>
              <td>${t.date}</td>
              <td><strong>${formatCurrency(t.total_amount)}</strong></td>
              <td>
                <span class="status-active" style="padding:3px 8px;border-radius:10px;font-size:11px;background:rgba(76,175,80,0.15);color:var(--accent)">${t.status || 'Sent'}</span>
              </td>
              <td style="white-space:nowrap">
                <button onclick="updateInvoiceStatus('${t.id}', 'paid')" style="padding:4px 8px;font-size:11px;background:var(--accent);color:white;border:none;border-radius:4px;cursor:pointer;margin-right:4px" title="Mark Paid">✓ Paid</button>
                <button onclick="deleteInvoice('${t.id}')" style="padding:4px 8px;font-size:11px;background:var(--danger);color:white;border:none;border-radius:4px;cursor:pointer" title="Delete">🗑</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    document.getElementById('inv-total').textContent = formatCurrency(total);
    document.getElementById('inv-outstanding').textContent = formatCurrency(total * 0.4);
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════
// BUG-003 FIX: Add invoice edit and delete functionality
async function deleteInvoice(invoiceId) {
  if (!confirm('Are you sure you want to delete this invoice? This cannot be undone.')) return;
  
  try {
    // Try API delete first
    await fetch(`${API}/api/ledger/transactions/${invoiceId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    
    // Remove from local store
    store.invoices = (store.invoices || []).filter(inv => inv.id !== invoiceId && inv.transaction_id !== invoiceId);
    saveStore();
    
    showToast('Invoice deleted', 'success');
    loadInvoices();
    loadDashboard();
  } catch(e) {
    // Fallback to local delete only
    store.invoices = (store.invoices || []).filter(inv => inv.id !== invoiceId && inv.transaction_id !== invoiceId);
    saveStore();
    showToast('Invoice deleted locally', 'success');
    loadInvoices();
  }
}

async function updateInvoiceStatus(invoiceId, newStatus) {
  try {
    // Update in local store
    const invoices = store.invoices || [];
    const idx = invoices.findIndex(inv => inv.id === invoiceId || inv.transaction_id === invoiceId);
    if (idx >= 0) {
      invoices[idx].status = newStatus;
      store.invoices = invoices;
      saveStore();
    }
    
    // Try API update
    await fetch(`${API}/api/ledger/transactions/${invoiceId}/status`, {
      method: 'PATCH',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}` 
      },
      body: JSON.stringify({ status: newStatus })
    });
    
    showToast(`Invoice marked as ${newStatus}`, 'success');
    loadInvoices();
  } catch(e) {
    showToast('Status updated locally', 'success');
    loadInvoices();
  }
}

function openEditInvoiceModal(invoiceId) {
  const invoice = (store.invoices || []).find(inv => inv.id === invoiceId || inv.transaction_id === invoiceId);
  if (!invoice) {
    showToast('Invoice not found', 'error');
    return;
  }
  
  // Populate the invoice modal with existing data
  document.getElementById('inv-customer').value = invoice.client_name || invoice.customer_name || '';
  document.getElementById('inv-date').value = invoice.date || '';
  document.getElementById('inv-due-date').value = invoice.due_date || '';
  document.getElementById('inv-notes').value = invoice.notes || '';
  document.getElementById('inv-terms').value = invoice.payment_terms || 'net30';
  
  // Store the invoice ID for updating
  const editIdField = document.getElementById('inv-edit-id');
  if (editIdField) editIdField.value = invoiceId;
  
  // Clear and populate line items
  document.getElementById('inv-lines-body').innerHTML = '';
  invLineCount = 0;
  
  const lineItems = invoice.line_items || [];
  if (lineItems.length > 0) {
    lineItems.forEach(item => {
      addInvoiceLine();
      const id = invLineCount;
      document.getElementById(`il-desc-${id}`).value = item.description || '';
      document.getElementById(`il-qty-${id}`).value = item.quantity || 1;
      document.getElementById(`il-unit-${id}`).value = item.unit || 'ea';
      document.getElementById(`il-rate-${id}`).value = item.rate || 0;
      document.getElementById(`il-gst-${id}`).checked = !item.gst_exempt;
    });
  } else {
    addInvoiceLine();
  }
  
  calcInvTotals();
  
  openModal('new-invoice-modal');
}


// EXPENSES
// ═══════════════════════════════════════════════════════════
function calcExpenseGST() {
  const amount = parseFloat(document.getElementById('exp-amount').value) || 0;
  const gst = amount / 1.05 * 0.05;
  document.getElementById('exp-gst').value = gst.toFixed(2);
}

async function createExpense() {
  const desc = document.getElementById('exp-desc').value.trim();
  const amount = parseFloat(document.getElementById('exp-amount').value) || 0;
  const gst = parseFloat(document.getElementById('exp-gst').value) || 0;
  const category = document.getElementById('exp-category').value;
  const date = document.getElementById('exp-date').value;
  const paidFrom = document.getElementById('exp-paid-from').value;

  if (!desc || !amount) {
    showToast('Please fill in description and amount', 'error');
    return;
  }

  try {
    const res = await apiPost('/api/ledger/transactions/expense', {
      description: desc,
      amount: amount,
      gst_paid: gst,
      expense_account_code: category,
      paid_from: paidFrom,
      date: date || new Date().toISOString().split('T')[0]
    });

    if (res) {
      closeModal('new-expense-modal');
      showToast('Expense recorded!', 'success');
      loadExpenses();
      loadDashboard();
    }
  } catch(e) {
    showToast('Error recording expense', 'error');
  }
}

async function loadExpenses() {
  try {
    const data = await apiGet('/api/ledger/transactions?transaction_type=expense');
    const container = document.getElementById('expenses-list');
    if (!data?.transactions?.length) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-icon">💳</div>
        <h3>No Expenses Yet</h3>
        <p>Track your business expenses</p>
        <button class="btn-primary" onclick="openModal('new-expense-modal')">+ Add Expense</button>
      </div>`;
      return;
    }

    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>Date</th><th>Description</th><th>Amount</th><th>GST</th></tr>
        </thead>
        <tbody>
          ${data.transactions.map(t => `
            <tr>
              <td>${t.date}</td>
              <td>${t.description}</td>
              <td class="text-danger"><strong>${formatCurrency(t.total_amount)}</strong></td>
              <td>${formatCurrency(t.total_amount * 0.05)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════
// PROJECTS
// ═══════════════════════════════════════════════════════════
async function createProject() {
  const name = document.getElementById('proj-name').value.trim();
  const client = document.getElementById('proj-client').value.trim();
  const clientEmail = document.getElementById('proj-client-email')?.value.trim() || '';
  const trade = document.getElementById('proj-trade').value;
  const budget = parseFloat(document.getElementById('proj-budget').value) || 0;
  const start = document.getElementById('proj-start').value;
  const finish = document.getElementById('proj-finish')?.value || '';
  const status = document.getElementById('proj-status')?.value || 'active';
  const address = document.getElementById('proj-address').value.trim();
  const desc = document.getElementById('proj-desc').value.trim();

  if (!name) { showToast('Project name is required', 'error'); return; }

  const project = {
    id: Date.now().toString(),
    name,
    client_name: client,
    client_email: clientEmail,
    project_type: trade,
    trade: trade,
    contract_value: budget,
    budget: budget,
    start_date: start,
    scheduled_finish_date: finish,
    address,
    description: desc,
    status,
    spent: 0,
    scope_of_work: currentSowAdd || [],
    client_link_id: generateLinkId(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  // Try to save to API first, fall back to local store
  try {
    const res = await apiPost('/api/projects/', project);
    if (res) project.id = res.id || project.id;
  } catch(e) { /* use local store */ }

  store.projects.push(project);
  
  // AUTO-ADD PROJECT TO PM SYSTEM
  // Create default tasks based on project type
  addProjectTasksToPM(project);
  
  // Add project as a resource in PM
  if (!store.pmResources) store.pmResources = [];
  
  localStorage.setItem('foreman_store', JSON.stringify(store));
  
  // Clear form
  document.getElementById('proj-name').value = '';
  document.getElementById('proj-client').value = '';
  if (document.getElementById('proj-client-email')) {
    document.getElementById('proj-client-email').value = '';
  }
  document.getElementById('proj-budget').value = '';
  document.getElementById('proj-address').value = '';
  document.getElementById('proj-desc').value = '';
  document.getElementById('proj-finish').value = '';
  document.getElementById('proj-start').value = '';
  
  // Clear scope of work
  currentSowAdd = [];
  const sowContainer = document.getElementById('proj-sow-container');
  if (sowContainer) {
    sowContainer.innerHTML = '<p style="color:#999;font-style:italic">No scope items added yet</p>';
  }
  
  closeModal('new-project-modal');
  showToast(`Project "${name}" created with ${generateDefaultProjectTasks(project).length} default tasks!`, 'success');
  renderProjects();
  loadDashboard();
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPLIANCE PAGE
   ═══════════════════════════════════════════════════════════════════════════ */
async function loadCompliance() {
  try {
    // Load compliance status summary
    const status = await apiGet('/api/compliance/status');
    if (status) {
      // Update WCB section
      const wcbRateEl = document.getElementById('wcb-rate');
      const wcbYtdEl = document.getElementById('wcb-ytd');
      if (wcbRateEl && status.wcb) {
        wcbRateEl.textContent = status.wcb.rate || 'N/A';
      }
      if (wcbYtdEl && status.wcb) {
        wcbYtdEl.textContent = formatCurrency(status.wcb.ytd_premiums || 0);
      }
    }
  } catch(e) {
    console.log('Could not load compliance status:', e);
  }

  // Load training records
  try {
    const training = await apiGet('/api/compliance/training');
    const trainingList = document.getElementById('training-list');
    if (trainingList && training && training.length > 0) {
      trainingList.innerHTML = training.map(t => {
        const statusClass = t.status === 'current' ? 'current' : (t.status === 'expiring' ? 'expiring' : 'expired');
        const icon = t.status === 'current' ? '✅' : (t.status === 'expiring' ? '⚠️' : '❌');
        return `
          <div class="training-item ${statusClass}">
            <span class="ti-icon">${icon}</span>
            <div class="ti-info">
              <span class="ti-name">${t.name || t.training_type}</span>
              <span class="ti-date">Expires: ${t.expiry_date || 'N/A'}</span>
            </div>
            <span class="ti-status ${t.status === 'expiring' ? 'warning' : ''}">${t.status || 'Unknown'}</span>
          </div>`;
      }).join('');
    }
  } catch(e) {
    console.log('Could not load training records:', e);
  }

  // Load permits
  try {
    const permits = await apiGet('/api/compliance/permits');
    const permitsList = document.getElementById('permits-list');
    if (permitsList && permits && permits.length > 0) {
      permitsList.innerHTML = permits.map(p => `
        <div class="permit-item">
          <span>${p.permit_number || p.type}</span>
          <span class="badge-${p.status === 'active' ? 'green' : 'yellow'}">${p.status}</span>
        </div>
      `).join('');
    }
  } catch(e) {
    console.log('Could not load permits:', e);
  }

  // Load safety checklist
  try {
    const checklist = await apiGet('/api/compliance/safety-checklist');
    const checklistEl = document.getElementById('safety-checklist');
    if (checklistEl && checklist && checklist.items) {
      const checkboxes = checklistEl.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach((cb, i) => {
        if (checklist.items[i] !== undefined) {
          cb.checked = checklist.items[i];
        }
      });
    }
  } catch(e) {
    console.log('Could not load safety checklist:', e);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   BILLING PAGE
   ═══════════════════════════════════════════════════════════════════════════ */
async function loadBilling() {
  try {
    // Load available plans
    const plans = await apiGet('/api/billing/plans');
    
    // Load current subscription status
    const userEmail = localStorage.getItem('userEmail');
    let subscription = null;
    if (userEmail) {
      try {
        subscription = await apiGet(`/api/billing/subscription/${encodeURIComponent(userEmail)}`);
      } catch(e) {
        // No subscription found, that's okay
      }
    }

    // Update plan cards to show current plan
    const planCards = ['starter', 'professional', 'business'];
    planCards.forEach(planName => {
      const card = document.getElementById(`plan-${planName}`);
      if (card) {
        const btn = card.querySelector('button');
        if (btn) {
          if (subscription && subscription.plan === planName) {
            btn.textContent = 'Current Plan';
            btn.className = 'btn-secondary';
            btn.disabled = true;
          } else {
            btn.textContent = subscription ? 'Upgrade' : 'Select';
            btn.className = planName === 'professional' ? 'btn-primary' : 'btn-secondary';
            btn.disabled = false;
          }
        }
      }
    });

    // Load billing status for admin overview
    if (isAdmin) {
      try {
        const billingStatus = await apiGet('/api/billing/status');
        console.log('Billing status loaded:', billingStatus);
      } catch(e) {
        console.log('Could not load admin billing status');
      }
    }
  } catch(e) {
    console.log('Could not load billing data:', e);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   PERMIT & INCIDENT MODAL HANDLERS
   ═══════════════════════════════════════════════════════════════════════════ */
async function savePermit() {
  const permit = {
    permit_type: getVal('permit-type'),
    permit_number: getVal('permit-number'),
    project_address: getVal('permit-address'),
    issue_date: getVal('permit-issue-date'),
    expiry_date: getVal('permit-expiry-date') || null,
    issuing_authority: getVal('permit-authority') || 'City of Calgary'
  };

  if (!permit.permit_number || !permit.project_address || !permit.issue_date) {
    showToast('Permit number, address, and issue date are required', 'error');
    return;
  }

  try {
    const result = await apiPost('/api/compliance/permits', permit);
    if (result && result.status === 'success') {
      showToast('Permit added successfully!', 'success');
      closeModal('permit-modal');
      loadCompliance();
    } else {
      showToast(result?.detail || 'Failed to add permit', 'error');
    }
  } catch(e) {
    console.error('Error saving permit:', e);
    showToast('Error saving permit', 'error');
  }
}

async function saveIncident() {
  const incident = {
    incident_date: getVal('incident-date'),
    incident_type: getVal('incident-type'),
    description: getVal('incident-description'),
    location: getVal('incident-location'),
    severity: getVal('incident-severity') || 'minor',
    injuries: getVal('incident-injuries') ? [getVal('incident-injuries')] : null,
    witnesses: getVal('incident-witnesses') ? [getVal('incident-witnesses')] : null,
    immediate_actions_taken: getVal('incident-actions') || null
  };

  if (!incident.incident_date || !incident.incident_type || !incident.description || !incident.location) {
    showToast('Date, type, description, and location are required', 'error');
    return;
  }

  try {
    const result = await apiPost('/api/compliance/incidents', incident);
    if (result && result.status === 'success') {
      showToast('Incident reported successfully', 'success');
      closeModal('incident-modal');
      // Clear form
      document.getElementById('incident-description').value = '';
      document.getElementById('incident-actions').value = '';
      document.getElementById('incident-injuries').value = '';
      document.getElementById('incident-witnesses').value = '';
    } else {
      showToast(result?.detail || 'Failed to report incident', 'error');
    }
  } catch(e) {
    console.error('Error saving incident:', e);
    showToast('Error reporting incident', 'error');
  }
}

function renderProjects(filter = 'all') {
  const container = document.getElementById('projects-list');
  let projects = store.projects || [];
  if (filter !== 'all') projects = projects.filter(p => p.status === filter);

  if (!projects.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🏗️</div>
      <h3>No Projects</h3>
      <p>${filter === 'all' ? 'Create your first project' : `No ${filter} projects`}</p>
      ${filter === 'all' ? '<button class="btn-primary" onclick="openModal(\'new-project-modal\')">+ New Project</button>' : ''}
    </div>`;
    return;
  }

  container.innerHTML = projects.map(p => {
    const budget = p.contract_value || p.budget || 0;
    const pct = budget > 0 ? Math.min(((p.spent || 0) / budget) * 100, 100) : 0;
    const fillClass = pct > 90 ? 'danger' : pct > 75 ? 'warning' : '';
    const tradeLabel = (p.project_type || p.trade || 'general').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const clientName = p.client_name || p.client || 'No client';
    const startDate = p.start_date ? new Date(p.start_date).toLocaleDateString('en-CA') : null;
    const finishDate = p.scheduled_finish_date ? new Date(p.scheduled_finish_date).toLocaleDateString('en-CA') : null;
    
    // Calculate scope of work progress
    const sow = p.scope_of_work || [];
    const sowTotal = sow.length;
    const sowCompleted = sow.filter(item => item.completed).length;
    const sowProgress = sowTotal > 0 ? Math.round((sowCompleted / sowTotal) * 100) : 0;
    
    // Check if overdue
    const isOverdue = finishDate && new Date(p.scheduled_finish_date) < new Date() && p.status !== 'completed';
    
    return `
      <div class="project-card">
        <div class="project-card-header">
          <div class="project-name" style="flex:1">${p.name}</div>
          <div style="display:flex;gap:8px;margin-left:10px">
            <button onclick="openEditProjectModal('${p.id}')" title="Edit Project" style="background:transparent;border:none;cursor:pointer;padding:4px">
              ✏️
            </button>
            <button onclick="showClientLinkModal('${p.id}')" title="Share with Client" style="background:transparent;border:none;cursor:pointer;padding:4px">
              🔗
            </button>
          </div>
        </div>
        <div class="project-client">👤 ${clientName}</div>
        <span class="proj-type-badge">🔧 ${tradeLabel}</span>
        ${p.address ? `<div style=\&quot;font-size:12px;color:var(--text-muted);margin-top:.3rem\&quot;>📍 ${escapeHtml(p.address || '')}</div>` : ''}
        ${(startDate || finishDate) ? `
          <div class="proj-dates">
            ${startDate ? `<span>📅 Start: ${startDate}</span>` : ''}
            ${finishDate ? `<span style="${isOverdue ? 'color:#dc3545;font-weight:bold' : ''}">🏁 Finish: ${finishDate}${isOverdue ? ' (OVERDUE)' : ''}</span>` : ''}
          </div>
        ` : ''}
        ${budget > 0 ? `
          <div class="project-budget-bar">
            <div class="budget-label">
              <span>Contract: ${formatCurrency(budget)}</span>
              <span>${pct.toFixed(0)}% used</span>
            </div>
            <div class="budget-bar"><div class="budget-fill ${fillClass}" style="width:${pct}%"></div></div>
          </div>
        ` : ''}
        ${sowTotal > 0 ? `
          <div style="margin-top:12px;padding:10px;background:#f8f9fa;border-radius:6px">
            <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:#666;margin-bottom:5px">
              <span>📋 Scope Progress</span>
              <span>${sowProgress}% (${sowCompleted}/${sowTotal})</span>
            </div>
            <div style="height:6px;background:#e9ecef;border-radius:3px;overflow:hidden">
              <div style="height:100%;width:${sowProgress}%;background:linear-gradient(90deg,#0d6efd 0%,#00b894 100%)"></div>
            </div>
            ${sowProgress < 100 ? `
              <button onclick="showProjectDetails('${p.id}')" style="margin-top:8px;padding:0;color:#0d6efd;text-decoration:none;font-size:0.85rem;cursor:pointer;background:none;border:none">
                View Scope →
              </button>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function filterProjects(filter) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  renderProjects(filter);
}

// ═══════════════════════════════════════════════════════════════
// PAYROLL SYSTEM – Full Implementation
// ═══════════════════════════════════════════════════════════════

// ── In-memory stores ──────────────────────────────────────────
// BUG-013 FIX: payrollStore now lives inside unified store.payroll
// Use store.payroll.employees, store.payroll.contractors, etc.
const payrollStore = store.payroll; // alias for backward compatibility

function savePayrollStore() {
  // BUG-013 FIX: Save to unified store instead of fragmented keys
  localStorage.setItem('foreman_store', JSON.stringify(store));
  syncStore().catch(() => {});
}

// WCB rates by trade (2024)
const WCB_RATES = {
  framing: 0.0320, carpentry: 0.0280, electrical: 0.0210,
  plumbing: 0.0210, hvac: 0.0240, roofing: 0.0480,
  concrete: 0.0350, drywall: 0.0260, painting: 0.0220,
  excavation: 0.0380, general: 0.0250, supervisor: 0.0180
};

// Provincial income tax rates (simplified 2024)
const PROV_TAX = {
  AB: { rate: 0.10, credit: 21003 },
  BC: { rate: 0.0506, credit: 11981 },
  SK: { rate: 0.105, credit: 17661 },
  MB: { rate: 0.108, credit: 15780 },
  ON: { rate: 0.0505, credit: 11865 }
};

// Chart of Accounts definition
const CHART_OF_ACCOUNTS = [
  { num: '100', name: 'Sales', type: 'income' },
  { num: '101', name: 'Affiliate Income', type: 'income' },
  { num: '102', name: 'Returns & Allowances', type: 'income' },
  { num: '200', name: 'Advertising & Marketing', type: 'expense' },
  { num: '201', name: 'Contract Labour', type: 'expense' },
  { num: '202', name: 'Insurance', type: 'expense' },
  { num: '203', name: 'Legal & Professional', type: 'expense' },
  { num: '204', name: 'Office & Admin', type: 'expense' },
  { num: '205', name: 'Wages & Salaries', type: 'expense' },
  { num: '206', name: 'Meals & Entertainment', type: 'expense' },
  { num: '207', name: 'Software & Subscriptions', type: 'expense' },
  { num: '208', name: 'Fleet Fuel', type: 'expense' },
  { num: '209', name: 'Equipment Fuel', type: 'expense' },
  { num: '210', name: 'Consumables & Supplies', type: 'expense' },
  { num: '211', name: 'Other Expenses', type: 'expense' },
  { num: '212', name: 'Equipment Rentals', type: 'expense' },
  { num: '213', name: 'Loan Payments', type: 'expense' },
  { num: '214', name: 'Fleet Maintenance', type: 'expense' },
  { num: '300', name: "Owner's Contribution", type: 'other' },
  { num: '301', name: "Owner's Draws", type: 'other' },
  { num: '302', name: 'Transfers Between Accounts', type: 'other' }
];

const PAY_PERIODS = [
  { key: 'sept-oct-2024', label: 'Sept-Oct Cheq 2024' },
  { key: 'oct-nov-2024', label: 'Oct-Nov Cheq 2024' },
  { key: 'nov-dec-2024', label: 'Nov-Dec Cheq 2024' },
  { key: 'dec-jan-2025', label: 'Dec-Jan Cheq 2025' }
];

// ── Tab Navigation ────────────────────────────────────────────
function showPayrollTab(tab, btn) {
  document.querySelectorAll('.payroll-tab-content').forEach(function(el) { el.style.display = 'none'; });
  var content = document.getElementById('ptab-content-' + tab);
  if (content) content.style.display = 'block';
  document.querySelectorAll('[id^="ptab-"]').forEach(function(b) { b.classList.remove('active'); });
  var tabBtn = document.getElementById('ptab-' + tab);
  if (tabBtn) tabBtn.classList.add('active');
  if (tab === 'employees') renderEmployees();
  if (tab === 'contractors') renderContractors();
  if (tab === 'history') renderPayrollHistory();
  if (tab === 'chart') renderChartOfAccounts();
  if (tab === 'bank') renderTransactions();
  if (tab === 'tax') renderTaxSummary();
  if (tab === 'backdate') renderBackdateTabs();
  if (tab === 'run') populateWorkerSelect();
}

// ── Worker Select Prefill ─────────────────────────────────────
function populateWorkerSelect() {
  var sel = document.getElementById('pay-worker-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select or enter manually —</option>';
  payrollStore.employees.forEach(function(e, i) {
    sel.innerHTML += '<option value="emp-' + i + '">' + e.name + ' (Employee)</option>';
  });
  payrollStore.contractors.forEach(function(c, i) {
    sel.innerHTML += '<option value="con-' + i + '">' + c.name + ' (Contractor)</option>';
  });
}

function prefillWorker() {
  var val = document.getElementById('pay-worker-select').value;
  if (!val) return;
  var parts = val.split('-');
  var type = parts[0];
  var idx = parseInt(parts[1]);
  var worker = type === 'emp' ? payrollStore.employees[idx] : payrollStore.contractors[idx];
  if (!worker) return;
  document.getElementById('pay-name').value = worker.name;
  document.getElementById('pay-trade').value = worker.trade || 'general';
  if (worker.rate) document.getElementById('pay-rate').value = worker.rate;
  document.getElementById('pay-type').value = type === 'con' ? 'contractor' : (worker.payType || 'hourly');
  togglePayType();
  calcPayroll();
}

function togglePayType() {
  var type = document.getElementById('pay-type').value;
  var hoursGroup = document.getElementById('pay-hours-group');
  var rateLabel = document.getElementById('pay-rate-label');
  if (type === 'salary') {
    if (hoursGroup) hoursGroup.style.display = 'none';
    if (rateLabel) rateLabel.textContent = 'Annual Salary ($)';
  } else if (type === 'contractor') {
    if (hoursGroup) hoursGroup.style.display = '';
    if (rateLabel) rateLabel.textContent = 'Rate ($)';
  } else {
    if (hoursGroup) hoursGroup.style.display = '';
    if (rateLabel) rateLabel.textContent = 'Hourly Rate ($)';
  }
  calcPayroll();
}

// ── Payroll Calculator ────────────────────────────────────────
function calcPayroll() {
  var typeEl = document.getElementById('pay-type');
  var type = typeEl ? typeEl.value : 'hourly';
  var hoursEl = document.getElementById('pay-hours');
  var hours = hoursEl ? (parseFloat(hoursEl.value) || 0) : 0;
  var rateEl = document.getElementById('pay-rate');
  var rate = rateEl ? (parseFloat(rateEl.value) || 0) : 0;
  var otEl = document.getElementById('pay-ot-hours');
  var otHours = otEl ? (parseFloat(otEl.value) || 0) : 0;
  var tradeEl = document.getElementById('pay-trade');
  var trade = tradeEl ? tradeEl.value : 'general';
  var provEl = document.getElementById('pay-province');
  var province = provEl ? provEl.value : 'AB';
  var vacEl = document.getElementById('pay-vacation');
  var vacPct = vacEl ? (parseFloat(vacEl.value) || 0.04) : 0.04;
  var extraEl = document.getElementById('pay-extra-deductions');
  var extraDed = extraEl ? (parseFloat(extraEl.value) || 0) : 0;
  var bonusEl = document.getElementById('pay-bonus');
  var bonus = bonusEl ? (parseFloat(bonusEl.value) || 0) : 0;

  var gross = 0;
  if (type === 'hourly') {
    gross = (hours * rate) + (otHours * rate * 1.5) + bonus;
  } else if (type === 'salary') {
    var periodEl = document.getElementById('pay-period');
    var period = periodEl ? periodEl.value : 'biweekly';
    var divisor = period === 'weekly' ? 52 : period === 'monthly' ? 12 : period === 'semimonthly' ? 24 : 26;
    gross = (rate / divisor) + bonus;
  } else {
    gross = (hours * rate) + (otHours * rate * 1.5) + bonus;
  }

  var wcbRate = WCB_RATES[trade] || 0.025;
  var isContractor = type === 'contractor';

  var cppExemption = 134.62;
  var cppBase = Math.max(0, gross - cppExemption);
  var cpp = isContractor ? 0 : cppBase * 0.0595;
  var ei = isContractor ? 0 : gross * 0.0166;
  var vacPay = isContractor ? 0 : gross * vacPct;

  var annualGross = gross * 26;
  var fedTaxAnnual = 0;
  if (annualGross > 246752) fedTaxAnnual = annualGross * 0.33;
  else if (annualGross > 111733) fedTaxAnnual = annualGross * 0.26;
  else if (annualGross > 55867) fedTaxAnnual = annualGross * 0.205;
  else if (annualGross > 15705) fedTaxAnnual = annualGross * 0.205;
  else fedTaxAnnual = annualGross * 0.15;
  fedTaxAnnual = Math.max(0, fedTaxAnnual - 2355.75);
  var fedTax = isContractor ? 0 : fedTaxAnnual / 26;

  var provInfo = PROV_TAX[province] || PROV_TAX.AB;
  var provTaxAnnual = Math.max(0, (annualGross - provInfo.credit) * provInfo.rate);
  var provTax = isContractor ? 0 : provTaxAnnual / 26;

  var totalTax = fedTax + provTax;
  var totalDeductions = cpp + ei + totalTax + extraDed;
  var net = gross - totalDeductions + (isContractor ? 0 : vacPay);

  var empCpp = isContractor ? 0 : cpp;
  var empEi = isContractor ? 0 : ei * 1.4;
  var wcb = gross * wcbRate;
  var totalCost = gross + empCpp + empEi + wcb + (isContractor ? 0 : vacPay);
  var remittance = cpp + ei + totalTax + empCpp + empEi;

  function set(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }
  set('pb-gross', formatCurrency(gross));
  set('pb-cpp', isContractor ? 'N/A (T4A)' : '-' + formatCurrency(cpp));
  set('pb-ei', isContractor ? 'N/A (T4A)' : '-' + formatCurrency(ei));
  set('pb-fed-tax', isContractor ? 'Withheld by payer' : '-' + formatCurrency(fedTax));
  set('pb-prov-tax', isContractor ? '' : '-' + formatCurrency(provTax));
  set('pb-vac', isContractor ? '$0.00' : '+' + formatCurrency(vacPay));
  set('pb-extra', extraDed > 0 ? '-' + formatCurrency(extraDed) : '$0.00');
  set('pb-net', formatCurrency(Math.max(0, net)));
  set('pb-emp-cpp', formatCurrency(empCpp));
  set('pb-emp-ei', formatCurrency(empEi));
  set('pb-wcb-rate', (wcbRate * 100).toFixed(2));
  set('pb-wcb', formatCurrency(wcb));
  set('pb-total', formatCurrency(totalCost));
  set('pb-remittance', formatCurrency(remittance));
  set('pb-wcb-remit', formatCurrency(wcb));
  // Also update display rows
  var hoursEl2 = document.getElementById('pay-hours');
  var rateEl2 = document.getElementById('pay-rate');
  var otEl2 = document.getElementById('pay-ot-hours');
  var bonusEl2 = document.getElementById('pay-bonus');
  var hrs = hoursEl2 ? (parseFloat(hoursEl2.value)||0) : 0;
  var rt = rateEl2 ? (parseFloat(rateEl2.value)||0) : 0;
  var ot = otEl2 ? (parseFloat(otEl2.value)||0) : 0;
  var bn = bonusEl2 ? (parseFloat(bonusEl2.value)||0) : 0;
  set('pb-hrs', hrs);
  set('pb-rate-disp', rt);
  set('pb-regular', formatCurrency(hrs * rt));
  var otRow = document.getElementById('pb-ot-row');
  if (otRow) otRow.style.display = ot > 0 ? '' : 'none';
  set('pb-ot-hrs', ot);
  set('pb-ot', formatCurrency(ot * rt * 1.5));
  var bonusRow = document.getElementById('pb-bonus-row');
  if (bonusRow) bonusRow.style.display = bn > 0 ? '' : 'none';
  set('pb-bonus-disp', formatCurrency(bn));
  var extraRow = document.getElementById('pb-extra-row');
  if (extraRow) extraRow.style.display = extraDed > 0 ? '' : 'none';
}

async function postPayroll() {
  var name = document.getElementById('pay-name').value.trim();
  var type = document.getElementById('pay-type').value;
  var hoursEl = document.getElementById('pay-hours');
  var hours = hoursEl ? (parseFloat(hoursEl.value) || 0) : 0;
  var rate = parseFloat(document.getElementById('pay-rate').value) || 0;
  var otEl = document.getElementById('pay-ot-hours');
  var otHours = otEl ? (parseFloat(otEl.value) || 0) : 0;
  var trade = document.getElementById('pay-trade').value;
  var period = document.getElementById('pay-period').value;
  var province = document.getElementById('pay-province').value;
  var bonusEl = document.getElementById('pay-bonus');
  var bonus = bonusEl ? (parseFloat(bonusEl.value) || 0) : 0;

  if (!name) { showToast('Enter worker name', 'error'); return; }
  if (!rate) { showToast('Enter pay rate', 'error'); return; }

  var isContractor = type === 'contractor';
  var gross = 0;
  if (type === 'salary') {
    var divisor = period === 'weekly' ? 52 : period === 'monthly' ? 12 : period === 'semimonthly' ? 24 : 26;
    gross = (rate / divisor) + bonus;
  } else {
    gross = (hours * rate) + (otHours * rate * 1.5) + bonus;
  }

  if (!gross) { showToast('Gross pay is $0 – check hours/rate', 'error'); return; }

  var wcbRate = WCB_RATES[trade] || 0.025;
  var cpp = isContractor ? 0 : Math.max(0, gross - 134.62) * 0.0595;
  var ei = isContractor ? 0 : gross * 0.0166;
  var vacPay = isContractor ? 0 : gross * 0.04;
  var fedTax = isContractor ? 0 : gross * 0.15;
  var provInfo = PROV_TAX[province] || PROV_TAX.AB;
  var provTax = isContractor ? 0 : gross * provInfo.rate * 0.5;
  var wcb = gross * wcbRate;

  var entry = {
    id: Date.now(),
    date: new Date().toISOString().split('T')[0],
    name: name, type: type, trade: trade, period: period, province: province,
    hours: hours, otHours: otHours, rate: rate, bonus: bonus, gross: gross,
    cpp: cpp, ei: ei, fedTax: fedTax, provTax: provTax, vacPay: vacPay, wcb: wcb,
    net: gross - cpp - ei - fedTax - provTax + vacPay,
    totalCost: gross + cpp + ei * 1.4 + wcb + vacPay,
    isContractor: isContractor
  };

  payrollStore.history.push(entry);

  var acct = isContractor ? '201' : '205';
  payrollStore.transactions.push({
    id: Date.now() + 1,
    date: entry.date,
    type: 'expense',
    account: acct,
    period: period,
    amount: gross,
    payee: name,
    desc: (isContractor ? 'Contract Labour' : 'Wages') + ' - ' + name,
    ref: 'PAY-' + entry.id
  });
  savePayrollStore();

  try {
    await apiPost('/api/ledger/transactions/payroll', {
      employee_name: name, gross_wages: gross,
      cpp_employee: cpp, ei_employee: ei,
      income_tax: fedTax + provTax, wcb_premium: wcb
    });
  } catch(e) { /* local only */ }

  showToast('Payroll posted for ' + name + ' - ' + formatCurrency(gross) + ' gross', 'success');
  renderPayrollHistory();
  renderChartOfAccounts();
}

// ── Employee CRUD ─────────────────────────────────────────────
function saveEmployee() {
  var name = document.getElementById('emp-name').value.trim();
  if (!name) { showToast('Name is required', 'error'); return; }
  var emp = {
    id: Date.now(),
    name: name,
    sin: document.getElementById('emp-sin').value.trim(),
    trade: document.getElementById('emp-trade').value,
    payType: document.getElementById('emp-pay-type').value,
    rate: parseFloat(document.getElementById('emp-rate').value) || 0,
    province: document.getElementById('emp-province').value,
    email: document.getElementById('emp-email').value.trim(),
    phone: document.getElementById('emp-phone').value.trim(),
    startDate: document.getElementById('emp-start-date').value,
    td1: document.getElementById('emp-td1').value,
    notes: document.getElementById('emp-notes').value.trim(),
    type: 'employee'
  };
  payrollStore.employees.push(emp);
  savePayrollStore();
  closeModal('add-employee-modal');
  renderEmployees();
  showToast('Employee ' + name + ' added', 'success');
}

function renderEmployees() {
  var container = document.getElementById('employee-list');
  if (!container) return;
  if (!payrollStore.employees.length) {
    container.innerHTML = '<div class="empty-state-sm">No employees added yet. Add your first employee to get started.</div>';
    return;
  }
  container.innerHTML = payrollStore.employees.map(function(e, i) {
    var empId = e.id || i;
    return '<div class="worker-card">' +
      '<div class="worker-avatar">' + e.name.charAt(0).toUpperCase() + '</div>' +
      '<div class="worker-info">' +
        '<div class="worker-name">' + e.name + '</div>' +
        '<div class="worker-meta">' + e.trade + ' &middot; ' + (e.payType === 'hourly' ? '$' + e.rate + '/hr' : '$' + e.rate.toLocaleString() + '/yr') + ' &middot; ' + e.province + '</div>' +
        '<div class="worker-meta">' + (e.email || '') + (e.phone ? ' &middot; ' + e.phone : '') + '</div>' +
      '</div>' +
      '<span class="worker-badge employee">Employee</span>' +
      '<div class="worker-actions">' +
        '<button class="btn-secondary btn-sm" onclick="loadWorkerToPayroll(\'emp\',' + i + ')">💵 Pay</button>' +
        '<button class="btn-secondary btn-sm" onclick="generatePaystub(' + i + ')">📄 Stub</button>' +
        '<button class="btn-secondary btn-sm" onclick="generateTD1(' + i + ')">🍁 TD1</button>' +
        '<button class="btn-secondary btn-sm" onclick="generateT4(' + i + ')">📋 T4</button>' +
        '<button class="btn-secondary btn-sm" style="color:#ef4444;border-color:#ef4444" onclick="removeEmployee(' + i + ')">Remove</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function removeEmployee(i) {
  if (!confirm('Remove this employee?')) return;
  payrollStore.employees.splice(i, 1);
  savePayrollStore();
  renderEmployees();
}

function loadWorkerToPayroll(type, idx) {
  showPayrollTab('run', document.getElementById('ptab-run'));
  var worker = type === 'emp' ? payrollStore.employees[idx] : payrollStore.contractors[idx];
  if (!worker) return;
  document.getElementById('pay-name').value = worker.name;
  document.getElementById('pay-trade').value = worker.trade || 'general';
  if (worker.rate) document.getElementById('pay-rate').value = worker.rate;
  document.getElementById('pay-type').value = type === 'con' ? 'contractor' : (worker.payType || 'hourly');
  togglePayType();
  calcPayroll();
}

// ── Contractor CRUD ───────────────────────────────────────────
function saveContractor() {
  var name = document.getElementById('con-name').value.trim();
  if (!name) { showToast('Name is required', 'error'); return; }
  var con = {
    id: Date.now(),
    name: name,
    bn: document.getElementById('con-bn').value.trim(),
    trade: document.getElementById('con-trade').value,
    rate: parseFloat(document.getElementById('con-rate').value) || 0,
    email: document.getElementById('con-email').value.trim(),
    phone: document.getElementById('con-phone').value.trim(),
    gst: document.getElementById('con-gst').value,
    wcb: document.getElementById('con-wcb').value,
    address: document.getElementById('con-address').value.trim(),
    notes: document.getElementById('con-notes').value.trim(),
    type: 'contractor',
    ytdPaid: 0
  };
  payrollStore.contractors.push(con);
  savePayrollStore();
  closeModal('add-contractor-modal');
  renderContractors();
  showToast('Contractor ' + name + ' added', 'success');
}

function renderContractors() {
  var container = document.getElementById('contractor-list');
  if (!container) return;
  if (!payrollStore.contractors.length) {
    container.innerHTML = '<div class="empty-state-sm">No contractors added yet.</div>';
    return;
  }
  container.innerHTML = payrollStore.contractors.map(function(c, i) {
    return '<div class="worker-card">' +
      '<div class="worker-avatar" style="background:linear-gradient(135deg,#e65100,#ff6d00)">' + c.name.charAt(0).toUpperCase() + '</div>' +
      '<div class="worker-info">' +
        '<div class="worker-name">' + c.name + '</div>' +
        '<div class="worker-meta">' + c.trade + ' &middot; ' + (c.rate ? '$' + c.rate + '/hr' : 'Rate TBD') + ' &middot; WCB: ' + c.wcb + '</div>' +
        '<div class="worker-meta">YTD Paid: ' + formatCurrency(c.ytdPaid || 0) + (c.ytdPaid >= 500 ? ' ⚠️ T4A Required' : '') + '</div>' +
      '</div>' +
      '<span class="worker-badge contractor">Contractor</span>' +
      '<div class="worker-actions">' +
        '<button class="btn-secondary btn-sm" onclick="loadWorkerToPayroll(\'con\',' + i + ')">Pay</button>' +
        '<button class="btn-secondary btn-sm" onclick="removeContractor(' + i + ')">Remove</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function removeContractor(i) {
  if (!confirm('Remove this contractor?')) return;
  payrollStore.contractors.splice(i, 1);
  savePayrollStore();
  renderContractors();
}

// ── Payroll History ───────────────────────────────────────────
function renderPayrollHistory() {
  var container = document.getElementById('payroll-history-table');
  var ytdContainer = document.getElementById('payroll-ytd-summary');
  if (!container) return;

  var yearFilter = document.getElementById('payroll-filter-year');
  var workerFilter = document.getElementById('payroll-filter-worker');

  var years = [];
  payrollStore.history.forEach(function(h) {
    var y = h.date.substring(0,4);
    if (years.indexOf(y) < 0) years.push(y);
  });
  years.sort().reverse();

  if (yearFilter) {
    var curYear = yearFilter.value;
    yearFilter.innerHTML = '<option value="all">All Years</option>' +
      years.map(function(y) { return '<option value="' + y + '" ' + (y === curYear ? 'selected' : '') + '>' + y + '</option>'; }).join('');
  }

  var workers = [];
  payrollStore.history.forEach(function(h) { if (workers.indexOf(h.name) < 0) workers.push(h.name); });
  workers.sort();

  if (workerFilter) {
    var curWorker = workerFilter.value;
    workerFilter.innerHTML = '<option value="all">All Workers</option>' +
      workers.map(function(w) { return '<option value="' + w + '" ' + (w === curWorker ? 'selected' : '') + '>' + w + '</option>'; }).join('');
  }

  var selYear = yearFilter ? yearFilter.value : 'all';
  var selWorker = workerFilter ? workerFilter.value : 'all';

  var filtered = payrollStore.history.filter(function(h) {
    if (selYear !== 'all' && !h.date.startsWith(selYear)) return false;
    if (selWorker !== 'all' && h.name !== selWorker) return false;
    return true;
  });

  var ytdGross = filtered.reduce(function(s,h){return s+h.gross;},0);
  var ytdNet = filtered.reduce(function(s,h){return s+h.net;},0);
  var ytdCpp = filtered.reduce(function(s,h){return s+h.cpp;},0);
  var ytdEi = filtered.reduce(function(s,h){return s+h.ei;},0);
  var ytdTax = filtered.reduce(function(s,h){return s+h.fedTax+h.provTax;},0);
  var ytdWcb = filtered.reduce(function(s,h){return s+h.wcb;},0);

  if (ytdContainer) {
    var cards = [
      {label:'Gross Wages',value:ytdGross},{label:'Net Pay',value:ytdNet},
      {label:'CPP Deducted',value:ytdCpp},{label:'EI Deducted',value:ytdEi},
      {label:'Income Tax',value:ytdTax},{label:'WCB Premiums',value:ytdWcb}
    ];
    ytdContainer.innerHTML = cards.map(function(c) {
      return '<div class="ytd-card"><div class="ytd-label">' + c.label + '</div><div class="ytd-value">' + formatCurrency(c.value) + '</div></div>';
    }).join('');
  }

  if (!filtered.length) {
    container.innerHTML = '<div class="empty-state-sm">No payroll entries for this filter.</div>';
    return;
  }

  var rows = '';
  filtered.forEach(function(h, i) {
    rows += '<tr>' +
      '<td>' + h.date + '</td>' +
      '<td>' + h.name + '</td>' +
      '<td><span class="worker-badge ' + (h.isContractor ? 'contractor' : 'employee') + '">' + (h.isContractor ? 'T4A' : 'T4') + '</span></td>' +
      '<td>' + h.trade + '</td>' +
      '<td>' + formatCurrency(h.gross) + '</td>' +
      '<td>' + (h.isContractor ? '-' : formatCurrency(h.cpp)) + '</td>' +
      '<td>' + (h.isContractor ? '-' : formatCurrency(h.ei)) + '</td>' +
      '<td>' + (h.isContractor ? '-' : formatCurrency(h.fedTax + h.provTax)) + '</td>' +
      '<td><strong>' + formatCurrency(h.net) + '</strong></td>' +
      '<td><button class="btn-secondary btn-sm" onclick="printPayStub(' + i + ')">Print</button></td>' +
    '</tr>';
  });

  container.innerHTML = '<table class="payroll-hist-table"><thead><tr>' +
    '<th>Date</th><th>Worker</th><th>Type</th><th>Trade</th>' +
    '<th>Gross</th><th>CPP</th><th>EI</th><th>Tax</th><th>Net Pay</th><th>Actions</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function exportPayrollCSV() {
  var rows = [['Date','Worker','Type','Trade','Gross','CPP','EI','Fed Tax','Prov Tax','Vac Pay','WCB','Net Pay','Total Cost']];
  payrollStore.history.forEach(function(h) {
    rows.push([h.date, h.name, h.isContractor ? 'Contractor' : 'Employee', h.trade,
      h.gross.toFixed(2), h.cpp.toFixed(2), h.ei.toFixed(2), h.fedTax.toFixed(2),
      h.provTax.toFixed(2), h.vacPay.toFixed(2), h.wcb.toFixed(2), h.net.toFixed(2), h.totalCost.toFixed(2)]);
  });
  downloadCSV(rows, 'payroll_history.csv');
}

function printPayStub(idx) {
  var h;
  if (idx !== undefined) {
    h = payrollStore.history[idx];
  } else {
    // Build from current calculator values
    var name = document.getElementById('pay-name') ? document.getElementById('pay-name').value.trim() : '';
    var type = document.getElementById('pay-type') ? document.getElementById('pay-type').value : 'hourly';
    var hours = document.getElementById('pay-hours') ? (parseFloat(document.getElementById('pay-hours').value)||0) : 0;
    var rate = document.getElementById('pay-rate') ? (parseFloat(document.getElementById('pay-rate').value)||0) : 0;
    var otHours = document.getElementById('pay-ot-hours') ? (parseFloat(document.getElementById('pay-ot-hours').value)||0) : 0;
    var trade = document.getElementById('pay-trade') ? document.getElementById('pay-trade').value : 'general';
    var period = document.getElementById('pay-period') ? document.getElementById('pay-period').value : 'biweekly';
    var province = document.getElementById('pay-province') ? document.getElementById('pay-province').value : 'AB';
    var bonus = document.getElementById('pay-bonus') ? (parseFloat(document.getElementById('pay-bonus').value)||0) : 0;
    var gross = (hours * rate) + (otHours * rate * 1.5) + bonus;
    var isContractor = type === 'contractor';
    var cpp = isContractor ? 0 : Math.max(0, gross - 134.62) * 0.0595;
    var ei = isContractor ? 0 : gross * 0.0166;
    var fedTax = isContractor ? 0 : gross * 0.15;
    var provTax = isContractor ? 0 : gross * 0.05;
    var vacPay = isContractor ? 0 : gross * 0.04;
    var wcb = gross * (WCB_RATES[trade] || 0.025);
    h = {
      name: name || 'Worker', date: new Date().toISOString().split('T')[0],
      trade: trade, period: period, province: province,
      hours: hours, otHours: otHours, rate: rate, bonus: bonus, gross: gross,
      cpp: cpp, ei: ei, fedTax: fedTax, provTax: provTax, vacPay: vacPay, wcb: wcb,
      net: gross - cpp - ei - fedTax - provTax + vacPay,
      totalCost: gross + cpp + ei * 1.4 + wcb + vacPay,
      isContractor: isContractor
    };
  }
  if (!h) return;
  var w = window.open('', '_blank');
  w.document.write('<html><head><title>Pay Stub - ' + h.name + '</title>' +
    '<style>body{font-family:Arial,sans-serif;max-width:600px;margin:40px auto;color:#222}' +
    'h2{border-bottom:2px solid #1a237e;padding-bottom:8px}' +
    'table{width:100%;border-collapse:collapse;margin:16px 0}' +
    'td{padding:6px 12px;border-bottom:1px solid #eee}' +
    '.right{text-align:right}.total{font-weight:bold;font-size:1.1em}' +
    '.section{background:#f5f5f5;font-weight:bold;color:#1a237e}' +
    '</style></head><body>' +
    '<h2>Pay Stub</h2>' +
    '<p><strong>Employee:</strong> ' + h.name + ' <strong>Date:</strong> ' + h.date + '</p>' +
    '<p><strong>Trade:</strong> ' + h.trade + ' <strong>Period:</strong> ' + h.period + ' <strong>Province:</strong> ' + h.province + '</p>' +
    '<table>' +
    '<tr class="section"><td colspan="2">Earnings</td></tr>' +
    '<tr><td>Regular Pay (' + h.hours + 'h x $' + h.rate + ')</td><td class="right">$' + (h.hours * h.rate).toFixed(2) + '</td></tr>' +
    (h.bonus > 0 ? '<tr><td>Bonus</td><td class="right">$' + h.bonus.toFixed(2) + '</td></tr>' : '') +
    '<tr><td><strong>Gross Pay</strong></td><td class="right"><strong>$' + h.gross.toFixed(2) + '</strong></td></tr>' +
    (!h.isContractor ?
      '<tr class="section"><td colspan="2">Deductions</td></tr>' +
      '<tr><td>CPP (5.95%)</td><td class="right">-$' + h.cpp.toFixed(2) + '</td></tr>' +
      '<tr><td>EI (1.66%)</td><td class="right">-$' + h.ei.toFixed(2) + '</td></tr>' +
      '<tr><td>Federal Income Tax</td><td class="right">-$' + h.fedTax.toFixed(2) + '</td></tr>' +
      '<tr><td>Provincial Tax (' + h.province + ')</td><td class="right">-$' + h.provTax.toFixed(2) + '</td></tr>' +
      '<tr><td>Vacation Pay (4%)</td><td class="right">+$' + h.vacPay.toFixed(2) + '</td></tr>'
      : '<tr><td colspan="2">Contractor - T4A issued. No CPP/EI deducted.</td></tr>') +
    '<tr class="total"><td>NET PAY</td><td class="right">$' + h.net.toFixed(2) + '</td></tr>' +
    '<tr class="section"><td colspan="2">Employer Costs</td></tr>' +
    '<tr><td>Employer CPP Match</td><td class="right">$' + h.cpp.toFixed(2) + '</td></tr>' +
    '<tr><td>Employer EI (x1.4)</td><td class="right">$' + (h.ei * 1.4).toFixed(2) + '</td></tr>' +
    '<tr><td>WCB Premium</td><td class="right">$' + h.wcb.toFixed(2) + '</td></tr>' +
    '<tr class="total"><td>Total Labour Cost</td><td class="right">$' + h.totalCost.toFixed(2) + '</td></tr>' +
    '</table>' +
    '<p style="font-size:.8em;color:#666">Generated by Foreman App - ' + new Date().toLocaleDateString() + '</p>' +
    '</body></html>');
  w.document.close();
  w.print();
}

// ── Chart of Accounts ─────────────────────────────────────────
function renderChartOfAccounts() {
  var tbody = document.getElementById('coa-tbody');
  if (!tbody) return;

  var periodSel = document.getElementById('coa-period-select');
  if (periodSel && periodSel.options.length <= 1) {
    periodSel.innerHTML = PAY_PERIODS.map(function(p) {
      return '<option value="' + p.key + '">' + p.label + '</option>';
    }).join('') + '<option value="all">All Periods (YTD)</option>';
  }

  var totals = {};
  CHART_OF_ACCOUNTS.forEach(function(a) {
    totals[a.num] = { p1: 0, p2: 0, p3: 0, p4: 0 };
  });

  payrollStore.history.forEach(function(h) {
    var acct = h.isContractor ? '201' : '205';
    var pIdx = PAY_PERIODS.findIndex(function(p) { return p.key === h.period; });
    if (pIdx >= 0 && totals[acct]) {
      var key = 'p' + (pIdx + 1);
      totals[acct][key] = (totals[acct][key] || 0) + h.gross;
    }
  });

  payrollStore.transactions.forEach(function(t) {
    var pIdx = PAY_PERIODS.findIndex(function(p) { return p.key === t.period; });
    if (pIdx >= 0 && totals[t.account]) {
      var key = 'p' + (pIdx + 1);
      totals[t.account][key] = (totals[t.account][key] || 0) + t.amount;
    }
  });

  PAY_PERIODS.forEach(function(p, i) {
    var col = document.getElementById('coa-col-' + (i + 1));
    if (col) col.textContent = p.label;
  });

  var html = '';
  var sections = [
    { label: 'INCOME', accounts: CHART_OF_ACCOUNTS.filter(function(a){return a.type==='income';}) },
    { label: 'EXPENSES', accounts: CHART_OF_ACCOUNTS.filter(function(a){return a.type==='expense';}) },
    { label: 'OTHER NON-P&L', accounts: CHART_OF_ACCOUNTS.filter(function(a){return a.type==='other';}) }
  ];

  var grandIncome = { p1:0, p2:0, p3:0, p4:0 };
  var grandExpense = { p1:0, p2:0, p3:0, p4:0 };

  sections.forEach(function(sec) {
    html += '<tr class="coa-section-header"><td colspan="7">' + sec.label + '</td></tr>';
    var secTotals = { p1:0, p2:0, p3:0, p4:0 };

    sec.accounts.forEach(function(acct) {
      var t = totals[acct.num] || { p1:0, p2:0, p3:0, p4:0 };
      var ytd = t.p1 + t.p2 + t.p3 + t.p4;
      secTotals.p1 += t.p1; secTotals.p2 += t.p2; secTotals.p3 += t.p3; secTotals.p4 += t.p4;
      if (sec.label === 'INCOME') { grandIncome.p1+=t.p1; grandIncome.p2+=t.p2; grandIncome.p3+=t.p3; grandIncome.p4+=t.p4; }
      else if (sec.label === 'EXPENSES') { grandExpense.p1+=t.p1; grandExpense.p2+=t.p2; grandExpense.p3+=t.p3; grandExpense.p4+=t.p4; }
      var isIncome = sec.label === 'INCOME';
      html += '<tr>' +
        '<td style="padding-left:1.5rem;color:var(--text-muted)">' + acct.num + '</td>' +
        '<td>' + acct.name + '</td>' +
        [t.p1, t.p2, t.p3, t.p4].map(function(v) {
          return '<td class="coa-amount ' + (v > 0 ? (isIncome ? 'positive' : 'negative') : '') + '">' + (v > 0 ? formatCurrency(v) : '-') + '</td>';
        }).join('') +
        '<td class="coa-amount" style="color:var(--primary-light);font-weight:600">' + (ytd > 0 ? formatCurrency(ytd) : '-') + '</td>' +
      '</tr>';
    });

    var secYtd = secTotals.p1 + secTotals.p2 + secTotals.p3 + secTotals.p4;
    html += '<tr class="coa-total-row">' +
      '<td colspan="2" style="padding-left:1rem">Total ' + sec.label + '</td>' +
      [secTotals.p1, secTotals.p2, secTotals.p3, secTotals.p4].map(function(v) {
        return '<td class="coa-amount">' + formatCurrency(v) + '</td>';
      }).join('') +
      '<td class="coa-amount" style="font-weight:700">' + formatCurrency(secYtd) + '</td>' +
    '</tr>';
  });

  var netP1 = grandIncome.p1 - grandExpense.p1;
  var netP2 = grandIncome.p2 - grandExpense.p2;
  var netP3 = grandIncome.p3 - grandExpense.p3;
  var netP4 = grandIncome.p4 - grandExpense.p4;
  var netYtd = netP1 + netP2 + netP3 + netP4;
  html += '<tr style="background:rgba(26,35,126,.25);font-weight:700;font-size:.95rem">' +
    '<td colspan="2">NET INCOME (P&L)</td>' +
    [netP1, netP2, netP3, netP4].map(function(v) {
      return '<td class="coa-amount ' + (v >= 0 ? 'positive' : 'negative') + '">' + formatCurrency(v) + '</td>';
    }).join('') +
    '<td class="coa-amount ' + (netYtd >= 0 ? 'positive' : 'negative') + '" style="font-size:1rem">' + formatCurrency(netYtd) + '</td>' +
  '</tr>';

  tbody.innerHTML = html;
}

function exportCOACSV() {
  var rows = [['Account #', 'Account Name', 'Type', PAY_PERIODS[0].label, PAY_PERIODS[1].label, PAY_PERIODS[2].label, PAY_PERIODS[3].label, 'YTD Total']];
  CHART_OF_ACCOUNTS.forEach(function(acct) {
    var t = { p1:0, p2:0, p3:0, p4:0 };
    payrollStore.transactions.filter(function(tx){return tx.account===acct.num;}).forEach(function(tx) {
      var pIdx = PAY_PERIODS.findIndex(function(p){return p.key===tx.period;});
      if (pIdx >= 0) t['p'+(pIdx+1)] += tx.amount;
    });
    var ytd = t.p1+t.p2+t.p3+t.p4;
    rows.push([acct.num, acct.name, acct.type, t.p1.toFixed(2), t.p2.toFixed(2), t.p3.toFixed(2), t.p4.toFixed(2), ytd.toFixed(2)]);
  });
  downloadCSV(rows, 'chart_of_accounts.csv');
}

// ── Bank Feed / Transactions ──────────────────────────────────
function renderTransactions() {
  var container = document.getElementById('transactions-table-container');
  if (!container) return;

  if (!payrollStore.transactions.length) {
    container.innerHTML = '<div class="empty-state-sm">No transactions yet. Import a bank CSV or add manually.</div>';
    return;
  }

  var sorted = payrollStore.transactions.slice().sort(function(a,b){return b.date.localeCompare(a.date);});

  var html = '<div class="bank-txn-row bank-txn-header">' +
    '<span>Date</span><span>Description</span><span>Amount</span><span class="txn-classify">Account</span><span>Ref</span>' +
    '</div>';

  sorted.forEach(function(t) {
    var isCredit = t.type === 'income';
    var acctOptions = CHART_OF_ACCOUNTS.map(function(a) {
      return '<option value="' + a.num + '" ' + (a.num === t.account ? 'selected' : '') + '>' + a.num + ' - ' + a.name + '</option>';
    }).join('');
    html += '<div class="bank-txn-row">' +
      '<span>' + t.date + '</span>' +
      '<span>' + (t.desc || t.payee || '-') + '</span>' +
      '<span class="' + (isCredit ? 'txn-amount-credit' : 'txn-amount-debit') + '">' + (isCredit ? '+' : '-') + formatCurrency(t.amount) + '</span>' +
      '<span class="txn-classify"><select class="txn-classify-select" onchange="reclassifyTxn(' + t.id + ', this.value)">' + acctOptions + '</select></span>' +
      '<span style="font-size:.78rem;color:var(--text-muted)">' + (t.ref || '') + '</span>' +
    '</div>';
  });

  container.innerHTML = html;
}

function reclassifyTxn(id, newAccount) {
  var txn = payrollStore.transactions.find(function(t){return t.id===id;});
  if (txn) { txn.account = newAccount; savePayrollStore(); renderChartOfAccounts(); }
}

function addManualTransaction() {
  var date = document.getElementById('txn-date').value;
  var type = document.getElementById('txn-type').value;
  var account = document.getElementById('txn-account').value;
  var period = document.getElementById('txn-period').value;
  var amount = parseFloat(document.getElementById('txn-amount').value) || 0;
  var payee = document.getElementById('txn-payee').value.trim();
  var ref = document.getElementById('txn-ref').value.trim();
  var desc = document.getElementById('txn-desc').value.trim();
  var projectEl = document.getElementById('txn-project');
  var project = projectEl ? projectEl.value : '';

  if (!date || !amount) { showToast('Date and amount are required', 'error'); return; }

  payrollStore.transactions.push({
    id: Date.now(), date: date, type: type, account: account, period: period,
    amount: amount, payee: payee, ref: ref, desc: desc, project: project,
    gst: document.getElementById('txn-gst').value, source: 'manual'
  });
  savePayrollStore();
  closeModal('add-transaction-modal');
  renderTransactions();
  renderChartOfAccounts();
  showToast('Transaction saved', 'success');
}

function importBankCSV(event) {
  var fileInput = (event && event.target) ? event.target : document.getElementById('bank-csv-input');
  var file = fileInput;
  if (!file || !file.files[0]) { showToast('Select a CSV file first', 'error'); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    var lines = e.target.result.split('\n').filter(function(l){return l.trim();});
    var imported = 0;
    var bankFormatEl = document.getElementById('bank-format');
    var bankFormat = bankFormatEl ? bankFormatEl.value : 'generic';

    lines.slice(1).forEach(function(line) {
      var cols = line.split(',').map(function(c){return c.replace(/"/g,'').trim();});
      if (cols.length < 3) return;
      var date, desc, amount, ref = '';
      if (bankFormat === 'rbc') {
        date = cols[2]; desc = (cols[4] + ' ' + cols[5]).trim(); amount = Math.abs(parseFloat(cols[6])||0); ref = cols[3];
      } else if (bankFormat === 'td') {
        date = cols[0]; desc = cols[1];
        var debit = parseFloat(cols[2])||0; var credit = parseFloat(cols[3])||0;
        amount = debit || credit;
      } else if (bankFormat === 'atb') {
        date = cols[0]; desc = cols[1]; amount = Math.abs(parseFloat(cols[2])||0);
      } else {
        date = cols[0]; desc = cols[1]; amount = Math.abs(parseFloat(cols[2])||0);
      }
      if (!date || !amount) return;
      var account = autoClassify(desc);
      var dl = (desc||'').toLowerCase();
      var type = (dl.indexOf('deposit') >= 0 || dl.indexOf('payment received') >= 0) ? 'income' : 'expense';
      payrollStore.transactions.push({
        id: Date.now() + imported, date: normalizeDate(date), type: type,
        account: account, period: guessPeriod(date), amount: amount,
        desc: desc, ref: ref, source: 'csv-import'
      });
      imported++;
    });
    savePayrollStore();
    renderTransactions();
    renderChartOfAccounts();
    showToast('Imported ' + imported + ' transactions', 'success');
  };
  reader.readAsText(file.files[0]);
}

function autoClassify(desc) {
  var d = (desc||'').toLowerCase();
  if (d.indexOf('fuel') >= 0 || d.indexOf('gas') >= 0 || d.indexOf('petro') >= 0 || d.indexOf('esso') >= 0 || d.indexOf('shell') >= 0) return '208';
  if (d.indexOf('equipment') >= 0 || d.indexOf('rental') >= 0 || d.indexOf('rent') >= 0) return '212';
  if (d.indexOf('insurance') >= 0 || d.indexOf('intact') >= 0 || d.indexOf('wawanesa') >= 0) return '202';
  if (d.indexOf('legal') >= 0 || d.indexOf('lawyer') >= 0 || d.indexOf('accountant') >= 0 || d.indexOf('cpa') >= 0) return '203';
  if (d.indexOf('office') >= 0 || d.indexOf('staples') >= 0 || d.indexOf('supply') >= 0) return '204';
  if (d.indexOf('software') >= 0 || d.indexOf('subscription') >= 0 || d.indexOf('adobe') >= 0 || d.indexOf('microsoft') >= 0) return '207';
  if (d.indexOf('meal') >= 0 || d.indexOf('restaurant') >= 0 || d.indexOf('food') >= 0 || d.indexOf('tim horton') >= 0 || d.indexOf('mcdonald') >= 0) return '206';
  if (d.indexOf('advertising') >= 0 || d.indexOf('google') >= 0 || d.indexOf('facebook') >= 0 || d.indexOf('meta') >= 0) return '200';
  if (d.indexOf('loan') >= 0 || d.indexOf('mortgage') >= 0 || d.indexOf('finance') >= 0) return '213';
  if (d.indexOf('maintenance') >= 0 || d.indexOf('repair') >= 0 || d.indexOf('service') >= 0) return '214';
  if (d.indexOf('payroll') >= 0 || d.indexOf('wage') >= 0 || d.indexOf('salary') >= 0) return '205';
  if (d.indexOf('subcontract') >= 0 || d.indexOf('contractor') >= 0) return '201';
  if (d.indexOf('sales') >= 0 || d.indexOf('invoice') >= 0 || d.indexOf('payment received') >= 0) return '100';
  return '211';
}

function guessPeriod(dateStr) {
  var d = new Date(normalizeDate(dateStr));
  if (!d || isNaN(d)) return PAY_PERIODS[3].key;
  var m = d.getMonth()+1; var y = d.getFullYear();
  if (y===2024&&(m===9||m===10)) return 'sept-oct-2024';
  if (y===2024&&(m===10||m===11)) return 'oct-nov-2024';
  if (y===2024&&(m===11||m===12)) return 'nov-dec-2024';
  if ((y===2024&&m===12)||(y===2025&&m===1)) return 'dec-jan-2025';
  return 'dec-jan-2025';
}

function normalizeDate(dateStr) {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  var parts = dateStr.split('/');
  if (parts.length===3) return parts[2]+'-'+parts[0].padStart(2,'0')+'-'+parts[1].padStart(2,'0');
  return dateStr;
}

function exportTransactionsCSV() {
  var rows = [['Date','Type','Account #','Account Name','Period','Amount','Payee','Description','Reference','Source']];
  payrollStore.transactions.forEach(function(t) {
    var acct = CHART_OF_ACCOUNTS.find(function(a){return a.num===t.account;});
    rows.push([t.date, t.type, t.account, acct?acct.name:'', t.period, t.amount.toFixed(2), t.payee||'', t.desc||'', t.ref||'', t.source||'']);
  });
  downloadCSV(rows, 'transactions.csv');
}

// ── CRA Tax Summary ───────────────────────────────────────────
function renderTaxSummary() {
  // Populate year selector
  var yearSel = document.getElementById('tax-year-select');
  if (yearSel && yearSel.options.length === 0) {
    var curYear = new Date().getFullYear();
    for (var y = curYear; y >= curYear - 3; y--) {
      yearSel.innerHTML += '<option value="' + y + '">' + y + '</option>';
    }
  }

  function setEl(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }

  // GST/HST
  var totalSales = payrollStore.transactions.filter(function(t){return t.account==='100';}).reduce(function(s,t){return s+t.amount;},0);
  var gstCollected = totalSales * 0.05;
  var itcAmount = payrollStore.transactions.filter(function(t){return t.gst==='itc'||t.gst==='included';}).reduce(function(s,t){return s+(t.amount/1.05*0.05);},0);
  var gstOwing = gstCollected - itcAmount;

  setEl('tax-gst-collected', formatCurrency(gstCollected));
  setEl('tax-itc', formatCurrency(itcAmount));
  setEl('tax-gst-owing', formatCurrency(Math.max(0, gstOwing)));

  // Payroll Remittance
  var empHistory = payrollStore.history.filter(function(h){return !h.isContractor;});
  var totalGross = empHistory.reduce(function(s,h){return s+h.gross;},0);
  var totalCpp = empHistory.reduce(function(s,h){return s+h.cpp*2;},0);
  var totalEi = empHistory.reduce(function(s,h){return s+h.ei+h.ei*1.4;},0);
  var totalTax = empHistory.reduce(function(s,h){return s+h.fedTax+h.provTax;},0);
  var totalRemittance = totalCpp + totalEi + totalTax;

  setEl('tax-cpp-total', formatCurrency(totalCpp));
  setEl('tax-ei-total', formatCurrency(totalEi));
  setEl('tax-it-total', formatCurrency(totalTax));
  setEl('tax-remittance-total', formatCurrency(totalRemittance));

  // T4 Summary Table
  var t4Map = {};
  empHistory.forEach(function(h){
    if(!t4Map[h.name]) t4Map[h.name]={gross:0,cpp:0,ei:0,tax:0};
    t4Map[h.name].gross+=h.gross; t4Map[h.name].cpp+=h.cpp;
    t4Map[h.name].ei+=h.ei; t4Map[h.name].tax+=h.fedTax+h.provTax;
  });
  var t4Container = document.getElementById('t4-summary-table');
  if (t4Container) {
    if (!Object.keys(t4Map).length) {
      t4Container.innerHTML = '<div class="empty-state-sm">No employee payroll entries yet.</div>';
    } else {
      var t4html = '<table style="width:100%;border-collapse:collapse;font-size:.84rem"><thead><tr style="background:var(--bg2)">' +
        '<th style="padding:.5rem .75rem;text-align:left">Employee</th>' +
        '<th style="padding:.5rem .75rem;text-align:right">Box 14 Gross</th>' +
        '<th style="padding:.5rem .75rem;text-align:right">Box 16 CPP</th>' +
        '<th style="padding:.5rem .75rem;text-align:right">Box 18 EI</th>' +
        '<th style="padding:.5rem .75rem;text-align:right">Box 22 Tax</th>' +
        '</tr></thead><tbody>';
      Object.keys(t4Map).forEach(function(name){
        var d = t4Map[name];
        t4html += '<tr><td style="padding:.5rem .75rem">' + name + '</td>' +
          '<td style="padding:.5rem .75rem;text-align:right">' + formatCurrency(d.gross) + '</td>' +
          '<td style="padding:.5rem .75rem;text-align:right">' + formatCurrency(d.cpp) + '</td>' +
          '<td style="padding:.5rem .75rem;text-align:right">' + formatCurrency(d.ei) + '</td>' +
          '<td style="padding:.5rem .75rem;text-align:right">' + formatCurrency(d.tax) + '</td></tr>';
      });
      t4Container.innerHTML = t4html + '</tbody></table>';
    }
  }

  // T4A Summary Table
  var t4aMap = {};
  payrollStore.history.filter(function(h){return h.isContractor;}).forEach(function(h){
    if(!t4aMap[h.name]) t4aMap[h.name]=0;
    t4aMap[h.name]+=h.gross;
  });
  var t4aContainer = document.getElementById('t4a-summary-table');
  if (t4aContainer) {
    if (!Object.keys(t4aMap).length) {
      t4aContainer.innerHTML = '<div class="empty-state-sm">No contractor payments yet.</div>';
    } else {
      var t4ahtml = '<table style="width:100%;border-collapse:collapse;font-size:.84rem"><thead><tr style="background:var(--bg2)">' +
        '<th style="padding:.5rem .75rem;text-align:left">Contractor</th>' +
        '<th style="padding:.5rem .75rem;text-align:right">Box 048 – Fees</th>' +
        '<th style="padding:.5rem .75rem;text-align:left">T4A Required?</th>' +
        '</tr></thead><tbody>';
      Object.keys(t4aMap).forEach(function(name){
        var amt = t4aMap[name];
        t4ahtml += '<tr><td style="padding:.5rem .75rem">' + name + '</td>' +
          '<td style="padding:.5rem .75rem;text-align:right">' + formatCurrency(amt) + '</td>' +
          '<td style="padding:.5rem .75rem">' + (amt >= 500 ? '<span style="color:#ef5350;font-weight:600">⚠️ Yes – T4A Required</span>' : '<span style="color:#66bb6a">No (under $500)</span>') + '</td></tr>';
      });
      t4aContainer.innerHTML = t4ahtml + '</tbody></table>';
    }
  }

  // Income Statement
  var totalIncome = payrollStore.transactions.filter(function(t){return t.account==='100'||t.account==='101';}).reduce(function(s,t){return s+t.amount;},0);
  var totalExpenses = payrollStore.transactions.filter(function(t){return parseInt(t.account)>=200&&parseInt(t.account)<=214;}).reduce(function(s,t){return s+t.amount;},0);
  var netIncome = totalIncome - totalExpenses;
  var isContainer = document.getElementById('income-statement-table');
  if (isContainer) {
    isContainer.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:.85rem">' +
      '<tr><td style="padding:.4rem .75rem">Total Revenue</td><td style="padding:.4rem .75rem;text-align:right;color:#66bb6a">' + formatCurrency(totalIncome) + '</td></tr>' +
      '<tr><td style="padding:.4rem .75rem">Total Expenses</td><td style="padding:.4rem .75rem;text-align:right;color:#ef5350">' + formatCurrency(totalExpenses) + '</td></tr>' +
      '<tr style="font-weight:700;border-top:1px solid var(--border-light)"><td style="padding:.6rem .75rem">Net Income (T2125)</td><td style="padding:.6rem .75rem;text-align:right;color:' + (netIncome >= 0 ? '#66bb6a' : '#ef5350') + '">' + formatCurrency(netIncome) + '</td></tr>' +
      '</table>';
  }
}

function exportTaxReport() {
  var year = new Date().getFullYear();
  var empHistory = payrollStore.history.filter(function(h){return !h.isContractor;});
  var conHistory = payrollStore.history.filter(function(h){return h.isContractor;});
  var t4Map = {};
  empHistory.forEach(function(h){
    if(!t4Map[h.name]) t4Map[h.name]={gross:0,cpp:0,ei:0,tax:0};
    t4Map[h.name].gross+=h.gross; t4Map[h.name].cpp+=h.cpp;
    t4Map[h.name].ei+=h.ei; t4Map[h.name].tax+=h.fedTax+h.provTax;
  });
  var t4aMap = {};
  conHistory.forEach(function(h){
    if(!t4aMap[h.name]) t4aMap[h.name]=0;
    t4aMap[h.name]+=h.gross;
  });
  var rows = [
    ['CRA Tax Report', year],[],
    ['GST/HST RETURN'],
    ['Line 103 - Total Sales', payrollStore.transactions.filter(function(t){return t.account==='100';}).reduce(function(s,t){return s+t.amount;},0).toFixed(2)],
    [],[' PAYROLL REMITTANCE (PD7A)'],
    ['Total Gross Wages', empHistory.reduce(function(s,h){return s+h.gross;},0).toFixed(2)],
    ['Total CPP (both portions)', empHistory.reduce(function(s,h){return s+h.cpp*2;},0).toFixed(2)],
    ['Total EI (both portions)', empHistory.reduce(function(s,h){return s+h.ei+h.ei*1.4;},0).toFixed(2)],
    ['Total Income Tax Withheld', empHistory.reduce(function(s,h){return s+h.fedTax+h.provTax;},0).toFixed(2)],
    [],['T4 SLIPS'],['Worker','Gross','CPP','EI','Tax']
  ];
  Object.keys(t4Map).forEach(function(name){
    var d=t4Map[name];
    rows.push([name,d.gross.toFixed(2),d.cpp.toFixed(2),d.ei.toFixed(2),d.tax.toFixed(2)]);
  });
  rows.push([],['T4A SLIPS'],['Contractor','Total Paid','Box']);
  Object.keys(t4aMap).forEach(function(name){
    rows.push([name,t4aMap[name].toFixed(2),'Box 048 - Fees for Services']);
  });
  downloadCSV(rows, 'cra_tax_report_' + year + '.csv');
}

// ── Backdate Feature ──────────────────────────────────────────
function renderBackdateTabs() {
  var container = document.getElementById('backdate-years-container');
  if (!container) return;
  var currentYear = new Date().getFullYear();
  var years = [currentYear - 3, currentYear - 2, currentYear - 1];

  container.innerHTML = years.map(function(year) {
    var data = payrollStore.backdateData[year] || {};
    return '<div class="backdate-year-card">' +
      '<h4>Tax Year ' + year +
        '<span style="font-size:.78rem;font-weight:400;color:var(--text-muted);margin-left:.5rem">' +
          (data.completed ? '✅ Completed' : '⏳ In Progress') +
        '</span>' +
      '</h4>' +
      '<div class="backdate-period-grid">' +
        makeBackdateField(year,'revenue','Total Revenue (Line 8000)',data.revenue) +
        makeBackdateField(year,'wages','Total Wages Paid (Acct 205)',data.wages) +
        makeBackdateField(year,'contract','Contract Labour (Acct 201)',data.contract) +
        makeBackdateField(year,'advertising','Advertising (Acct 200)',data.advertising) +
        makeBackdateField(year,'insurance','Insurance (Acct 202)',data.insurance) +
        makeBackdateField(year,'fuel','Fleet Fuel (Acct 208)',data.fuel) +
        makeBackdateField(year,'equipment','Equipment Rentals (Acct 212)',data.equipment) +
        makeBackdateField(year,'other','Other Expenses (Acct 211)',data.other) +
        makeBackdateField(year,'gst-collected','GST Collected',data.gstCollected) +
        makeBackdateField(year,'gst-paid','GST Paid (ITCs)',data.gstPaid) +
        '<div class="form-group"><label># T4 Employees</label><input type="number" id="bd-' + year + '-t4count" value="' + (data.t4count||'') + '" placeholder="0" step="1" oninput="calcBackdate(' + year + ')"></div>' +
        '<div class="form-group"><label># T4A Contractors</label><input type="number" id="bd-' + year + '-t4acount" value="' + (data.t4acount||'') + '" placeholder="0" step="1" oninput="calcBackdate(' + year + ')"></div>' +
      '</div>' +
      '<div id="bd-' + year + '-summary" style="background:var(--bg2);border:1px solid var(--border-light);border-radius:8px;padding:1rem;margin-bottom:1rem;font-size:.85rem">' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.5rem">' +
          '<div><span style="color:var(--text-muted)">Net Income:</span> <strong id="bd-' + year + '-net">-</strong></div>' +
          '<div><span style="color:var(--text-muted)">GST Owing:</span> <strong id="bd-' + year + '-gst-owing">-</strong></div>' +
          '<div><span style="color:var(--text-muted)">Est. Corp Tax (9%):</span> <strong id="bd-' + year + '-corp-tax">-</strong></div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:.75rem;flex-wrap:wrap">' +
        '<button class="btn-primary btn-sm" onclick="saveBackdateYear(' + year + ')">💾 Save ' + year + ' Data</button>' +
        '<button class="btn-secondary btn-sm" onclick="exportBackdateYear(' + year + ')">⬇️ Export ' + year + ' CSV</button>' +
        '<button class="btn-secondary btn-sm" onclick="markBackdateComplete(' + year + ')">' + (data.completed ? '🔓 Reopen' : '✅ Mark Complete') + '</button>' +
      '</div>' +
    '</div>';
  }).join('');

  years.forEach(function(year) { calcBackdate(year); });
}

function makeBackdateField(year, field, label, value) {
  return '<div class="form-group"><label>' + label + '</label>' +
    '<input type="number" id="bd-' + year + '-' + field + '" value="' + (value||'') + '" placeholder="0.00" step="0.01" oninput="calcBackdate(' + year + ')"></div>';
}

function calcBackdate(year) {
  function g(id) { var el = document.getElementById('bd-' + year + '-' + id); return el ? parseFloat(el.value)||0 : 0; }
  var revenue = g('revenue');
  var totalExpenses = g('wages')+g('contract')+g('advertising')+g('insurance')+g('fuel')+g('equipment')+g('other');
  var netIncome = revenue - totalExpenses;
  var gstOwing = g('gst-collected') - g('gst-paid');
  var corpTax = Math.max(0, netIncome * 0.09);
  function setEl(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }
  setEl('bd-' + year + '-net', formatCurrency(netIncome));
  setEl('bd-' + year + '-gst-owing', gstOwing >= 0 ? formatCurrency(gstOwing) + ' owing' : formatCurrency(Math.abs(gstOwing)) + ' refund');
  setEl('bd-' + year + '-corp-tax', formatCurrency(corpTax));
}

function saveBackdateYear(year) {
  function g(id) { var el = document.getElementById('bd-' + year + '-' + id); return el ? parseFloat(el.value)||0 : 0; }
  function gi(id) { var el = document.getElementById('bd-' + year + '-' + id); return el ? parseInt(el.value)||0 : 0; }
  payrollStore.backdateData[year] = {
    year: year, revenue: g('revenue'), wages: g('wages'), contract: g('contract'),
    advertising: g('advertising'), insurance: g('insurance'), fuel: g('fuel'),
    equipment: g('equipment'), other: g('other'),
    gstCollected: g('gst-collected'), gstPaid: g('gst-paid'),
    t4count: gi('t4count'), t4acount: gi('t4acount'),
    savedAt: new Date().toISOString()
  };
  savePayrollStore();
  showToast(year + ' tax data saved', 'success');
}

function markBackdateComplete(year) {
  if (!payrollStore.backdateData[year]) payrollStore.backdateData[year] = {};
  payrollStore.backdateData[year].completed = !payrollStore.backdateData[year].completed;
  savePayrollStore();
  renderBackdateTabs();
}

function exportBackdateYear(year) {
  var d = payrollStore.backdateData[year] || {};
  var totalExpenses = (d.wages||0)+(d.contract||0)+(d.advertising||0)+(d.insurance||0)+(d.fuel||0)+(d.equipment||0)+(d.other||0);
  var netIncome = (d.revenue||0) - totalExpenses;
  var rows = [
    ['CRA Tax Summary - Year ' + year],[],
    ['T2125 - Business Income'],
    ['Total Revenue (Line 8000)', (d.revenue||0).toFixed(2)],
    ['Wages & Salaries (Acct 205)', (d.wages||0).toFixed(2)],
    ['Contract Labour (Acct 201)', (d.contract||0).toFixed(2)],
    ['Advertising (Acct 200)', (d.advertising||0).toFixed(2)],
    ['Insurance (Acct 202)', (d.insurance||0).toFixed(2)],
    ['Fleet Fuel (Acct 208)', (d.fuel||0).toFixed(2)],
    ['Equipment Rentals (Acct 212)', (d.equipment||0).toFixed(2)],
    ['Other Expenses (Acct 211)', (d.other||0).toFixed(2)],
    ['Total Expenses', totalExpenses.toFixed(2)],
    ['Net Business Income', netIncome.toFixed(2)],[],
    ['GST/HST Return'],
    ['GST Collected (Line 103)', (d.gstCollected||0).toFixed(2)],
    ['ITCs Claimed (Line 106)', (d.gstPaid||0).toFixed(2)],
    ['Net GST Owing/Refund', ((d.gstCollected||0)-(d.gstPaid||0)).toFixed(2)],[],
    ['Slips Required'],
    ['T4 Slips (Employees)', d.t4count||0],
    ['T4A Slips (Contractors)', d.t4acount||0]
  ];
  downloadCSV(rows, 'cra_backdate_' + year + '.csv');
}

// ── CSV Download Helper ───────────────────────────────────────
function downloadCSV(rows, filename) {
  var csv = rows.map(function(r){return r.map(function(c){return '"'+String(c).replace(/"/g,'""')+'"';}).join(',');}).join('\n');
  var blob = new Blob([csv], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Init Payroll ──────────────────────────────────────────────
function initPayroll() {
  var txnDate = document.getElementById('txn-date');
  if (txnDate) txnDate.value = new Date().toISOString().split('T')[0];
  populateTxnProjectDropdown();
  renderEmployees();
}

function populateTxnProjectDropdown() {
  var sel = document.getElementById('txn-project');
  if (!sel) return;
  sel.innerHTML = '<option value="">- No project -</option>';
  if (store && store.projects && store.projects.length) {
    store.projects.forEach(function(p) {
      sel.innerHTML += '<option value="' + (p.id||p.name) + '">' + (p.name||p.project_name) + '</option>';
    });
  }
}

// ═══════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════
function initReports() {
  const today = new Date();
  const yearStart = `${today.getFullYear()}-01-01`;
  const todayStr = today.toISOString().split('T')[0];
  document.getElementById('report-from').value = yearStart;
  document.getElementById('report-to').value = todayStr;
}

function showReport(type) {
  currentReport = type;
  document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
}

async function loadReport() {
  const from = document.getElementById('report-from').value;
  const to = document.getElementById('report-to').value;
  if (!from || !to) { showToast('Select date range', 'warning'); return; }

  const container = document.getElementById('report-content');
  container.innerHTML = '<div class="text-center" style="padding:40px"><div class="spinner"></div><p style="margin-top:12px;color:var(--text-muted)">Generating report...</p></div>';

  try {
    let data, html;
    if (currentReport === 'pl') {
      data = await apiGet(`/api/ledger/reports/profit-loss?from_date=${from}&to_date=${to}`);
      html = renderPLReport(data);
    } else if (currentReport === 'balance') {
      data = await apiGet(`/api/ledger/reports/balance-sheet?as_of=${to}`);
      html = renderBalanceSheet(data);
    } else if (currentReport === 'gst') {
      data = await apiGet(`/api/ledger/reports/gst-summary?from_date=${from}&to_date=${to}`);
      html = renderGSTReport(data);
    } else if (currentReport === 'cashflow') {
      data = await apiGet(`/api/ledger/reports/cash-flow?from_date=${from}&to_date=${to}`);
      html = renderCashFlow(data);
    } else if (currentReport === 'ar-aging') {
      data = await apiGet('/api/ledger/reports/ar-aging');
      html = renderARaging(data);
    }
    container.innerHTML = html || '<div class="empty-state-sm">No data for this period</div>';
  } catch(e) {
    container.innerHTML = '<div class="empty-state-sm">Error loading report. Please try again.</div>';
  }
}

function renderPLReport(d) {
  if (!d) return '<div class="empty-state-sm">No data</div>';
  return `
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Period: ${d.period?.from} to ${d.period?.to}</div>
    <div class="report-section">
      <h4>Revenue</h4>
      ${(d.income||[]).map(i => `<div class="report-row"><span>${i.code} · ${i.name}</span><span>${formatCurrency(i.amount)}</span></div>`).join('')}
      <div class="report-total positive"><span>Total Revenue</span><span>${formatCurrency(d.total_income)}</span></div>
    </div>
    <div class="report-section">
      <h4>Cost of Goods Sold</h4>
      ${(d.cost_of_goods_sold||[]).map(i => `<div class="report-row"><span>${i.code} · ${i.name}</span><span>${formatCurrency(i.amount)}</span></div>`).join('')}
      <div class="report-total"><span>Total COGS</span><span>${formatCurrency(d.total_cogs)}</span></div>
    </div>
    <div class="report-total positive" style="font-size:16px;padding:14px 0">
      <span>Gross Profit (${d.gross_margin_pct}%)</span><span>${formatCurrency(d.gross_profit)}</span>
    </div>
    <div class="report-section">
      <h4>Operating Expenses</h4>
      ${(d.expenses||[]).map(i => `<div class="report-row"><span>${i.code} · ${i.name}</span><span>${formatCurrency(i.amount)}</span></div>`).join('')}
      <div class="report-total"><span>Total Expenses</span><span>${formatCurrency(d.total_expenses)}</span></div>
    </div>
    <div class="report-total ${d.net_income >= 0 ? 'positive' : 'negative'}" style="font-size:18px;padding:16px 0;border-top:2px solid var(--primary)">
      <span>Net Income (${d.net_margin_pct}%)</span><span>${formatCurrency(d.net_income)}</span>
    </div>
  `;
}

function renderBalanceSheet(d) {
  if (!d) return '<div class="empty-state-sm">No data</div>';
  return `
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px">As of: ${d.as_of_date}</div>
    <div class="report-section">
      <h4>Assets</h4>
      ${(d.assets||[]).map(a => `<div class="report-row"><span>${a.code} · ${a.name}</span><span>${formatCurrency(a.amount)}</span></div>`).join('')}
      <div class="report-total positive"><span>Total Assets</span><span>${formatCurrency(d.total_assets)}</span></div>
    </div>
    <div class="report-section">
      <h4>Liabilities</h4>
      ${(d.liabilities||[]).map(l => `<div class="report-row"><span>${l.code} · ${l.name}</span><span>${formatCurrency(l.amount)}</span></div>`).join('')}
      <div class="report-total negative"><span>Total Liabilities</span><span>${formatCurrency(d.total_liabilities)}</span></div>
    </div>
    <div class="report-section">
      <h4>Equity</h4>
      ${(d.equity||[]).map(e => `<div class="report-row"><span>${e.code} · ${e.name}</span><span>${formatCurrency(e.amount)}</span></div>`).join('')}
      <div class="report-total"><span>Total Equity</span><span>${formatCurrency(d.total_equity)}</span></div>
    </div>
    <div class="report-total" style="font-size:16px;padding:14px 0;border-top:2px solid var(--primary)">
      <span>Total Liabilities + Equity</span><span>${formatCurrency(d.total_liabilities_and_equity)}</span>
    </div>
    ${d.is_balanced ? '<div style="color:var(--accent);font-size:12px;text-align:center;margin-top:8px">✅ Balance sheet is balanced</div>' : ''}
  `;
}

function renderGSTReport(d) {
  if (!d) return '<div class="empty-state-sm">No data</div>';
  const statusColor = d.status === 'owing' ? 'var(--danger)' : d.status === 'refund' ? 'var(--accent)' : 'var(--text-muted)';
  return `
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Period: ${d.period?.from} to ${d.period?.to}</div>
    <div class="report-section">
      <div class="report-row"><span>GST Collected (Line 103)</span><span>${formatCurrency(d.gst_collected)}</span></div>
      <div class="report-row"><span>Input Tax Credits - ITC (Line 106)</span><span>-${formatCurrency(d.gst_paid_itc)}</span></div>
      <div class="report-total" style="color:${statusColor}">
        <span>Net GST ${d.status === 'owing' ? 'Owing' : d.status === 'refund' ? 'Refund' : ''}</span>
        <span>${formatCurrency(Math.abs(d.net_gst_owing))}</span>
      </div>
    </div>
    <div style="background:rgba(33,150,243,0.08);border:1px solid rgba(33,150,243,0.2);border-radius:8px;padding:12px;font-size:13px;margin-top:12px">
      <strong>📋 Filing Info:</strong> ${d.filing_due}<br>
      File online at <a href="https://www.canada.ca/en/revenue-agency.html" target="_blank" style="color:var(--primary)">CRA My Business Account</a>
    </div>
  `;
}

function renderCashFlow(d) {
  if (!d) return '<div class="empty-state-sm">No data</div>';
  return `
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Period: ${d.period?.from} to ${d.period?.to}</div>
    <div class="report-section">
      <div class="report-row"><span>Opening Balance</span><span>${formatCurrency(d.opening_balance)}</span></div>
      <div class="report-row"><span>Total Inflows</span><span class="text-success">+${formatCurrency(d.total_inflows)}</span></div>
      <div class="report-row"><span>Total Outflows</span><span class="text-danger">-${formatCurrency(d.total_outflows)}</span></div>
      <div class="report-total ${d.net_change >= 0 ? 'positive' : 'negative'}">
        <span>Net Change</span><span>${d.net_change >= 0 ? '+' : ''}${formatCurrency(d.net_change)}</span>
      </div>
      <div class="report-total positive"><span>Closing Balance</span><span>${formatCurrency(d.closing_balance)}</span></div>
    </div>
  `;
}

function renderARaging(d) {
  if (!d) return '<div class="empty-state-sm">No data</div>';
  return `
    <h4 style="margin-bottom:12px">Accounts Receivable Aging</h4>
    <div class="report-row"><span>Current (0-30 days)</span><span class="text-success">${formatCurrency(d.current)}</span></div>
    <div class="report-row"><span>31-60 days</span><span style="color:var(--warning)">${formatCurrency(d.days_31_60)}</span></div>
    <div class="report-row"><span>61-90 days</span><span style="color:var(--warning)">${formatCurrency(d.days_61_90)}</span></div>
    <div class="report-row"><span>Over 90 days</span><span class="text-danger">${formatCurrency(d.over_90)}</span></div>
    <div class="report-total"><span>Total Outstanding</span><span>${formatCurrency(d.total_outstanding)}</span></div>
  `;
}

// ═══════════════════════════════════════════════════════════
// TIME TRACKING
// ═══════════════════════════════════════════════════════════

function initTimeTracking() {
  // Populate project dropdown
  const projSel = document.getElementById('time-project');
  if (projSel) {
    projSel.innerHTML = '<option value="">Select project...</option>';
    (store.projects || []).forEach(p => {
      projSel.innerHTML += `<option value="${p.id}">${escapeHtml(p.name || '')}</option>`;
    });
  }
  // Render existing time entries
  renderTimeEntries();
}

function renderTimeEntries() {
  const container = document.getElementById('time-entries');
  if (!container) return;
  
  const entries = store.time_entries || [];
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  
  const weekEntries = entries.filter(e => new Date(e.date) >= weekStart);
  
  if (weekEntries.length === 0) {
    container.innerHTML = '<div class="empty-state-sm">No time entries this week</div>';
    return;
  }
  
  // Sort by date (newest first)
  weekEntries.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  // Calculate totals
  const totalMinutes = weekEntries.reduce((sum, e) => sum + (e.minutes || 0), 0);
  
  // Show summary at top
  let html = `
    <div style="padding:12px;background:linear-gradient(135deg,var(--primary-light),rgba(255,107,53,0.1));border-radius:8px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:600;color:var(--primary)">Weekly Total</span>
        <span style="font-size:1.2em;font-weight:700">${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m</span>
      </div>
    </div>
    <div class="time-entries-list">
  `;
  
  // Show individual entries
  weekEntries.forEach(e => {
    const date = new Date(e.date);
    const dateStr = date.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
    const timeStr = `${Math.floor(e.minutes / 60)}h ${e.minutes % 60}m`;
    
    html += `
      <div class="time-entry-item" style="display:flex;align-items:center;justify-content:space-between;padding:10px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
        <div style="flex:1">
          <div style="font-weight:500">${e.project_name || 'No Project'}</div>
          <div style="font-size:12px;color:var(--text-muted)">
            ${dateStr} • ${e.work_type || 'General'} ${e.notes ? '• ' + escapeHtml(e.notes.substring(0,30)) + (e.notes.length > 30 ? '...' : '') : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-weight:600;color:var(--accent)">${timeStr}</span>
          <button onclick="openEditTimeEntryModal('${e.id}')" style="padding:4px 8px;font-size:11px;background:var(--bg-input);border:1px solid var(--border);border-radius:4px;cursor:pointer" title="Edit">✏️</button>
          <button onclick="deleteTimeEntry('${e.id}')" style="padding:4px 8px;font-size:11px;background:rgba(244,67,54,0.1);color:var(--danger);border:1px solid rgba(244,67,54,0.3);border-radius:4px;cursor:pointer" title="Delete">🗑</button>
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  container.innerHTML = html;
}

function toggleTimer() {
  if (timerRunning) {
    clearInterval(timerInterval);
    timerRunning = false;
    document.getElementById('timer-btn').textContent = '▶ Start Timer';
    document.getElementById('timer-btn').className = 'btn-primary';
    
    // BUG-001 FIX: Actually save the time entry when timer stops
    if (timerSeconds > 0) {
      const projectId = document.getElementById('time-project')?.value || null;
      const project = projectId ? (store.projects || []).find(p => p.id === projectId) : null;
      const workType = document.getElementById('time-type')?.value || 'other';
      const notes = document.getElementById('time-notes')?.value || '';
      
      const entry = {
        id: 'time_' + Date.now(),
        date: new Date().toISOString(),
        minutes: Math.floor(timerSeconds / 60),
        seconds: timerSeconds,
        project_id: projectId,
        project_name: project ? project.name : null,
        work_type: workType,
        notes: notes,
        user: currentUser?.contact_name || 'Unknown',
        manual: false,
        timer: true
      };
      
      store.time_entries = store.time_entries || [];
      store.time_entries.push(entry);
      saveStore();
      
      showToast(`Time entry saved: ${formatTime(timerSeconds)}`, 'success');
      renderTimeEntries();
    }
    
    timerSeconds = 0;
    document.getElementById('timer-display').textContent = '00:00:00';
  } else {
    timerRunning = true;
    document.getElementById('timer-btn').textContent = '⏹ Stop Timer';
    document.getElementById('timer-btn').className = 'btn-danger';
    timerInterval = setInterval(() => {
      timerSeconds++;
      document.getElementById('timer-display').textContent = formatTime(timerSeconds);
    }, 1000);
  }
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function logManualTime() {
  const projectId = document.getElementById('time-project').value;
  const project = (store.projects || []).find(p => p.id === projectId);
  const workType = document.getElementById('time-type').value;
  const notes = document.getElementById('time-notes').value;
  
  // BUG-005 FIX: Use a proper modal instead of prompts
  // For now, use a single prompt with better UX
  const timeStr = prompt('Enter time (e.g., "2h 30m" or "1.5h" or "90m"):', '1h');
  
  if (timeStr !== null) {
    let totalMinutes = 0;
    
    // Parse various formats: "2h 30m", "1.5h", "90m", "2:30"
    const hMatch = timeStr.match(/(\d+(?:\.\d+)?)\s*h/i);
    const mMatch = timeStr.match(/(\d+)\s*m/i);
    const colonMatch = timeStr.match(/(\d+):(\d+)/);
    
    if (colonMatch) {
      totalMinutes = parseInt(colonMatch[1]) * 60 + parseInt(colonMatch[2]);
    } else {
      if (hMatch) totalMinutes += Math.round(parseFloat(hMatch[1]) * 60);
      if (mMatch) totalMinutes += parseInt(mMatch[1]);
    }
    
    if (totalMinutes > 0) {
      const entry = {
        id: 'time_' + Date.now(),
        date: new Date().toISOString(),
        minutes: totalMinutes,
        seconds: totalMinutes * 60,
        project_id: projectId || null,
        project_name: project ? project.name : null,
        work_type: workType,
        notes: notes,
        user: currentUser?.contact_name || 'Unknown',
        manual: true
      };
      store.time_entries = store.time_entries || [];
      store.time_entries.push(entry);
      saveStore();
      renderTimeEntries();
      syncStore().catch(() => {});
      showToast(`Time entry saved: ${Math.floor(totalMinutes/60)}h ${totalMinutes%60}m`, 'success');
    } else {
      showToast('Could not parse time. Use formats like "2h 30m", "1.5h", or "90m"', 'warning');
    }
  }
}

// MF-004: Time entry edit and delete functions
function deleteTimeEntry(entryId) {
  if (!confirm('Delete this time entry?')) return;
  
  store.time_entries = (store.time_entries || []).filter(e => e.id !== entryId);
  saveStore();
  renderTimeEntries();
  showToast('Time entry deleted', 'success');
}

function openEditTimeEntryModal(entryId) {
  const entry = (store.time_entries || []).find(e => e.id === entryId);
  if (!entry) {
    showToast('Time entry not found', 'error');
    return;
  }
  
  // Populate project dropdown first
  const projSelect = document.getElementById('edit-time-project');
  if (projSelect) {
    projSelect.innerHTML = '<option value="">No Project</option>';
    (store.projects || []).forEach(p => {
      projSelect.innerHTML += `<option value="${p.id}">${escapeHtml(p.name || '')}</option>`;
    });
  }
  
  // Populate fields
  document.getElementById('edit-time-id').value = entryId;
  document.getElementById('edit-time-hours').value = Math.floor(entry.minutes / 60);
  document.getElementById('edit-time-minutes').value = entry.minutes % 60;
  document.getElementById('edit-time-project').value = entry.project_id || '';
  document.getElementById('edit-time-type').value = entry.work_type || 'other';
  document.getElementById('edit-time-notes').value = entry.notes || '';
  document.getElementById('edit-time-date').value = entry.date ? entry.date.split('T')[0] : '';
  
  openModal('edit-time-entry-modal');
}

async function saveEditedTimeEntry() {
  const entryId = document.getElementById('edit-time-id').value;
  const hours = parseInt(document.getElementById('edit-time-hours').value) || 0;
  const minutes = parseInt(document.getElementById('edit-time-minutes').value) || 0;
  const totalMinutes = hours * 60 + minutes;
  
  if (totalMinutes <= 0) {
    showToast('Please enter a valid time', 'error');
    return;
  }
  
  const entries = store.time_entries || [];
  const idx = entries.findIndex(e => e.id === entryId);
  
  if (idx >= 0) {
    entries[idx] = {
      ...entries[idx],
      minutes: totalMinutes,
      seconds: totalMinutes * 60,
      project_id: document.getElementById('edit-time-project').value || null,
      work_type: document.getElementById('edit-time-type').value,
      notes: document.getElementById('edit-time-notes').value,
      date: document.getElementById('edit-time-date').value || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    store.time_entries = entries;
    saveStore();
    
    closeModal('edit-time-entry-modal');
    renderTimeEntries();
    showToast('Time entry updated', 'success');
  }
}

// ═══════════════════════════════════════════════════════════
// COMPLIANCE
// ═══════════════════════════════════════════════════════════
function submitChecklist() {
  const items = document.querySelectorAll('.check-item input[type="checkbox"]');
  const checked = Array.from(items).filter(i => i.checked).length;
  const total = items.length;
  if (checked < total) {
    showToast(`${total - checked} items not checked. Please complete all items.`, 'warning');
  } else {
    showToast('Safety checklist submitted! ✅', 'success');
    items.forEach(i => i.checked = false);
  }
}

// ═══════════════════════════════════════════════════════════
// ADMIN SETTINGS
// ═══════════════════════════════════════════════════════════
async function loadAdminSettings() {
  if (!isAdmin) return;
  try {
    const settings = await apiGet('/api/settings/admin/all');
    if (!settings) return;

    // Branding
    const b = settings.branding || {};
    setVal('s-app-name', b.app_name);
    setVal('s-tagline', b.tagline);
    setVal('s-primary-color', b.primary_color);
    setVal('s-primary-color-text', b.primary_color);
    setVal('s-accent-color', b.accent_color);
    setVal('s-accent-color-text', b.accent_color);
    setVal('s-logo-url', b.logo_url);
    setVal('s-font', b.font_family);
    setVal('s-theme', b.dark_mode_default ? 'dark' : 'light');

    // Business
    const biz = settings.business || {};
    setVal('s-biz-name', biz.business_name);
    setVal('s-biz-type', biz.business_type);
    setVal('s-biz-phone', biz.phone);
    setVal('s-biz-email', biz.email);
    setVal('s-biz-address', biz.address);
    setVal('s-biz-bn', biz.business_number);
    setVal('s-wcb-acct', biz.wcb_account);
    setVal('s-gst-num', biz.gst_number);

    // AI
    const ai = settings.ai || {};
    setVal('s-ai-name', ai.assistant_name);
    setVal('s-ai-personality', ai.personality);
    setVal('s-ai-trade', ai.trade_focus);
    setVal('s-ai-knowledge', ai.knowledge_level);
    setVal('s-ai-greeting', ai.greeting_message);
    setChecked('s-ai-voice', ai.voice_enabled);
    setChecked('s-ai-proactive', ai.proactive_suggestions);

    // Financial
    const fin = settings.financial || {};
    setVal('s-gst-rate', (fin.gst_rate * 100).toFixed(1));
    setVal('s-inv-prefix', fin.invoice_prefix);
    setVal('s-payment-terms', fin.payment_terms);
    setVal('s-late-fee', fin.late_fee_percentage);
    setVal('s-labour-rate', fin.default_labour_rate);
    setVal('s-markup', fin.default_markup_percentage);
    setVal('s-wcb-framing', fin.wcb_rate_framing);
    setVal('s-wcb-carpentry', fin.wcb_rate_carpentry);
    setVal('s-wcb-general', fin.wcb_rate_general);

    // Compliance
    const comp = settings.compliance || {};
    setVal('s-inspection-freq', comp.safety_inspection_frequency);
    setVal('s-toolbox-freq', comp.toolbox_talk_frequency);
    setVal('s-required-training', (comp.required_training || []).join(', '));
    setVal('s-ppe-req', (comp.ppe_requirements || []).join(', '));
    setChecked('s-incident-req', comp.incident_reporting_required);

    // Notifications
    const notif = settings.notifications || {};
    setChecked('s-notif-email', notif.email_enabled);
    setChecked('s-notif-push', notif.push_enabled);
    setVal('s-notif-email-addr', notif.notification_email);
    setChecked('s-daily-summary', notif.daily_summary);
    setChecked('s-weekly-report', notif.weekly_report);

    // Security
    const sys = settings.system || {};
    setVal('s-session-timeout', sys.session_timeout_hours);
    setVal('s-max-file', sys.max_file_size_mb);
    setChecked('s-allow-reg', sys.allow_registration);
    setChecked('s-require-nda', sys.require_nda);

  } catch(e) {
    console.error('Error loading settings:', e);
  }
}

function showSettingsTab(tab) {
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
  event.target.classList.add('active');
  const panel = document.getElementById(`settings-${tab}`);
  if (panel) panel.classList.add('active');
}

async function saveBranding() {
  const data = {
    app_name: getVal('s-app-name'),
    tagline: getVal('s-tagline'),
    primary_color: getVal('s-primary-color-text') || getVal('s-primary-color'),
    accent_color: getVal('s-accent-color-text') || getVal('s-accent-color'),
    logo_url: getVal('s-logo-url'),
    font_family: getVal('s-font'),
    dark_mode_default: getVal('s-theme') === 'dark',
  };
  const res = await apiPut('/api/settings/admin/branding', data);
  if (res?.success) {
    applyBranding(res.branding);
    showToast('Branding saved!', 'success');
  }
}

async function saveBusiness() {
  const data = {
    business_name: getVal('s-biz-name'),
    business_type: getVal('s-biz-type'),
    phone: getVal('s-biz-phone'),
    email: getVal('s-biz-email'),
    address: getVal('s-biz-address'),
    business_number: getVal('s-biz-bn'),
    wcb_account: getVal('s-wcb-acct'),
    gst_number: getVal('s-gst-num'),
  };
  const res = await apiPut('/api/settings/admin/business', data);
  if (res?.success) showToast('Business info saved!', 'success');
}

async function saveAISettings() {
  const data = {
    assistant_name: getVal('s-ai-name'),
    personality: getVal('s-ai-personality'),
    trade_focus: getVal('s-ai-trade'),
    knowledge_level: getVal('s-ai-knowledge'),
    greeting_message: getVal('s-ai-greeting'),
    voice_enabled: getChecked('s-ai-voice'),
    proactive_suggestions: getChecked('s-ai-proactive'),
  };
  const res = await apiPut('/api/settings/admin/ai', data);
  if (res?.success) {
    // Update greeting in chat
    const greetEl = document.getElementById('ai-greeting');
    if (greetEl && data.greeting_message) greetEl.textContent = data.greeting_message;
    showToast('AI settings saved!', 'success');
  }
}

async function saveFinancialSettings() {
  const data = {
    gst_rate: parseFloat(getVal('s-gst-rate')) / 100,
    invoice_prefix: getVal('s-inv-prefix'),
    payment_terms: getVal('s-payment-terms'),
    late_fee_percentage: parseFloat(getVal('s-late-fee')),
    default_labour_rate: parseFloat(getVal('s-labour-rate')),
    default_markup_percentage: parseFloat(getVal('s-markup')),
    wcb_rate_framing: parseFloat(getVal('s-wcb-framing')),
    wcb_rate_carpentry: parseFloat(getVal('s-wcb-carpentry')),
    wcb_rate_general: parseFloat(getVal('s-wcb-general')),
  };
  const res = await apiPut('/api/settings/admin/financial', data);
  if (res?.success) showToast('Financial settings saved!', 'success');
}

async function saveComplianceSettings() {
  const data = {
    safety_inspection_frequency: getVal('s-inspection-freq'),
    toolbox_talk_frequency: getVal('s-toolbox-freq'),
    required_training: getVal('s-required-training').split(',').map(s => s.trim()).filter(Boolean),
    ppe_requirements: getVal('s-ppe-req').split(',').map(s => s.trim()).filter(Boolean),
    incident_reporting_required: getChecked('s-incident-req'),
  };
  const res = await apiPut('/api/settings/admin/compliance', data);
  if (res?.success) showToast('Compliance settings saved!', 'success');
}

async function saveNotificationSettings() {
  const data = {
    email_enabled: getChecked('s-notif-email'),
    push_enabled: getChecked('s-notif-push'),
    notification_email: getVal('s-notif-email-addr'),
    daily_summary: getChecked('s-daily-summary'),
    weekly_report: getChecked('s-weekly-report'),
  };
  const res = await apiPut('/api/settings/admin/notifications', data);
  if (res?.success) showToast('Notification settings saved!', 'success');
}

async function saveIntegrations() {
  const data = {
    email_provider: getChecked('s-gmail-enabled') ? 'gmail' : 'none',
    email_address: getVal('s-email-addr'),
    google_drive_enabled: getChecked('s-gdrive-enabled'),
    stripe_enabled: getChecked('s-stripe-enabled'),
  };
  const res = await apiPut('/api/settings/admin/integrations', data);
  if (res?.success) showToast('Integration settings saved!', 'success');
}

async function saveSecuritySettings() {
  const data = {
    session_timeout_hours: parseInt(getVal('s-session-timeout')),
    max_file_size_mb: parseInt(getVal('s-max-file')),
    allow_registration: getChecked('s-allow-reg'),
    require_nda: getChecked('s-require-nda'),
  };
  const res = await apiPut('/api/settings/admin/integrations', data);
  showToast('Security settings saved!', 'success');
}

async function changeAdminPassword() {
  const newPw = getVal('s-new-pw');
  const confirmPw = getVal('s-confirm-pw');
  if (!newPw || newPw.length < 8) { showToast('Password must be at least 8 characters', 'error'); return; }
  if (newPw !== confirmPw) { showToast('Passwords do not match', 'error'); return; }

  const res = await apiPost('/api/settings/admin/change-password', { new_password: newPw, confirm_password: confirmPw });
  if (res?.success) {
    showToast('Password changed! Save the new hash in your .env file', 'success');
    setVal('s-new-pw', '');
    setVal('s-confirm-pw', '');
  }
}

function confirmReset() {
  const confirmed = prompt('Type "RESET" to confirm deleting all data:');
  if (confirmed === 'RESET') {
    showToast('Data reset initiated', 'warning');
  }
}

function syncColor(type) {
  if (type === 'primary') {
    const val = getVal('s-primary-color-text');
    if (val.match(/^#[0-9a-fA-F]{6}$/)) setVal('s-primary-color', val);
  } else {
    const val = getVal('s-accent-color-text');
    if (val.match(/^#[0-9a-fA-F]{6}$/)) setVal('s-accent-color', val);
  }
}

// ═══════════════════════════════════════════════════════════
// USER MANAGEMENT
// ═══════════════════════════════════════════════════════════
async function loadUsers() {
  if (!isAdmin) return;
  try {
    const data = await apiGet('/api/admin/users');
    if (!data) return;

    const users = data.users || [];
    const stats = data.platform_stats || {};

    document.getElementById('ps-total').textContent = stats.total_users || users.length;
    document.getElementById('ps-active').textContent = stats.active_users || users.filter(u => u.status === 'active').length;
    document.getElementById('ps-starter').textContent = stats.starter_users || 0;
    document.getElementById('ps-pro').textContent = stats.professional_users || 0;

    const container = document.getElementById('users-table');
    if (!users.length) {
      container.innerHTML = '<div class="empty-state-sm">No registered users yet</div>';
      return;
    }

    container.innerHTML = users.map(u => `
      <div class="user-row">
        <div class="user-row-avatar">${(u.contact_name || u.email || 'U').charAt(0).toUpperCase()}</div>
        <div class="user-row-info">
          <div class="user-row-name">${u.business_name || u.contact_name || 'Unknown'}</div>
          <div class="user-row-email">${u.email} · ${u.plan || 'starter'} · ${u.trade || 'general'}</div>
        </div>
        <div class="user-row-actions">
          <span class="btn-xs ${u.status === 'active' ? 'btn-secondary' : 'btn-primary'}" 
            onclick="toggleUserStatus('${u.email}', '${u.status}')"
            style="cursor:pointer;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;
            background:${u.status === 'active' ? 'rgba(244,67,54,0.1)' : 'rgba(76,175,80,0.1)'};
            color:${u.status === 'active' ? 'var(--danger)' : 'var(--accent)'}">
            ${u.status === 'active' ? 'Suspend' : 'Activate'}
          </span>
        </div>
      </div>
    `).join('');
  } catch(e) {}
}

async function toggleUserStatus(email, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
  try {
    await apiPut(`/api/admin/users/${encodeURIComponent(email)}/status`, { status: newStatus });
    showToast(`User ${newStatus}`, 'success');
    loadUsers();
  } catch(e) {
    showToast('Error updating user', 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// PROFILE & PREFERENCES
// ═══════════════════════════════════════════════════════════
// saveProfile defined below in PROFILE FUNCTIONS section

async function savePreferences() {
  const data = {
    theme: getVal('p-theme'),
    language: getVal('p-language'),
    notifications_push: getChecked('p-push-notif'),
    notifications_email: getChecked('p-email-notif'),
  };
  applyTheme(data.theme);
  showToast('Preferences saved!', 'success');
}

function applyTheme(theme) {
  document.body.classList.toggle('dark-theme', theme === 'dark');
  document.body.classList.toggle('light-theme', theme === 'light');
}

function selectPlan(plan) {
  showToast(`Upgrade to ${plan} - payment integration coming soon!`, 'info');
}

// ═══════════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════════
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  document.body.style.overflow = '';
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.add('hidden');
    document.body.style.overflow = '';
  }
});

// Close modals on ESC key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Close any open standard modal-overlay
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => {
      m.classList.add('hidden');
    });
    document.body.style.overflow = '';
  }
});

// ═══════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════
// ── Notification store ──────────────────────────────────────
// Each item: { id, type, category, title, desc, time, read }
// categories: 'tasks' | 'alerts' | 'info'
function getNotifStore() {
  if (!store.notifications) store.notifications = [];
  return store.notifications;
}

function buildNotifications() {
  const now = new Date();
  const generated = [];

  // 1. Overdue tasks
  const tasks = store.pmTasks || [];
  tasks.forEach(task => {
    if (task.status === 'done') return;
    if (!task.dueDate) return;
    const due = new Date(task.dueDate);
    const diffDays = Math.floor((now - due) / 86400000);
    if (diffDays > 0) {
      generated.push({
        id: 'task-overdue-' + task.id,
        type: 'overdue',
        category: 'tasks',
        icon: '🚨',
        title: 'Overdue Task: ' + task.title,
        desc: 'Was due ' + diffDays + ' day' + (diffDays > 1 ? 's' : '') + ' ago' +
              (task.assigneeName ? ' · Assigned to ' + task.assigneeName : ''),
        time: task.dueDate,
        read: false
      });
    } else if (diffDays >= -2) {
      generated.push({
        id: 'task-due-soon-' + task.id,
        type: 'warning',
        category: 'tasks',
        icon: '⏰',
        title: 'Due Soon: ' + task.title,
        desc: diffDays === 0 ? 'Due today!' : 'Due in ' + Math.abs(diffDays) + ' day' + (Math.abs(diffDays) > 1 ? 's' : '') +
              (task.assigneeName ? ' · ' + task.assigneeName : ''),
        time: task.dueDate,
        read: false
      });
    }
  });

  // 2. Open high-priority issues
  const issues = store.pmIssues || [];
  issues.forEach(issue => {
    if (issue.status === 'resolved' || issue.status === 'closed') return;
    if (issue.priority === 'critical' || issue.priority === 'high') {
      generated.push({
        id: 'issue-open-' + issue.id,
        type: 'overdue',
        category: 'alerts',
        icon: '🔴',
        title: (issue.priority === 'critical' ? 'Critical' : 'High') + ' Issue: ' + issue.title,
        desc: 'Status: ' + issue.status + (issue.assignee ? ' · Assigned to ' + issue.assignee : ''),
        time: issue.date || '',
        read: false
      });
    }
  });

  // 3. High-probability risks
  const risks = store.pmRisks || [];
  risks.forEach(risk => {
    if (risk.status === 'mitigated' || risk.status === 'closed') return;
    if (risk.score >= 6 || risk.impact === 'high') {
      generated.push({
        id: 'risk-' + risk.id,
        type: 'warning',
        category: 'alerts',
        icon: '⚠️',
        title: 'Risk Alert: ' + risk.description,
        desc: 'Category: ' + risk.category + ' · Score: ' + (risk.score || 'N/A') + ' · Owner: ' + (risk.owner || 'Unassigned'),
        time: '',
        read: false
      });
    }
  });

  // 4. Recently completed tasks (last 48h)
  tasks.forEach(task => {
    if (task.status !== 'done' || !task.completedDate) return;
    const comp = new Date(task.completedDate);
    const diffH = Math.floor((now - comp) / 3600000);
    if (diffH <= 48) {
      generated.push({
        id: 'task-done-' + task.id,
        type: 'success',
        category: 'tasks',
        icon: '✅',
        title: 'Task Completed: ' + task.title,
        desc: 'Completed ' + (diffH < 1 ? 'just now' : diffH + 'h ago') +
              (task.assigneeName ? ' by ' + task.assigneeName : ''),
        time: task.completedDate,
        read: false
      });
    }
  });

  // 5. Projects summary
  const projects = store.projects || [];
  if (projects.length > 0) {
    const activeProjects = projects.filter(p => p.status !== 'completed' && p.status !== 'cancelled');
    if (activeProjects.length > 0) {
      generated.push({
        id: 'projects-active',
        type: 'info',
        category: 'info',
        icon: '🏗️',
        title: activeProjects.length + ' Active Project' + (activeProjects.length > 1 ? 's' : ''),
        desc: activeProjects.slice(0, 3).map(p => p.name || p.title || 'Untitled').join(', ') +
              (activeProjects.length > 3 ? ` and ${activeProjects.length - 3} more` : ''),
        time: '',
        read: true
      });
    }
  }

  // Merge with existing store — preserve read state, add new ones
  const existing = getNotifStore();
  store.notifications = generated.map(n => {
    const e = existing.find(x => x.id === n.id);
    return e ? { ...n, read: e.read } : n;
  });

  saveStore();
  return store.notifications;
}

function updateNotifBadge() {
  const notifs = buildNotifications();
  const unread = notifs.filter(n => !n.read).length;
  const badge = document.getElementById('notif-count');
  if (badge) {
    badge.textContent = unread > 99 ? '99+' : unread;
    if (unread > 0) {
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
}

function showNotifications() {
  const panel = document.getElementById('notifications-panel');
  const overlay = document.getElementById('notif-overlay');
  if (!panel) return;

  // Close user menu if open
  const userMenu = document.getElementById('user-menu');
  if (userMenu && !userMenu.classList.contains('hidden')) {
    userMenu.classList.add('hidden');
  }

  if (!panel.classList.contains('hidden')) {
    closeNotifications();
    return;
  }

  renderNotifPanel('all');
  panel.classList.remove('hidden');
  if (overlay) overlay.classList.remove('hidden');
}

function closeNotifications() {
  const panel = document.getElementById('notifications-panel');
  const overlay = document.getElementById('notif-overlay');
  if (panel) panel.classList.add('hidden');
  if (overlay) overlay.classList.add('hidden');
}

function switchNotifTab(tab, btn) {
  document.querySelectorAll('.notif-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderNotifPanel(tab);
}

function renderNotifPanel(filter) {
  const list = document.getElementById('notif-list');
  if (!list) return;

  const notifs = buildNotifications();
  let filtered = notifs;
  if (filter === 'unread') filtered = notifs.filter(n => !n.read);
  else if (filter === 'tasks') filtered = notifs.filter(n => n.category === 'tasks');
  else if (filter === 'alerts') filtered = notifs.filter(n => n.category === 'alerts');

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="notif-empty">
        <span class="notif-empty-icon">✅</span>
        <p>${filter === 'unread' ? 'No unread notifications' : "You're all caught up!"}</p>
      </div>`;
    return;
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const diff = Math.floor((Date.now() - d) / 60000);
    if (diff < 1) return 'just now';
    if (diff < 60) return diff + 'm ago';
    if (diff < 1440) return Math.floor(diff / 60) + 'h ago';
    return Math.floor(diff / 1440) + 'd ago';
  }

  list.innerHTML = filtered.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'} notif-type-${n.type}"
         onclick="markNotificationRead('${n.id}', this)">
      <div class="notif-item-icon">${n.icon || '🔔'}</div>
      <div class="notif-item-body">
        <p class="notif-item-title">${n.title}</p>
        <p class="notif-item-desc">${n.desc}</p>
        <span class="notif-item-time">${timeAgo(n.time)}</span>
      </div>
      ${n.read ? '' : '<div class="notif-unread-dot"></div>'}
    </div>
  `).join('');
}

function markNotificationRead(id, el) {
  const notifs = getNotifStore();
  const n = notifs.find(x => x.id === id);
  if (n) {
    n.read = true;
    store.notifications = notifs;
    saveStore();
    if (el) {
      el.classList.remove('unread');
      const dot = el.querySelector('.notif-unread-dot');
      if (dot) dot.remove();
    }
    updateNotifBadge();
  }
}

function markAllNotificationsRead() {
  const notifs = getNotifStore();
  notifs.forEach(n => { n.read = true; });
  store.notifications = notifs;
  saveStore();
  updateNotifBadge();
  const activeTab = document.querySelector('.notif-tab.active');
  const tabName = activeTab ? activeTab.textContent.toLowerCase() : 'all';
  renderNotifPanel(tabName);
}

function clearAllNotifications() {
  store.notifications = [];
  saveStore();
  updateNotifBadge();
  closeNotifications();
  showToast('Notifications cleared', 'success');
}

// ═══════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════
let toastTimeout;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  document.getElementById('toast-icon').textContent = icons[type] || '✅';
  document.getElementById('toast-msg').textContent = msg;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ═══════════════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════════════
async function apiGet(url) {
  const res = await fetch(`${API}${url}`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  if (!res.ok) {
    if (res.status === 401) { handleSessionExpired(); return null; }
    return null;
  }
  return res.json();
}

async function apiPost(url, body) {
  const res = await fetch(`${API}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    if (res.status === 401) { handleSessionExpired(); return null; }
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Request failed');
  }
  return res.json();
}

async function apiPut(url, body) {
  const res = await fetch(`${API}${url}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    if (res.status === 401) { handleSessionExpired(); return null; }
    return null;
  }
  return res.json();
}

// FIX BUG-002: apiDelete was missing entirely
async function apiDelete(url) {
  const res = await fetch(`${API}${url}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  if (!res.ok) {
    if (res.status === 401) { handleSessionExpired(); return null; }
    return null;
  }
  try { return res.json(); } catch(e) { return { success: true }; }
}

// FIX BUG-001: syncStore was called but never defined
async function syncStore() {
  if (!authToken) return;
  try {
    await fetch(`${API}/api/users/store`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ store: store })
    });
  } catch(e) {
    localStorage.setItem('foreman_store', JSON.stringify(store));
  }
  localStorage.setItem('foreman_store', JSON.stringify(store));
}

// FIX BUG-009: Handle expired/invalid auth tokens gracefully
function handleSessionExpired() {
  authToken = null;
  isAdmin = false;
  currentUser = null;
  localStorage.removeItem('foreman_token');
  localStorage.removeItem('foreman_user');
  localStorage.removeItem('foreman_is_admin');
  showNotification('Session expired. Please sign in again.', 'warning');
  setTimeout(() => { showAuth(); }, 1500);
}

// ═══════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount || 0);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

function showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

function togglePassword(id) {
  const input = document.getElementById(id);
  input.type = input.type === 'password' ? 'text' : 'password';
}

function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el && val !== undefined && val !== null) el.value = val;
}

function getChecked(id) {
  const el = document.getElementById(id);
  return el ? el.checked : false;
}

function setChecked(id, val) {
  const el = document.getElementById(id);
  if (el) el.checked = !!val;
}

function darkenColor(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function hexToRgba(hex, alpha) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// Filter docs
function filterDocs(cat) {
  // Redirect to new filterDocuments function
  filterDocuments(cat, document.getElementById(`doc-cat-${cat}`));
}
// ═══════════════════════════════════════════════════════════════════
// INVOICE / ESTIMATE TAB SWITCHING
// ═══════════════════════════════════════════════════════════════════
function showInvTab(tab, btn) {
  document.getElementById('inv-tab-invoices').style.display = tab === 'invoices' ? 'block' : 'none';
  document.getElementById('inv-tab-estimates').style.display = tab === 'estimates' ? 'block' : 'none';
  document.querySelectorAll('.inv-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function openEstimateModal() {
  estLineCount = 0;
  document.getElementById('est-lines-body').innerHTML = '';
  document.getElementById('est-customer').value = '';
  document.getElementById('est-project-desc').value = '';
  document.getElementById('est-notes').value = '';
  document.getElementById('est-subtotal').textContent = '$0.00';
  document.getElementById('est-gst-total').textContent = '$0.00';
  document.getElementById('est-grand-total').textContent = '$0.00';
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('est-date').value = today;
  const valid = new Date(); valid.setDate(valid.getDate() + 30);
  document.getElementById('est-valid-until').value = valid.toISOString().split('T')[0];
  addEstimateLine();
  openModal('new-estimate-modal');
}


// ═══════════════════════════════════════════════════════════════
// PROFILE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function handleProfilePhoto(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5MB', 'error'); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    localStorage.setItem('profilePhoto', dataUrl);
    const img = document.getElementById('profile-avatar-img');
    const avatar = document.getElementById('profile-avatar-display');
    if (img) { img.src = dataUrl; img.style.display = 'block'; }
    if (avatar) avatar.style.backgroundImage = `url(${dataUrl})`;
    showToast('Profile photo updated!', 'success');
  };
  reader.readAsDataURL(file);
}

function removeProfilePhoto() {
  localStorage.removeItem('profilePhoto');
  const img = document.getElementById('profile-avatar-img');
  const avatar = document.getElementById('profile-avatar-display');
  if (img) { img.src = ''; img.style.display = 'none'; }
  if (avatar) avatar.style.backgroundImage = '';
  showToast('Profile photo removed', 'info');
}

function setAvatarColor(color) {
  store.profile.avatarColor = color;
localStorage.setItem('foreman_store', JSON.stringify(store));
  const circle = document.getElementById('profile-avatar-display');
  if (circle) circle.style.background = color;
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  const swatch = document.querySelector(`.color-swatch[data-color="${color}"]`);
  if (swatch) swatch.classList.add('selected');
  showToast('Avatar color updated!', 'success');
}

function updateAvatarInitials() {
  const val = document.getElementById('p-initials') ? document.getElementById('p-initials').value : '';
  const circle = document.getElementById('profile-avatar-display');
  if (circle) {
    const span = circle.querySelector('.avatar-initials-text');
    if (span) span.textContent = val.toUpperCase().slice(0, 3);
  }
  localStorage.setItem('avatarInitials', val.toUpperCase().slice(0, 3));
}

async function changePassword() {
  const current = getVal('p-current-pw');
  const newPw = getVal('p-new-pw');
  const confirm = getVal('p-confirm-pw');
  if (!current) { showToast('Enter your current password', 'error'); return; }
  if (newPw.length < 8) { showToast('New password must be at least 8 characters', 'error'); return; }
  if (newPw !== confirm) { showToast('Passwords do not match', 'error'); return; }
  // FIX BUG-003: Never store passwords in localStorage - send to API only
  try {
    const res = await apiPost('/api/users/change-password', {
      current_password: current,
      new_password: newPw,
      confirm_password: confirm
    });
    if (res && res.success) {
      setVal('p-current-pw', '');
      setVal('p-new-pw', '');
      setVal('p-confirm-pw', '');
      localStorage.removeItem('userPassword');
      showToast('Password changed successfully!', 'success');
    } else {
      showToast(res?.detail || 'Password change failed. Check your current password.', 'error');
    }
  } catch(e) {
    showToast('Password change failed: ' + e.message, 'error');
  }
}

function saveProfile() {
  const profile = {
    fullName: getVal('p-name'),
    displayName: getVal('p-display-name'),
    email: getVal('p-email'),
    phone: getVal('p-phone'),
    jobTitle: getVal('p-job-title'),
    companyRole: getVal('p-company-role'),
    province: getVal('p-province'),
    timezone: getVal('p-timezone'),
    bio: getVal('p-bio'),
    signature: getVal('p-signature'),
    linkedin: getVal('p-linkedin'),
    website: getVal('p-website'),
    emergency: getVal('p-emergency-name'),
    initials: getVal('p-initials'),
    avatarColor: store.profile.avatarColor || '#2563eb',
    photo: localStorage.getItem('profilePhoto') || ''
  };
  store.profile = profile;
localStorage.setItem('foreman_store', JSON.stringify(store));

  // Update header display
  const headerName = document.getElementById('header-user-name');
  if (headerName) headerName.textContent = profile.displayName || profile.fullName || 'User';

  // Update avatar
  const circle = document.getElementById('profile-avatar-display');
  if (circle) {
    circle.style.background = profile.avatarColor;
    if (profile.photo) circle.style.backgroundImage = `url(${profile.photo})`;
    const span = document.getElementById('profile-avatar-initial');
    if (span) span.textContent = profile.initials || (profile.fullName ? profile.fullName.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase() : 'U');
    if (profile.photo) {
      const img = document.getElementById('profile-avatar-img');
      if (img) { img.src = profile.photo; img.style.display = 'block'; }
    }
  }
  showToast('Profile saved successfully!', 'success');
}

function loadProfile() {
  const raw = store.profile && Object.keys(store.profile).length > 0 ? JSON.stringify(store.profile) : localStorage.getItem('userProfile');
  if (!raw) return;
  try {
    const p = JSON.parse(raw);
    const fieldMap = {
      'p-name': p.fullName,
      'p-display-name': p.displayName,
      'p-email': p.email,
      'p-phone': p.phone,
      'p-job-title': p.jobTitle,
      'p-company-role': p.companyRole,
      'p-province': p.province,
      'p-timezone': p.timezone,
      'p-bio': p.bio,
      'p-signature': p.signature,
      'p-linkedin': p.linkedin,
      'p-website': p.website,
      'p-emergency-name': p.emergency,
      'p-initials': p.initials
    };
    Object.entries(fieldMap).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el && val !== undefined && val !== null) el.value = val;
    });
    if (p.avatarColor) {
      const avatar = document.getElementById('profile-avatar-display');
      if (avatar) avatar.style.background = p.avatarColor;
    }
    if (p.photo) {
      const img = document.getElementById('profile-avatar-img');
      if (img) { img.src = p.photo; img.style.display = 'block'; }
    }
    if (p.initials) {
      const span = document.getElementById('profile-avatar-initial');
      if (span) span.textContent = p.initials;
    } else if (p.fullName) {
      const span = document.getElementById('profile-avatar-initial');
      if (span) span.textContent = p.fullName.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    }
  } catch(e) { console.warn('loadProfile error:', e); }
}

// ═══════════════════════════════════════════════════════════════
// EXPENSE / RECEIPT FUNCTIONS
// ═══════════════════════════════════════════════════════════════

// BUG-014 FIX: receipts now live in store.receipts (unified store)
const receiptStoreAlias = store.receipts; // backward compat alias

function showExpenseTab(tab, btn) {
  // Hide all expense content divs
  ['list','receipts','summary'].forEach(t => {
    const el = document.getElementById('etab-content-' + t);
    if (el) el.style.display = 'none';
  });
  document.querySelectorAll('#page-expenses .filter-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('etab-content-' + tab);
  if (el) el.style.display = 'block';
  if (btn) btn.classList.add('active');
  if (tab === 'receipts') renderReceiptGallery();
  if (tab === 'summary') renderExpenseSummary();
  if (tab === 'list') renderExpenses();
}

function handleReceiptUpload(input) {
  const files = Array.from(input.files);
  files.forEach(file => processReceiptFile(file));
}

function handleReceiptDrop(e) {
  e.preventDefault();
  const zone = document.getElementById('receipt-drop-zone');
  if (zone) zone.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
  files.forEach(file => processReceiptFile(file));
}

function processReceiptFile(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const receipt = {
      id: Date.now() + Math.random(),
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: e.target.result,
      date: new Date().toISOString().split('T')[0],
      amount: '',
      vendor: '',
      category: 'Uncategorized',
      notes: '',
      uploaded: new Date().toISOString()
    };
    store.receipts.push(receipt);
    localStorage.setItem('foreman_store', JSON.stringify(store));
    renderReceiptGallery();
    showToast(`Receipt "${file.name}" uploaded!`, 'success');
  };
  reader.readAsDataURL(file);
}

function renderReceiptGallery() {
  const gallery = document.getElementById('receipt-gallery');
  if (!gallery) return;
  if (!store.receipts || store.receipts.length === 0) {
    gallery.innerHTML = '<div class="empty-state-sm">No receipts yet. Upload or take a photo above.</div>';
    return;
  }
  gallery.innerHTML = store.receipts.map((r, i) => `
    <div class="receipt-card" id="receipt-${i}">
      <div class="receipt-thumb">
        ${r.type && r.type.startsWith('image/') ? `<img src="${r.dataUrl}" alt="Receipt" onclick="viewReceipt(${i})">` : `<div class="receipt-pdf-icon">📄</div>`}
      </div>
      <div class="receipt-info">
        <div class="receipt-name">${escapeHtml(r.name)}</div>
        <div class="receipt-meta">
          <input type="text" class="receipt-field" placeholder="Vendor" value="${escapeHtml(r.vendor||'')}" onchange="updateReceipt(${i},'vendor',this.value)">
          <input type="number" class="receipt-field" placeholder="Amount $" value="${r.amount||''}" onchange="updateReceipt(${i},'amount',this.value)">
          <input type="date" class="receipt-field" value="${r.date||''}" onchange="updateReceipt(${i},'date',this.value)">
          <select class="receipt-field" onchange="updateReceipt(${i},'category',this.value)">
            ${['Uncategorized','Materials','Labour','Equipment','Fuel','Meals','Travel','Office','Subcontractor','Other'].map(c=>`<option value="${c}" ${r.category===c?'selected':''}>${c}</option>`).join('')}
          </select>
          <input type="text" class="receipt-field" placeholder="Notes" value="${escapeHtml(r.notes||'')}" onchange="updateReceipt(${i},'notes',this.value)">
        </div>
        <div class="receipt-actions">
          <button class="btn-sm btn-primary" onclick="saveReceiptToExpenses(${i})">💾 Save to Expenses</button>
          <button class="btn-sm btn-danger" onclick="deleteReceipt(${i})">🗑 Delete</button>
        </div>
      </div>
    </div>
  `).join('');
}

function updateReceipt(idx, field, value) {
  if (!store.receipts[idx]) return;
  store.receipts[idx][field] = value;
  localStorage.setItem('foreman_store', JSON.stringify(store));
}

function deleteReceipt(idx) {
  store.receipts.splice(idx, 1);
  localStorage.setItem('foreman_store', JSON.stringify(store));
  renderReceiptGallery();
  showToast('Receipt deleted', 'info');
}

function viewReceipt(idx) {
  const r = store.receipts[idx];
  if (!r) return;
  const w = window.open('', '_blank');
  w.document.write(`<html><body style="margin:0;background:#000;display:flex;justify-content:center;align-items:center;min-height:100vh"><img src="${r.dataUrl}" style="max-width:100%;max-height:100vh"></body></html>`);
}

function saveReceiptToExpenses(idx) {
  const r = store.receipts[idx];
  if (!r) return;
  if (!r.amount || !r.vendor) { showToast('Please fill in vendor and amount first', 'error'); return; }
  const expense = {
    id: Date.now(),
    date: r.date || new Date().toISOString().split('T')[0],
    description: r.vendor + (r.notes ? ' - ' + r.notes : ''),
    category: r.category || 'Other',
    amount: parseFloat(r.amount) || 0,
    gst: parseFloat(r.amount) * 0.05 || 0,
    receiptRef: r.name,
    source: 'receipt'
  };
  if (!store.expenses) store.expenses = [];
  store.expenses.push(expense);
  localStorage.setItem('expenses', JSON.stringify(store.expenses));
  showToast(`Expense saved: $${expense.amount.toFixed(2)} from ${escapeHtml(r.vendor || '')}`, 'success');
  renderExpenses();
}

function renderExpenses() {
  const container = document.getElementById('expenses-list');
  if (!container) return;
  const expenses = store.expenses || [];
  const catFilter = document.getElementById('exp-filter-cat') ? document.getElementById('exp-filter-cat').value : 'all';
  const monthFilter = document.getElementById('exp-filter-month') ? document.getElementById('exp-filter-month').value : 'all';
  const now = new Date();
  let filtered = expenses;
  if (catFilter && catFilter !== 'all') filtered = filtered.filter(e => (e.category || '') === catFilter || (e.account || '') === catFilter);
  if (monthFilter === 'this-month') {
    const ym = now.toISOString().slice(0,7);
    filtered = filtered.filter(e => e.date && e.date.startsWith(ym));
  } else if (monthFilter === 'last-month') {
    const d = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const ym = d.toISOString().slice(0,7);
    filtered = filtered.filter(e => e.date && e.date.startsWith(ym));
  } else if (monthFilter === 'this-year') {
    const yr = now.getFullYear().toString();
    filtered = filtered.filter(e => e.date && e.date.startsWith(yr));
  }
  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">💳</div><h3>No Expenses Found</h3><p>Try changing your filters or add a new expense</p><button class="btn-primary" onclick="openModal('new-expense-modal')">+ Add Expense</button></div>`;
    const totalEl = document.getElementById('exp-total-display');
    if (totalEl) totalEl.textContent = '';
    return;
  }
  const total = filtered.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const totalEl = document.getElementById('exp-total-display');
  if (totalEl) totalEl.textContent = 'Total: ' + formatCurrency(total);
  container.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Amount</th><th>GST</th><th>Actions</th></tr></thead>
      <tbody>
        ${filtered.map((e, i) => `
          <tr>
            <td>${e.date || ''}</td>
            <td>${escapeHtml(e.description || '')}</td>
            <td><span class="badge">${e.category || 'Other'}</span></td>
            <td>${formatCurrency(e.amount || 0)}</td>
            <td>${formatCurrency(e.gst || 0)}</td>
            <td><button class="btn-sm btn-danger" onclick="deleteExpense(${i})">🗑</button></td>
          </tr>
        `).join('')}
      </tbody>
      <tfoot><tr><td colspan="3"><strong>Total</strong></td><td colspan="3"><strong>${formatCurrency(total)}</strong></td></tr></tfoot>
    </table>`;
}

function deleteExpense(idx) {
  if (!store.expenses) return;
  store.expenses.splice(idx, 1);
  // BUG-002 FIX: Use unified saveStore() instead of wrong localStorage key
  saveStore();
  renderExpenses();
  showToast('Expense deleted', 'info');
}

function exportExpensesCSV() {
  const expenses = store.expenses || [];
  const rows = [['Date','Description','Category','Amount','GST','Source']];
  expenses.forEach(e => rows.push([e.date||'', e.description||'', e.category||'', e.amount||0, e.gst||0, e.source||'manual']));
  downloadCSV(rows, 'expenses.csv');
}

function renderExpenseSummary() {
  const expenses = store.expenses || [];
  const total = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const gstTotal = expenses.reduce((s, e) => s + (parseFloat(e.gst) || 0), 0);
  const byCategory = {};
  expenses.forEach(e => {
    const cat = e.category || 'Other';
    byCategory[cat] = (byCategory[cat] || 0) + (parseFloat(e.amount) || 0);
  });
  const summaryEl = document.getElementById('exp-summary-cards');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Total Expenses</div><div class="kpi-value">${formatCurrency(total)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total GST Paid</div><div class="kpi-value">${formatCurrency(gstTotal)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Receipts Uploaded</div><div class="kpi-value">${store.receipts.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Categories</div><div class="kpi-value">${Object.keys(byCategory).length}</div></div>`;
  }
  const breakdownEl = document.getElementById('exp-category-breakdown');
  if (breakdownEl) {
    breakdownEl.innerHTML = Object.entries(byCategory).sort((a,b)=>b[1]-a[1]).map(([cat, amt]) => `
      <div class="expense-cat-row">
        <span class="expense-cat-name">${cat}</span>
        <div class="expense-cat-bar-wrap"><div class="expense-cat-bar" style="width:${total>0?Math.round(amt/total*100):0}%"></div></div>
        <span class="expense-cat-amt">${formatCurrency(amt)} (${total>0?Math.round(amt/total*100):0}%)</span>
      </div>`).join('');
  }
}

// ═══════════════════════════════════════════════════════════════
// ACCOUNTING & BOOKKEEPING FUNCTIONS
// ═══════════════════════════════════════════════════════════════

if (!window.acctStore) {
  window.acctStore = JSON.parse(localStorage.getItem('acctStore') || JSON.stringify({
    journal: [],
    ar: [],
    ap: [],
    reconciliation: { bankBalance: 0, bookBalance: 0, adjustments: [] }
  }));
}

function saveAcctStore() {
  localStorage.setItem('acctStore', JSON.stringify(window.acctStore));
}

function showAcctTab(tab, btn) {
  // Hide all acct content divs
  ['overview','journal','ar','ap','reconcile','trial','balance'].forEach(t => {
    const el = document.getElementById('acct-content-' + t);
    if (el) el.style.display = 'none';
  });
  document.querySelectorAll('#page-accounting .filter-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('acct-content-' + tab);
  if (el) el.style.display = 'block';
  if (btn) btn.classList.add('active');
  if (tab === 'overview') renderAcctOverview();
  if (tab === 'journal') renderJournal();
  if (tab === 'ar') renderAR();
  if (tab === 'ap') renderAP();
  if (tab === 'reconcile') renderReconciliation();
  if (tab === 'trial') renderTrialBalance();
  if (tab === 'balance') renderBalanceSheetAcct();
}

function initAccounting() {
  // Show overview, hide others
  ['overview','journal','ar','ap','reconcile','trial','balance'].forEach(t => {
    const el = document.getElementById('acct-content-' + t);
    if (el && t !== 'overview') el.style.display = 'none';
    if (el && t === 'overview') el.style.display = 'block';
  });
  renderAcctOverview();
}

function renderAcctOverview() {
  const journal = window.acctStore.journal || [];
  const ar = window.acctStore.ar || [];
  const ap = window.acctStore.ap || [];
  const totalRevenue = journal.filter(j=>j.type==='revenue').reduce((s,j)=>s+(parseFloat(j.credit)||0),0);
  const totalExpenses = journal.filter(j=>j.type==='expense').reduce((s,j)=>s+(parseFloat(j.debit)||0),0);
  const arOutstanding = ar.filter(a=>a.status!=='paid').reduce((s,a)=>s+(parseFloat(a.amount)||0),0);
  const apOutstanding = ap.filter(a=>a.status!=='paid').reduce((s,a)=>s+(parseFloat(a.amount)||0),0);
  const kpiEl = document.getElementById('acct-kpi-cards');
  if (kpiEl) {
    kpiEl.innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Total Revenue (Journal)</div><div class="kpi-value">${formatCurrency(totalRevenue)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Expenses (Journal)</div><div class="kpi-value">${formatCurrency(totalExpenses)}</div></div>
      <div class="kpi-card"><div class="kpi-label">AR Outstanding</div><div class="kpi-value">${formatCurrency(arOutstanding)}</div></div>
      <div class="kpi-card"><div class="kpi-label">AP Outstanding</div><div class="kpi-value">${formatCurrency(apOutstanding)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Net Income</div><div class="kpi-value ${totalRevenue-totalExpenses>=0?'text-green':'text-red'}">${formatCurrency(totalRevenue-totalExpenses)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Journal Entries</div><div class="kpi-value">${journal.length}</div></div>`;
  }
  // Update standalone balance spans
  const arTotalEl = document.getElementById('acct-ar-total');
  const apTotalEl = document.getElementById('acct-ap-total');
  const netEl = document.getElementById('acct-net-position');
  if (arTotalEl) arTotalEl.textContent = formatCurrency(arOutstanding);
  if (apTotalEl) apTotalEl.textContent = formatCurrency(apOutstanding);
  if (netEl) { const net = arOutstanding - apOutstanding; netEl.textContent = formatCurrency(net); netEl.style.color = net >= 0 ? '#059669' : '#dc2626'; }
  const recentEl = document.getElementById('acct-recent-journal');
  if (recentEl) {
    const recent = [...journal].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,5);
    if (recent.length === 0) { recentEl.innerHTML = '<div class="empty-state-sm">No journal entries yet.</div>'; return; }
    recentEl.innerHTML = `<table class="data-table"><thead><tr><th>Date</th><th>Description</th><th>Account</th><th>Debit</th><th>Credit</th></tr></thead><tbody>
      ${recent.map(j=>`<tr><td>${j.date||''}</td><td>${escapeHtml(j.description||'')}</td><td>${escapeHtml(j.account||'')}</td><td>${j.debit?formatCurrency(j.debit):''}</td><td>${j.credit?formatCurrency(j.credit):''}</td></tr>`).join('')}
    </tbody></table>`;
  }
}

function openJournalModal() {
  const today = new Date().toISOString().split('T')[0];
  setVal('je-date', today);
  setVal('je-description', '');
  setVal('je-account', '');
  setVal('je-type', 'expense');
  setVal('je-debit', '');
  setVal('je-credit', '');
  setVal('je-reference', '');
  setVal('je-notes', '');
  openModal('add-journal-modal');
}

function saveJournalEntry() {
  const entry = {
    id: Date.now(),
    date: getVal('je-date'),
    description: getVal('je-description'),
    account: getVal('je-account'),
    type: getVal('je-type'),
    debit: parseFloat(getVal('je-debit')) || 0,
    credit: parseFloat(getVal('je-credit')) || 0,
    reference: getVal('je-reference'),
    notes: getVal('je-notes'),
    created: new Date().toISOString()
  };
  if (!entry.date || !entry.description) { showToast('Date and description required', 'error'); return; }
  if (!entry.debit && !entry.credit) { showToast('Enter debit or credit amount', 'error'); return; }
  window.acctStore.journal.push(entry);
  saveAcctStore();
  closeModal('add-journal-modal');
  renderJournal();
  renderAcctOverview();
  showToast('Journal entry saved!', 'success');
}

function renderJournal() {
  const container = document.getElementById('journal-table-container');
  if (!container) return;
  const journal = window.acctStore.journal || [];
  const typeFilter = document.getElementById('journal-filter-type') ? document.getElementById('journal-filter-type').value : 'all';
  let filtered = journal;
  if (typeFilter && typeFilter !== 'all') filtered = filtered.filter(j => j.type === typeFilter);
  filtered = [...filtered].sort((a,b) => new Date(b.date) - new Date(a.date));
  if (filtered.length === 0) { container.innerHTML = '<div class="empty-state-sm">No journal entries yet. Click "+ Add Entry" to begin.</div>'; return; }
  const totalDebit = filtered.reduce((s,j)=>s+(parseFloat(j.debit)||0),0);
  const totalCredit = filtered.reduce((s,j)=>s+(parseFloat(j.credit)||0),0);
  container.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Date</th><th>Description</th><th>Account</th><th>Type</th><th>Debit</th><th>Credit</th><th>Ref</th><th>Actions</th></tr></thead>
      <tbody>
        ${filtered.map((j,i) => `
          <tr>
            <td>${j.date||''}</td>
            <td>${escapeHtml(j.description||'')}</td>
            <td>${escapeHtml(j.account||'')}</td>
            <td><span class="badge badge-${j.type||'other'}">${j.type||'other'}</span></td>
            <td class="text-right">${j.debit?formatCurrency(j.debit):''}</td>
            <td class="text-right">${j.credit?formatCurrency(j.credit):''}</td>
            <td>${escapeHtml(j.reference||'')}</td>
            <td><button class="btn-sm btn-danger" onclick="deleteJournalEntry(${j.id})">🗑</button></td>
          </tr>`).join('')}
      </tbody>
      <tfoot><tr><td colspan="4"><strong>Totals</strong></td><td class="text-right"><strong>${formatCurrency(totalDebit)}</strong></td><td class="text-right"><strong>${formatCurrency(totalCredit)}</strong></td><td colspan="2"></td></tr></tfoot>
    </table>`;
}

function deleteJournalEntry(id) {
  window.acctStore.journal = window.acctStore.journal.filter(j => j.id !== id);
  saveAcctStore();
  renderJournal();
  showToast('Entry deleted', 'info');
}

function exportJournalCSV() {
  const journal = window.acctStore.journal || [];
  const rows = [['Date','Description','Account','Type','Debit','Credit','Reference','Notes']];
  journal.forEach(j => rows.push([j.date||'',j.description||'',j.account||'',j.type||'',j.debit||0,j.credit||0,j.reference||'',j.notes||'']));
  downloadCSV(rows, 'journal_entries.csv');
}

// ── Accounts Receivable ──────────────────────────────────────

function openARModal() {
  const today = new Date().toISOString().split('T')[0];
  setVal('ar-date', today);
  setVal('ar-customer', '');
  setVal('ar-description', '');
  setVal('ar-amount', '');
  setVal('ar-due-date', '');
  setVal('ar-status', 'outstanding');
  setVal('ar-invoice-ref', '');
  openModal('add-ar-modal');
}

function saveAREntry() {
  const entry = {
    id: Date.now(),
    date: getVal('ar-date'),
    customer: getVal('ar-customer'),
    description: getVal('ar-description'),
    amount: parseFloat(getVal('ar-amount')) || 0,
    dueDate: getVal('ar-due-date'),
    status: getVal('ar-status'),
    invoiceRef: getVal('ar-invoice-ref'),
    created: new Date().toISOString()
  };
  if (!entry.customer || !entry.amount) { showToast('Customer and amount required', 'error'); return; }
  window.acctStore.ar.push(entry);
  saveAcctStore();
  closeModal('add-ar-modal');
  renderAR();
  renderAcctOverview();
  showToast('AR entry saved!', 'success');
}

function renderAR() {
  const container = document.getElementById('ar-table-container');
  if (!container) return;
  const ar = window.acctStore.ar || [];
  const outstanding = ar.filter(a=>a.status!=='paid').reduce((s,a)=>s+(parseFloat(a.amount)||0),0);
  const paid = ar.filter(a=>a.status==='paid').reduce((s,a)=>s+(parseFloat(a.amount)||0),0);
  const overdue = ar.filter(a=>a.status!=='paid' && a.dueDate && new Date(a.dueDate)<new Date()).reduce((s,a)=>s+(parseFloat(a.amount)||0),0);
  const summaryEl = document.getElementById('ar-summary-cards');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Outstanding</div><div class="kpi-value text-orange">${formatCurrency(outstanding)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Overdue</div><div class="kpi-value text-red">${formatCurrency(overdue)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Collected</div><div class="kpi-value text-green">${formatCurrency(paid)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Entries</div><div class="kpi-value">${ar.length}</div></div>`;
  }
  if (ar.length === 0) { container.innerHTML = '<div class="empty-state-sm">No AR entries. Add invoices or manual AR entries.</div>'; return; }
  const sorted = [...ar].sort((a,b)=>new Date(b.date)-new Date(a.date));
  container.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Date</th><th>Customer</th><th>Description</th><th>Amount</th><th>Due Date</th><th>Status</th><th>Invoice Ref</th><th>Actions</th></tr></thead>
      <tbody>
        ${sorted.map(a => `
          <tr class="${a.status!=='paid'&&a.dueDate&&new Date(a.dueDate)<new Date()?'row-overdue':''}">
            <td>${a.date||''}</td>
            <td>${escapeHtml(a.customer||'')}</td>
            <td>${escapeHtml(a.description||'')}</td>
            <td class="text-right">${formatCurrency(a.amount||0)}</td>
            <td>${a.dueDate||''}</td>
            <td><span class="badge badge-${a.status==='paid'?'success':a.status==='overdue'?'danger':'warning'}">${a.status||'outstanding'}</span></td>
            <td>${escapeHtml(a.invoiceRef||'')}</td>
            <td>
              ${a.status!=='paid'?`<button class="btn-sm btn-success" onclick="markARPaid(${a.id})">✓ Paid</button>`:''}
              <button class="btn-sm btn-danger" onclick="deleteAREntry(${a.id})">🗑</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function markARPaid(id) {
  const entry = window.acctStore.ar.find(a=>a.id===id);
  if (entry) { entry.status = 'paid'; entry.paidDate = new Date().toISOString().split('T')[0]; }
  saveAcctStore();
  renderAR();
  showToast('Marked as paid!', 'success');
}

function deleteAREntry(id) {
  window.acctStore.ar = window.acctStore.ar.filter(a=>a.id!==id);
  saveAcctStore();
  renderAR();
  showToast('AR entry deleted', 'info');
}

function exportARCSV() {
  const ar = window.acctStore.ar || [];
  const rows = [['Date','Customer','Description','Amount','Due Date','Status','Invoice Ref']];
  ar.forEach(a => rows.push([a.date||'',a.customer||'',a.description||'',a.amount||0,a.dueDate||'',a.status||'',a.invoiceRef||'']));
  downloadCSV(rows, 'accounts_receivable.csv');
}

// ── Accounts Payable ─────────────────────────────────────────

function openAPModal() {
  const today = new Date().toISOString().split('T')[0];
  setVal('ap-date', today);
  setVal('ap-vendor', '');
  setVal('ap-description', '');
  setVal('ap-amount', '');
  setVal('ap-due-date', '');
  setVal('ap-status', 'outstanding');
  setVal('ap-bill-ref', '');
  openModal('add-ap-modal');
}

function saveAPEntry() {
  const entry = {
    id: Date.now(),
    date: getVal('ap-date'),
    vendor: getVal('ap-vendor'),
    description: getVal('ap-description'),
    amount: parseFloat(getVal('ap-amount')) || 0,
    dueDate: getVal('ap-due-date'),
    status: getVal('ap-status'),
    billRef: getVal('ap-bill-ref'),
    created: new Date().toISOString()
  };
  if (!entry.vendor || !entry.amount) { showToast('Vendor and amount required', 'error'); return; }
  window.acctStore.ap.push(entry);
  saveAcctStore();
  closeModal('add-ap-modal');
  renderAP();
  renderAcctOverview();
  showToast('AP entry saved!', 'success');
}

function renderAP() {
  const container = document.getElementById('ap-table-container');
  if (!container) return;
  const ap = window.acctStore.ap || [];
  const outstanding = ap.filter(a=>a.status!=='paid').reduce((s,a)=>s+(parseFloat(a.amount)||0),0);
  const paid = ap.filter(a=>a.status==='paid').reduce((s,a)=>s+(parseFloat(a.amount)||0),0);
  const overdue = ap.filter(a=>a.status!=='paid' && a.dueDate && new Date(a.dueDate)<new Date()).reduce((s,a)=>s+(parseFloat(a.amount)||0),0);
  const summaryEl = document.getElementById('ap-summary-cards');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Owed to Vendors</div><div class="kpi-value text-orange">${formatCurrency(outstanding)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Overdue Bills</div><div class="kpi-value text-red">${formatCurrency(overdue)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Paid Bills</div><div class="kpi-value text-green">${formatCurrency(paid)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Entries</div><div class="kpi-value">${ap.length}</div></div>`;
  }
  if (ap.length === 0) { container.innerHTML = '<div class="empty-state-sm">No AP entries. Add bills or manual AP entries.</div>'; return; }
  const sorted = [...ap].sort((a,b)=>new Date(b.date)-new Date(a.date));
  container.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Date</th><th>Vendor</th><th>Description</th><th>Amount</th><th>Due Date</th><th>Status</th><th>Bill Ref</th><th>Actions</th></tr></thead>
      <tbody>
        ${sorted.map(a => `
          <tr class="${a.status!=='paid'&&a.dueDate&&new Date(a.dueDate)<new Date()?'row-overdue':''}">
            <td>${a.date||''}</td>
            <td>${escapeHtml(a.vendor||'')}</td>
            <td>${escapeHtml(a.description||'')}</td>
            <td class="text-right">${formatCurrency(a.amount||0)}</td>
            <td>${a.dueDate||''}</td>
            <td><span class="badge badge-${a.status==='paid'?'success':a.status==='overdue'?'danger':'warning'}">${a.status||'outstanding'}</span></td>
            <td>${escapeHtml(a.billRef||'')}</td>
            <td>
              ${a.status!=='paid'?`<button class="btn-sm btn-success" onclick="markAPPaid(${a.id})">✓ Paid</button>`:''}
              <button class="btn-sm btn-danger" onclick="deleteAPEntry(${a.id})">🗑</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function markAPPaid(id) {
  const entry = window.acctStore.ap.find(a=>a.id===id);
  if (entry) { entry.status = 'paid'; entry.paidDate = new Date().toISOString().split('T')[0]; }
  saveAcctStore();
  renderAP();
  showToast('Bill marked as paid!', 'success');
}

function deleteAPEntry(id) {
  window.acctStore.ap = window.acctStore.ap.filter(a=>a.id!==id);
  saveAcctStore();
  renderAP();
  showToast('AP entry deleted', 'info');
}

function exportAPCSV() {
  const ap = window.acctStore.ap || [];
  const rows = [['Date','Vendor','Description','Amount','Due Date','Status','Bill Ref']];
  ap.forEach(a => rows.push([a.date||'',a.vendor||'',a.description||'',a.amount||0,a.dueDate||'',a.status||'',a.billRef||'']));
  downloadCSV(rows, 'accounts_payable.csv');
}

// ── Bank Reconciliation ──────────────────────────────────────

function renderReconciliation() {
  const recon = window.acctStore.reconciliation || { bankBalance: 0, bookBalance: 0 };
  setVal('recon-bank-balance', recon.bankBalance || 0);
  setVal('recon-book-balance', recon.bookBalance || 0);
  if (recon.outstandingCheques) setVal('recon-outstanding-cheques', recon.outstandingCheques);
  if (recon.depositsInTransit) setVal('recon-deposits-transit', recon.depositsInTransit);
  if (recon.bankErrors) setVal('recon-bank-errors', recon.bankErrors);
  if (recon.bookErrors) setVal('recon-book-errors', recon.bookErrors);
  calcReconciliation();
}

function renderReconAdjustments() {
  const recon = window.acctStore.reconciliation || { adjustments: [] };
  const container = document.getElementById('recon-adjustments-list');
  if (!container) return;
  const adjs = recon.adjustments || [];
  if (adjs.length === 0) { container.innerHTML = '<div class="empty-state-sm">No adjustments added.</div>'; return; }
  container.innerHTML = adjs.map((a, i) => `
    <div class="recon-adj-row">
      <span class="recon-adj-desc">${escapeHtml(a.description||'')}</span>
      <span class="recon-adj-type badge badge-${a.type==='add'?'success':'danger'}">${a.type==='add'?'+':'-'}</span>
      <span class="recon-adj-amt">${formatCurrency(a.amount||0)}</span>
      <button class="btn-sm btn-danger" onclick="removeReconAdj(${i})">🗑</button>
    </div>`).join('');
}

function addReconAdjustment() {
  const desc = getVal('recon-adj-desc');
  const type = getVal('recon-adj-type');
  const amount = parseFloat(getVal('recon-adj-amount')) || 0;
  if (!desc || !amount) { showToast('Description and amount required', 'error'); return; }
  if (!window.acctStore.reconciliation) window.acctStore.reconciliation = { bankBalance: 0, bookBalance: 0, adjustments: [] };
  window.acctStore.reconciliation.adjustments.push({ description: desc, type, amount });
  saveAcctStore();
  setVal('recon-adj-desc', '');
  setVal('recon-adj-amount', '');
  renderReconAdjustments();
  calcReconciliation();
}

function removeReconAdj(idx) {
  window.acctStore.reconciliation.adjustments.splice(idx, 1);
  saveAcctStore();
  renderReconAdjustments();
  calcReconciliation();
}

function calcReconciliation() {
  const bankBal = parseFloat(getVal('recon-bank-balance')) || 0;
  const bookBal = parseFloat(getVal('recon-book-balance')) || 0;
  const outstandingCheques = parseFloat(getVal('recon-outstanding-cheques')) || 0;
  const depositsInTransit = parseFloat(getVal('recon-deposits-transit')) || 0;
  const bankErrors = parseFloat(getVal('recon-bank-errors')) || 0;
  const bookErrors = parseFloat(getVal('recon-book-errors')) || 0;
  const adjustedBank = bankBal - outstandingCheques + depositsInTransit + bankErrors;
  const adjustedBook = bookBal + bookErrors;
  const diff = adjustedBank - adjustedBook;
  setVal('recon-adj-bank', formatCurrency(adjustedBank));
  setVal('recon-adj-book', formatCurrency(adjustedBook));
  setVal('recon-difference', formatCurrency(diff));
  const statusEl = document.getElementById('recon-status');
  if (statusEl) {
    if (Math.abs(diff) < 0.01) {
      statusEl.innerHTML = '<span style="color:#059669">✅ BALANCED — Bank and Book balances agree!</span>';
    } else {
      statusEl.innerHTML = '<span style="color:#dc2626">⚠️ UNBALANCED — Difference of ' + formatCurrency(Math.abs(diff)) + '. Check for errors.</span>';
    }
  }
}

function saveReconciliation() {
  if (!window.acctStore.reconciliation) window.acctStore.reconciliation = {};
  window.acctStore.reconciliation.bankBalance = parseFloat(getVal('recon-bank-balance')) || 0;
  window.acctStore.reconciliation.bookBalance = parseFloat(getVal('recon-book-balance')) || 0;
  window.acctStore.reconciliation.outstandingCheques = parseFloat(getVal('recon-outstanding-cheques')) || 0;
  window.acctStore.reconciliation.depositsInTransit = parseFloat(getVal('recon-deposits-transit')) || 0;
  window.acctStore.reconciliation.bankErrors = parseFloat(getVal('recon-bank-errors')) || 0;
  window.acctStore.reconciliation.bookErrors = parseFloat(getVal('recon-book-errors')) || 0;
  window.acctStore.reconciliation.savedDate = new Date().toISOString();
  saveAcctStore();
  calcReconciliation();
  showToast('Reconciliation saved!', 'success');
}

function exportReconciliation() {
  const recon = window.acctStore.reconciliation || { bankBalance: 0, bookBalance: 0, adjustments: [] };
  const rows = [['Bank Reconciliation Report'], ['Date', new Date().toLocaleDateString()], [],
    ['Bank Statement Balance', recon.bankBalance || 0], ['Book Balance', recon.bookBalance || 0], [],
    ['Adjustments'], ['Description', 'Type', 'Amount']];
  (recon.adjustments || []).forEach(a => rows.push([a.description, a.type, a.amount]));
  downloadCSV(rows, 'bank_reconciliation.csv');
}

// ── Trial Balance ────────────────────────────────────────────

function renderTrialBalance() {
  const container = document.getElementById('trial-balance-container');
  if (!container) return;
  const journal = window.acctStore.journal || [];
  const dateEl = document.getElementById('trial-as-of');
  const asOf = dateEl ? dateEl.value : new Date().toISOString().split('T')[0];
  const filtered = asOf ? journal.filter(j => j.date <= asOf) : journal;
  const accounts = {};
  filtered.forEach(j => {
    const acct = j.account || 'Unclassified';
    if (!accounts[acct]) accounts[acct] = { debit: 0, credit: 0 };
    accounts[acct].debit += parseFloat(j.debit) || 0;
    accounts[acct].credit += parseFloat(j.credit) || 0;
  });
  const totalDebit = Object.values(accounts).reduce((s,a)=>s+a.debit,0);
  const totalCredit = Object.values(accounts).reduce((s,a)=>s+a.credit,0);
  if (Object.keys(accounts).length === 0) {
    container.innerHTML = '<div class="empty-state-sm">No journal entries to generate trial balance. Add journal entries first.</div>';
    return;
  }
  container.innerHTML = `
    <h4 style="text-align:center;margin-bottom:8px">Trial Balance — As of ${asOf || 'All Dates'}</h4>
    <table class="data-table">
      <thead><tr><th>Account</th><th class="text-right">Debit</th><th class="text-right">Credit</th></tr></thead>
      <tbody>
        ${Object.entries(accounts).map(([acct, vals]) => `
          <tr>
            <td>${escapeHtml(acct)}</td>
            <td class="text-right">${vals.debit ? formatCurrency(vals.debit) : ''}</td>
            <td class="text-right">${vals.credit ? formatCurrency(vals.credit) : ''}</td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr class="total-row">
          <td><strong>TOTALS</strong></td>
          <td class="text-right"><strong>${formatCurrency(totalDebit)}</strong></td>
          <td class="text-right"><strong>${formatCurrency(totalCredit)}</strong></td>
        </tr>
        <tr>
          <td colspan="3" class="text-center ${Math.abs(totalDebit-totalCredit)<0.01?'text-green':'text-red'}">
            ${Math.abs(totalDebit-totalCredit)<0.01?'✅ Trial Balance is BALANCED':'⚠️ Out of balance by '+formatCurrency(Math.abs(totalDebit-totalCredit))}
          </td>
        </tr>
      </tfoot>
    </table>`;
}

function exportTrialBalance() {
  const journal = window.acctStore.journal || [];
  const accounts = {};
  journal.forEach(j => {
    const acct = j.account || 'Unclassified';
    if (!accounts[acct]) accounts[acct] = { debit: 0, credit: 0 };
    accounts[acct].debit += parseFloat(j.debit) || 0;
    accounts[acct].credit += parseFloat(j.credit) || 0;
  });
  const rows = [['Account', 'Debit', 'Credit']];
  Object.entries(accounts).forEach(([acct, vals]) => rows.push([acct, vals.debit, vals.credit]));
  const td = Object.values(accounts).reduce((s,a)=>s+a.debit,0);
  const tc = Object.values(accounts).reduce((s,a)=>s+a.credit,0);
  rows.push(['TOTALS', td, tc]);
  downloadCSV(rows, 'trial_balance.csv');
}

// ── Balance Sheet ────────────────────────────────────────────

function renderBalanceSheetAcct() {
  const container = document.getElementById('balance-sheet-acct-container');
  if (!container) return;
  const journal = window.acctStore.journal || [];
  const ar = window.acctStore.ar || [];
  const ap = window.acctStore.ap || [];
  const dateEl = document.getElementById('balance-as-of');
  const asOf = dateEl ? dateEl.value : new Date().toISOString().split('T')[0];
  const filtered = asOf ? journal.filter(j => j.date <= asOf) : journal;
  const totalRevenue = filtered.filter(j=>j.type==='revenue').reduce((s,j)=>s+(parseFloat(j.credit)||0),0);
  const totalExpenses = filtered.filter(j=>j.type==='expense').reduce((s,j)=>s+(parseFloat(j.debit)||0),0);
  const netIncome = totalRevenue - totalExpenses;
  const arOutstanding = ar.filter(a=>a.status!=='paid' && (!asOf || a.date<=asOf)).reduce((s,a)=>s+(parseFloat(a.amount)||0),0);
  const apOutstanding = ap.filter(a=>a.status!=='paid' && (!asOf || a.date<=asOf)).reduce((s,a)=>s+(parseFloat(a.amount)||0),0);
  const cashEntries = filtered.filter(j=>j.type==='asset'||j.account?.toLowerCase().includes('cash')||j.account?.toLowerCase().includes('bank'));
  const cashBalance = cashEntries.reduce((s,j)=>s+(parseFloat(j.debit)||0)-(parseFloat(j.credit)||0),0);
  const totalAssets = Math.max(0, cashBalance) + arOutstanding;
  const totalLiabilities = apOutstanding;
  const equity = totalAssets - totalLiabilities;
  container.innerHTML = `
    <h4 style="text-align:center;margin-bottom:8px">Balance Sheet — As of ${asOf || 'All Dates'}</h4>
    <div class="balance-sheet-grid">
      <div class="bs-section">
        <h5 class="bs-section-title">ASSETS</h5>
        <div class="bs-line"><span>Cash & Bank</span><span>${formatCurrency(Math.max(0,cashBalance))}</span></div>
        <div class="bs-line"><span>Accounts Receivable</span><span>${formatCurrency(arOutstanding)}</span></div>
        <div class="bs-line bs-total"><span><strong>Total Assets</strong></span><span><strong>${formatCurrency(totalAssets)}</strong></span></div>
      </div>
      <div class="bs-section">
        <h5 class="bs-section-title">LIABILITIES</h5>
        <div class="bs-line"><span>Accounts Payable</span><span>${formatCurrency(apOutstanding)}</span></div>
        <div class="bs-line bs-total"><span><strong>Total Liabilities</strong></span><span><strong>${formatCurrency(totalLiabilities)}</strong></span></div>
      </div>
      <div class="bs-section">
        <h5 class="bs-section-title">EQUITY</h5>
        <div class="bs-line"><span>Revenue (YTD)</span><span>${formatCurrency(totalRevenue)}</span></div>
        <div class="bs-line"><span>Expenses (YTD)</span><span>(${formatCurrency(totalExpenses)})</span></div>
        <div class="bs-line"><span>Net Income</span><span class="${netIncome>=0?'text-green':'text-red'}">${formatCurrency(netIncome)}</span></div>
        <div class="bs-line bs-total"><span><strong>Total Equity</strong></span><span><strong>${formatCurrency(equity)}</strong></span></div>
      </div>
      <div class="bs-check ${Math.abs(totalAssets-totalLiabilities-equity)<0.01?'bs-balanced':'bs-unbalanced'}">
        ${Math.abs(totalAssets-totalLiabilities-equity)<0.01?'✅ Balance Sheet BALANCES (Assets = Liabilities + Equity)':'⚠️ Balance Sheet does not balance — check journal entries'}
      </div>
    </div>`;
}

function exportBalanceSheetAcct() {
  const journal = window.acctStore.journal || [];
  const ar = window.acctStore.ar || [];
  const ap = window.acctStore.ap || [];
  const totalRevenue = journal.filter(j=>j.type==='revenue').reduce((s,j)=>s+(parseFloat(j.credit)||0),0);
  const totalExpenses = journal.filter(j=>j.type==='expense').reduce((s,j)=>s+(parseFloat(j.debit)||0),0);
  const arOutstanding = ar.filter(a=>a.status!=='paid').reduce((s,a)=>s+(parseFloat(a.amount)||0),0);
  const apOutstanding = ap.filter(a=>a.status!=='paid').reduce((s,a)=>s+(parseFloat(a.amount)||0),0);
  const rows = [
    ['Balance Sheet', new Date().toLocaleDateString()], [],
    ['ASSETS'], ['Accounts Receivable', arOutstanding], ['Total Assets', arOutstanding], [],
    ['LIABILITIES'], ['Accounts Payable', apOutstanding], ['Total Liabilities', apOutstanding], [],
    ['EQUITY'], ['Revenue YTD', totalRevenue], ['Expenses YTD', totalExpenses], ['Net Income', totalRevenue-totalExpenses], ['Total Equity', arOutstanding-apOutstanding]
  ];
  downloadCSV(rows, 'balance_sheet.csv');
}

function exportAcctReport() {
  exportJournalCSV();
}


// ========================================
// PROJECT EDIT & SCOPE OF WORK FUNCTIONS
// ========================================

let currentSowAdd = [];
let currentSowEdit = [];

function generateLinkId() {
  return 'proj_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now().toString(36);
}

function openEditProjectModal(projectId) {
  const projects = store.projects || [];
  const project = projects.find(p => p.id === projectId);
  if (!project) {
    showNotification('Project not found', 'error');
    return;
  }
  
  document.getElementById('edit-proj-id').value = project.id;
  document.getElementById('edit-proj-name').value = project.name || '';
  document.getElementById('edit-proj-client').value = project.client_name || '';
  document.getElementById('edit-proj-client-email').value = project.client_email || '';
  document.getElementById('edit-proj-type').value = project.project_type || 'Other';
  document.getElementById('edit-proj-value').value = project.contract_value || project.budget || '';
  
  const statusMap = { 'pending': 'Not Started', 'active': 'In Progress', 'on_hold': 'On Hold', 'completed': 'Completed' };
  document.getElementById('edit-proj-status').value = statusMap[project.status] || project.status || 'Not Started';
  
  document.getElementById('edit-proj-start').value = project.start_date || '';
  document.getElementById('edit-proj-finish').value = project.scheduled_finish_date || '';
  document.getElementById('edit-proj-address').value = project.address || '';
  document.getElementById('edit-proj-desc').value = project.description || '';
  
  currentSowEdit = (project.scope_of_work || []).map(item => ({...item}));
  renderScopeOfWorkEdit(currentSowEdit);
  
  openModal('modal-edit-project');
}

function renderScopeOfWorkEdit(items) {
  const container = document.getElementById('edit-proj-sow-container');
  if (!items || items.length === 0) {
    container.innerHTML = '<p style="color:#999;font-style:italic">No scope items added yet</p>';
    return;
  }
  container.innerHTML = items.map((item, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px;background:#f5f5f5;border-radius:4px;margin-bottom:5px">
      <input type="checkbox" ${item.completed ? 'checked' : ''} onchange="toggleSowItem('edit', ${i})">
      <input type="text" value="${escapeHtml(item.text)}" onchange="updateSowItem('edit', ${i}, this.value)" style="flex:1;padding:5px;border:1px solid #ddd;border-radius:3px">
      <button type="button" style="padding:5px 10px;background:#dc3545;color:white;border:none;border-radius:3px;cursor:pointer" onclick="removeSowItem('edit', ${i})">&times;</button>
    </div>
  `).join('');
}

function renderScopeOfWorkAdd(items) {
  const container = document.getElementById('proj-sow-container');
  if (!items || items.length === 0) {
    container.innerHTML = '<p style="color:#999;font-style:italic">No scope items added yet</p>';
    return;
  }
  container.innerHTML = items.map((item, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px;background:#f5f5f5;border-radius:4px;margin-bottom:5px">
      <input type="checkbox" ${item.completed ? 'checked' : ''} onchange="toggleSowItem('add', ${i})">
      <input type="text" value="${escapeHtml(item.text)}" onchange="updateSowItem('add', ${i}, this.value)" style="flex:1;padding:5px;border:1px solid #ddd;border-radius:3px">
      <button type="button" style="padding:5px 10px;background:#dc3545;color:white;border:none;border-radius:3px;cursor:pointer" onclick="removeSowItem('add', ${i})">&times;</button>
    </div>
  `).join('');
}

function addScopeOfWorkItem(mode) {
  const inputId = mode === 'edit' ? 'edit-proj-new-sow' : 'proj-new-sow';
  const input = document.getElementById(inputId);
  const text = input.value.trim();
  if (!text) {
    showNotification('Please enter a scope item', 'warning');
    return;
  }
  const newItem = { text: text, completed: false };
  if (mode === 'add') {
    currentSowAdd.push(newItem);
    renderScopeOfWorkAdd(currentSowAdd);
  } else {
    currentSowEdit.push(newItem);
    renderScopeOfWorkEdit(currentSowEdit);
  }
  input.value = '';
}

function toggleSowItem(mode, index) {
  const arr = mode === 'add' ? currentSowAdd : currentSowEdit;
  if (arr[index]) arr[index].completed = !arr[index].completed;
}

function updateSowItem(mode, index, newText) {
  const arr = mode === 'add' ? currentSowAdd : currentSowEdit;
  if (arr[index]) arr[index].text = newText;
}

function removeSowItem(mode, index) {
  if (mode === 'add') {
    currentSowAdd.splice(index, 1);
    renderScopeOfWorkAdd(currentSowAdd);
  } else {
    currentSowEdit.splice(index, 1);
    renderScopeOfWorkEdit(currentSowEdit);
  }
}

async function saveEditedProject() {
  const projectId = document.getElementById('edit-proj-id').value;
  const name = document.getElementById('edit-proj-name').value.trim();
  const client = document.getElementById('edit-proj-client').value.trim();
  const clientEmail = document.getElementById('edit-proj-client-email').value.trim();
  const type = document.getElementById('edit-proj-type').value;
  const value = document.getElementById('edit-proj-value').value;
  const status = document.getElementById('edit-proj-status').value;
  const start = document.getElementById('edit-proj-start').value;
  const finish = document.getElementById('edit-proj-finish').value.trim();
  const address = document.getElementById('edit-proj-address').value.trim();
  const desc = document.getElementById('edit-proj-desc').value.trim();
  
  if (!name || !finish) {
    showNotification('Please fill in required fields', 'warning');
    return;
  }
  
  const projects = store.projects || [];
  const projectIndex = projects.findIndex(p => p.id === projectId);
  if (projectIndex === -1) {
    showNotification('Project not found', 'error');
    return;
  }
  
  const statusReverseMap = { 'Not Started': 'pending', 'In Progress': 'active', 'On Hold': 'on_hold', 'Completed': 'completed' };
  
  projects[projectIndex] = {
    ...projects[projectIndex],
    name: name,
    client_name: client,
    client_email: clientEmail,
    project_type: type,
    trade: type,
    contract_value: parseFloat(value) || 0,
    budget: parseFloat(value) || 0,
    status: statusReverseMap[status] || status,
    start_date: start,
    scheduled_finish_date: finish,
    address: address,
    description: desc,
    scope_of_work: currentSowEdit,
    updated_at: new Date().toISOString()
  };
  
  if (!projects[projectIndex].client_link_id) {
    projects[projectIndex].client_link_id = generateLinkId();
  }
  
  store.projects = projects;
  localStorage.setItem('foreman_store', JSON.stringify(store));
  
  closeModal('modal-edit-project');
  renderProjects();
  showNotification('Project updated successfully', 'success');
  
  try { await syncStore(); } catch (e) { console.error('Sync error:', e); }
}

function getClientShareLink(projectId) {
  const projects = store.projects || [];
  const project = projects.find(p => p.id === projectId);
  if (!project) return null;
  if (!project.client_link_id) {
    project.client_link_id = generateLinkId();
    store.projects = projects;
    localStorage.setItem('foreman_store', JSON.stringify(store));
    syncStore();
  }
  return window.location.origin + '/client-view/' + project.client_link_id;
}

function showClientLinkModal(projectId) {
  const link = getClientShareLink(projectId);
  if (link) {
    document.getElementById('client-link-url').value = link;
    openModal('modal-client-link');
  } else {
    showNotification('Project not found', 'error');
  }
}

function copyClientLinkFromModal() {
  const link = document.getElementById('client-link-url').value;
  navigator.clipboard.writeText(link).then(() => {
    showNotification('Link copied to clipboard!', 'success');
  }).catch(() => {
    showNotification('Failed to copy link', 'error');
  });
}

function showProjectDetails(projectId) {
  const projects = store.projects || [];
  const project = projects.find(p => p.id === projectId);
  if (!project) {
    showNotification('Project not found', 'error');
    return;
  }
  
  document.getElementById('proj-details-title').textContent = project.name;
  document.getElementById('proj-details-info').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:15px">
      <div><strong>Client:</strong> ${escapeHtml(project.client_name || 'N/A')}</div>
      <div><strong>Type:</strong> ${escapeHtml(project.project_type || project.trade || 'N/A')}</div>
      <div><strong>Status:</strong> ${escapeHtml(project.status)}</div>
      <div><strong>Expected Finish:</strong> ${escapeHtml(project.scheduled_finish_date || 'Not set')}</div>
    </div>
  `;
  
  const sow = project.scope_of_work || [];
  document.getElementById('proj-details-scope').innerHTML = sow.length === 0 
    ? '<p style="color:#999;font-style:italic">No scope of work items defined</p>'
    : sow.map(item => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f0f0f0">
        <input type="checkbox" ${item.completed ? 'checked' : ''} disabled>
        <span style="${item.completed ? 'text-decoration:line-through;color:#999' : ''}">${escapeHtml(item.text)}</span>
      </div>
    `).join('');
  
  openModal('modal-project-details');
}


// ========================================
// UPGRADED AI CHAT FUNCTIONS
// ========================================

// Render markdown-like text to HTML
function renderMarkdown(text) {
  if (!text) return '';
  let html = text
    // Escape HTML first
    .replace(/&/g, '&')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    // Code blocks
    .replace(/```([\s\S]*?)```/g, '<pre style="background:#f0f4ff;padding:10px;border-radius:6px;overflow-x:auto;margin:8px 0"><code>$1</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.08);padding:1px 5px;border-radius:4px;font-family:monospace">$1</code>')
    // Headers
    .replace(/^### (.+)$/gm, '<h4 style="margin:10px 0 5px;font-size:0.95rem">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="margin:12px 0 6px;font-size:1rem">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 style="margin:12px 0 6px;font-size:1.1rem">$1</h2>')
    // Bullet points - convert to li
    .replace(/^[•\-\*] (.+)$/gm, '<li style="margin:3px 0">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li style="margin:3px 0">$1</li>')
    // Horizontal rule
    .replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid #e2e8f0;margin:12px 0">')
    // Paragraphs - double newline
    .replace(/\n\n/g, '</p><p style="margin:8px 0">')
    // Single newline
    .replace(/\n/g, '<br>');
  
  // Wrap li items in ul
  html = html.replace(/(<li[^>]*>.*?<\/li>(<br>)?)+/g, function(m) {
    return '<ul style="padding-left:18px;margin:6px 0">' + m.replace(/<br>/g, '') + '</ul>';
  });
  
  return '<p style="margin:0">' + html + '</p>';
}


// Override appendMessage to support markdown
function appendMessage(text, role, actions) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-message ${role}`;
  const avatar = role === 'ai' ? '📋' : (currentUser?.contact_name?.charAt(0)?.toUpperCase() || 'U');
  
  let actionsHtml = '';
  if (actions && actions.length > 0) {
    actionsHtml = `<div class="chat-actions" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">
      ${actions.map(a => `<button class="btn-secondary btn-sm" onclick="navigateTo('${a.page || ''}')" style="font-size:0.8rem;padding:4px 10px">${a.label}</button>`).join('')}
    </div>`;
  }
  
  const content = role === 'ai' 
    ? `<div class="msg-content"><p style="margin:0">${renderMarkdown(text)}</p></div>${actionsHtml}`
    : `<p style="margin:0">${escapeHtml(text)}</p>`;
  
  div.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div class="msg-bubble">${content}</div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// Override sendMessage to include app data context
async function sendMessage() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;

  input.value = '';
  autoResize(input);
  appendMessage(msg, 'user');
  showTyping();

  try {
    // Build app data context from store
    const appData = {
      projects: store.projects || [],
      invoices: store.invoices || [],
      expenses: store.expenses || [],
      employees: store.employees || [],
      contractors: store.contractors || [],
      journal_entries: store.journal_entries || [],
      ar_entries: store.ar_entries || [],
      ap_entries: store.ap_entries || [],
      documents: store.documents || []
    };

    const res = await fetch(`${API}/api/chat/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        message: msg,
        context: currentPage,
        app_data: appData,
        user_context: {
          contact_name: currentUser?.contact_name || '',
          business_name: currentUser?.business_name || '',
          trade: currentUser?.trade || ''
        }
      })
    });
    const data = await res.json();
    hideTyping();
    appendMessage(data.response || 'I can help with that!', 'ai', data.actions);
    
    // Show suggestions
    if (data.suggestions && data.suggestions.length > 0) {
      const sugDiv = document.getElementById('chat-suggestions');
      if (sugDiv) {
        sugDiv.innerHTML = data.suggestions.map(s => 
          `<button class="suggestion-chip" onclick="sendQuickPrompt('${s.replace(/'/g, "\'")}')">${s}</button>`
        ).join('');
      }
    }
  } catch(e) {
    hideTyping();
    appendMessage('I\'m here to help! For construction questions, compliance, invoicing, and more — just ask.', 'ai');
  }
}

// Show AI context modal
function showAIContext() {
  const appData = {
    projects: (store.projects || []).length,
    invoices: (store.invoices || []).length,
    expenses: (store.expenses || []).length,
    documents: (store.documents || []).length
  };
  
  const msg = `📊 **AI Context Summary**\n\nThe AI currently has access to:\n• ${appData.projects} projects\n• ${appData.invoices} invoices\n• ${appData.expenses} expense entries\n• ${appData.documents} documents\n\nAll data is sent securely with each message.`;
  appendMessage(msg, 'ai');
}

// ========================================
// DOCUMENTS PAGE FUNCTIONS
// ========================================

let currentDocFilter = 'all';
let currentViewDocId = null;
let pendingDocFile = null;

function initDocuments() {
  currentDocFilter = 'all';
  // Reset filter buttons
  document.querySelectorAll('.doc-cat').forEach(b => b.classList.remove('active'));
  const allBtn = document.getElementById('doc-cat-all');
  if (allBtn) allBtn.classList.add('active');
  renderDocuments();
  updateDocStats();
}

function filterDocuments(category, btn, searchTerm) {
  if (category !== undefined && category !== '') currentDocFilter = category || 'all';
  if (btn) {
    document.querySelectorAll('.doc-cat').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  } else if (category) {
    // Try to activate the right button
    document.querySelectorAll('.doc-cat').forEach(b => b.classList.remove('active'));
    const targetBtn = document.getElementById(`doc-cat-${category}`);
    if (targetBtn) targetBtn.classList.add('active');
  }
  renderDocuments(searchTerm);
}

function renderDocuments(searchTerm) {
  const container = document.getElementById('documents-grid');
  if (!container) return;
  
  let docs = store.documents || [];
  
  // Filter by category
  if (currentDocFilter && currentDocFilter !== 'all') {
    docs = docs.filter(d => d.category === currentDocFilter);
  }
  
  // Filter by search
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    docs = docs.filter(d => 
      (d.name || '').toLowerCase().includes(term) ||
      (d.description || '').toLowerCase().includes(term) ||
      (d.category || '').toLowerCase().includes(term)
    );
  }
  
  const emptyEl = document.getElementById('documents-empty');
  if (docs.length === 0) {
    container.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    updateDocStats();
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  
  const catIcons = {
    'Blueprint': '📐', 'Contract': '📄', 'Permit': '🏛️',
    'Photo': '📷', 'Invoice': '🧾', 'Other': '📎'
  };
  
  container.innerHTML = docs.map(doc => {
    const icon = catIcons[doc.category] || '📎';
    const project = (store.projects || []).find(p => p.id === doc.project_id);
    const isImage = doc.file_type && doc.file_type.startsWith('image/');
    const isPDF = doc.file_type === 'application/pdf';
    const fileSize = formatFileSize(doc.file_size);
    
    return `
      <div class="doc-card" onclick="viewDocument('${doc.id}')">
        <div class="doc-card-header">
          <div class="doc-card-icon">${icon}</div>
          <div class="doc-card-badges">
            ${doc.client_visible === true || doc.client_visible === 'true' ? '<span class="doc-badge-client">👥 Client</span>' : ''}
            <span class="doc-badge-type">${getDocTypeLabel(doc.filename)}</span>
          </div>
          <button class="doc-card-delete" onclick="event.stopPropagation();deleteDocument('${doc.id}')">✕</button>
        </div>
        ${isImage && doc.data_url ? `<div class="doc-card-thumb"><img src="${doc.data_url}" alt="${escapeHtml(doc.name)}"></div>` : ''}
        ${isPDF ? `<div class="doc-card-thumb doc-card-thumb-pdf"><span>📄 PDF</span></div>` : ''}
        <div class="doc-card-name">${escapeHtml(doc.name)}</div>
        <div class="doc-card-meta">
          <span>${doc.category}</span>
          <span>•</span>
          <span>${formatDate(doc.created_at)}</span>
          ${fileSize ? `<span>• ${fileSize}</span>` : ''}
        </div>
        ${project ? `<div class="doc-card-project">📋 ${escapeHtml(project.name)}</div>` : ''}
        ${doc.description ? `<div class="doc-card-desc">${escapeHtml(doc.description)}</div>` : ''}
        <div class="doc-card-actions">
          <button onclick="event.stopPropagation();viewDocument('${doc.id}')" class="btn-secondary btn-sm">👁️ View</button>
          <button onclick="event.stopPropagation();downloadDocument('${doc.id}')" class="btn-secondary btn-sm">⬇️ Save</button>
          <button onclick="event.stopPropagation();shareDocumentToChat('${doc.id}')" class="btn-secondary btn-sm">🤖 Ask AI</button>
        </div>
      </div>
    `;
  }).join('');
  updateDocStats();
}

function handleDocumentDrop(event) {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (file) processDocumentFile(file);
}

function handleDocumentFileSelect(input) {
  const file = input.files[0];
  if (file) processDocumentFile(file);
}

function processDocumentFile(file) {
  pendingDocFile = file;
  
  // Auto-fill name if empty
  const nameInput = document.getElementById('doc-name');
  if (nameInput && !nameInput.value) {
    nameInput.value = file.name.replace(/\.[^/.]+$/, '');
  }
  
  // Auto-detect category
  const catSelect = document.getElementById('doc-category');
  if (catSelect) {
    const name = file.name.toLowerCase();
    if (name.includes('blueprint') || name.includes('plan') || name.endsWith('.dwg') || name.endsWith('.dxf')) {
      catSelect.value = 'Blueprint';
    } else if (name.includes('contract') || name.includes('agreement')) {
      catSelect.value = 'Contract';
    } else if (name.includes('permit')) {
      catSelect.value = 'Permit';
    } else if (file.type.startsWith('image/')) {
      catSelect.value = 'Photo';
    }
  }
  
  // Show preview
  const preview = document.getElementById('doc-preview');
  const dropZone = document.getElementById('doc-drop-zone');
  
  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = e => {
      preview.innerHTML = `<img src="${e.target.result}" style="max-width:100%;max-height:150px;border-radius:6px">`;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
  } else {
    preview.innerHTML = `<div style="padding:10px;background:#f0f4ff;border-radius:6px;text-align:center">
      <div style="font-size:1.5rem">📄</div>
      <div style="font-size:0.85rem;color:#333">${escapeHtml(file.name)}</div>
      <div style="font-size:0.75rem;color:#888">${(file.size / 1024).toFixed(1)} KB</div>
    </div>`;
    preview.style.display = 'block';
  }
  
  // Update drop zone text
  const content = dropZone.querySelector('.drop-zone-content');
  if (content) content.style.display = 'none';
}

async function saveDocument() {
  const name = document.getElementById('doc-name').value.trim();
  const category = document.getElementById('doc-category').value;
  const projectId = document.getElementById('doc-project').value;
  const clientVisible = document.getElementById('doc-client-visible').value === 'true';
  const description = document.getElementById('doc-description').value.trim();
  
  if (!name) {
    showNotification('Please enter a document name', 'warning');
    return;
  }
  
  if (!pendingDocFile) {
    showNotification('Please select a file to upload', 'warning');
    return;
  }
  
  // Read file as base64 data URL
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(pendingDocFile);
  });
  
  const doc = {
    id: 'doc_' + Date.now(),
    name: name,
    category: category,
    project_id: projectId || null,
    client_visible: clientVisible,
    description: description,
    file_name: pendingDocFile.name,
    file_type: pendingDocFile.type,
    file_size: pendingDocFile.size,
    data_url: dataUrl,
    created_at: new Date().toISOString()
  };
  
  if (!store.documents) store.documents = [];
  store.documents.push(doc);
  localStorage.setItem('foreman_store', JSON.stringify(store));
  
  // Clear form
  document.getElementById('doc-name').value = '';
  document.getElementById('doc-description').value = '';
  document.getElementById('doc-preview').style.display = 'none';
  const content = document.querySelector('#doc-drop-zone .drop-zone-content');
  if (content) content.style.display = '';
  pendingDocFile = null;
  
  closeModal('modal-upload-document');
  renderDocuments();
  showNotification('Document saved successfully', 'success');
  
  try { await syncStore(); } catch(e) {}
}

function viewDocument(docId) {
  const doc = (store.documents || []).find(d => d.id === docId);
  if (!doc) return;
  
  currentViewDocId = docId;
  document.getElementById('view-doc-title').textContent = doc.name;
  
  const viewer = document.getElementById('doc-viewer-content');
  
  if (doc.file_type && doc.file_type.startsWith('image/') && doc.data_url) {
    viewer.innerHTML = `<img src="${doc.data_url}" style="max-width:100%;max-height:70vh;object-fit:contain">`;
  } else if (doc.file_type === 'application/pdf' && doc.data_url) {
    viewer.innerHTML = `<iframe src="${doc.data_url}" style="width:100%;height:70vh;border:none"></iframe>`;
  } else if (doc.data_url) {
    viewer.innerHTML = `
      <div style="text-align:center;padding:40px">
        <div style="font-size:4rem">📄</div>
        <h3 style="margin:15px 0 8px">${escapeHtml(doc.name)}</h3>
        <p style="color:#666">${doc.file_name} • ${(doc.file_size/1024).toFixed(1)} KB</p>
        <button class="btn-primary" style="margin-top:20px" onclick="downloadDocument('${docId}')">⬇️ Download File</button>
      </div>
    `;
  } else {
    viewer.innerHTML = `<div style="text-align:center;padding:40px;color:#888">No preview available</div>`;
  }
  
  openModal('modal-view-document');
}

function downloadDocument(docId) {
  const doc = (store.documents || []).find(d => d.id === docId);
  if (!doc || !doc.data_url) {
    showNotification('File not available for download', 'error');
    return;
  }
  
  const a = document.createElement('a');
  a.href = doc.data_url;
  a.download = doc.file_name || doc.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function deleteDocument(docId) {
  if (!confirm('Delete this document? This cannot be undone.')) return;
  
  store.documents = (store.documents || []).filter(d => d.id !== docId);
  localStorage.setItem('foreman_store', JSON.stringify(store));
  renderDocuments();
  showNotification('Document deleted', 'success');
  
  try { syncStore(); } catch(e) {}
}


// ═══════════════════════════════════════════════════════════
// DOCUMENTS - Additional Helper Functions
// ═══════════════════════════════════════════════════════════

function openUploadDocModal() {
  // Populate project dropdown
  const sel = document.getElementById('doc-project');
  if (sel) {
    sel.innerHTML = '<option value="">No project</option>';
    (store.projects || []).forEach(p => {
      sel.innerHTML += `<option value="${p.id}">${escapeHtml(p.name || '')}</option>`;
    });
  }
  // Reset form
  const nameEl = document.getElementById('doc-name');
  const descEl = document.getElementById('doc-description');
  const previewEl = document.getElementById('doc-preview');
  if (nameEl) nameEl.value = '';
  if (descEl) descEl.value = '';
  if (previewEl) { previewEl.style.display = 'none'; previewEl.innerHTML = ''; }
  window._pendingDocFile = null;
  openModal('modal-upload-document');
}

function handleDocumentDropPage(event) {
  event.preventDefault();
  const zone = document.getElementById('doc-drop-zone-page');
  if (zone) zone.classList.remove('drag-over');
  const files = event.dataTransfer.files;
  if (files.length > 0) {
    openUploadDocModal();
    // Small delay to let modal open
    setTimeout(() => processDocumentFile(files[0]), 300);
  }
}

function updateDocStats() {
  const docs = store.documents || [];
  const countEl = document.getElementById('doc-count-label');
  const clientEl = document.getElementById('doc-client-count-label');
  if (countEl) countEl.textContent = `${docs.length} document${docs.length !== 1 ? 's' : ''}`;
  if (clientEl) {
    const clientCount = docs.filter(d => d.client_visible === true || d.client_visible === 'true').length;
    clientEl.textContent = `${clientCount} shared with clients`;
  }
}

function getDocIcon(category) {
  const icons = {
    'Blueprint': '📐',
    'Contract': '📄',
    'Permit': '🏛️',
    'Photo': '📷',
    'Invoice': '🧾',
    'Other': '📎'
  };
  return icons[category] || '📎';
}

function getDocTypeLabel(filename) {
  if (!filename) return 'FILE';
  const ext = filename.split('.').pop().toUpperCase();
  return ext;
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function shareDocumentToChat(docId) {
  const doc = (store.documents || []).find(d => d.id === docId);
  if (!doc) return;
  navigateTo('ai-chat');
  setTimeout(() => {
    const input = document.getElementById('chat-input');
    if (input) {
      input.value = `Please analyze this document: "${doc.name}" (${doc.category}). ${doc.description ? 'Notes: ' + doc.description : ''}`;
      input.focus();
    }
  }, 300);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROJECT MANAGEMENT SYSTEM - Advanced PM Features for The Foreman
// ═══════════════════════════════════════════════════════════════════════════════

// PM Data Store Extensions
store.pmTasks = store.pmTasks || [];
store.pmRisks = store.pmRisks || [];
store.pmIssues = store.pmIssues || [];
store.pmResources = store.pmResources || [];
store.pmActivities = store.pmActivities || [];
store.pmMilestones = store.pmMilestones || [];
store.pmChangeRequests = store.pmChangeRequests || [];
store.pmClientUpdates = store.pmClientUpdates || [];
store.pmCurrentView = 'board';
store.pmCurrentTab = 'overview';

// ── PM Data Initialization (empty — populated from real projects/payroll) ──
// Clear any old stale sample data that may be in localStorage
(function purgeSampleData() {
  const tasks = store.pmTasks || [];
  // Sample tasks had numeric ids (1-7) and hardcoded 2024 dates — remove them
  const purged = tasks.filter(t => {
    const id = String(t.id);
    // Remove legacy numeric-id sample tasks
    if (/^[1-7]$/.test(id)) return false;
    return true;
  });
  if (purged.length !== tasks.length) {
    store.pmTasks = purged;
    saveStore();
  }
  // Remove sample risks R001-R004
  const risks = store.pmRisks || [];
  const purgedRisks = risks.filter(r => !/^R00[1-4]$/.test(String(r.id)));
  if (purgedRisks.length !== risks.length) {
    store.pmRisks = purgedRisks;
    saveStore();
  }
  // Remove sample issues I001-I003
  const issues = store.pmIssues || [];
  const purgedIssues = issues.filter(i => !/^I00[1-3]$/.test(String(i.id)));
  if (purgedIssues.length !== issues.length) {
    store.pmIssues = purgedIssues;
    saveStore();
  }
  // Remove hardcoded sample labor resources (ids 1-8 with no projectId)
  const resources = store.pmResources || [];
  const purgedRes = resources.filter(r => {
    if (typeof r.id === 'number' && r.id >= 1 && r.id <= 8 && r.type === 'labor') return false;
    return true;
  });
  if (purgedRes.length !== resources.length) {
    store.pmResources = purgedRes;
    saveStore();
  }
})();

// Sync existing projects into PM (any project not yet tracked)

// ═══════════════════════════════════════════════════════════════════════════════
// PM TAB NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════════

function switchPMTab(tab) {
  store.pmCurrentTab = tab;
  
  // Update tab buttons
  document.querySelectorAll('.pm-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  
  // Update tab content
  document.querySelectorAll('.pm-tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `pm-tab-${tab}`);
  });
  
  // Render content based on tab
  switch(tab) {
    case 'overview': renderPMOverview(); break;
    case 'tasks': renderKanbanBoard(); break;
    case 'schedule': renderGanttChart(); break;
    case 'resources': renderResourcesTab(); break;
    case 'risks': renderRisksTab(); break;
    case 'issues': renderIssuesTab(); break;
    case 'reports': renderReportsTab(); break;
    case 'client': renderClientPortal(); break;
  }
}

function switchPMView(view) {
  store.pmCurrentView = view;
  if (view === 'gantt') {
    switchPMTab('schedule');
  } else if (view === 'board') {
    switchPMTab('tasks');
  } else {
    switchPMTab('tasks');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// KANBAN BOARD
// ═══════════════════════════════════════════════════════════════════════════════

function renderKanbanBoard() {
  const tasks = store.pmTasks || [];
  const statuses = ['todo', 'inprogress', 'review', 'done'];
  const statusLabels = { todo: '📋 To Do', inprogress: '🔄 In Progress', review: '👀 Review', done: '✅ Done' };
  
  statuses.forEach(status => {
    const container = document.getElementById(`kanban-${status}`);
    const statusTasks = tasks.filter(t => t.status === status);
    
    if (container) {
      if (statusTasks.length === 0) {
        container.innerHTML = '<div class="kanban-empty">No tasks</div>';
      } else {
        container.innerHTML = statusTasks.map(task => renderKanbanCard(task)).join('');
      }
      
      // Update count
      const countEl = document.getElementById(`${status}-count`);
      if (countEl) countEl.textContent = statusTasks.length;
    }
  });
  
  // Setup drag and drop
  setupKanbanDragDrop();
}

function renderKanbanCard(task) {
  const priorityColors = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e' };
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done';
  
  // Get assignee avatars
  const assigneeAvatars = (task.assignees && task.assignees.length > 0) 
    ? task.assignees.map(a => `<span class="avatar" title="${a.name}">${a.initials}</span>`).join('')
    : (task.assignee ? `<span class="avatar" title="${task.assigneeName || ''}">${task.assignee}</span>` : '');
  
  // Format cost display
  const costDisplay = task.cost ? `<span class="task-cost-badge">$${parseFloat(task.cost).toLocaleString()}</span>` : '';
  
  // Format duration display
  const durationDisplay = task.duration ? `<span class="task-duration-badge">📅 ${task.duration} day${task.duration > 1 ? 's' : ''}</span>` : '';
  
  // Get project name if linked
  const project = task.projectId ? (store.projects || []).find(p => p.id === task.projectId) : null;
  const projectDisplay = project ? `<span class="task-project-link" onclick="event.stopPropagation(); navigateTo('projects')">📁 ${project.name}</span>` : '';
  
  return `
    <div class="kanban-card" draggable="true" data-task-id="${task.id}" onclick="openTaskDetail('${task.id}')">
      ${costDisplay}
      <div class="card-priority ${task.priority}" style="border-left-color: ${priorityColors[task.priority] || '#6b7280'}"></div>
      <h5 class="card-title">${task.title}</h5>
      <p class="card-desc">${task.description || ''}</p>
      ${projectDisplay}
      <div class="task-meta-row">
        ${durationDisplay}
        ${task.dueDate ? `<span class="task-meta-item ${isOverdue ? 'overdue' : ''}">📅 ${task.dueDate}</span>` : ''}
      </div>
      ${task.status !== 'todo' && task.status !== 'done' ? `
        <div class="card-progress">
          <div class="progress-bar"><div class="progress-fill" style="width: ${task.progress || 0}%"></div></div>
          <span class="progress-text">${task.progress || 0}%</span>
        </div>
      ` : ''}
      <div class="card-meta">
        ${assigneeAvatars ? `<div class="card-avatars task-assignees">${assigneeAvatars}</div>` : ''}
      </div>
      <div class="card-tags">
        <span class="tag ${task.category}">${task.category || 'task'}</span>
        ${task.priority === 'critical' ? '<span class="tag priority-critical">Critical</span>' : ''}
        ${task.priority === 'high' ? '<span class="tag priority-high">High</span>' : ''}
      </div>
      <div class="kanban-card-actions" onclick="event.stopPropagation()">
        <button class="btn-edit" onclick="editPMTask('${task.id}')">✏️ Edit</button>
        <button class="btn-delete" onclick="deletePMTask('${task.id}')">🗑️ Delete</button>
      </div>
    </div>
  `;
}

function setupKanbanDragDrop() {
  const cards = document.querySelectorAll('.kanban-card');
  const columns = document.querySelectorAll('.kanban-cards');
  
  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.dataset.taskId);
      card.classList.add('dragging');
    });
    
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });
  });
  
  columns.forEach(column => {
    column.addEventListener('dragover', (e) => {
      e.preventDefault();
      column.classList.add('drag-over');
    });
    
    column.addEventListener('dragleave', () => {
      column.classList.remove('drag-over');
    });
    
    column.addEventListener('drop', (e) => {
      e.preventDefault();
      column.classList.remove('drag-over');
      
      const taskId = parseInt(e.dataTransfer.getData('text/plain'));
      const newStatus = column.closest('.kanban-column').dataset.status;
      
      moveTaskToStatus(taskId, newStatus);
    });
  });
}

function moveTaskToStatus(taskId, newStatus) {
  const tasks = store.pmTasks || [];
  const task = tasks.find(t => t.id === taskId);
  
  if (task) {
    const oldStatus = task.status;
    task.status = newStatus;
    
    if (newStatus === 'done') {
      task.progress = 100;
      task.completedDate = new Date().toISOString().split('T')[0];
    }
    
    saveStore();
    renderKanbanBoard();
    addPMActivity(`Task "${task.title}" moved from ${oldStatus} to ${newStatus}`);
  }
}

function openTaskDetail(taskId) {
  const task = (store.pmTasks || []).find(t => t.id === taskId);
  if (!task) return;
  
  // Create modal content
  const modalHtml = `
    <div id="pm-task-detail-modal" class="modal-overlay" onclick="if(event.target===this)closeModal('pm-task-detail-modal')">
      <div class="modal" style="max-width:600px">
        <div class="modal-header">
          <h3>${task.title}</h3>
          <button class="modal-close" onclick="closeModal('pm-task-detail-modal')">✕</button>
        </div>
        <div class="modal-body">
          <div class="task-detail-section">
            <label>Description</label>
            <p>${task.description || 'No description'}</p>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Status</label>
              <select id="task-detail-status">
                <option value="todo" ${task.status === 'todo' ? 'selected' : ''}>To Do</option>
                <option value="inprogress" ${task.status === 'inprogress' ? 'selected' : ''}>In Progress</option>
                <option value="review" ${task.status === 'review' ? 'selected' : ''}>Review</option>
                <option value="done" ${task.status === 'done' ? 'selected' : ''}>Done</option>
              </select>
            </div>
            <div class="form-group">
              <label>Priority</label>
              <select id="task-detail-priority">
                <option value="critical" ${task.priority === 'critical' ? 'selected' : ''}>Critical</option>
                <option value="high" ${task.priority === 'high' ? 'selected' : ''}>High</option>
                <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>Medium</option>
                <option value="low" ${task.priority === 'low' ? 'selected' : ''}>Low</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Due Date</label>
              <input type="date" id="task-detail-due" value="${task.dueDate || ''}">
            </div>
            <div class="form-group">
              <label>Progress</label>
              <input type="range" id="task-detail-progress" min="0" max="100" value="${task.progress || 0}">
              <span id="progress-label">${task.progress || 0}%</span>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="closeModal('pm-task-detail-modal')">Cancel</button>
          <button class="btn-danger" onclick="deleteTask(${task.id})">Delete</button>
          <button class="btn-primary" onclick="saveTaskDetail(${task.id})">Save Changes</button>
        </div>
      </div>
    </div>
  `;
  
  // Remove existing modal if any
  const existing = document.getElementById('pm-task-detail-modal');
  if (existing) existing.remove();
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  
  // Setup progress slider
  const progressSlider = document.getElementById('task-detail-progress');
  const progressLabel = document.getElementById('progress-label');
  if (progressSlider && progressLabel) {
    progressSlider.addEventListener('input', () => {
      progressLabel.textContent = progressSlider.value + '%';
    });
  }
}

function saveTaskDetail(taskId) {
  const tasks = store.pmTasks || [];
  const task = tasks.find(t => t.id === taskId);
  
  if (task) {
    task.status = document.getElementById('task-detail-status').value;
    task.priority = document.getElementById('task-detail-priority').value;
    task.dueDate = document.getElementById('task-detail-due').value;
    task.progress = parseInt(document.getElementById('task-detail-progress').value);
    
    if (task.status === 'done') {
      task.completedDate = new Date().toISOString().split('T')[0];
    }
    
    saveStore();
    closeModal('pm-task-detail-modal');
    renderKanbanBoard();
    addPMActivity(`Task "${task.title}" updated`);
  }
}

function deleteTask(taskId) {
  if (!confirm('Are you sure you want to delete this task?')) return;
  
  store.pmTasks = (store.pmTasks || []).filter(t => t.id !== taskId);
  saveStore();
  closeModal('pm-task-detail-modal');
  renderKanbanBoard();
}

function filterPMTasks() {
  const search = (document.getElementById('pm-task-search')?.value || '').toLowerCase();
  const assignee = document.getElementById('pm-assignee-filter')?.value || '';
  const priority = document.getElementById('pm-priority-filter')?.value || '';
  
  const tasks = (store.pmTasks || []).filter(task => {
    const matchesSearch = !search || task.title.toLowerCase().includes(search) || (task.description || '').toLowerCase().includes(search);
    const matchesAssignee = !assignee || task.assignee === assignee;
    const matchesPriority = !priority || task.priority === priority;
    return matchesSearch && matchesAssignee && matchesPriority;
  });
  
  // Re-render with filtered tasks
  const statuses = ['todo', 'inprogress', 'review', 'done'];
  statuses.forEach(status => {
    const container = document.getElementById(`kanban-${status}`);
    const statusTasks = tasks.filter(t => t.status === status);
    
    if (container) {
      container.innerHTML = statusTasks.length > 0 
        ? statusTasks.map(renderKanbanCard).join('')
        : '<div class="kanban-empty">No matching tasks</div>';
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// GANTT CHART
// ═══════════════════════════════════════════════════════════════════════════════

function renderGanttChart() {
  const tasks = store.pmTasks || [];
  const milestones = store.pmMilestones || [];
  
  // Generate Gantt timeline
  const timelineContainer = document.getElementById('gantt-timeline');
  if (timelineContainer) {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 30);
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 60);
    
    // Generate weeks
    let weeksHtml = '<div class="gantt-weeks">';
    let current = new Date(startDate);
    while (current <= endDate) {
      weeksHtml += `<div class="gantt-week">W${Math.ceil(current.getDate() / 7)}</div>`;
      current.setDate(current.getDate() + 7);
    }
    weeksHtml += '</div>';
    
    timelineContainer.innerHTML = `
      <div class="gantt-months">
        <div class="gantt-month">${today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
      </div>
      ${weeksHtml}
    `;
  }
  
  // Generate task list
  const taskListContainer = document.getElementById('gantt-tasks');
  if (taskListContainer) {
    if (tasks.length === 0) {
      taskListContainer.innerHTML = '<div class="pm-empty-mini"><span style="font-size:20px">📅</span><p>No tasks yet. Add tasks in the <strong>Tasks</strong> tab to see the schedule.</p></div>';
    } else {
      let html = '';
      tasks.forEach(task => {
        const icon = getCategoryIcon(task.category);
        html += `
          <div class="gantt-task-item ${task.category}" onclick="openTaskDetail('${task.id}')">
            <span class="task-indent ${task.status === 'done' ? 'completed' : ''}"></span>
            <span class="task-name">${icon} ${escapeHtml(task.title)}</span>
          </div>
        `;
      });
      taskListContainer.innerHTML = html;
    }
  }
  
  // Generate bars
  const barsContainer = document.getElementById('gantt-bars');
  if (barsContainer) {
    const today = new Date();
    let html = '';
    
    tasks.forEach(task => {
      if (task.dueDate) {
        const dueDate = new Date(task.dueDate);
        const startDate = task.startDate ? new Date(task.startDate) : new Date(dueDate);
        startDate.setDate(startDate.getDate() - 7); // Assume 7 day duration
        
        const totalDays = 90; // 3 month window
        const startOffset = Math.max(0, Math.floor((startDate - new Date()) / (1000 * 60 * 60 * 24) / totalDays * 100) + 50);
        const width = Math.min(30, Math.ceil(7 / totalDays * 100));
        
        html += `
          <div class="gantt-row">
            <div class="gantt-bar category-${task.category}" style="left: ${startOffset}%; width: ${width}%;" 
                 title="${task.title} - Due: ${task.dueDate}">
              ${width > 10 ? `<span class="bar-label">${task.progress || 0}%</span>` : ''}
            </div>
          </div>
        `;
      }
    });
    
    barsContainer.innerHTML = html;
  }
  
  // Set today line position
  const todayLine = document.getElementById('gantt-today-line');
  if (todayLine) {
    todayLine.style.left = '50%';
  }
}

function getCategoryIcon(category) {
  const icons = {
    'electrical': '⚡',
    'plumbing': '🔧',
    'hvac': '❄️',
    'framing': '🪵',
    'foundation': '🏗️',
    'insulation': '🧱',
    'inspection': '📋',
    'siteprep': '🚜'
  };
  return icons[category] || '📝';
}

function ganttZoomIn() {
  console.log('Gantt zoom in');
}

function ganttZoomOut() {
  console.log('Gantt zoom out');
}

function ganttToday() {
  const todayLine = document.getElementById('gantt-today-line');
  if (todayLine) {
    todayLine.scrollIntoView({ behavior: 'smooth', inline: 'center' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESOURCES
// ═══════════════════════════════════════════════════════════════════════════════

function renderResourcesTab() {
  // Build labor list from payroll employees + manually added PM resources
  const payrollEmployees = (store.payroll && store.payroll.employees) ? store.payroll.employees : [];
  const pmResources = store.pmResources || [];
  const equipment = pmResources.filter(r => r.type === 'equipment');

  // Build labor from payroll employees
  const labor = payrollEmployees.map(emp => {
    const name = (emp.name || ((emp.first_name || '') + ' ' + (emp.last_name || ''))).trim();
    const initials = name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '??';
    const activeTasks = (store.pmTasks || []).filter(t =>
      t.status !== 'done' && (
        t.assignee === initials ||
        (t.assigneeName || '').toLowerCase() === name.toLowerCase() ||
        String(t.assigneeId) === String(emp.id)
      )
    );
    const taskCount = activeTasks.length;
    const utilization = Math.min(100, taskCount * 20);
    return { id: emp.id, name, initials, role: emp.position || emp.trade || emp.role || 'Team Member', type: 'labor', utilization, tasks: taskCount };
  });

  // Include manually added labor resources not already from payroll
  const manualLabor = pmResources.filter(r => r.type === 'labor' && !payrollEmployees.find(e => {
    const n = ((e.name || '') || ((e.first_name || '') + ' ' + (e.last_name || ''))).trim();
    return n.toLowerCase() === (r.name || '').toLowerCase();
  }));
  const allLabor = [...labor, ...manualLabor];

  // Render team
  const teamGrid = document.getElementById('pm-team-grid');
  if (teamGrid) {
    if (allLabor.length === 0) {
      teamGrid.innerHTML = `
        <div class="pm-empty-mini" style="grid-column:1/-1">
          <p>No team members yet. Add employees in the <strong>Payroll</strong> tab or assign resources here.</p>
          <button class="btn btn-sm btn-outline" onclick="navigateTo('payroll')">Go to Payroll</button>
        </div>`;
    } else {
      teamGrid.innerHTML = allLabor.map(person => `
        <div class="team-card">
          <div class="team-avatar">${person.initials}</div>
          <div class="team-info">
            <h4>${person.name}</h4>
            <span class="team-role">${person.role}</span>
          </div>
          <div class="utilization-bar">
            <div class="util-fill ${person.utilization > 90 ? 'warning' : person.utilization > 70 ? 'high' : 'medium'}"
                 style="width:${person.utilization || 0}%"></div>
          </div>
          <span class="util-label">${person.utilization || 0}% allocated ${person.utilization > 90 ? '⚠️' : ''}</span>
          <div class="team-tasks"><span class="task-count">${person.tasks} active task${person.tasks !== 1 ? 's' : ''}</span></div>
        </div>
      `).join('');
    }
  }

  // Render equipment
  const equipmentGrid = document.getElementById('pm-equipment-grid');
  if (equipmentGrid) {
    if (equipment.length === 0) {
      equipmentGrid.innerHTML = `<div class="pm-empty-mini" style="grid-column:1/-1"><p>No equipment tracked yet. Use <strong>Assign Resource</strong> to add equipment.</p></div>`;
    } else {
      equipmentGrid.innerHTML = equipment.map(item => `
        <div class="equipment-card">
          <div class="equip-icon">${item.icon || '🔧'}</div>
          <div class="equip-info">
            <h4>${item.name}</h4>
            <span class="equip-status ${item.status}">${formatStatus(item.status)}</span>
          </div>
          <div class="equip-project">${item.project || 'Not assigned'}</div>
        </div>
      `).join('');
    }
  }

  renderCapacityChart();
}

function renderCapacityChart() {
  const capacityChart = document.getElementById('pm-capacity-chart');
  if (!capacityChart) return;

  // Build weekly capacity from real data
  const employees = (store.payroll && store.payroll.employees) ? store.payroll.employees : [];
  const tasks = store.pmTasks || [];
  const teamSize = employees.length;
  // Standard: 40h/week per person
  const availableHours = teamSize * 40 || 40;

  // Generate next 4 weeks
  const weeks = [];
  const today = new Date();
  for (let i = 0; i < 4; i++) {
    const start = new Date(today);
    start.setDate(today.getDate() + (i * 7) - today.getDay() + 1);
    const end = new Date(start);
    end.setDate(start.getDate() + 4);
    const label = `${start.toLocaleDateString('en-US',{month:'short',day:'numeric'})} - ${end.toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;
    // Count tasks scheduled in this week
    const weekTasks = tasks.filter(t => {
      if (!t.dueDate || t.status === 'done') return false;
      const due = new Date(t.dueDate);
      return due >= start && due <= end;
    });
    // Estimate hours: each task = 8h default or task.duration days * 8
    const scheduledHours = weekTasks.reduce((s, t) => s + ((t.duration || 1) * 8), 0);
    weeks.push({ label, scheduledHours, availableHours });
  }

  if (weeks.every(w => w.scheduledHours === 0) && teamSize === 0) {
    capacityChart.innerHTML = `<div class="pm-empty-mini"><p>Add employees in Payroll and assign tasks to see capacity planning.</p></div>`;
    return;
  }

  capacityChart.innerHTML = `
    <div class="capacity-header">
      <span>Week</span><span>Scheduled Hours</span><span>Available</span><span>Variance</span>
    </div>
    ${weeks.map(w => {
      const variance = w.availableHours - w.scheduledHours;
      const isOver = w.scheduledHours > w.availableHours;
      const pct = Math.min(Math.round((w.scheduledHours / w.availableHours) * 100), 100);
      return `
        <div class="capacity-row ${isOver ? 'warning' : ''}">
          <span>${w.label}</span>
          <div class="capacity-bar-container">
            <div class="capacity-bar ${isOver ? 'over' : ''}" style="width:${pct}%">${w.scheduledHours}h</div>
          </div>
          <span>${w.availableHours}h</span>
          <span class="variance ${variance >= 0 ? 'positive' : 'negative'}">${variance >= 0 ? '+' : ''}${variance}h</span>
        </div>
      `;
    }).join('')}
  `;
}

function formatStatus(status) {
  const labels = {
    'available': 'Available',
    'in-use': 'In Use',
    'maintenance': 'Maintenance'
  };
  return labels[status] || status;
}

function filterResources() {
  renderResourcesTab();
}

// ═══════════════════════════════════════════════════════════════════════════════
// RISKS
// ═══════════════════════════════════════════════════════════════════════════════

function renderRisksTab() {
  renderRiskMatrix();
  renderRiskRegister();
}

function renderRiskMatrix() {
  const matrix = document.getElementById('pm-risk-matrix');
  if (!matrix) return;
  
  const risks = store.pmRisks || [];
  
  // Count risks in each cell
  const matrixData = {
    'high-high': [], 'high-medium': [], 'high-low': [],
    'medium-high': [], 'medium-medium': [], 'medium-low': [],
    'low-high': [], 'low-medium': [], 'low-low': []
  };
  
  risks.forEach(risk => {
    const key = `${risk.impact}-${risk.likelihood}`;
    if (matrixData[key]) matrixData[key].push(risk);
  });
  
  const gridCells = ['high', 'medium', 'low'].map(impact => 
    ['low', 'medium', 'high'].map(likelihood => {
      const key = `${impact}-${likelihood}`;
      const count = matrixData[key]?.length || 0;
      const severity = getSeverityClass(impact, likelihood);
      return `<div class="matrix-cell ${severity}" title="${capitalize(impact)} impact, ${capitalize(likelihood)} likelihood" onclick="showRisksInCell('${impact}', '${likelihood}')"><span class="cell-count">${count || ''}</span></div>`;
    }).join('')
  ).join('');

  matrix.innerHTML = `
    <div style="display:flex;gap:4px;align-items:flex-start;overflow-x:auto;padding-bottom:4px">
      <div class="matrix-y-axis"><span>High</span><span style="font-weight:600;opacity:0.7">Impact</span><span>Low</span></div>
      <div>
        <div class="matrix-grid">${gridCells}</div>
        <div class="matrix-x-axis"><span>Low</span><span style="font-weight:600;opacity:0.7">Likelihood</span><span>High</span></div>
      </div>
    </div>
  `;
}

function getSeverityClass(impact, likelihood) {
  const score = getRiskScore(impact, likelihood);
  if (score >= 9) return 'critical';
  if (score >= 6) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

function getRiskScore(impact, likelihood) {
  const impactScores = { 'high': 3, 'medium': 2, 'low': 1 };
  const likelihoodScores = { 'high': 3, 'medium': 2, 'low': 1 };
  return (impactScores[impact] || 1) * (likelihoodScores[likelihood] || 1);
}

function renderRiskRegister() {
  const tbody = document.getElementById('risk-register-body');
  if (!tbody) return;
  
  const risks = store.pmRisks || [];
  
  if (risks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--text-muted)">
      <div style="font-size:24px;margin-bottom:8px">⚠️</div>
      <div>No risks logged yet. Click <strong>+ Add Risk</strong> to start tracking.</div>
    </td></tr>`;
    return;
  }
  tbody.innerHTML = risks.map(risk => `
    <tr class="risk-row ${getSeverityClass(risk.impact, risk.likelihood)}" onclick="openRiskDetail('${risk.id}')">
      <td>${escapeHtml(risk.id || '')}</td>
      <td>${escapeHtml(risk.description || risk.title || '')}</td>
      <td>${escapeHtml(risk.category || '')}</td>
      <td class="impact-${risk.impact}">${capitalize(risk.impact || '')}</td>
      <td class="likelihood-${risk.likelihood}">${capitalize(risk.likelihood || '')}</td>
      <td class="score-${getSeverityClass(risk.impact, risk.likelihood)}">${risk.score || getRiskScore(risk.impact, risk.likelihood)}</td>
      <td>${escapeHtml(risk.mitigation || '-')}</td>
      <td>${escapeHtml(risk.owner || '-')}</td>
      <td><span class="status-badge ${risk.status}">${capitalize(risk.status || '')}</span></td>
    </tr>
  `).join('');
}

function openRiskDetail(riskId) {
  const risk = (store.pmRisks || []).find(r => r.id === riskId);
  if (!risk) return;
  showToast(`Risk: ${risk.description || risk.title} — Owner: ${risk.owner || 'N/A'} | Status: ${risk.status}`, 'info');
}

function setRiskView(view) {
  console.log('Setting risk view to:', view);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ISSUES
// ═══════════════════════════════════════════════════════════════════════════════

function renderIssuesTab() {
  renderIssueStats();
  renderIssueList();
  renderChangeRequests();
}

function renderIssueStats() {
  const container = document.getElementById('pm-issue-stats');
  if (!container) return;
  
  const issues = store.pmIssues || [];
  const stats = {
    open: issues.filter(i => i.status === 'open').length,
    'in-progress': issues.filter(i => i.status === 'in-progress').length,
    resolved: issues.filter(i => i.status === 'resolved').length,
    closed: issues.filter(i => i.status === 'closed').length
  };
  
  container.innerHTML = Object.entries(stats).map(([status, count]) => `
    <div class="issue-stat-card ${status}">
      <div class="stat-number">${count}</div>
      <div class="stat-label">${capitalize(status.replace('-', ' '))}</div>
    </div>
  `).join('');
}

function renderIssueList() {
  const container = document.getElementById('pm-issue-list');
  if (!container) return;
  
  const issues = store.pmIssues || [];
  
  if (issues.length === 0) {
    container.innerHTML = `<div class="pm-empty-mini"><span style="font-size:24px">🔧</span><p>No issues logged yet. Click <strong>+ Log Issue</strong> to track problems and change requests.</p></div>`;
    return;
  }
  container.innerHTML = issues.map(issue => `
    <div class="issue-item ${issue.priority}" onclick="openIssueDetail('${issue.id}')">
      <div class="issue-header">
        <span class="issue-id">${escapeHtml(issue.id || '')}</span>
        <span class="issue-priority ${issue.priority}">${capitalize(issue.priority || '')}</span>
        <span class="issue-status ${issue.status}">${capitalize((issue.status || '').replace('-', ' '))}</span>
      </div>
      <h4 class="issue-title">${escapeHtml(issue.title || '')}</h4>
      <p class="issue-desc">${escapeHtml(issue.description || '')}</p>
      <div class="issue-meta">
        <span class="issue-date">Reported: ${escapeHtml(issue.date || '')}</span>
        <span class="issue-reporter">by ${escapeHtml(issue.reporter || '')}</span>
        <span class="issue-assignee">Assigned: ${escapeHtml(issue.assignee || '-')}</span>
      </div>
      ${issue.comments ? `<div class="issue-actions"><span class="issue-comments">💬 ${issue.comments} comments</span></div>` : ''}
    </div>
  `).join('');
}

function openIssueDetail(issueId) {
  const issue = (store.pmIssues || []).find(i => i.id === issueId);
  if (!issue) return;
  showToast(`${issue.title} — ${issue.status} | Assigned: ${issue.assignee || 'N/A'}`, 'info');
}

function renderChangeRequests() {
  const container = document.getElementById('pm-change-requests');
  if (!container) return;
  
  const crs = store.pmChangeRequests || [];
  
  if (crs.length === 0) {
    container.innerHTML = `<div class="pm-empty-mini"><span style="font-size:20px">📝</span><p>No change requests yet. Use <strong>+ Add Change Request</strong> to track scope changes.</p></div>`;
    return;
  }
  
  container.innerHTML = crs.map(cr => `
    <div class="change-request-item ${cr.status}">
      <div class="cr-header">
        <span class="cr-id">${escapeHtml(cr.id || '')}</span>
        <span class="cr-status ${cr.status}">${capitalize(cr.status || '')}</span>
      </div>
      <h4>${escapeHtml(cr.title || '')}</h4>
      <p>${escapeHtml(cr.description || '')}</p>
      ${cr.status === 'pending' ? `
        <div class="cr-actions">
          <button class="btn btn-primary btn-sm" onclick="approveChangeRequest('${cr.id}')">✓ Approve</button>
          <button class="btn btn-secondary btn-sm" onclick="rejectChangeRequest('${cr.id}')">✗ Reject</button>
        </div>
      ` : ''}
    </div>
  `).join('');
}

function approveChangeRequest(crId) {
  const cr = (store.pmChangeRequests || []).find(c => c.id === crId);
  if (!cr) return;
  cr.status = 'approved';
  saveStore();
  logPMActivity(`Approved change request: "${cr.title}"`);
  renderChangeRequests();
  showToast(`Change request ${crId} approved!`, 'success');
}

function rejectChangeRequest(crId) {
  const cr = (store.pmChangeRequests || []).find(c => c.id === crId);
  if (!cr) return;
  cr.status = 'rejected';
  saveStore();
  logPMActivity(`Rejected change request: "${cr.title}"`);
  renderChangeRequests();
  showToast(`Change request ${crId} rejected.`, 'warning');
}

function filterIssues() {
  renderIssuesTab();
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════════════════════════

function renderReportsTab() {
  const container = document.getElementById('pm-reports-container');
  if (!container) return;

  const tasks = store.pmTasks || [];
  const risks = store.pmRisks || [];
  const issues = store.pmIssues || [];

  if (tasks.length === 0 && risks.length === 0 && issues.length === 0) {
    container.innerHTML = `<div class="pm-empty-mini" style="padding:48px 24px">
      <span style="font-size:32px">📊</span>
      <h3 style="margin:12px 0 8px;color:var(--text-primary)">No Report Data Yet</h3>
      <p>Add projects, tasks, and track progress to generate reports.</p>
    </div>`;
    renderAuditLog();
    return;
  }

  const completed = tasks.filter(t => t.status === 'done').length;
  const inProgress = tasks.filter(t => t.status === 'inprogress').length;
  const inReview = tasks.filter(t => t.status === 'review').length;
  const todo = tasks.filter(t => t.status === 'todo').length;
  const total = tasks.length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  const overdueCount = tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'done').length;
  const openRisks = risks.filter(r => r.status !== 'closed').length;
  const criticalRisks = risks.filter(r => r.severity === 'critical' || getSeverityClass(r.impact, r.likelihood) === 'critical').length;
  const openIssues = issues.filter(i => i.status !== 'resolved' && i.status !== 'closed').length;

  const statusClass = overdueCount > 0 || criticalRisks > 0 ? 'at-risk' : openRisks > 2 ? 'warning' : 'on-track';
  const statusLabel = statusClass === 'at-risk' ? '⚠️ At Risk' : statusClass === 'warning' ? '🟡 Monitor' : '✅ On Track';

  container.innerHTML = `
    <div class="report-card">
      <div class="report-header">
        <h3>📊 Executive Summary</h3>
        <span class="report-date">Generated: ${new Date().toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
      </div>
      <div class="report-content">
        <div class="report-section">
          <h4>Project Overview</h4>
          <p><strong>Status:</strong> <span class="status-text ${statusClass}">${statusLabel}</span></p>
          <p><strong>Completion:</strong> ${progress}%</p>
          <p><strong>Tasks:</strong> ${completed} of ${total} completed</p>
          ${overdueCount > 0 ? `<p><strong style="color:var(--danger)">⚠️ Overdue Tasks:</strong> ${overdueCount}</p>` : ''}
        </div>
        <div class="report-section">
          <h4>Task Breakdown</h4>
          <div class="schedule-summary">
            <div class="schedule-item">
              <span class="schedule-label">Overall Progress</span>
              <div class="schedule-bar"><div class="schedule-fill actual" style="width: ${progress}%"></div></div>
              <span>${progress}%</span>
            </div>
          </div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px">
            <span style="color:var(--text-secondary);font-size:13px">📋 To Do: <strong>${todo}</strong></span>
            <span style="color:var(--info);font-size:13px">🔄 In Progress: <strong>${inProgress}</strong></span>
            <span style="color:var(--warning);font-size:13px">👀 Review: <strong>${inReview}</strong></span>
            <span style="color:var(--success);font-size:13px">✅ Done: <strong>${completed}</strong></span>
          </div>
        </div>
        <div class="report-section">
          <h4>Risk & Issues Summary</h4>
          <p><strong>Open Risks:</strong> ${openRisks} ${criticalRisks > 0 ? `<span style="color:var(--danger)">(${criticalRisks} critical)</span>` : ''}</p>
          <p><strong>Open Issues:</strong> ${openIssues}</p>
          <p><strong>Change Requests:</strong> ${(store.pmChangeRequests || []).filter(c => c.status === 'pending').length} pending</p>
        </div>
      </div>
    </div>
  `;

  renderAuditLog();
}

function renderAuditLog() {
  const container = document.getElementById('pm-audit-log');
  if (!container) return;
  
  const activities = store.pmActivities || [];
  
  if (activities.length === 0) {
    container.innerHTML = `
      <div class="pm-empty-mini">
        <span style="font-size:20px">📋</span>
        <p>No activity yet. Actions on tasks, risks, and issues will appear here.</p>
      </div>`;
    return;
  }
  
  container.innerHTML = activities.slice().reverse().slice(0, 50).map(a => `
    <div class="audit-entry">
      <span class="audit-time">${a.time || ''}</span>
      <span class="audit-user">${escapeHtml(a.user || 'System')}</span>
      <span class="audit-action">${escapeHtml(a.action || '')}</span>
    </div>
  `).join('');
}

function logPMActivity(action, user) {
  if (!store.pmActivities) store.pmActivities = [];
  const now = new Date();
  const timeStr = now.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) 
    + ' ' + now.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true });
  store.pmActivities.push({
    time: timeStr,
    user: user || (store.currentUser?.name || store.currentUser?.email || 'You'),
    action: action
  });
  if (store.pmActivities.length > 200) store.pmActivities = store.pmActivities.slice(-200);
  saveStore();
}

function generatePMReport() {
  const tasks = store.pmTasks || [];
  const risks = store.pmRisks || [];
  const issues = store.pmIssues || [];
  const done = tasks.filter(t => t.status === 'done').length;
  const inProgress = tasks.filter(t => t.status === 'inprogress').length;
  const openRisks = risks.filter(r => r.status !== 'closed').length;
  const openIssues = issues.filter(i => i.status !== 'resolved' && i.status !== 'closed').length;
  showToast(`Report ready: ${tasks.length} tasks (${done} done, ${inProgress} in progress), ${openRisks} open risks, ${openIssues} open issues`, 'success');
  logPMActivity('Generated PM status report');
}

function exportPMReport() {
  const tasks = store.pmTasks || [];
  const risks = store.pmRisks || [];
  const issues = store.pmIssues || [];
  const lines = [
    'Project Management Report',
    'Generated: ' + new Date().toLocaleString(),
    '',
    '--- TASKS ---',
    ...tasks.map(t => `[${t.status}] ${t.title} (${t.assignee || 'Unassigned'})`),
    '',
    '--- RISKS ---',
    ...risks.map(r => `[${r.severity}] ${r.title} - ${r.status}`),
    '',
    '--- ISSUES ---',
    ...issues.map(i => `[${i.priority}] ${i.title} - ${i.status}`)
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pm-report-' + new Date().toISOString().slice(0, 10) + '.txt';
  a.click();
  showToast('Report exported!', 'success');
  logPMActivity('Exported PM report');
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT PORTAL
// ═══════════════════════════════════════════════════════════════════════════════

function renderClientPortal() {
  const progressRing = document.getElementById('client-progress-ring');
  if (progressRing) {
    const tasks = store.pmTasks || [];
    const completed = tasks.filter(t => t.status === 'done').length;
    const total = tasks.length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    progressRing.innerHTML = `
      <div class="client-progress-ring">
        <svg viewBox="0 0 36 36">
          <path class="ring-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
          <path class="ring-fill client" stroke-dasharray="${progress}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
        </svg>
        <div class="progress-value">${progress}%</div>
      </div>
    `;
  }

  const updatesList = document.getElementById('client-updates-list');
  if (updatesList) {
    const updates = store.clientUpdates || [];
    if (updates.length === 0) {
      updatesList.innerHTML = `<div class="pm-empty-mini"><span style="font-size:20px">📢</span><p>No updates posted yet. Use the button above to share a project update with your client.</p></div>`;
    } else {
      updatesList.innerHTML = updates.slice().reverse().map(u => `
        <div class="client-update">
          <div class="update-date">${escapeHtml(u.date || '')}</div>
          <h4>${escapeHtml(u.title || '')}</h4>
          <p>${escapeHtml(u.body || '')}</p>
        </div>
      `).join('');
    }
  }

  const messagesList = document.getElementById('client-messages-list');
  if (messagesList) {
    const messages = store.clientMessages || [];
    if (messages.length === 0) {
      messagesList.innerHTML = `<div class="pm-empty-mini"><span style="font-size:20px">💬</span><p>No messages yet. Send a message to start the conversation.</p></div>`;
    } else {
      messagesList.innerHTML = messages.map(m => {
        const initials = (m.user || 'You').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        return `
          <div class="client-message from-builder">
            <div class="msg-avatar">${initials}</div>
            <div class="msg-bubble">
              <p>${escapeHtml(m.text || '')}</p>
              <span class="msg-time">${escapeHtml(m.time || '')}</span>
            </div>
          </div>`;
      }).join('');
      messagesList.scrollTop = messagesList.scrollHeight;
    }
  }
}

// postClientUpdate() → handled by pm-client-update-modal + savePMClientUpdate()

function shareClientPortal() {
  const url = window.location.href;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => showToast('Portal link copied to clipboard!', 'success'));
  } else {
    showToast('Copy this link to share with your client: ' + url, 'info');
  }
}

function sendClientMessage() {
  const input = document.getElementById('client-message-input');
  if (!input || !input.value.trim()) return;
  const text = input.value.trim();
  const now = new Date();
  const timeStr = now.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) 
    + ', ' + now.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true });
  const user = store.currentUser?.name || store.currentUser?.email || 'You';
  if (!store.clientMessages) store.clientMessages = [];
  store.clientMessages.push({ text, time: timeStr, user });
  if (store.clientMessages.length > 100) store.clientMessages = store.clientMessages.slice(-100);
  saveStore();
  logPMActivity('Sent client message');
  input.value = '';
  renderClientPortal();
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVITY LOG
// ═══════════════════════════════════════════════════════════════════════════════

function addPMActivity(action) {
  const activities = store.pmActivities || [];
  const user = store.currentUser?.name || 'User';
  
  activities.unshift({
    time: new Date().toLocaleString(),
    user: user,
    action: action
  });
  
  // Keep only last 50 activities
  if (activities.length > 50) activities.pop();
  
  store.pmActivities = activities;
  saveStore();
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI INSIGHTS
// ═══════════════════════════════════════════════════════════════════════════════

function showAIDetail(type) {
  const tasks = store.pmTasks || [];
  const done = tasks.filter(t => t.status === 'done').length;
  const total = tasks.length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;
  const insights = {
    schedule: `Schedule Analysis: ${progress}% of tasks complete (${done}/${total}). ${progress < 50 ? 'Project is in early stages — ensure milestones are on track.' : progress < 80 ? 'Good progress. Review any overdue tasks.' : 'Approaching completion — focus on final inspections and closeout.'}`,
    resource: `Resource Analysis: ${(store.pmResources || []).length} resources assigned. Review the Resources tab to balance workload across your team.`,
    budget: `Budget Analysis: Review your Accounting tab for current spend vs. budget. Ensure change orders are captured in the Issues tab.`
  };
  showToast(insights[type] || 'No AI insight available for this category.', 'info');
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function refreshScheduleData() {
  renderKanbanBoard();
  renderGanttChart();
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODALS FOR NEW ITEMS
// ═══════════════════════════════════════════════════════════════════════════════

// New Task Modal
function openNewTaskModal(projectId = null) {
  // Reset form
  document.getElementById('pm-task-form').reset();
  document.getElementById('pm-task-id').value = '';
  document.getElementById('pm-task-project-id').value = projectId || '';
  document.getElementById('pm-task-modal-title').textContent = '➕ Add New Task';
  document.getElementById('pm-task-progress').value = 0;
  document.getElementById('pm-task-progress-value').textContent = '0%';
  
  // Populate assignees from payroll employees/contractors
  populateTaskAssignees();
  
  // If no project specified, show project selector
  if (!projectId) {
    updateTaskProjectDropdown();
  }
  
  openModal('pm-new-task-modal');
}

// Populate assignees from payroll system
function populateTaskAssignees() {
  const container = document.getElementById('pm-task-assignees-container');
  if (!container) return;
  
  const employees = store.payroll?.employees || [];
  const contractors = store.payroll?.contractors || [];
  const pmResources = store.pmResources || [];
  
  let html = '';
  
  // Add employees from payroll
  if (employees.length > 0) {
    html += '<div class="assignee-section"><strong>Employees:</strong>';
    employees.forEach((emp, i) => {
      const name = emp.name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
      const initials = getInitials(name);
      html += `
        <label class="assignee-checkbox">
          <input type="checkbox" name="assignee" value="emp-${i}" data-name="${name}" data-initials="${initials}">
          <span class="assignee-avatar-small">${initials}</span>
          <span>${name}</span>
          <small style="color:#666">${emp.role || emp.position || ''}</small>
        </label>`;
    });
    html += '</div>';
  }
  
  // Add contractors from payroll
  if (contractors.length > 0) {
    html += '<div class="assignee-section"><strong>Contractors:</strong>';
    contractors.forEach((con, i) => {
      const name = con.name || con.company_name || `Contractor ${i+1}`;
      const initials = getInitials(name);
      html += `
        <label class="assignee-checkbox">
          <input type="checkbox" name="assignee" value="con-${i}" data-name="${name}" data-initials="${initials}">
          <span class="assignee-avatar-small">${initials}</span>
          <span>${name}</span>
          <small style="color:#666">${con.trade || con.specialty || ''}</small>
        </label>`;
    });
    html += '</div>';
  }
  
  // Add from PM resources if available
  const laborResources = pmResources.filter(r => r.type === 'labor');
  if (laborResources.length > 0) {
    html += '<div class="assignee-section"><strong>Team Members:</strong>';
    laborResources.forEach((res, i) => {
      html += `
        <label class="assignee-checkbox">
          <input type="checkbox" name="assignee" value="res-${res.id}" data-name="${res.name}" data-initials="${res.initials || getInitials(res.name)}">
          <span class="assignee-avatar-small">${res.initials || getInitials(res.name)}</span>
          <span>${res.name}</span>
          <small style="color:#666">${res.role || ''}</small>
        </label>`;
    });
    html += '</div>';
  }
  
  if (!html) {
    html = '<p style="color:#999;font-style:italic">No team members found. Add employees in Payroll or Resources.</p>';
  }
  
  container.innerHTML = html;
}

// Get initials from name
function getInitials(name) {
  if (!name) return '??';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

// Update project dropdown in task form
function updateTaskProjectDropdown() {
  const projects = store.projects || [];
  const selectContainer = document.getElementById('pm-task-project-select');
  if (!selectContainer) return;
  
  if (projects.length === 0) {
    selectContainer.innerHTML = '<p style="color:#999">No projects available. Create a project first.</p>';
    return;
  }
  
  selectContainer.innerHTML = `
    <select id="pm-task-project" onchange="onProjectSelect(this.value)">
      <option value="">No Project (General Task)</option>
      ${projects.map(p => `<option value="${p.id}">${p.name} - ${p.client_name || 'No Client'}</option>`).join('')}
    </select>`;
}

// Save PM Task
function savePMTask(event) {
  event.preventDefault();
  
  const taskId = document.getElementById('pm-task-id').value;
  const projectId = document.getElementById('pm-task-project-id').value || document.getElementById('pm-task-project')?.value || '';
  
  // Get selected assignees
  const assigneeCheckboxes = document.querySelectorAll('input[name="assignee"]:checked');
  const assignees = Array.from(assigneeCheckboxes).map(cb => ({
    value: cb.value,
    name: cb.dataset.name,
    initials: cb.dataset.initials
  }));
  
  const taskData = {
    id: taskId || Date.now().toString(),
    projectId: projectId,
    title: document.getElementById('pm-task-title').value.trim(),
    description: document.getElementById('pm-task-description').value.trim(),
    category: document.getElementById('pm-task-category').value,
    startDate: document.getElementById('pm-task-start').value,
    dueDate: document.getElementById('pm-task-due').value,
    duration: parseInt(document.getElementById('pm-task-duration').value) || 1,
    cost: parseFloat(document.getElementById('pm-task-cost').value) || 0,
    priority: document.getElementById('pm-task-priority').value,
    status: document.getElementById('pm-task-status').value,
    progress: parseInt(document.getElementById('pm-task-progress').value) || 0,
    notes: document.getElementById('pm-task-notes').value.trim(),
    assignees: assignees,
    assignee: assignees.length > 0 ? assignees[0].initials : '',
    assigneeName: assignees.length > 0 ? assignees.map(a => a.name).join(', ') : '',
    createdAt: taskId ? undefined : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  // Remove undefined fields
  Object.keys(taskData).forEach(key => taskData[key] === undefined && delete taskData[key]);
  
  // Initialize pmTasks if needed
  if (!store.pmTasks) store.pmTasks = [];
  
  if (taskId) {
    // Update existing task
    const idx = store.pmTasks.findIndex(t => t.id === taskId);
    if (idx >= 0) {
      store.pmTasks[idx] = { ...store.pmTasks[idx], ...taskData };
    }
  } else {
    // Add new task
    store.pmTasks.push(taskData);
  }
  
  saveStore();
  logPMActivity((taskId ? 'Updated' : 'Created') + ' task: "' + taskData.title + '"');
  closeModal('pm-new-task-modal');
  showToast(`Task "${taskData.title}" ${taskId ? 'updated' : 'created'}!`, 'success');
  
  // Refresh displays
  renderKanbanBoard();
  renderGanttChart();
  updatePMOverview();
}

// Edit PM Task
function editPMTask(taskId) {
  const task = (store.pmTasks || []).find(t => t.id === taskId);
  if (!task) return;
  
  document.getElementById('pm-task-id').value = task.id;
  document.getElementById('pm-task-project-id').value = task.projectId || '';
  document.getElementById('pm-task-title').value = task.title || '';
  document.getElementById('pm-task-description').value = task.description || '';
  document.getElementById('pm-task-category').value = task.category || 'general';
  document.getElementById('pm-task-start').value = task.startDate || '';
  document.getElementById('pm-task-due').value = task.dueDate || '';
  document.getElementById('pm-task-duration').value = task.duration || 1;
  document.getElementById('pm-task-cost').value = task.cost || '';
  document.getElementById('pm-task-priority').value = task.priority || 'medium';
  document.getElementById('pm-task-status').value = task.status || 'todo';
  document.getElementById('pm-task-progress').value = task.progress || 0;
  document.getElementById('pm-task-progress-value').textContent = (task.progress || 0) + '%';
  document.getElementById('pm-task-notes').value = task.notes || '';
  document.getElementById('pm-task-modal-title').textContent = '✏️ Edit Task';
  
  populateTaskAssignees();
  
  // Select assignees
  setTimeout(() => {
    if (task.assignees && task.assignees.length > 0) {
      task.assignees.forEach(a => {
        const cb = document.querySelector(`input[name="assignee"][value="${a.value}"]`);
        if (cb) cb.checked = true;
      });
    } else if (task.assignee) {
      // Legacy single assignee
      const cb = document.querySelector(`input[name="assignee"][data-initials="${task.assignee}"]`);
      if (cb) cb.checked = true;
    }
  }, 100);
  
  openModal('pm-new-task-modal');
}

// Delete PM Task
function deletePMTask(taskId) {
  if (!confirm('Are you sure you want to delete this task?')) return;
  
  store.pmTasks = (store.pmTasks || []).filter(t => t.id !== taskId);
  saveStore();
  showToast('Task deleted', 'success');
  renderKanbanBoard();
  renderGanttChart();
}

// Update PM Overview stats
function updatePMOverview() {
  // Alias — triggers full re-render
  renderPMOverview();
}

function renderPMOverview() {
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

// Add tasks from project creation
function addProjectTasksToPM(project) {
  if (!project || !project.id) return;
  
  // Create default tasks based on project type/trade
  const defaultTasks = generateDefaultProjectTasks(project);
  
  defaultTasks.forEach(task => {
    task.projectId = project.id;
    task.id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    if (!store.pmTasks) store.pmTasks = [];
    store.pmTasks.push(task);
  });
  
  saveStore();
}

// Generate default tasks based on project type
function generateDefaultProjectTasks(project) {
  const trade = project.trade || project.project_type || 'general';
  const startDate = project.start_date || new Date().toISOString().split('T')[0];
  
  const taskTemplates = {
    'Framing': [
      { title: 'Material delivery - lumber', category: 'framing', duration: 1, cost: 0, priority: 'high' },
      { title: 'Layout and marking', category: 'framing', duration: 1, cost: 0, priority: 'high' },
      { title: 'Exterior wall framing', category: 'framing', duration: 3, cost: 0, priority: 'high' },
      { title: 'Interior wall framing', category: 'framing', duration: 2, cost: 0, priority: 'medium' },
      { title: 'Framing inspection', category: 'inspection', duration: 1, cost: 0, priority: 'high' }
    ],
    'Electrical': [
      { title: 'Material pickup - wire, boxes, panels', category: 'electrical', duration: 1, cost: 0, priority: 'high' },
      { title: 'Main panel installation', category: 'electrical', duration: 1, cost: 0, priority: 'critical' },
      { title: 'Rough-in wiring', category: 'electrical', duration: 3, cost: 0, priority: 'high' },
      { title: 'Electrical inspection', category: 'inspection', duration: 1, cost: 0, priority: 'high' },
      { title: 'Fixtures and devices', category: 'electrical', duration: 2, cost: 0, priority: 'medium' }
    ],
    'Plumbing': [
      { title: 'Material pickup - pipe, fittings', category: 'plumbing', duration: 1, cost: 0, priority: 'high' },
      { title: 'Rough-in supply lines', category: 'plumbing', duration: 2, cost: 0, priority: 'high' },
      { title: 'Rough-in drain lines', category: 'plumbing', duration: 2, cost: 0, priority: 'high' },
      { title: 'Plumbing inspection', category: 'inspection', duration: 1, cost: 0, priority: 'high' },
      { title: 'Fixture installation', category: 'plumbing', duration: 2, cost: 0, priority: 'medium' }
    ],
    'HVAC': [
      { title: 'Material pickup - ductwork', category: 'hvac', duration: 1, cost: 0, priority: 'high' },
      { title: 'Main trunk installation', category: 'hvac', duration: 2, cost: 0, priority: 'high' },
      { title: 'Branch ductwork', category: 'hvac', duration: 2, cost: 0, priority: 'medium' },
      { title: 'Unit installation', category: 'hvac', duration: 1, cost: 0, priority: 'high' },
      { title: 'HVAC inspection', category: 'inspection', duration: 1, cost: 0, priority: 'high' }
    ],
    'General': [
      { title: 'Site preparation', category: 'general', duration: 1, cost: 0, priority: 'high' },
      { title: 'Material ordering', category: 'general', duration: 1, cost: 0, priority: 'high' },
      { title: 'Work execution', category: 'general', duration: 3, cost: 0, priority: 'medium' },
      { title: 'Final cleanup', category: 'general', duration: 1, cost: 0, priority: 'low' },
      { title: 'Final inspection', category: 'inspection', duration: 1, cost: 0, priority: 'high' }
    ]
  };
  
  const templates = taskTemplates[trade] || taskTemplates['General'];
  
  // Calculate dates based on duration
  let currentDate = startDate ? new Date(startDate) : new Date();
  
  return templates.map((template, index) => {
    const task = {
      title: template.title,
      description: `${template.title} for ${project.name}`,
      category: template.category,
      duration: template.duration,
      cost: template.cost,
      priority: template.priority,
      status: 'todo',
      progress: 0,
      startDate: currentDate.toISOString().split('T')[0],
      dueDate: new Date(currentDate.getTime() + (template.duration * 24 * 60 * 60 * 1000)).toISOString().split('T')[0]
    };
    
    // Move to next task start date
    currentDate = new Date(currentDate.getTime() + (template.duration * 24 * 60 * 60 * 1000));
    
    return task;
  });
}

// Open project selection modal for adding tasks
function openProjectSelectModal() {
  const projects = store.projects || [];
  const container = document.getElementById('pm-project-list');
  
  if (projects.length === 0) {
    container.innerHTML = '<p style="color:#999;text-align:center;padding:20px">No projects available. Create a project first.</p>';
  } else {
    container.innerHTML = projects.map(p => `
      <div class="pm-project-item" onclick="selectProjectForTask('${p.id}')">
        <div class="pm-project-info">
          <strong>${p.name}</strong>
          <small>${p.client_name || 'No client'} &bull; ${p.status || 'active'}</small>
        </div>
        <span class="pm-project-arrow">&#10140;</span>
      </div>
    `).join('');
  }
  
  openModal('pm-project-select-modal');
}

// Select project for new task
function selectProjectForTask(projectId) {
  closeModal('pm-project-select-modal');
  openNewTaskModal(projectId);
}

// Get tasks by project
function getTasksByProject(projectId) {
  return (store.pmTasks || []).filter(t => t.projectId === projectId);
}

// Initialize PM Dashboard when navigating to it
const originalNavigateTo = navigateTo;
navigateTo = function(page) {
  originalNavigateTo(page);
  if (page === 'pm-dashboard') {
    setTimeout(() => {
      switchPMTab('overview');
    }, 100);
  }
};

console.log('📊 Project Management System loaded successfully');

// Sync existing projects into PM (runs after addProjectTasksToPM is defined)
(function syncProjectsToPM() {
  const projects = store.projects || [];
  projects.forEach(project => {
    if (!project || !project.id) return;
    const existing = (store.pmTasks || []).filter(t => String(t.projectId) === String(project.id));
    if (existing.length === 0) {
      addProjectTasksToPM(project);
    }
  });
})();

// ═══════════════════════════════════════════════════════════════════════════
// PM MILESTONE HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

function openPMMilestoneModal() {
  // Populate project dropdown
  const sel = document.getElementById('pm-milestone-project');
  if (sel) {
    sel.innerHTML = '<option value="">— All Projects —</option>';
    (store.projects || []).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name || p.title || 'Untitled Project';
      sel.appendChild(opt);
    });
  }
  // Default date to 2 weeks from now
  const dateEl = document.getElementById('pm-milestone-date');
  if (dateEl) {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    dateEl.value = d.toISOString().split('T')[0];
  }
  openModal('pm-new-milestone-modal');
}

function savePMMilestone(event) {
  event.preventDefault();
  const milestone = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    title: document.getElementById('pm-milestone-title').value.trim(),
    date: document.getElementById('pm-milestone-date').value,
    status: document.getElementById('pm-milestone-status').value,
    description: document.getElementById('pm-milestone-desc').value.trim(),
    projectId: document.getElementById('pm-milestone-project').value,
    createdAt: new Date().toISOString()
  };
  if (!store.pmMilestones) store.pmMilestones = [];
  store.pmMilestones.push(milestone);
  saveStore();
  closeModal('pm-new-milestone-modal');
  showToast('✅ Milestone saved!', 'success');
  // Reset form
  document.getElementById('pm-milestone-form').reset();
  // Refresh gantt if visible
  if (document.querySelector('.pm-tab[data-tab="schedule"]')?.classList.contains('active')) {
    renderGanttChart();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PM RESOURCE HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

function openPMResourceModal() {
  // Populate person dropdown from payroll
  const sel = document.getElementById('pm-resource-person');
  if (sel) {
    sel.innerHTML = '<option value="">— Select Person —</option>';
    const employees = store.payroll?.employees || [];
    const contractors = store.payroll?.contractors || [];
    if (employees.length) {
      const eg = document.createElement('optgroup');
      eg.label = 'Employees';
      employees.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id || e.name;
        opt.textContent = e.name + (e.trade ? ` (${e.trade})` : '');
        eg.appendChild(opt);
      });
      sel.appendChild(eg);
    }
    if (contractors.length) {
      const cg = document.createElement('optgroup');
      cg.label = 'Contractors';
      contractors.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id || c.name;
        opt.textContent = c.name + (c.trade ? ` (${c.trade})` : '');
        cg.appendChild(opt);
      });
      sel.appendChild(cg);
    }
    if (!employees.length && !contractors.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No staff found — add in Payroll first';
      sel.appendChild(opt);
    }
  }
  openModal('pm-assign-resource-modal');
}

function savePMResource(event) {
  event.preventDefault();
  const personSel = document.getElementById('pm-resource-person');
  const personName = personSel.options[personSel.selectedIndex]?.text || '';
  const resource = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    personId: document.getElementById('pm-resource-person').value,
    personName: personName,
    role: document.getElementById('pm-resource-role').value.trim(),
    startDate: document.getElementById('pm-resource-start').value,
    endDate: document.getElementById('pm-resource-end').value,
    dailyHours: parseFloat(document.getElementById('pm-resource-hours').value) || 8,
    dailyRate: parseFloat(document.getElementById('pm-resource-rate').value) || 0,
    notes: document.getElementById('pm-resource-notes').value.trim(),
    createdAt: new Date().toISOString()
  };
  if (!store.pmResources) store.pmResources = [];
  store.pmResources.push(resource);
  saveStore();
  logPMActivity('Assigned resource: "' + (personName || resource.role) + '"');
  closeModal('pm-assign-resource-modal');
  showToast('✅ Resource assigned!', 'success');
  document.getElementById('pm-resource-form').reset();
  renderResourcesTab();
}

// ═══════════════════════════════════════════════════════════════════════════
// PM RISK HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

function savePMRisk(event) {
  event.preventDefault();
  const risk = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    title: document.getElementById('pm-risk-title').value.trim(),
    category: document.getElementById('pm-risk-category').value,
    probability: document.getElementById('pm-risk-probability').value,
    impact: document.getElementById('pm-risk-impact').value,
    description: document.getElementById('pm-risk-desc').value.trim(),
    mitigation: document.getElementById('pm-risk-mitigation').value.trim(),
    owner: document.getElementById('pm-risk-owner').value.trim(),
    status: document.getElementById('pm-risk-status').value,
    createdAt: new Date().toISOString()
  };
  if (!risk.title) { showToast('Risk title is required', 'error'); return; }
  risk.likelihood = risk.probability || 'medium';
  risk.severity = getSeverityClass(risk.impact, risk.likelihood);
  risk.score = getRiskScore(risk.impact, risk.likelihood);
  risk.date = new Date().toLocaleDateString('en-CA');
  if (!store.pmRisks) store.pmRisks = [];
  store.pmRisks.push(risk);
  saveStore();
  logPMActivity('Added risk: "' + risk.title + '"');
  closeModal('pm-new-risk-modal');
  showToast('⚠️ Risk logged!', 'warning');
  document.getElementById('pm-risk-form').reset();
  renderRisksTab();
}

// ═══════════════════════════════════════════════════════════════════════════
// PM ISSUE HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

function savePMIssue(event) {
  event.preventDefault();
  const issue = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    title: document.getElementById('pm-issue-title').value.trim(),
    type: document.getElementById('pm-issue-type').value,
    priority: document.getElementById('pm-issue-priority').value,
    status: document.getElementById('pm-issue-status').value,
    description: document.getElementById('pm-issue-desc').value.trim(),
    assignee: document.getElementById('pm-issue-assignee').value.trim(),
    dueDate: document.getElementById('pm-issue-due').value,
    resolution: document.getElementById('pm-issue-resolution').value.trim(),
    createdAt: new Date().toISOString()
  };
  if (!issue.title) { showToast('Issue title is required', 'error'); return; }
  issue.date = new Date().toLocaleDateString('en-CA');
  issue.reporter = store.currentUser?.name || store.currentUser?.email || 'You';
  if (!store.pmIssues) store.pmIssues = [];
  store.pmIssues.push(issue);
  saveStore();
  logPMActivity('Logged issue: "' + issue.title + '"');
  closeModal('pm-new-issue-modal');
  showToast('🚨 Issue logged!', 'warning');
  document.getElementById('pm-issue-form').reset();
  renderIssuesTab();
}

// ═══════════════════════════════════════════════════════════════════════════
// PM CLIENT UPDATE HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

function savePMClientUpdate(event) {
  event.preventDefault();
  const update = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    title: document.getElementById('pm-client-update-title').value.trim(),
    type: document.getElementById('pm-client-update-type').value,
    progress: parseInt(document.getElementById('pm-client-update-progress').value) || null,
    message: document.getElementById('pm-client-update-message').value.trim(),
    nextSteps: document.getElementById('pm-client-update-next').value.trim(),
    notifyClient: document.getElementById('pm-client-update-notify').checked,
    includePhotos: document.getElementById('pm-client-update-photos').checked,
    postedAt: new Date().toISOString(),
    postedBy: currentUser?.name || 'Project Manager'
  };
  if (!update.title) { showToast('Update title is required', 'error'); return; }
  // Normalize to store.clientUpdates for consistency with renderClientPortal()
  const clientUpdate = {
    id: update.id,
    date: new Date().toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }),
    title: update.title,
    body: update.message || update.nextSteps || '',
    type: update.type,
    progress: update.progress,
    postedBy: update.postedBy
  };
  if (!store.clientUpdates) store.clientUpdates = [];
  store.clientUpdates.push(clientUpdate);
  saveStore();
  logPMActivity('Posted client update: "' + update.title + '"');
  closeModal('pm-client-update-modal');
  showToast('📢 Client update posted!', 'success');
  document.getElementById('pm-client-update-form').reset();
  renderClientPortal();
}

// ═══════════════════════════════════════════════════════════
//  MINI FLOATING CHAT POPUP
// ═══════════════════════════════════════════════════════════

let miniChatOpen = false;
let miniChatHistory = [];

function toggleMiniChat() {
  miniChatOpen = !miniChatOpen;
  const popup = document.getElementById('mini-chat-popup');
  const fab   = document.getElementById('fab-ai-btn');
  if (!popup) return;
  if (miniChatOpen) {
    popup.classList.remove('hidden');
    popup.classList.add('mini-chat-visible');
    if (fab) fab.classList.add('fab-active');
    setTimeout(() => {
      const inp = document.getElementById('mini-chat-input');
      if (inp) inp.focus();
    }, 150);
  } else {
    popup.classList.remove('mini-chat-visible');
    popup.classList.add('mini-chat-hide');
    if (fab) fab.classList.remove('fab-active');
    setTimeout(() => {
      popup.classList.add('hidden');
      popup.classList.remove('mini-chat-hide');
    }, 250);
  }
}

function openFullChat() {
  toggleMiniChat();
  navigateTo('ai-chat');
}

function handleMiniChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMiniChat();
  }
}

function sendMiniPrompt(text) {
  const inp = document.getElementById('mini-chat-input');
  if (inp) inp.value = text;
  sendMiniChat();
}

async function sendMiniChat() {
  const input = document.getElementById('mini-chat-input');
  const msg = input ? input.value.trim() : '';
  if (!msg) return;

  input.value = '';
  autoResize(input);

  // Hide quick prompts after first message
  const qp = document.getElementById('mini-quick-prompts');
  if (qp) qp.style.display = 'none';

  appendMiniMessage(msg, 'user');
  appendMiniMessage('...', 'ai', true); // typing indicator

  try {
    const contextData = buildContextSummary();
    const systemPrompt = `You are Foreman AI — a concise, practical construction management assistant. The user is a foreman or contractor on a job site. Give short, actionable answers. Current context: ${contextData}`;

    const res = await fetch(`${API}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ message: msg, system: systemPrompt, history: miniChatHistory.slice(-6) })
    });

    removeMiniTyping();

    if (res.ok) {
      const data = await res.json();
      const reply = data.response || data.message || 'Got it!';
      appendMiniMessage(reply, 'ai');
      miniChatHistory.push({ role: 'user', content: msg });
      miniChatHistory.push({ role: 'assistant', content: reply });
    } else {
      appendMiniMessage('Sorry, I couldn\'t connect right now. Try opening the full chat.', 'ai');
    }
  } catch(e) {
    removeMiniTyping();
    appendMiniMessage('Connection error. <button class="btn btn-sm btn-outline" onclick="openFullChat()" style="font-size:11px;padding:2px 8px;margin-top:4px">Open Full Chat</button>', 'ai');
  }
}

function appendMiniMessage(text, role, isTyping = false) {
  const container = document.getElementById('mini-chat-messages');
  if (!container) return;
  const div = document.createElement('div');
  div.className = `mini-msg ${role}${isTyping ? ' typing' : ''}`;
  if (isTyping) {
    div.innerHTML = `<div class="mini-msg-bubble"><span class="typing-dots"><span></span><span></span><span></span></span></div>`;
  } else {
    const content = role === 'ai' ? renderMarkdown(text) : escapeHtml(text);
    div.innerHTML = `<div class="mini-msg-bubble">${content}</div>`;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function removeMiniTyping() {
  const container = document.getElementById('mini-chat-messages');
  if (!container) return;
  const typing = container.querySelector('.typing');
  if (typing) typing.remove();
}

function buildContextSummary() {
  const projects = store.projects || [];
  const tasks = store.pmTasks || [];
  const invoices = store.invoices || [];
  const now = new Date();
  const overdue = tasks.filter(t => t.dueDate && new Date(t.dueDate) < now && t.status !== 'done').length;
  const outstanding = invoices.filter(i => i.status === 'sent' || i.status === 'overdue');
  return `${projects.length} projects, ${tasks.length} tasks (${overdue} overdue), ${outstanding.length} outstanding invoices.`;
}

console.log('📋 Foreman AI Mini Chat loaded');

// ═══════════════════════════════════════════════════════════
//  DELAYS & DEFICIENCIES SYSTEM
// ═══════════════════════════════════════════════════════════

function openDelayModal() {
  // Populate projects dropdown
  const projects = store.projects || [];
  const sel = document.getElementById('delay-project');
  if (sel) {
    sel.innerHTML = '<option value="">Select project...</option>' +
      projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  }
  // Set today's date
  const dateInput = document.getElementById('delay-date');
  if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
  // Show/hide delay days row based on type
  const typeSelect = document.getElementById('delay-type');
  if (typeSelect) {
    typeSelect.onchange = function() {
      const daysRow = document.getElementById('delay-days-row');
      if (daysRow) {
        const showDays = ['delay', 'weather', 'material', 'labour', 'equipment', 'inspection'].includes(this.value);
        daysRow.style.display = showDays ? 'flex' : 'none';
      }
    };
  }
  openModal('delay-modal');
}

function submitDelay(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const entry = {
    id: 'del_' + Date.now(),
    type: fd.get('type'),
    severity: fd.get('severity'),
    projectId: fd.get('project_id'),
    title: fd.get('title'),
    description: fd.get('description'),
    delay_days: parseInt(fd.get('delay_days')) || 0,
    auto_adjust: fd.get('auto_adjust') || 'no',
    date: fd.get('date') || new Date().toISOString().split('T')[0],
    responsible_party: fd.get('responsible_party'),
    corrective_action: fd.get('corrective_action'),
    status: fd.get('status') || 'open',
    logged_by: currentUser?.contact_name || 'Foreman',
    logged_at: new Date().toISOString()
  };

  if (!store.delays) store.delays = [];
  store.delays.push(entry);

  // Auto-adjust task dates if requested and it's a schedule delay
  if (entry.delay_days > 0 && entry.auto_adjust === 'yes' && entry.projectId) {
    adjustTaskDatesForDelay(entry.projectId, entry.delay_days, entry.date);
  }

  saveStore();
  closeModal('delay-modal');
  form.reset();
  document.getElementById('delay-days-row').style.display = 'none';

  const projectName = (store.projects || []).find(p => p.id === entry.projectId)?.name || 'project';
  const daysMsg = entry.delay_days > 0 ? ` Task dates adjusted by ${entry.delay_days} day(s).` : '';
  showToast(`⚠️ Issue logged for ${projectName}.${daysMsg}`, entry.severity === 'critical' ? 'error' : 'success');

  logPMActivity(`Logged ${entry.type}: "${entry.title}" on ${projectName}`);

  // If already on delays page, re-render
  if (document.getElementById('page-delays')?.classList.contains('active')) {
    renderDelaysPage();
  }
  // Also re-render PM overview if on that tab
  const pmOverview = document.getElementById('pm-overview-content');
  if (pmOverview && document.getElementById('page-pm-dashboard')?.classList.contains('active')) {
    renderPMOverview();
  }
}

function adjustTaskDatesForDelay(projectId, delayDays, fromDate) {
  const tasks = store.pmTasks || [];
  let adjusted = 0;
  tasks.forEach(t => {
    if (String(t.projectId) !== String(projectId)) return;
    if (t.status === 'done') return;
    // Push tasks that start on or after fromDate
    if (t.startDate && t.startDate >= fromDate) {
      const sd = new Date(t.startDate);
      sd.setDate(sd.getDate() + delayDays);
      t.startDate = sd.toISOString().split('T')[0];
      adjusted++;
    }
    if (t.dueDate && t.dueDate >= fromDate) {
      const dd = new Date(t.dueDate);
      dd.setDate(dd.getDate() + delayDays);
      t.dueDate = dd.toISOString().split('T')[0];
    }
  });
  if (adjusted > 0) {
    showToast(`📅 Adjusted ${adjusted} task date${adjusted > 1 ? 's' : ''} by ${delayDays} day${delayDays > 1 ? 's' : ''}`, 'info');
  }
}

function renderDelaysPage() {
  const delays = store.delays || [];
  const projects = store.projects || [];

  // Update KPIs
  const total = delays.length;
  const open = delays.filter(d => d.status === 'open').length;
  const inprogress = delays.filter(d => d.status === 'inprogress').length;
  const resolved = delays.filter(d => d.status === 'resolved').length;
  const avgDays = total > 0 ? Math.round(delays.reduce((s,d) => s + (d.delay_days || 0), 0) / total) : 0;

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('dkpi-total', total);
  setEl('dkpi-open', open);
  setEl('dkpi-inprogress', inprogress);
  setEl('dkpi-resolved', resolved);
  setEl('dkpi-days', avgDays);

  const container = document.getElementById('delays-list');
  if (!container) return;

  if (delays.length === 0) {
    container.innerHTML = `
      <div class="pm-empty-state">
        <div class="pm-empty-icon">⚠️</div>
        <h3>No Issues Logged</h3>
        <p>Use the <strong>Log Issue</strong> button to record any delay, deficiency, or safety concern on your projects.</p>
        <button class="btn btn-primary" onclick="openDelayModal()">+ Log First Issue</button>
      </div>`;
    return;
  }

  const typeIcons = { delay:'⏱', deficiency:'🔴', safety:'🦺', material:'📦', weather:'🌧', labour:'👷', equipment:'🔧', design:'📐', inspection:'🔍', other:'📋' };
  const sevClass = { low:'severity-low', medium:'severity-medium', high:'severity-high', critical:'severity-critical' };
  const sevLabel = { low:'Low', medium:'Medium', high:'High', critical:'Critical' };

  container.innerHTML = delays.slice().reverse().map(d => {
    const proj = projects.find(p => p.id === d.projectId);
    const projName = proj?.name || 'Unknown Project';
    return `
    <div class="delay-card ${sevClass[d.severity] || ''}">
      <div class="delay-card-header">
        <div class="delay-type-icon">${typeIcons[d.type] || '📋'}</div>
        <div class="delay-card-info">
          <div class="delay-title">${d.title}</div>
          <div class="delay-meta">${projName} · ${d.date} · Logged by ${d.logged_by || 'Foreman'}</div>
        </div>
        <div class="delay-card-badges">
          <span class="delay-sev-badge ${sevClass[d.severity]}">${sevLabel[d.severity] || d.severity}</span>
          <span class="delay-status-badge status-${d.status}">${d.status === 'open' ? '🔴 Open' : d.status === 'inprogress' ? '🔧 In Progress' : '✅ Resolved'}</span>
        </div>
        <div class="delay-card-actions">
          <button class="btn btn-sm btn-outline" onclick="resolveDelay('${d.id}')">Resolve</button>
          <button class="btn btn-sm btn-outline" onclick="deleteDelay('${d.id}')">Delete</button>
        </div>
      </div>
      ${d.description ? `<div class="delay-description">${d.description}</div>` : ''}
      ${d.delay_days > 0 ? `<div class="delay-days-badge">📅 ${d.delay_days} day${d.delay_days > 1 ? 's' : ''} schedule impact</div>` : ''}
      ${d.corrective_action ? `<div class="delay-corrective">🔧 <strong>Corrective Action:</strong> ${d.corrective_action}</div>` : ''}
    </div>`;
  }).join('');
}

function filterDelays(filter, btn) {
  document.querySelectorAll('.filter-bar .filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const delays = store.delays || [];
  const projects = store.projects || [];
  let filtered;

  if (filter === 'all') filtered = delays;
  else if (['open','inprogress','resolved'].includes(filter)) filtered = delays.filter(d => d.status === filter);
  else filtered = delays.filter(d => d.type === filter);

  const typeIcons = { delay:'⏱', deficiency:'🔴', safety:'🦺', material:'📦', weather:'🌧', labour:'👷', equipment:'🔧', design:'📐', inspection:'🔍', other:'📋' };
  const sevClass = { low:'severity-low', medium:'severity-medium', high:'severity-high', critical:'severity-critical' };
  const sevLabel = { low:'Low', medium:'Medium', high:'High', critical:'Critical' };

  const container = document.getElementById('delays-list');
  if (!container) return;

  if (filtered.length === 0) {
    container.innerHTML = `<div class="pm-empty-mini"><p>No ${filter === 'all' ? '' : filter} issues found.</p></div>`;
    return;
  }

  container.innerHTML = filtered.slice().reverse().map(d => {
    const proj = projects.find(p => p.id === d.projectId);
    const projName = proj?.name || 'Unknown Project';
    return `
    <div class="delay-card ${sevClass[d.severity] || ''}">
      <div class="delay-card-header">
        <div class="delay-type-icon">${typeIcons[d.type] || '📋'}</div>
        <div class="delay-card-info">
          <div class="delay-title">${d.title}</div>
          <div class="delay-meta">${projName} · ${d.date}</div>
        </div>
        <div class="delay-card-badges">
          <span class="delay-sev-badge ${sevClass[d.severity]}">${sevLabel[d.severity] || d.severity}</span>
          <span class="delay-status-badge status-${d.status}">${d.status === 'open' ? '🔴 Open' : d.status === 'inprogress' ? '🔧 In Progress' : '✅ Resolved'}</span>
        </div>
        <div class="delay-card-actions">
          <button class="btn btn-sm btn-outline" onclick="resolveDelay('${d.id}')">Resolve</button>
          <button class="btn btn-sm btn-outline" onclick="deleteDelay('${d.id}')">Delete</button>
        </div>
      </div>
      ${d.description ? `<div class="delay-description">${d.description}</div>` : ''}
      ${d.delay_days > 0 ? `<div class="delay-days-badge">📅 ${d.delay_days} day${d.delay_days > 1 ? 's' : ''} schedule impact</div>` : ''}
    </div>`;
  }).join('');
}

function resolveDelay(id) {
  const delay = (store.delays || []).find(d => d.id === id);
  if (delay) {
    delay.status = 'resolved';
    delay.resolved_at = new Date().toISOString();
    saveStore();
    renderDelaysPage();
    showToast('✅ Issue marked as resolved', 'success');
  }
}

function deleteDelay(id) {
  if (!confirm('Delete this issue log?')) return;
  store.delays = (store.delays || []).filter(d => d.id !== id);
  saveStore();
  renderDelaysPage();
  showToast('Deleted', 'info');
}

// ═══════════════════════════════════════════════════════════
//  SAFETY FORMS SYSTEM
// ═══════════════════════════════════════════════════════════

function switchSafetyTab(tab) {
  // Legacy support - if called with old tab names, just show records
  if (tab === 'sf-records' || tab === 'records') {
    renderSafetyRecords();
  }
}

function openSafetyFormModal(formId) {
  const modal = document.getElementById('sf-modal-' + formId);
  if (!modal) return;
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  populateSafetyFormProjects(formId);
  // Set today's date
  const today = new Date().toISOString().split('T')[0];
  modal.querySelectorAll('input[type="date"]').forEach(inp => {
    if (!inp.value) inp.value = today;
  });
}

function closeSafetyFormModal(formId, event) {
  if (event && event.target !== event.currentTarget) return;
  const modal = document.getElementById('sf-modal-' + formId);
  if (!modal) return;
  modal.classList.add('hidden');
  document.body.style.overflow = '';
}

function hideSafetyRecords() {
  const records = document.getElementById('sf-tab-sf-records');
  const grid = document.getElementById('sf-card-grid');
  if (records) records.classList.add('hidden');
  if (grid) grid.style.display = '';
}

function populateSafetyFormProjects(formId) {
  const projects = store.projects || [];
  const opts = '<option value="">Select project...</option>' +
    projects.map(p => '<option value="' + p.id + '">' + p.name + '</option>').join('');
  // Update all project selects in all safety form modals
  const selectors = ['sf-flha-project','sf-fall-project','sf-toolbox-project','sf-incident-project','sf-inspection-project'];
  selectors.forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = opts;
  });
}

function addHazardRow(containerId) {
  const id = containerId || 'flha-hazard-rows';
  const container = document.getElementById(id);
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'sf-hazard-row';
  row.innerHTML = '<input type="text" placeholder="HAZARD" name="hazard[]">' +
    '<input type="text" placeholder="CONTROL MEASURE" name="control[]">' +
    '<select name="risk_level[]"><option>Low</option><option>Medium</option><option>High</option></select>' +
    '<button type="button" class="btn-icon-remove" onclick="this.closest(\'.sf-hazard-row\').remove()">✕</button>';
  container.appendChild(row);
}

function addSignatureRow(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'sf-sig-row';
  row.innerHTML = '<input type="text" name="worker_name[]" placeholder="Worker Name">' +
    '<input type="text" name="worker_sig[]" placeholder="Signature / Initials">';
  container.appendChild(row);
}

function submitSafetyForm(e, formType) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const data = {};
  for (const [key, val] of fd.entries()) {
    if (key.endsWith('[]')) {
      const k = key.slice(0,-2);
      if (!data[k]) data[k] = [];
      data[k].push(val);
    } else {
      data[key] = val;
    }
  }

  const formNames = { flha: 'FLHA', fall_arrest: 'Fall Arrest', toolbox_talk: 'Tool Box Talk', incident_report: 'Incident Report', site_inspection: 'Site Inspection' };
  // Also support old short names
  const formNamesFallback = { flha: 'FLHA', fall: 'Fall Arrest', toolbox: 'Tool Box Talk', incident: 'Incident Report', inspection: 'Site Inspection' };
  const projectId = data.project || data.project_id || '';
  const record = {
    id: 'sf_' + Date.now(),
    form_type: formType,
    form_name: formNames[formType] || formNamesFallback[formType] || formType,
    project_id: projectId,
    project_name: (store.projects || []).find(p => String(p.id) === String(projectId))?.name || 'General',
    date: data.date || data.incident_date || new Date().toISOString().split('T')[0],
    submitted_by: data.foreman || data.conductor || data.inspector || data.reported_by || data.worker_name || currentUser?.name || 'Foreman',
    submitted_at: new Date().toISOString(),
    data: data
  };

  if (!store.safetyRecords) store.safetyRecords = [];
  store.safetyRecords.push(record);
  saveStore();

  // Simulate email notification
  showToast('✅ ' + record.form_name + ' submitted for ' + record.project_name + '. Saved to Records.', 'success');
  form.reset();

  // If incident, also log as a delay/deficiency
  if (formType === 'incident_report') {
    const incEntry = {
      id: 'del_' + Date.now(),
      type: 'safety',
      severity: data.severity || 'high',
      projectId: projectId,
      title: 'Incident Report: ' + (data.description ? data.description.substring(0, 60) : 'Site incident'),
      date: data.date || new Date().toISOString().split('T')[0],
      status: 'open',
      logged_by: record.submitted_by,
      logged_at: new Date().toISOString()
    };
    if (!store.delays) store.delays = [];
    store.delays.push(incEntry);
    saveStore();
  }

  // Close the modal and show records
  const modalMap = { flha: 'sf-flha', fall_arrest: 'sf-fall', toolbox_talk: 'sf-toolbox', incident_report: 'sf-incident', site_inspection: 'sf-inspection' };
  const modalId = modalMap[formType];
  if (modalId) closeSafetyFormModal(modalId);

  // Show records after a brief delay
  setTimeout(() => renderSafetyRecords(), 300);
}

function previewSafetyForm(formType) {
  const form = document.getElementById(`form-${formType}`);
  if (!form) return;
  const fd = new FormData(form);
  const lines = [];
  for (const [k, v] of fd.entries()) {
    if (v) lines.push(`<strong>${k.replace(/_/g,' ')}:</strong> ${v}`);
  }
  alert(`Preview:\n\n${lines.slice(0,12).join('\n')}\n\n...and ${Math.max(0,lines.length-12)} more fields.`);
}

function renderSafetyRecords() {
  // Show records section, hide card grid
  const grid = document.getElementById('sf-card-grid');
  const recordsSection = document.getElementById('sf-tab-sf-records');
  if (grid) grid.style.display = 'none';
  if (recordsSection) recordsSection.classList.remove('hidden');

  const container = document.getElementById('sf-records-list');
  if (!container) return;

  let records = store.safetyRecords || [];

  if (records.length === 0) {
    container.innerHTML = `
      <div class="pm-empty-state" style="grid-column:1/-1">
        <div class="pm-empty-icon">📂</div>
        <h3>No Records Yet</h3>
        <p>Submitted safety forms will appear here. Fill out and submit a form using the cards on the forms page.</p>
        <button class="btn btn-primary" onclick="hideSafetyRecords()">← Back to Forms</button>
      </div>`;
    return;
  }

  const formIcons = { flha:'📋', fall_arrest:'🪝', toolbox_talk:'🔧', incident_report:'🚨', site_inspection:'🔍' };
  container.innerHTML = records.slice().reverse().map(r => `
    <div class="sf-record-card">
      <div class="sf-record-header">
        <span class="sf-record-icon">${formIcons[r.form_type] || '📄'}</span>
        <div class="sf-record-info">
          <div class="sf-record-name">${r.form_name}</div>
          <div class="sf-record-meta">${r.project_name || 'No Project'} · ${r.date || ''}</div>
        </div>
        <div class="sf-record-actions">
          <button class="btn btn-sm btn-outline" onclick="viewSafetyRecord('${r.id}')">View</button>
          <button class="btn btn-sm btn-outline" style="color:#ef4444;border-color:#ef4444" onclick="deleteSafetyRecord('${r.id}')">Delete</button>
        </div>
      </div>
      <div class="sf-record-meta-row">
        <span>By: ${r.submitted_by || 'Unknown'}</span>
        <span>${new Date(r.submitted_at).toLocaleString('en-CA', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
      </div>
    </div>`).join('');
}

function viewSafetyRecord(id) {
  const record = (store.safetyRecords || []).find(r => r.id === id);
  if (!record) return;
  const lines = Object.entries(record.data || {})
    .filter(([k,v]) => v && v !== '' && !Array.isArray(v))
    .map(([k,v]) => `${k.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}: ${v}`)
    .join('\n');
  alert(`${record.form_name}\nProject: ${record.project_name}\nDate: ${record.date}\nSubmitted by: ${record.submitted_by}\n\n${lines}`);
}

function deleteSafetyRecord(id) {
  if (!confirm('Delete this safety form record?')) return;
  store.safetyRecords = (store.safetyRecords || []).filter(r => r.id !== id);
  saveStore();
  renderSafetyRecords();
  showToast('Record deleted', 'info');
}

console.log('🦺 Safety Forms & Delays system loaded');
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
  const tabEl = document.getElementById(`crm-tab-${tab}`) || document.querySelector(`.crm-tab[data-tab="${tab}"]`);
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
  set('crm-kpi-conversion', winRate + '%');
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
  const filterStage = document.getElementById('pipeline-filter-owner')?.value || '';
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
  const typeFilter = document.getElementById('contacts-filter-type')?.value || '';

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
      <span>📋 ${leads} lead${leads!==1?'s':''}</span>
      <span>🎯 ${activities} activit${activities!==1?'ies':'y'}</span>
      <span class="contact-date">${c.created_at ? new Date(c.created_at).toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'}) : ''}</span>
    </div>
  </div>`;
}

// ── Contact CRUD ──────────────────────────────────────────────────────────
function openAddContactModal(preType) {
  initCRMStore();
  crmCurrentEditContactId = null;
  const form = document.querySelector('#crm-contact-modal form');
  if (form) form.reset();
  if (preType) { const t = document.getElementById('crm-contact-type'); if(t) t.value = preType; }
  document.getElementById('crm-contact-modal-title').textContent = 'Add Contact';
  openModal('crm-contact-modal');
}

function editCRMContact(contactId) {
  initCRMStore();
  const c = (store.crmContacts||[]).find(c => c.id === contactId);
  if (!c) return;
  crmCurrentEditContactId = contactId;
  document.getElementById('crm-contact-modal-title').textContent = 'Edit Contact';
  setField('crm-contact-firstname', c.first_name);
  setField('crm-contact-lastname', c.last_name);
  setField('crm-contact-company', c.company);
  setField('crm-contact-type', c.type);
  setField('crm-contact-email', c.email);
  setField('crm-contact-phone', c.phone);
  setField('crm-contact-location', c.location);
  setField('crm-contact-temp', c.temperature);
  setField('crm-contact-source', c.source);
  setField('crm-contact-owner', c.owner);
  setField('crm-contact-address', c.address);
  setField('crm-contact-notes', c.notes);
  openModal('crm-contact-modal');
}

function saveCRMContact() {
  initCRMStore();
  const firstName = document.getElementById('crm-contact-firstname')?.value.trim();
  const lastName = document.getElementById('crm-contact-lastname')?.value.trim();
  if (!firstName && !lastName) { showToast('Name is required', 'error'); return; }

  const contactData = {
    first_name: firstName || '',
    last_name: lastName || '',
    company: getField('crm-contact-company'),
    type: getField('crm-contact-type') || 'Lead',
    email: getField('crm-contact-email'),
    phone: getField('crm-contact-phone'),
    location: getField('crm-contact-location'),
    temperature: getField('crm-contact-temp') || 'Warm',
    source: getField('crm-contact-source'),
    owner: getField('crm-contact-owner'),
    address: getField('crm-contact-address'),
    notes: getField('crm-contact-notes'),
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
  const form = document.querySelector('#crm-lead-modal form');
  if (form) form.reset();
  if (stage) { const s = document.getElementById('crm-lead-stage'); if(s) s.value = stage; }
  if (contactId) { const c = document.getElementById('crm-lead-contact'); if(c) c.value = contactId; }
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
  setField('crm-lead-title', l.title);
  setField('crm-lead-contact', l.contact_id);
  setField('crm-lead-stage', l.stage);
  setField('crm-lead-value', l.value);
  setField('crm-lead-priority', l.priority);
  setField('crm-lead-close-date', l.close_date);
  setField('crm-lead-trade', l.trade);
  setField('crm-lead-probability', l.probability);
  setField('crm-lead-address', l.address);
  setField('crm-lead-description', l.description);
  populateCRMContactDropdowns();
  openModal('crm-lead-modal');
}

function saveCRMLead() {
  initCRMStore();
  const title = document.getElementById('crm-lead-title')?.value.trim();
  if (!title) { showToast('Lead title is required', 'error'); return; }

  const contactId = getField('crm-lead-contact');
  const contact = (store.crmContacts||[]).find(c => c.id === contactId);

  const leadData = {
    title,
    contact_id: contactId,
    contact_name: contact ? `${contact.first_name} ${contact.last_name}` : '',
    company: contact?.company || '',
    stage: getField('crm-lead-stage') || 'New',
    value: parseFloat(getField('crm-lead-value')) || 0,
    priority: getField('crm-lead-priority') || 'Medium',
    close_date: getField('crm-lead-close-date'),
    trade: getField('crm-lead-trade'),
    probability: parseInt(getField('crm-lead-probability')) || 50,
    address: getField('crm-lead-address'),
    description: getField('crm-lead-description'),
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

  const body = document.getElementById('crm-contact-detail-content');
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
  const stageFilter = document.getElementById('deals-filter-stage')?.value || '';

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
  const form = document.querySelector('#crm-deal-modal form');
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
  setField('crm-deal-name', d.name);
  setField('crm-deal-contact', d.contact_id);
  setField('crm-deal-value', d.value);
  setField('crm-deal-stage', d.stage);
  setField('crm-deal-close', d.close_date);
  setField('crm-deal-prob', d.probability);
  setField('crm-deal-project', d.project);
  setField('crm-deal-type', d.type);
  setField('crm-deal-notes', d.notes);
  populateCRMContactDropdowns();
  openModal('crm-deal-modal');
}

function saveCRMDeal() {
  initCRMStore();
  const name = document.getElementById('crm-deal-name')?.value.trim();
  if (!name) { showToast('Deal name is required', 'error'); return; }

  const contactId = getField('crm-deal-contact');
  const contact = (store.crmContacts||[]).find(c => c.id === contactId);

  const dealData = {
    name,
    contact_id: contactId,
    contact_name: contact ? `${contact.first_name} ${contact.last_name}` : '',
    value: parseFloat(getField('crm-deal-value')) || 0,
    stage: getField('crm-deal-stage') || 'New',
    close_date: getField('crm-deal-close'),
    probability: parseInt(getField('crm-deal-prob')) || 50,
    project: getField('crm-deal-project'),
    type: getField('crm-deal-type'),
    notes: getField('crm-deal-notes'),
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
  const typeFilter = document.getElementById('activities-filter-type')?.value || '';

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
  const form = document.querySelector('#crm-activity-modal form');
  if (form) form.reset();
  selectedActivityType = 'call';
  document.querySelectorAll('.activity-type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === 'call');
  });
  document.getElementById('crm-activity-type').value = 'call';
  if (contactId) {
    const c = (store.crmContacts||[]).find(c => c.id === contactId);
    if (c) setField('crm-activity-contact', contactId);
  }
  if (leadId) {
    const l = (store.crmLeads||[]).find(l => l.id === leadId);
    if (l) setField('crm-activity-lead', leadId);
  }
  const dateField = document.getElementById('crm-activity-date');
  if (dateField) dateField.value = new Date().toISOString().slice(0,10);
  populateCRMContactDropdowns();
  populateCRMLeadDropdowns();
  openModal('crm-activity-modal');
}

function selectActivityType(type, el) {
  selectedActivityType = type;
  document.querySelectorAll('.activity-type-btn').forEach(b => {
    b.classList.remove('active');
    b.classList.remove('selected');
  });
  if (el) { el.classList.add('active'); el.classList.add('selected'); }
  else {
    document.querySelectorAll('.activity-type-btn').forEach(b => {
      if (b.getAttribute('onclick') && b.getAttribute('onclick').includes("'"+type+"'")) {
        b.classList.add('active'); b.classList.add('selected');
      }
    });
  }
  const hidden = document.getElementById('crm-activity-type');
  if (hidden) hidden.value = type;
}

function saveCRMActivity() {
  initCRMStore();
  const subject = document.getElementById('crm-activity-subject')?.value.trim();
  const type = document.getElementById('crm-activity-type')?.value || selectedActivityType;
  if (!subject) { showToast('Subject is required', 'error'); return; }

  const contactId = getField('crm-activity-contact') || crmCurrentActivityContactId;
  const leadId = getField('crm-activity-lead') || crmCurrentActivityLeadId;
  const contact = contactId ? (store.crmContacts||[]).find(c => c.id === contactId) : null;

  const activity = {
    id: 'act_' + Date.now(),
    type,
    subject,
    contact_id: contactId,
    contact_name: contact ? `${contact.first_name} ${contact.last_name}` : '',
    lead_id: leadId,
    notes: getField('crm-activity-notes'),
    date: getField('crm-activity-date') || new Date().toISOString().slice(0,10),
    duration: parseInt(getField('crm-activity-duration')) || null,
    outcome: getField('crm-activity-outcome'),
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
  const form = document.querySelector('#crm-followup-modal form');
  if (form) form.reset();
  if (contactId) setField('crm-followup-contact', contactId);
  const dateField = document.getElementById('crm-followup-date');
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
  const contactId = getField('crm-followup-contact');
  const date = getField('crm-followup-date');
  const type = getField('crm-followup-type') || 'Call';
  if (!date) { showToast('Date is required', 'error'); return; }

  const contact = contactId ? (store.crmContacts||[]).find(c => c.id === contactId) : null;
  const followup = {
    id: 'fu_' + Date.now(),
    contact_id: contactId,
    contact_name: contact ? `${contact.first_name} ${contact.last_name}` : '',
    type,
    date,
    time: getField('crm-followup-time'),
    note: getField('crm-followup-note'),
    priority: getField('crm-followup-priority') || 'Medium',
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
  renderBarChart('crm-chart-pipeline', PIPELINE_STAGES.map(s => ({
    label: s,
    value: leads.filter(l => l.stage === s).reduce((sum,l) => sum + (parseFloat(l.value)||0), 0),
    color: STAGE_COLORS[s]
  })));

  // Leads by source
  const sourceMap = {};
  contacts.forEach(c => { if (c.source) sourceMap[c.source] = (sourceMap[c.source]||0) + 1; });
  const sourceData = Object.entries(sourceMap).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([label,value]) => ({ label, value, color: '#6366f1' }));
  renderBarChart('crm-chart-sources', sourceData.length > 0 ? sourceData : [{ label: 'No data', value: 0, color: '#e5e7eb' }]);

  // Activity breakdown
  const actTypeMap = {};
  activities.forEach(a => { if (a.type && !a.auto) actTypeMap[a.type] = (actTypeMap[a.type]||0) + 1; });
  const actColors = ACTIVITY_COLORS;
  const actData = Object.entries(actTypeMap).map(([label,value]) => ({ label: label.charAt(0).toUpperCase()+label.slice(1), value, color: actColors[label]||'#6b7280' }));
  renderBarChart('crm-chart-activity', actData.length > 0 ? actData : [{ label: 'No data', value: 0, color: '#e5e7eb' }]);

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
  renderBarChart('crm-chart-forecast', forecastData.length > 0 ? forecastData : [{ label: 'No data', value: 0, color: '#e5e7eb' }]);

  // Summary stats
  const totalLeads = leads.length;
  const wonLeads = leads.filter(l => l.stage === 'Won').length;
  const lostLeads = leads.filter(l => l.stage === 'Lost').length;
  const winRate = (totalLeads > 0) ? Math.round(wonLeads / (wonLeads + lostLeads || 1) * 100) : 0;
  const avgDeal = totalLeads > 0 ? Math.round(leads.reduce((s,l)=>s+(parseFloat(l.value)||0),0) / totalLeads) : 0;
  const totalRevenue = leads.filter(l => l.stage === 'Won').reduce((s,l)=>s+(parseFloat(l.value)||0), 0);

  const stats = document.getElementById('crm-analytics-stats-container') || document.getElementById('crm-top-contacts');
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
  ['crm-lead-contact','crm-deal-contact','crm-activity-contact','crm-followup-contact'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { const val = el.value; el.innerHTML = opts; el.value = val; }
  });
}

function populateCRMLeadDropdowns() {
  const leads = store.crmLeads || [];
  const opts = `<option value="">-- No Lead --</option>` + leads.map(l =>
    `<option value="${l.id}">${escHtml(l.title)} [${l.stage}]</option>`
  ).join('');
  ['crm-activity-lead'].forEach(id => {
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


// ── Filter wrapper functions (called by HTML oninput/onchange) ─────────────
function filterPipeline() { renderPipelineBoard(); }
function filterContacts() { renderCRMContacts(); }
function filterDeals() { renderCRMDeals(); }
function filterActivities() { renderCRMActivities(); }

// ── CRM Tab uses data-tab attribute on buttons ─────────────────────────────
// The HTML tab buttons don't have data-tab, they use onclick="showCRMTab('x')"
// showCRMTab handles active state via id="crm-tab-pipeline" pattern
// Override showCRMTab to use both approaches:
const _origShowCRMTab = typeof showCRMTab !== 'undefined' ? showCRMTab : null;

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
  // Use actual invoice form field IDs
  const invDate = document.getElementById('inv-date')?.value || new Date().toISOString().slice(0,10);
  const invDue = document.getElementById('inv-due-date')?.value || '';
  const clientName = document.getElementById('inv-customer')?.value || 'Client Name';
  const notes = document.getElementById('inv-notes')?.value || '';
  const terms = document.getElementById('inv-terms')?.options[document.getElementById('inv-terms')?.selectedIndex]?.text || 'Net 30';

  // Gather line items from the invoice lines table
  const rows = document.querySelectorAll('#inv-lines-body tr');
  const items = [];
  rows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    if (inputs.length >= 2) {
      const desc = inputs[0]?.value || '';
      const qty = parseFloat(inputs[1]?.value || 0);
      const rate = parseFloat(inputs[3]?.value || 0);
      const amount = qty * rate;
      if (desc || qty || rate) items.push({ desc, qty, rate, amount });
    }
  });

  // Get subtotal from existing display
  const subtotalText = document.getElementById('inv-subtotal')?.textContent || '$0.00';
  const subtotal = parseFloat(subtotalText.replace(/[^0-9.]/g,'')) || items.reduce((s,i)=>s+i.amount, 0);
  const gstText = document.getElementById('inv-gst-total')?.textContent || '$0.00';
  const gst = parseFloat(gstText.replace(/[^0-9.]/g,'')) || 0;
  const total = subtotal + gst;

  // Get auto-generated invoice number from table or generate one
  const invoiceRows = document.querySelectorAll('#invoices-table-body tr, #invoices-list tr');
  const invNumber = 'INV-' + String((invoiceRows.length || 0) + 1).padStart(4, '0');

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
            </tr>`).join('') : `<tr><td colspan="4" class="text-center" style="color:#9ca3af;padding:2rem">No line items added yet. Add items in the invoice form.</td></tr>`}
        </tbody>
        <tfoot>
          <tr class="invoice-subtotal-row"><td colspan="3">Subtotal</td><td class="text-right">$${subtotal.toFixed(2)}</td></tr>
          ${gst > 0 ? `<tr><td colspan="3">GST (5%)</td><td class="text-right">$${gst.toFixed(2)}</td></tr>` : ''}
          <tr class="invoice-total-row"><td colspan="3"><strong>TOTAL</strong></td><td class="text-right"><strong>$${total.toFixed(2)}</strong></td></tr>
        </tfoot>
      </table>

      ${notes ? `<div class="invoice-notes"><strong>Notes:</strong> ${escHtml(notes)}</div>` : ''}
      <div class="invoice-footer">Thank you for your business!</div>
    </div>`;

  const preview = document.getElementById('invoice-preview-content');
  if (preview) preview.innerHTML = html;
  openModal('invoice-preview-modal');
}

function printInvoicePreview() {
  const body = document.getElementById('invoice-preview-content');
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

  const preview = document.getElementById('paystub-content');
  if (preview) preview.innerHTML = html;
  openModal('paystub-modal');
}

function printPaystub() {
  const body = document.getElementById('paystub-content');
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

  const preview = document.getElementById('td1-content');
  if (preview) preview.innerHTML = html;
  openModal('td1-modal');
}

function printTD1() {
  const body = document.getElementById('td1-content');
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

  const preview = document.getElementById('t4-content');
  if (preview) preview.innerHTML = html;
  openModal('t4-modal');
}

function printT4() {
  const body = document.getElementById('t4-content');
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

console.log('📋 HR Module (Pay Stubs, TD1, T4) loaded');

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