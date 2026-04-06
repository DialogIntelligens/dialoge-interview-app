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

// Login API
app.post('/api/login', (req, res) => {
  const { code } = req.body;
  if (code && code.trim() === ACCESS_CODE) {
    req.session.authenticated = true;
    return res.json({ success: true });
  }
  res.status(401).json({ success: false, message: 'Invalid access code. Please try again.' });
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
