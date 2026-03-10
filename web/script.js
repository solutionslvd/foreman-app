// Alberta Construction AI Assistant - JavaScript

// State Management
const state = {
    currentSection: 'dashboard',
    chatHistory: [],
    isRecording: false,
    sidebarOpen: false
};

// DOM Elements
const elements = {
    sidebar: document.getElementById('sidebar'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    navItems: document.querySelectorAll('.nav-item'),
    contentSections: document.querySelectorAll('.content-section'),
    pageTitle: document.getElementById('pageTitle'),
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    sendBtn: document.getElementById('sendBtn'),
    voiceBtn: document.getElementById('voiceBtn'),
    chatVoiceBtn: document.getElementById('chatVoiceBtn'),
    quickActions: document.querySelectorAll('.quick-action'),
    tabBtns: document.querySelectorAll('.tab-btn'),
    modalOverlay: document.getElementById('modalOverlay')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    initializeNavigation();
    initializeChat();
    initializeVoiceCommands();
    initializeQuickActions();
    initializeTabs();
    initializeResponsive();
    initializeAnimations();
});

// Navigation
function initializeNavigation() {
    elements.navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.dataset.section;
            navigateToSection(section);
        });
    });
    
    elements.sidebarToggle.addEventListener('click', () => {
        elements.sidebar.classList.toggle('active');
        state.sidebarOpen = !state.sidebarOpen;
    });
}

function navigateToSection(section) {
    // Update active nav item
    elements.navItems.forEach(item => {
        item.classList.remove('active');
        if (item.dataset.section === section) {
            item.classList.add('active');
        }
    });
    
    // Update content sections
    elements.contentSections.forEach(sec => {
        sec.classList.remove('active');
        if (sec.id === section) {
            sec.classList.add('active');
        }
    });
    
    // Update page title
    const titles = {
        dashboard: 'Dashboard',
        chat: 'AI Assistant',
        financial: 'Financial Management',
        projects: 'Projects',
        compliance: 'Compliance',
        documents: 'Documents'
    };
    elements.pageTitle.textContent = titles[section] || 'Dashboard';
    
    state.currentSection = section;
    
    // Close sidebar on mobile
    if (window.innerWidth <= 1024) {
        elements.sidebar.classList.remove('active');
    }
}

// Chat Functionality
function initializeChat() {
    elements.sendBtn.addEventListener('click', sendMessage);
    elements.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // Auto-resize textarea
    elements.chatInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
}

function sendMessage() {
    const message = elements.chatInput.value.trim();
    if (!message) return;
    
    // Add user message
    addMessage(message, 'user');
    elements.chatInput.value = '';
    elements.chatInput.style.height = 'auto';
    
    // Simulate AI response
    setTimeout(() => {
        const response = generateAIResponse(message);
        addMessage(response, 'ai');
    }, 1000);
}

function addMessage(content, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;
    
    const avatar = document.createElement('div');
    avatar.className = `message-avatar ${sender}`;
    avatar.innerHTML = sender === 'ai' ? '<i class="fas fa-robot"></i>' : '<i class="fas fa-user"></i>';
    
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    messageContent.innerHTML = formatMessage(content);
    
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(messageContent);
    
    elements.chatMessages.appendChild(messageDiv);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    
    state.chatHistory.push({ sender, content, timestamp: new Date() });
}

