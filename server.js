const express = require('express');
const session = require('express-session');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// The access code clients use to enter — set via environment variable on Render
const ACCESS_CODE = process.env.ACCESS_CODE || 'interview2025';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dialoge-secret-key-change-me';
const DIALOGE_API_KEY = process.env.DIALOGE_API_KEY || '';
const DIALOGE_API_BASE = 'https://api.dialogintelligens.dk';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // set to true if using HTTPS (Render provides HTTPS)
    maxAge: 8 * 60 * 60 * 1000 // 8 hours
  }
}));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.redirect('/');
}

// Root — redirect to chat if already logged in
app.get('/', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect('/chat');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login API — username is the chatbot ID, password is the shared access code
app.post('/api/login', (req, res) => {
  const { chatbotId, code } = req.body;
  if (!chatbotId || !chatbotId.trim()) {
    return res.status(400).json({ success: false, message: 'Please enter a chatbot ID.' });
  }
  if (code && code.trim() === ACCESS_CODE) {
    req.session.authenticated = true;
    req.session.chatbotId = chatbotId.trim();
    return res.json({ success: true });
  }
  res.status(401).json({ success: false, message: 'Invalid access code. Please try again.' });
});

// Session info — returns chatbot ID for the current session
app.get('/api/session', requireAuth, (req, res) => {
  res.json({ chatbotId: req.session.chatbotId });
});

// Chat page — protected
app.get('/chat', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Helper: get a Dialoge JWT via Basic Auth
async function getDialogeToken() {
  return new Promise((resolve, reject) => {
    const credentials = Buffer.from(`${DIALOGE_API_KEY}:`).toString('base64');
    const options = {
      hostname: 'api.dialogintelligens.dk',
      path: '/api/v1/chat/auth',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
        'Content-Length': 0
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.token) resolve(parsed.token);
          else reject(new Error('No token in response: ' + data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Rate API — proxies star rating + comment to the Dialoge platform
app.post('/api/rate', requireAuth, async (req, res) => {
  const { rating, comment } = req.body;
  const chatbotId = req.session.chatbotId;

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, message: 'Invalid rating.' });
  }

  if (!DIALOGE_API_KEY) {
    // API key not configured — still return success so UI doesn't break
    console.warn('DIALOGE_API_KEY not set; skipping rate API call.');
    return res.json({ success: true });
  }

  try {
    const token = await getDialogeToken();

    await new Promise((resolve, reject) => {
      const body = JSON.stringify({ chatbotId, rating, comment: comment || '' });
      const options = {
        hostname: 'api.dialogintelligens.dk',
        path: '/api/v1/chat/rate',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      };
      const request = https.request(options, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => resolve(data));
      });
      request.on('error', reject);
      request.write(body);
      request.end();
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Dialoge rate error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to submit rating.' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.listen(PORT, () => {
  console.log(`Dialoge Interview App running on port ${PORT}`);
});
