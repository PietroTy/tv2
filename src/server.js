require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const app = express();
app.enable('trust proxy');
const server = http.createServer(app);
const io = new Server(server);

// ---------------------------------------------------------------------------
// Sessão persistente (arquivo JSON — sem dependências extras)
// ---------------------------------------------------------------------------
const sessionSecret = process.env.SESSION_SECRET || 'tv2-secret-default';
const SESSION_FILE = path.join(__dirname, '../data/.sessions.json');
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 dias

class JsonSessionStore extends session.Store {
  constructor() {
    super();
    this._data = {};
    this._load();
    setInterval(() => this._cleanup(), 10 * 60 * 1000); // limpa a cada 10 min
  }

  _load() {
    try {
      const raw = fs.readFileSync(SESSION_FILE, 'utf-8');
      this._data = JSON.parse(raw);
    } catch { this._data = {}; }
  }

  _save() {
    try { fs.writeFileSync(SESSION_FILE, JSON.stringify(this._data)); } catch {}
  }

  _cleanup() {
    const now = Date.now();
    let changed = false;
    for (const [sid, s] of Object.entries(this._data)) {
      if (s && s.cookie && s.cookie.expires && new Date(s.cookie.expires) < now) {
        delete this._data[sid];
        changed = true;
      }
    }
    if (changed) this._save();
  }

  get(sid, cb) { cb(null, this._data[sid] || null); }

  set(sid, sess, cb) { this._data[sid] = sess; this._save(); cb(); }

  destroy(sid, cb) { delete this._data[sid]; this._save(); cb(); }

  all(cb) { cb(null, Object.values(this._data)); }
  length(cb) { cb(null, Object.keys(this._data).length); }
  clear(cb) { this._data = {}; this._save(); cb(); }
}

const sessionMiddleware = session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: new JsonSessionStore(),
  cookie: {
    secure: false,
    maxAge: SESSION_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax'
  }
});

app.use(cookieParser());
app.use(sessionMiddleware);

// ---------------------------------------------------------------------------
// Cache de canais
// ---------------------------------------------------------------------------
let channelsCache = null;
let channelsCacheTime = 0;
const CHANNELS_TTL = 60 * 1000; // 60 segundos

function loadChannels() {
  const filePath = path.join(__dirname, '../data/channels.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function getChannels() {
  const now = Date.now();
  if (!channelsCache || now - channelsCacheTime >= CHANNELS_TTL) {
    channelsCache = loadChannels();
    channelsCacheTime = now;
  }
  return channelsCache;
}

function getNextItemTitleForChannel(ch, videoIdx, partIdx) {
  const videos = ch.videos;
  if (!videos || videos.length === 0) return '—';
  
  const currentItem = videos[videoIdx];
  if (currentItem && currentItem.type === 'episode' && currentItem.parts && currentItem.parts.length > 0) {
    if (partIdx + 1 < currentItem.parts.length) {
      const nextPart = currentItem.parts[partIdx + 1];
      return currentItem.title + ' — ' + nextPart.title;
    }
  }
  
  const nextVideoIdx = (videoIdx + 1) % videos.length;
  const nextItem = videos[nextVideoIdx];
  if (nextItem) {
    if (nextItem.type === 'episode' && nextItem.parts && nextItem.parts.length > 0) {
      const firstPart = nextItem.parts[0];
      return nextItem.title + ' — ' + firstPart.title;
    }
    return nextItem.title || '—';
  }
  return '—';
}

function getPlaybackStateForChannel(channel, timestamp) {
  if (!channel || !channel.videos || channel.videos.length === 0) return null;

  const videos = channel.videos;
  let totalDuration = 0;
  for (let i = 0; i < videos.length; i++) {
    const item = videos[i];
    totalDuration += item.dur;
  }

  if (totalDuration <= 0) return null;

  // Meia-noite UTC do dia atual
  const date = new Date(timestamp);
  const startOfDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  
  let position = Math.floor((timestamp - startOfDay) / 1000) % totalDuration;
  if (position < 0) position += totalDuration;

  for (let videoIdx = 0; videoIdx < videos.length; videoIdx++) {
    const item = videos[videoIdx];
    const itemDur = item.dur;

    if (position < itemDur) {
      if (item.type === 'episode' && item.parts && item.parts.length > 0) {
        let partOffset = position;
        for (let partIdx = 0; partIdx < item.parts.length; partIdx++) {
          const part = item.parts[partIdx];
          if (partOffset < part.dur) {
            return {
              videoIdx,
              partIdx,
              videoId: part.id,
              title: item.title + ' — ' + part.title,
              nextTitle: getNextItemTitleForChannel(channel, videoIdx, partIdx),
              startSec: partOffset
            };
          }
          partOffset -= part.dur;
        }
        const lastPart = item.parts[item.parts.length - 1];
        return {
          videoIdx,
          partIdx: item.parts.length - 1,
          videoId: lastPart.id,
          title: item.title + ' — ' + lastPart.title,
          nextTitle: getNextItemTitleForChannel(channel, videoIdx, item.parts.length - 1),
          startSec: 0
        };
      } else {
        return {
          videoIdx,
          partIdx: 0,
          videoId: item.id,
          title: item.title || '',
          nextTitle: getNextItemTitleForChannel(channel, videoIdx, 0),
          startSec: position
        };
      }
    }

    position -= itemDur;
  }

  return null;
}


// ---------------------------------------------------------------------------
// Google OAuth2
// ---------------------------------------------------------------------------
const googleEnabled =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

if (googleEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || `http://localhost:${PORT}/auth/google/callback`
      },
      (_accessToken, _refreshToken, profile, done) => {
        const user = {
          id: profile.id,
          displayName: profile.displayName,
          email:
            profile.emails && profile.emails.length > 0
              ? profile.emails[0].value
              : null,
          avatar:
            profile.photos && profile.photos.length > 0
              ? profile.photos[0].value
              : null
        };
        done(null, user);
      }
    )
  );
}