function formatMessage(content) {
    // Convert URLs to links
    content = content.replace(
        /(https?:\/\/[^\s]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    
    // Convert line breaks to paragraphs
    const paragraphs = content.split('\n\n');
    return paragraphs.map(p => `<p>${p}</p>`).join('');
}

function generateAIResponse(message) {
    const lowerMessage = message.toLowerCase();
    
    // Financial queries
    if (lowerMessage.includes('invoice') || lowerMessage.includes('payment')) {
        return `I can help you with invoicing! Here's what I can do:

**Create Invoice**: I'll generate a professional invoice with your business details, client information, and line items.

**Track Payments**: Monitor which invoices have been paid and follow up on overdue payments.

**Payment Reminders**: Send automatic reminders to clients for upcoming or overdue payments.

Would you like me to help you create a new invoice or check on existing ones?`;
    }
    
    // Compliance queries
    if (lowerMessage.includes('compliance') || lowerMessage.includes('wcb') || lowerMessage.includes('safety')) {
        return `I can help you stay compliant with Alberta regulations:

**WCB Alberta**: I can help ensure your coverage is active and premiums are calculated correctly based on your trade.

**OHS Requirements**: I'll track safety inspections, training requirements, and help you maintain your safety program.

**Building Permits**: I can remind you of required permits and inspection schedules for your projects.

**Safety Documentation**: Generate required safety reports, checklists, and incident reports.

What specific compliance area do you need help with?`;
    }
    
    // Tax queries
    if (lowerMessage.includes('tax') || lowerMessage.includes('deduction') || lowerMessage.includes('expense')) {
        return `I can help you navigate tax matters with practical guidance:

**Expense Deductions**: I'll help you maximize legitimate deductions while staying compliant with CRA requirements.

**Grey Areas**: I provide practical guidance on complex situations like:
- Vehicle expenses (business-use percentage based on mileage log)
- Home office (square footage percentage)
- Meals (50% deductible for business purposes)
- Tools (under $500 can be expensed immediately)

**GST Remittance**: Track and calculate GST collected and payable.

**Catch-up Situations**: If you're behind on taxes, I can help prioritize and create a recovery plan.

What specific tax concern can I help you with?`;
    }
    
    // Catch-up queries
    if (lowerMessage.includes('behind') || lowerMessage.includes('catch up') || lowerMessage.includes('late')) {
        return `I understand you're looking to catch up on some paperwork. Don't worry - this is common in construction, and I'm here to help you get back on track!

**Immediate Priorities**:
1. **Payroll and source deductions** (most urgent - personal liability risk)
2. **GST remittance** (penalties accumulate quickly)
3. **Income tax filing** (deadline-driven)

**My Approach**:
- I'll help you reconstruct missing records using bank statements
- Create a prioritized action plan based on risk and urgency
- Generate necessary documentation and summaries
- Guide you through communicating with authorities if needed

**Flexible Solutions**:
- Reasonable expense categorization based on industry norms
- Practical approaches to grey areas
- Documentation that supports your positions

Let's start with the most urgent items. What areas are you most behind on?`;
    }
    
    // Default response
    return `I understand you need help with "${message}". Let me provide some guidance:

Based on your construction business, I can help you with:

📊 **Financial Management**: Invoicing, expenses, budgeting, and cost tracking
📋 **Compliance**: WCB, OHS, permits, and safety requirements
💰 **Tax & Accounting**: Deductions, GST, payroll, and catch-up situations
🏗️ **Project Management**: Scheduling, coordination, and documentation
📝 **Administrative Tasks**: Reduce paperwork and automate routine tasks

Could you provide more details about what you'd like to accomplish? I'm here to help make your construction business run more smoothly!`;
}

// Voice Commands
function initializeVoiceCommands() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            handleVoiceCommand(transcript);
        };
        
        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            showNotification('Voice recognition failed. Please try again.', 'error');
        };
        
        recognition.onend = () => {
            state.isRecording = false;
            updateVoiceButtonState();
        };
        
        elements.voiceBtn.addEventListener('click', () => {
            if (state.isRecording) {
                recognition.stop();
            } else {
                recognition.start();
                state.isRecording = true;
                updateVoiceButtonState();
            }
        });
        
        elements.chatVoiceBtn.addEventListener('click', () => {
            if (state.isRecording) {
                recognition.stop();
            } else {
                recognition.start();
                state.isRecording = true;
                updateVoiceButtonState();
            }
        });
    } else {
        console.log('Speech recognition not supported');
        elements.voiceBtn.style.display = 'none';
        elements.chatVoiceBtn.style.display = 'none';
    }
}

function handleVoiceCommand(transcript) {
    console.log('Voice command:', transcript);
    
    // Add voice transcript to chat input
    elements.chatInput.value = transcript;
    elements.chatInput.focus();
    
    // Auto-send after short delay
    setTimeout(() => {
        sendMessage();
    }, 500);
}

function updateVoiceButtonState() {
    const icon = state.isRecording ? 'fa-stop' : 'fa-microphone';
    const color = state.isRecording ? '#ef4444' : '';
    
    elements.voiceBtn.innerHTML = `<i class="fas ${icon}"></i>`;
    elements.chatVoiceBtn.innerHTML = `<i class="fas ${icon}"></i>`;
    
    if (state.isRecording) {
        elements.voiceBtn.style.color = color;
        elements.chatVoiceBtn.style.color = color;
    } else {
        elements.voiceBtn.style.color = '';
        elements.chatVoiceBtn.style.color = '';
    }
}

// Quick Actions
function initializeQuickActions() {
    elements.quickActions.forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            handleQuickAction(action);
        });
    });
}

function handleQuickAction(action) {
    const actions = {
        create_invoice: 'I need help creating an invoice for a client',
        check_compliance: 'Can you check my compliance status?',
        tax_help: 'I need help with my taxes and deductions',
        catch_up: 'I need to catch up on my paperwork and taxes'
    };
    
    if (actions[action]) {
        elements.chatInput.value = actions[action];
        sendMessage();
    }
}

// Tabs
function initializeTabs() {
    elements.tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            switchTab(tab);
        });
    });
}

function switchTab(tab) {
    elements.tabBtns.forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === tab) {
            btn.classList.add('active');
        }
    });
    
    // In a real application, this would switch tab content
    console.log('Switched to tab:', tab);
}

// Responsive Design
function initializeResponsive() {
    window.addEventListener('resize', () => {
        if (window.innerWidth > 1024) {
            elements.sidebar.classList.remove('active');
        }
    });
}

// Animations
function initializeAnimations() {
    // Animate stats on load
    const statValues = document.querySelectorAll('.stat-value');
    statValues.forEach(stat => {
        const finalValue = stat.textContent;
        animateValue(stat, 0, parseInt(finalValue.replace(/[^0-9]/g, '')), 1000);
    });
}

function animateValue(element, start, end, duration) {
    const range = end - start;
    const increment = end > start ? 1 : -1;
    const stepTime = Math.abs(Math.floor(duration / range));
    let current = start;
    
    const timer = setInterval(() => {
        current += increment;
        element.textContent = formatNumber(current);
        
        if (current === end) {
            clearInterval(timer);
        }
    }, stepTime);
}

function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Notifications
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('show');
    }, 100);
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Utility Functions
function formatDate(date) {
    return new Date(date).toLocaleDateString('en-CA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency: 'CAD'
    }).format(amount);
}

// Export functions for potential use by backend
window.BuildAI = {
    navigateToSection,
    sendMessage,
    addMessage,
    showNotification,
    formatDate,
    formatCurrency
};