const express = require('express');
const session = require('express-session');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

const ACCESS_CODE    = process.env.ACCESS_CODE    || 'interview2025';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dialoge-secret-key-change-me';
const DIALOGE_API_KEY = process.env.DIALOGE_API_KEY || '';

// CLIENTS env var — JSON map of clientName → [chatbotId, ...]
// Example: {"intern":["intern-a","intern-b","intern-c"],"dafolo":["dafolo"]}
// If not set, the login "username" is treated directly as the chatbot ID (legacy behaviour).
let CLIENTS = null;
try {
  if (process.env.CLIENTS) {
    CLIENTS = JSON.parse(process.env.CLIENTS);
  }
} catch (e) {
  console.error('Could not parse CLIENTS env var as JSON:', e.message);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    maxAge: 8 * 60 * 60 * 1000 // 8 hours
  }
}));

// ── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.redirect('/');
}

// ── Root ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect(req.session.chatbotId ? '/chat' : '/select');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ── Branded client login pages ────────────────────────────────────────────────
// Always show the branded page — clients bookmark this URL as their entry point.
// Submitting the form will redirect to /chat or /select as normal.
app.get('/dafolo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dafolo.html'));
});

// ── Login ─────────────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { chatbotId, code } = req.body;        // chatbotId field = "username" from the form

  if (!chatbotId || !chatbotId.trim()) {
    return res.status(400).json({ success: false, message: 'Please enter a client ID.' });
  }
  if (!code || code.trim() !== ACCESS_CODE) {
    return res.status(401).json({ success: false, message: 'Invalid access code. Please try again.' });
  }

  const clientName = chatbotId.trim().toLowerCase();
  req.session.authenticated = true;
  req.session.clientName = clientName;

  if (CLIENTS) {
    // Find a case-insensitive match in CLIENTS
    const key = Object.keys(CLIENTS).find(k => k.toLowerCase() === clientName);
    const bots = key ? CLIENTS[key] : null;

    if (!bots || bots.length === 0) {
      return res.status(401).json({ success: false, message: 'Unknown client ID.' });
    }

    if (bots.length === 1) {
      // Only one chatbot — go straight to chat
      req.session.chatbotId = bots[0];
      req.session.chatbots  = bots;
      return res.json({ success: true, redirect: '/chat' });
    }

    // Multiple chatbots — let the user pick
    req.session.chatbotId = null;
    req.session.chatbots  = bots;
    return res.json({ success: true, redirect: '/select' });
  }

  // Legacy: no CLIENTS map — treat the entered name as the chatbot ID directly
  req.session.chatbotId = clientName;
  req.session.chatbots  = [clientName];
  return res.json({ success: true, redirect: '/chat' });
});

// ── Session info ──────────────────────────────────────────────────────────────
app.get('/api/session', requireAuth, (req, res) => {
  res.json({
    chatbotId: req.session.chatbotId,
    chatbots:  req.session.chatbots || []
  });
});

// ── Select chatbot ────────────────────────────────────────────────────────────
app.get('/select', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'select.html'));
});

app.post('/api/select', requireAuth, (req, res) => {
  const { chatbotId } = req.body;
  const allowed = req.session.chatbots || [];
  if (!chatbotId || !allowed.includes(chatbotId)) {
    return res.status(400).json({ success: false, message: 'Invalid selection.' });
  }
  req.session.chatbotId = chatbotId;
  res.json({ success: true });
});

// ── Chat page ─────────────────────────────────────────────────────────────────
app.get('/chat', requireAuth, (req, res) => {
  if (!req.session.chatbotId) return res.redirect('/select');
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// ── Dialoge helpers ───────────────────────────────────────────────────────────
function dialoge(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr)
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      // Basic Auth with API key as username, empty password
      const creds = Buffer.from(`${DIALOGE_API_KEY}:`).toString('base64');
      headers['Authorization'] = `Basic ${creds}`;
    }
    const options = {
      hostname: 'api.dialogintelligens.dk',
      path: urlPath,
      method,
      headers
    };
    const req = https.request(options, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => {
        try { resolve({ status: resp.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: resp.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function getDialogeToken(chatbotId) {
  const resp = await dialoge('POST', '/api/v1/chat/auth', null, { chatbot_id: chatbotId });
  if (resp.body && resp.body.token) return resp.body.token;
  throw new Error('No token in response: ' + JSON.stringify(resp.body));
}

// ── Rate API ──────────────────────────────────────────────────────────────────
app.post('/api/rate', requireAuth, async (req, res) => {
  const { rating, comment } = req.body;
  const chatbotId = req.session.chatbotId;

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, message: 'Invalid rating.' });
  }

  if (!DIALOGE_API_KEY) {
    console.warn('DIALOGE_API_KEY not set; skipping rate API call.');
    return res.json({ success: true });
  }

  try {
    const token = await getDialogeToken(chatbotId);
    const resp = await dialoge('POST', '/api/v1/chat/rate', token, {
      rating,
      feedback: comment || ''
    });
    console.log('Dialoge rate response:', resp.status, JSON.stringify(resp.body));
    res.json({ success: true });
  } catch (err) {
    console.error('Dialoge rate error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to submit rating.' });
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.listen(PORT, () => {
  console.log(`Dialoge Interview App running on port ${PORT}`);
});