app.use(passport.initialize());
app.use(passport.session());

app.use(express.json());

// Servir apenas os arquivos estáticos permitidos da raiz para segurança
const ALLOWED_STATIC = ['/index.html', '/style.css', '/app.js', '/favicon.ico', '/favicon.png'];
app.use((req, res, next) => {
  if (ALLOWED_STATIC.includes(req.path)) {
    return res.sendFile(path.join(__dirname, '..', req.path));
  }
  if (req.path.startsWith('/img/')) {
    return res.sendFile(path.join(__dirname, '..', req.path));
  }
  next();
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// ---------------------------------------------------------------------------
// Rotas de API
// ---------------------------------------------------------------------------
app.get('/api/channels', (_req, res) => {
  try {
    const channels = getChannels();
    res.json(channels);
  } catch (err) {
    console.error('Erro ao carregar canais:', err.message);
    res.status(500).json({ erro: 'Não foi possível carregar os canais.' });
  }
});

app.get('/api/time', (_req, res) => {
  res.json({ timestamp: Date.now() });
});

app.get('/api/playback/:channelIndex', (req, res) => {
  try {
    const channels = getChannels();
    const idx = parseInt(req.params.channelIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= channels.length) {
      return res.status(400).json({ erro: 'Canal inválido.' });
    }
    const state = getPlaybackStateForChannel(channels[idx], Date.now());
    res.json(state);
  } catch (err) {
    console.error('Erro ao calcular reprodução:', err.message);
    res.status(500).json({ erro: 'Não foi possível carregar o estado de reprodução.' });
  }
});

// ---------------------------------------------------------------------------
// Rotas de autenticação Google
// ---------------------------------------------------------------------------
app.get('/auth/google', (req, res, next) => {
  if (!googleEnabled) {
    return res.status(501).json({
      erro: 'Credenciais do Google OAuth não configuradas. Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env.'
    });
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(
    req,
    res,
    next
  );
});

app.get(
  '/auth/google/callback',
  (req, res, next) => {
    if (!googleEnabled) {
      return res.redirect('/');
    }
    next();
  },
  passport.authenticate('google', { failureRedirect: '/' }),
  (_req, res) => {
    res.redirect('/');
  }
);

app.get('/auth/me', (req, res) => {
  if (req.user) {
    res.json({ user: req.user });
  } else {
    res.json({ user: null });
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});



// ---------------------------------------------------------------------------
// Compartilhamento de sessão com Socket.IO
// ---------------------------------------------------------------------------
io.engine.use(sessionMiddleware);

const wrap = (middleware) => (socket, next) =>
  middleware(socket.request, {}, next);

io.use(wrap(passport.initialize()));
io.use(wrap(passport.session()));

// ---------------------------------------------------------------------------
// Socket.IO — Chat e contagem de espectadores
// ---------------------------------------------------------------------------
function getViewerCount(roomName) {
  const room = io.sockets.adapter.rooms.get(roomName);
  return room ? room.size : 0;
}

io.on('connection', (socket) => {
  socket.on('join-channel', ({ channel }) => {
    // Sair de todas as salas de canal anteriores
    for (const room of socket.rooms) {
      if (room !== socket.id && room.startsWith('channel-')) {
        socket.leave(room);
      }
    }

    const roomName = `channel-${channel}`;
    socket.join(roomName);

    // Emitir contagem atualizada para a sala após entrar
    // Pequeno atraso para garantir que o socket já está na sala
    setTimeout(() => {
      const count = getViewerCount(roomName);
      io.to(roomName).emit('viewer-count', count);
    }, 50);
  });

  socket.on('chat-message', ({ text, channel }) => {
    const sess = socket.request.session;
    let displayName;
    let avatarUrl = null;

    if (sess && sess.passport && sess.passport.user) {
      const user = sess.passport.user;
      displayName = user.displayName;
      avatarUrl = user.avatar || null;
    } else {
      const idSuffix = socket.id.slice(-4);
      displayName = `Visitante #${idSuffix}`;
    }

    const roomName = `channel-${channel}`;
    io.to(roomName).emit('chat-message', {
      user: displayName,
      avatar: avatarUrl,
      text,
      timestamp: Date.now()
    });
  });

  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (room !== socket.id && room.startsWith('channel-')) {
        // O socket ainda está na sala neste momento; após sair, o count diminui em 1
        setTimeout(() => {
          const count = getViewerCount(room);
          io.to(room).emit('viewer-count', count);
        }, 100);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`TV2 — Servidor rodando em http://localhost:${PORT}`);
  if (googleEnabled) {
    console.log('Google OAuth: ativado');
  } else {
    console.log(
      'Google OAuth: desativado (configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env)'
    );
  }
});
