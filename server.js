const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// The access code clients use to enter — set via environment variable on Render
const ACCESS_CODE = process.env.ACCESS_CODE || 'interview2025';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dialoge-secret-key-change-me';

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

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.listen(PORT, () => {
  console.log(`Dialoge Interview App running on port ${PORT}`);
});
