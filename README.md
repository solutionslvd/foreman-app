# The Foreman

AI-powered construction management platform for Alberta contractors.

## 🚀 Features

- **Dashboard** - Financial KPIs, revenue tracking, profit margins
- **Invoicing** - Create and manage invoices with line items
- **Expenses** - Track project expenses and categorize them
- **Payroll** - Employee and contractor payment management
- **Projects** - Project tracking with scope of work
- **Compliance** - WCB tracking, safety training, permits, incidents
- **Documents** - Upload and organize project documents
- **AI Assistant** - Chat-based AI help for construction questions
- **Time Tracking** - Track worker hours on projects

## 🛠️ Tech Stack

- **Backend**: FastAPI (Python 3.11)
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Database**: SQLite (development), PostgreSQL (production)
- **AI**: OpenAI GPT-4

## 📋 Prerequisites

- Python 3.11+
- pip (Python package manager)
- Git

## 🏁 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO
```

### 2. Create Virtual Environment

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Set Up Environment Variables

```bash
cp .env.example .env
# Edit .env with your actual values
```

### 5. Run Development Server

```bash
uvicorn app.main:app --reload --port 8050
```

### 6. Open in Browser

Navigate to http://localhost:8050

## 🌐 Deployment

See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for detailed deployment instructions.

### Quick Deploy Options

- **Vercel**: Import repo and deploy
- **Railway**: Connect GitHub and deploy
- **Render**: Create new Web Service

## 📁 Project Structure

```
the-foreman/
├── app/
│   ├── main.py          # FastAPI application
│   ├── api/             # API routes
│   ├── models/          # Data models
│   └── services/        # Business logic
├── web/
│   ├── app.html         # Main application
│   ├── landing.html     # Landing page
│   ├── admin.html       # Admin panel
│   └── static/          # CSS, JS, images
├── requirements.txt     # Python dependencies
├── vercel.json          # Vercel config
├── render.yaml          # Render config
└── railway.json         # Railway config
```

## 🔐 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_API_KEY` | OpenAI API key | Yes |
| `SECRET_KEY` | App secret key | Yes |
| `DATABASE_URL` | PostgreSQL URL | No |
| `STRIPE_SECRET_KEY` | Stripe API key | No |

## 📄 License

MIT License - See LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📞 Support

For support, email support@foremanapp.ca