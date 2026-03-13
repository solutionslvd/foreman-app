/* ═══════════════════════════════════════════════════════════
   BuildAI Alberta - App JavaScript v2.0
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
    } else {
      // Migrate legacy fragmented keys into unified store
      migrateLegacyStorage();
    }
  } catch(e) { console.warn('loadUnifiedStore error:', e); }
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
  // App name
  const appName = s.app_name || 'BuildAI';
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
  else if (page === 'ai-chat') renderDynamicChatSuggestions();
  else if (page === 'compliance') loadCompliance();
  else if (page === 'billing') loadBilling();

  // Scroll to top
  document.getElementById('app-main').scrollTop = 0;
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
    suggestions.push({ icon: '🧾', label: 'GST Help', prompt: 'How do I calculate GST on an invoice in Alberta?' });
  }

  if (day <= 15) {
    suggestions.push({ icon: '💳', label: 'Payroll Deductions', prompt: 'What payroll deductions are due by the 15th?' });
  } else {
    suggestions.push({ icon: '⚠️', label: 'WCB Info', prompt: 'What WCB requirements do I need for my workers?' });
  }

  suggestions.push({ icon: '🏗️', label: 'Permits', prompt: 'What permits do I need for construction in Alberta?' });

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
          </tr>
        </thead>
        <tbody>
          ${data.transactions.map(t => `
            <tr>
              <td><strong>${t.reference || 'N/A'}</strong></td>
              <td>${t.description.replace('Invoice ', '').split(' - ')[1] || t.description}</td>
              <td>${t.date}</td>
              <td><strong>${formatCurrency(t.total_amount)}</strong></td>
              <td><span class="status-active" style="padding:3px 8px;border-radius:10px;font-size:11px;background:rgba(76,175,80,0.15);color:var(--accent)">Sent</span></td>
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
      if (wcbRateEl &amp;&amp; status.wcb) {
        wcbRateEl.textContent = status.wcb.rate || 'N/A';
      }
      if (wcbYtdEl &amp;&amp; status.wcb) {
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
    if (trainingList &amp;&amp; training &amp;&amp; training.length > 0) {
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
    if (permitsList &amp;&amp; permits &amp;&amp; permits.length > 0) {
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
    if (checklistEl &amp;&amp; checklist &amp;&amp; checklist.items) {
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
          if (subscription &amp;&amp; subscription.plan === planName) {
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

// WCB rates by trade (Alberta 2024)
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
    return '<div class="worker-card">' +
      '<div class="worker-avatar">' + e.name.charAt(0).toUpperCase() + '</div>' +
      '<div class="worker-info">' +
        '<div class="worker-name">' + e.name + '</div>' +
        '<div class="worker-meta">' + e.trade + ' &middot; ' + (e.payType === 'hourly' ? '$' + e.rate + '/hr' : '$' + e.rate.toLocaleString() + '/yr') + ' &middot; ' + e.province + '</div>' +
        '<div class="worker-meta">' + (e.email || '') + (e.phone ? ' &middot; ' + e.phone : '') + '</div>' +
      '</div>' +
      '<span class="worker-badge employee">Employee</span>' +
      '<div class="worker-actions">' +
        '<button class="btn-secondary btn-sm" onclick="loadWorkerToPayroll(\'emp\',' + i + ')">Pay</button>' +
        '<button class="btn-secondary btn-sm" onclick="removeEmployee(' + i + ')">Remove</button>' +
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
  
  // Group by project
  const byProject = {};
  weekEntries.forEach(e => {
    const key = e.project_id || 'no-project';
    if (!byProject[key]) byProject[key] = { name: e.project_name || 'No Project', minutes: 0 };
    byProject[key].minutes += e.minutes || 0;
  });
  
  container.innerHTML = Object.entries(byProject).map(([key, data]) => `
    <div style="display:flex;justify-content:space-between;padding:10px;background:#f8f9fa;border-radius:6px;margin-bottom:8px">
      <span>${escapeHtml(data.name)}</span>
      <span style="font-weight:600">${Math.floor(data.minutes / 60)}h ${data.minutes % 60}m</span>
    </div>
  `).join('');
}

function toggleTimer() {
  if (timerRunning) {
    clearInterval(timerInterval);
    timerRunning = false;
    document.getElementById('timer-btn').textContent = '▶ Start Timer';
    document.getElementById('timer-btn').className = 'btn-primary';
    showToast(`Time logged: ${formatTime(timerSeconds)}`, 'success');
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
  
  // Create a simple modal for manual time entry
  const hours = prompt('Enter hours:', '0');
  const minutes = prompt('Enter minutes:', '30');
  
  if (hours !== null && minutes !== null) {
    const totalMinutes = (parseInt(hours) || 0) * 60 + (parseInt(minutes) || 0);
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
      localStorage.setItem('foreman_store', JSON.stringify(store));
      renderTimeEntries();
      syncStore();
      showToast(`Manual entry saved: ${hours}h ${minutes}m`, 'success');
    }
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

// ═══════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════
function showNotifications() {
  showToast('No new notifications', 'info');
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
  localStorage.setItem('expenses', JSON.stringify(store.expenses));
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
    .replace(/&/g, '&amp;')
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
  const avatar = role === 'ai' ? '🤖' : (currentUser?.contact_name?.charAt(0)?.toUpperCase() || 'U');
  
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
    appendMessage('I\'m here to help! For Alberta construction questions, compliance, invoicing, and more — just ask.', 'ai');
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

// Sample PM Data for Demo
const samplePMTasks = [
  { id: 1, title: 'Electrical rough-in', description: 'Complete electrical rough-in for main floor', status: 'todo', priority: 'critical', assignee: 'JD', assigneeName: 'John Doe', dueDate: '2024-12-15', category: 'electrical', progress: 0 },
  { id: 2, title: 'Plumbing layout', description: 'Design and mark plumbing routes', status: 'todo', priority: 'high', assignee: 'SM', assigneeName: 'Sarah Miller', dueDate: '2024-12-18', category: 'plumbing', progress: 0 },
  { id: 3, title: 'HVAC ductwork', description: 'Install main HVAC ducts', status: 'inprogress', priority: 'medium', assignee: 'MJ', assigneeName: 'Mike Johnson', dueDate: '2024-12-20', category: 'hvac', progress: 60 },
  { id: 4, title: 'Insulation installation', description: 'Install insulation in exterior walls', status: 'inprogress', priority: 'high', assignee: 'SM', assigneeName: 'Sarah Miller', dueDate: '2024-12-22', category: 'insulation', progress: 35 },
  { id: 5, title: 'Framing inspection', description: 'City inspection for framing work', status: 'review', priority: 'medium', assignee: 'JD', assigneeName: 'John Doe', dueDate: '2024-12-16', category: 'inspection', progress: 90, comments: 3 },
  { id: 6, title: 'Foundation work', description: 'Complete foundation and slab pour', status: 'done', priority: 'low', assignee: 'JD', assigneeName: 'John Doe', completedDate: '2024-12-10', category: 'foundation', progress: 100 },
  { id: 7, title: 'Framing - main floor', description: 'Frame exterior and interior walls', status: 'done', priority: 'medium', assignee: 'SM', assigneeName: 'Sarah Miller', completedDate: '2024-12-12', category: 'framing', progress: 100 }
];

const samplePMRisks = [
  { id: 'R001', description: 'Steel beam delivery delay', category: 'Supply Chain', impact: 'high', likelihood: 'high', score: 9, mitigation: 'Pre-order materials, identify backup supplier', owner: 'John D.', status: 'active' },
  { id: 'R002', description: 'Subcontractor availability - Electrical', category: 'Resource', impact: 'high', likelihood: 'medium', score: 6, mitigation: 'Book subcontractor early, have backup', owner: 'Sarah M.', status: 'monitoring' },
  { id: 'R003', description: 'Weather delays - Snow/Freezing', category: 'Environmental', impact: 'medium', likelihood: 'high', score: 6, mitigation: 'Build weather buffer into schedule', owner: 'Mike J.', status: 'monitoring' },
  { id: 'R004', description: 'Permit approval delays', category: 'Regulatory', impact: 'medium', likelihood: 'medium', score: 4, mitigation: 'Submit early, follow up weekly', owner: 'John D.', status: 'mitigated' }
];

const samplePMIssues = [
  { id: 'I001', title: 'Foundation crack discovered during inspection', description: 'A 2-foot crack was found in the foundation wall during the framing inspection.', priority: 'critical', status: 'open', reporter: 'John D.', assignee: 'Sarah M.', date: '2024-12-14', comments: 4, attachments: 2 },
  { id: 'I002', title: 'HVAC ductwork doesn\'t match plans', description: 'Installed ductwork routing conflicts with planned plumbing lines.', priority: 'high', status: 'in-progress', reporter: 'Mike J.', assignee: 'Amy J.', date: '2024-12-13', comments: 7, attachments: 3 },
  { id: 'I003', title: 'Missing insulation in north wall', description: 'Found gap in insulation installation. Has been corrected.', priority: 'medium', status: 'resolved', reporter: 'Sarah M.', assignee: 'John D.', date: '2024-12-10', resolvedDate: '2024-12-12' }
];

const samplePMResources = [
  { id: 1, name: 'John Doe', initials: 'JD', role: 'Lead Carpenter', type: 'labor', utilization: 85, tasks: 4 },
  { id: 2, name: 'Sarah Miller', initials: 'SM', role: 'Electrician', type: 'labor', utilization: 60, tasks: 3 },
  { id: 3, name: 'Mike Johnson', initials: 'MJ', role: 'Plumber', type: 'labor', utilization: 40, tasks: 2 },
  { id: 4, name: 'Amy Jackson', initials: 'AJ', role: 'HVAC Tech', type: 'labor', utilization: 95, tasks: 5 },
  { id: 5, name: 'Skid Steer', icon: '🚜', type: 'equipment', status: 'available', project: '' },
  { id: 6, name: 'Scaffolding Set', icon: '🏗️', type: 'equipment', status: 'in-use', project: '123 Main St' },
  { id: 7, name: 'Compressor', icon: '🔩', type: 'equipment', status: 'in-use', project: '123 Main St' },
  { id: 8, name: 'Generator', icon: '⚡', type: 'equipment', status: 'maintenance', project: 'In shop' }
];

// Initialize PM data if empty
if (store.pmTasks.length === 0) {
  store.pmTasks = samplePMTasks;
  store.pmRisks = samplePMRisks;
  store.pmIssues = samplePMIssues;
  store.pmResources = samplePMResources;
  saveStore();
}

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
    let html = '';
    tasks.forEach(task => {
      const icon = getCategoryIcon(task.category);
      html += `
        <div class="gantt-task-item ${task.category}" onclick="openTaskDetail(${task.id})">
          <span class="task-indent ${task.status === 'done' ? 'completed' : ''}"></span>
          <span class="task-name">${icon} ${task.title}</span>
        </div>
      `;
    });
    taskListContainer.innerHTML = html;
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
  const resources = store.pmResources || [];
  const labor = resources.filter(r => r.type === 'labor');
  const equipment = resources.filter(r => r.type === 'equipment');
  
  // Render team
  const teamGrid = document.getElementById('pm-team-grid');
  if (teamGrid) {
    teamGrid.innerHTML = labor.map(person => `
      <div class="team-card">
        <div class="team-avatar">${person.initials}</div>
        <div class="team-info">
          <h4>${person.name}</h4>
          <span class="team-role">${person.role}</span>
        </div>
        <div class="utilization-bar">
          <div class="util-fill ${person.utilization > 90 ? 'warning' : person.utilization > 70 ? 'high' : 'medium'}" 
               style="width: ${person.utilization}%"></div>
        </div>
        <span class="util-label">${person.utilization}% allocated ${person.utilization > 90 ? '⚠️' : ''}</span>
        <div class="team-tasks"><span class="task-count">${person.tasks} active tasks</span></div>
      </div>
    `).join('');
  }
  
  // Render equipment
  const equipmentGrid = document.getElementById('pm-equipment-grid');
  if (equipmentGrid) {
    equipmentGrid.innerHTML = equipment.map(item => `
      <div class="equipment-card">
        <div class="equip-icon">${item.icon}</div>
        <div class="equip-info">
          <h4>${item.name}</h4>
          <span class="equip-status ${item.status}">${formatStatus(item.status)}</span>
        </div>
        <div class="equip-project">${item.project || 'Not assigned'}</div>
      </div>
    `).join('');
  }
  
  // Render capacity chart
  renderCapacityChart();
}

function renderCapacityChart() {
  const capacityChart = document.getElementById('pm-capacity-chart');
  if (!capacityChart) return;
  
  const weeks = ['Dec 16-20', 'Dec 23-27', 'Dec 30-Jan 3', 'Jan 6-10'];
  const hours = [180, 160, 220, 190];
  const available = 200;
  
  capacityChart.innerHTML = `
    <div class="capacity-header">
      <span>Week</span><span>Labor Hours</span><span>Available</span><span>Variance</span>
    </div>
    ${weeks.map((week, i) => {
      const hoursVal = hours[i];
      const variance = available - hoursVal;
      const isOver = hoursVal > available;
      return `
        <div class="capacity-row ${isOver ? 'warning' : ''}">
          <span>${week}</span>
          <div class="capacity-bar-container">
            <div class="capacity-bar ${isOver ? 'over' : ''}" style="width: ${Math.min(hoursVal, 220)}px;">${hoursVal}h</div>
          </div>
          <span>${available}h</span>
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
  
  matrix.innerHTML = `
    <div class="matrix-y-axis"><span>High</span><span>Impact</span><span>Low</span></div>
    <div class="matrix-grid">
      ${['high', 'medium', 'low'].map(impact => 
        ['low', 'medium', 'high'].map(likelihood => {
          const key = `${impact}-${likelihood}`;
          const count = matrixData[key]?.length || 0;
          const severity = getSeverityClass(impact, likelihood);
          return `<div class="matrix-cell ${severity}" onclick="showRisksInCell('${impact}', '${likelihood}')">
            <span class="cell-count">${count || ''}</span>
          </div>`;
        }).join('')
      ).join('')}
    </div>
    <div class="matrix-x-axis"><span>Low</span><span>Likelihood</span><span>High</span></div>
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
  
  tbody.innerHTML = risks.map(risk => `
    <tr class="risk-row ${getSeverityClass(risk.impact, risk.likelihood)}" onclick="openRiskDetail('${risk.id}')">
      <td>${risk.id}</td>
      <td>${risk.description}</td>
      <td>${risk.category}</td>
      <td class="impact-${risk.impact}">${capitalize(risk.impact)}</td>
      <td class="likelihood-${risk.likelihood}">${capitalize(risk.likelihood)}</td>
      <td class="score-${getSeverityClass(risk.impact, risk.likelihood)}">${risk.score}</td>
      <td>${risk.mitigation || '-'}</td>
      <td>${risk.owner}</td>
      <td><span class="status-badge ${risk.status}">${capitalize(risk.status)}</span></td>
    </tr>
  `).join('');
}

function openRiskDetail(riskId) {
  const risk = (store.pmRisks || []).find(r => r.id === riskId);
  if (!risk) return;
  
  alert(`Risk: ${risk.description}\n\nMitigation: ${risk.mitigation}\nOwner: ${risk.owner}\nStatus: ${risk.status}`);
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
  
  container.innerHTML = issues.map(issue => `
    <div class="issue-item ${issue.priority}" onclick="openIssueDetail('${issue.id}')">
      <div class="issue-header">
        <span class="issue-id">${issue.id}</span>
        <span class="issue-priority ${issue.priority}">${capitalize(issue.priority)}</span>
        <span class="issue-status ${issue.status}">${capitalize(issue.status.replace('-', ' '))}</span>
      </div>
      <h4 class="issue-title">${issue.title}</h4>
      <p class="issue-desc">${issue.description}</p>
      <div class="issue-meta">
        <span class="issue-date">Reported: ${issue.date}</span>
        <span class="issue-reporter">by ${issue.reporter}</span>
        <span class="issue-assignee">Assigned: ${issue.assignee}</span>
      </div>
      ${issue.comments ? `<div class="issue-actions"><span class="issue-comments">💬 ${issue.comments} comments</span></div>` : ''}
    </div>
  `).join('');
}

function openIssueDetail(issueId) {
  const issue = (store.pmIssues || []).find(i => i.id === issueId);
  if (!issue) return;
  
  alert(`Issue: ${issue.title}\n\n${issue.description}\n\nStatus: ${issue.status}\nAssigned to: ${issue.assignee}`);
}

function renderChangeRequests() {
  const container = document.getElementById('pm-change-requests');
  if (!container) return;
  
  const crs = store.pmChangeRequests || [
    { id: 'CR-001', title: 'Client requested additional bathroom', description: 'Add half-bath on main floor. Impact: $8,500, +5 days', status: 'pending' },
    { id: 'CR-002', title: 'Upgrade kitchen countertops to granite', description: 'Client upgrade. Cost adjustment: +$3,200', status: 'approved' }
  ];
  
  container.innerHTML = crs.map(cr => `
    <div class="change-request-item ${cr.status}">
      <div class="cr-header">
        <span class="cr-id">${cr.id}</span>
        <span class="cr-status ${cr.status}">${capitalize(cr.status)}</span>
      </div>
      <h4>${cr.title}</h4>
      <p>${cr.description}</p>
      ${cr.status === 'pending' ? `
        <div class="cr-actions">
          <button class="btn-primary btn-sm" onclick="approveChangeRequest('${cr.id}')">Approve</button>
          <button class="btn-secondary btn-sm" onclick="rejectChangeRequest('${cr.id}')">Reject</button>
        </div>
      ` : ''}
    </div>
  `).join('');
}

function approveChangeRequest(crId) {
  alert(`Change request ${crId} approved!`);
  // In real app, would update status and log
}

function rejectChangeRequest(crId) {
  alert(`Change request ${crId} rejected.`);
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
  const completed = tasks.filter(t => t.status === 'done').length;
  const total = tasks.length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  container.innerHTML = `
    <div class="report-card">
      <div class="report-header">
        <h3>📊 Executive Summary</h3>
        <span class="report-date">Generated: ${new Date().toLocaleDateString()}</span>
      </div>
      <div class="report-content">
        <div class="report-section">
          <h4>Project Overview</h4>
          <p><strong>Status:</strong> <span class="status-text on-track">On Track</span></p>
          <p><strong>Completion:</strong> ${progress}%</p>
          <p><strong>Tasks:</strong> ${completed} of ${total} completed</p>
        </div>
        <div class="report-section">
          <h4>Task Status</h4>
          <div class="schedule-summary">
            <div class="schedule-item">
              <span class="schedule-label">Progress</span>
              <div class="schedule-bar"><div class="schedule-fill actual" style="width: ${progress}%"></div></div>
              <span>${progress}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Render audit log
  renderAuditLog();
}

function renderAuditLog() {
  const container = document.getElementById('pm-audit-log');
  if (!container) return;
  
  const activities = store.pmActivities || [
    { time: 'Dec 15, 2024 2:30 PM', user: 'John Doe', action: 'Updated task "Electrical rough-in" status' },
    { time: 'Dec 15, 2024 11:45 AM', user: 'Sarah Miller', action: 'Added comment to issue I001' },
    { time: 'Dec 15, 2024 9:00 AM', user: 'System', action: 'Generated daily status report' }
  ];
  
  container.innerHTML = activities.map(a => `
    <div class="audit-entry">
      <span class="audit-time">${a.time}</span>
      <span class="audit-user">${a.user}</span>
      <span class="audit-action">${a.action}</span>
    </div>
  `).join('');
}

function generatePMReport() {
  alert('Report generated! In a full implementation, this would create a PDF report.');
}

function exportPMReport() {
  alert('Export feature would download the report as PDF.');
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
    const progress = total > 0 ? Math.round((completed / total) * 100) : 45;
    
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
    updatesList.innerHTML = `
      <div class="client-update">
        <div class="update-date">Dec 14, 2024</div>
        <h4>Framing Complete - Inspection Passed!</h4>
        <p>We've completed all framing work and passed the city inspection.</p>
      </div>
      <div class="client-update">
        <div class="update-date">Dec 10, 2024</div>
        <h4>Roof Trusses Installed</h4>
        <p>The roof trusses have been installed and sheathed.</p>
      </div>
    `;
  }
  
  const messagesList = document.getElementById('client-messages-list');
  if (messagesList) {
    messagesList.innerHTML = `
      <div class="client-message from-builder">
        <div class="msg-avatar">JD</div>
        <div class="msg-bubble">
          <p>Framing inspection passed today!</p>
          <span class="msg-time">Dec 14, 2:30 PM</span>
        </div>
      </div>
    `;
  }
}

function shareClientPortal() {
  alert('Client portal link copied to clipboard!\n\nIn a full implementation, this would generate a shareable link for your client.');
}

function sendClientMessage() {
  const input = document.getElementById('client-message-input');
  if (!input || !input.value.trim()) return;
  
  const messagesList = document.getElementById('client-messages-list');
  if (messagesList) {
    const newMessage = document.createElement('div');
    newMessage.className = 'client-message from-builder';
    newMessage.innerHTML = `
      <div class="msg-avatar">You</div>
      <div class="msg-bubble">
        <p>${input.value}</p>
        <span class="msg-time">Just now</span>
      </div>
    `;
    messagesList.appendChild(newMessage);
    input.value = '';
    messagesList.scrollTop = messagesList.scrollHeight;
  }
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
  const insights = {
    schedule: 'Based on current progress analysis, the electrical work is taking longer than planned. Consider adding a second electrician or scheduling overtime.',
    resource: 'Your plumbing team (Mike) has availability next week. You could advance the bathroom rough-in to balance workload.',
    budget: 'Current spending trajectory shows you\'ll finish 3% under budget. Material costs have been well-controlled.'
  };
  
  alert(`AI Analysis: ${type}\n\n${insights[type] || 'No additional details available.'}`);
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
  closeModal('pm-new-task-modal');
  showToast(`Task "${taskData.title}" saved!`, 'success');
  
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
  const tasks = store.pmTasks || [];
  
  // Count by status
  const todo = tasks.filter(t => t.status === 'todo').length;
  const inProgress = tasks.filter(t => t.status === 'inprogress').length;
  const review = tasks.filter(t => t.status === 'review').length;
  const done = tasks.filter(t => t.status === 'done').length;
  
  // Calculate total cost
  const totalCost = tasks.reduce((sum, t) => sum + (t.cost || 0), 0);
  
  // Update overview if elements exist
  const scheduleStats = document.querySelector('.schedule-stats');
  if (scheduleStats) {
    scheduleStats.innerHTML = `
      <div class="stat-item"><div class="stat-value">${done}</div><div class="stat-label">Completed</div></div>
      <div class="stat-item"><div class="stat-value">${inProgress}</div><div class="stat-label">In Progress</div></div>
      <div class="stat-item warning"><div class="stat-value">${tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'done').length}</div><div class="stat-label">Overdue</div></div>
      <div class="stat-item"><div class="stat-value">${todo}</div><div class="stat-label">Upcoming</div></div>
    `;
  }
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
