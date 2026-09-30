const path = require('node:path');
const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const {
  registerUser,
  loginUser,
  getUsers,
  getVisibleUsersForUser,
  getMessages,
  createMessage,
  buildPrivateRoomId,
  createAdminSession,
  validateAdminCode,
  toggleUserBan,
  removeUser,
  getAllMessages,
  deleteMessage,
  generateUserInvite,
  getUserInvites,
  redeemUserInvite,
} = require('./src/chatStore');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'private-comm-secret';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get(['/', '/admin', '/user'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const users = getUsers();
    const currentUser = users.find((user) => String(user.id) === String(payload.id));

    if (currentUser && currentUser.banned) {
      return res.status(403).json({ error: 'This account has been banned.' });
    }

    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user || req.user.admin !== true) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  next();
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'private-communication-system' });
});

app.post('/api/register', async (req, res) => {
  try {
    const user = await registerUser({
      username: req.body.username,
      password: req.body.password,
    });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      token,
      user,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const user = await loginUser({
      username: req.body.username,
      password: req.body.password,
    });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user,
    });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

app.post('/api/admin/join', (req, res) => {
  try {
    const user = createAdminSession({
      username: req.body.username,
      password: req.body.password,
      code: req.body.code,
    });

    const token = jwt.sign({ id: user.id, username: user.username, admin: true }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        ...user,
        admin: true,
      },
      admin: true,
    });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    admin: Boolean(req.user.admin),
  });
});

app.get('/api/users', authMiddleware, (req, res) => {
  const users = getVisibleUsersForUser(req.user);
  res.json(users);
});

app.post('/api/user/join', (req, res) => {
  try {
    const result = redeemUserInvite({
      username: req.body.username || '',
      code: req.body.code,
    });

    if (!result.valid) {
      return res.status(401).json({ error: 'Invalid or expired user invite code.' });
    }

    const user = {
      id: result.id,
      username: result.username,
      createdAt: new Date().toISOString(),
    };

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  res.json(getUsers());
});

app.get('/api/admin/invites', authMiddleware, adminMiddleware, (req, res) => {
  res.json(getUserInvites());
});

app.post('/api/admin/invite', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const invite = generateUserInvite(req.body.username);
    res.json(invite);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/admin/users/:id/ban', authMiddleware, adminMiddleware, (req, res) => {
  const user = toggleUserBan(req.params.id);

  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  res.json(user);
});

app.delete('/api/admin/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  const user = removeUser(req.params.id);

  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  res.json(user);
});

app.get('/api/admin/messages', authMiddleware, adminMiddleware, (req, res) => {
  res.json(getAllMessages());
});

app.delete('/api/admin/messages/:id', authMiddleware, adminMiddleware, (req, res) => {
  const message = deleteMessage(req.params.id);

  if (!message) {
    return res.status(404).json({ error: 'Message not found.' });
  }

  res.json({ ok: true, message });
});

app.get('/api/messages/:roomId', authMiddleware, (req, res) => {
  res.json(getMessages(req.params.roomId));
});

app.post('/api/messages', authMiddleware, (req, res) => {
  const { roomId, text } = req.body;
  const message = createMessage({
    roomId,
    senderId: req.user.id,
    senderName: req.user.username,
    text,
  });

  if (!message) {
    return res.status(400).json({ error: 'Message cannot be empty.' });
  }

  io.to(roomId).emit('new-message', message);
  res.status(201).json(message);
});

io.use((socket, next) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error('Authentication required.'));
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const users = getUsers();
    const currentUser = users.find((user) => String(user.id) === String(payload.id));

    if (currentUser && currentUser.banned) {
      return next(new Error('This account has been banned.'));
    }

    socket.user = payload;
    next();
  } catch (error) {
    next(new Error('Invalid token.'));
  }
});

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId }) => {
    if (!roomId) {
      return;
    }

    socket.join(roomId);
    socket.emit('joined-room', { roomId });
  });

  socket.on('send-message', ({ roomId, text }, callback) => {
    if (!roomId || !text || !socket.user) {
      callback?.({ ok: false, error: 'Missing room or message.' });
      return;
    }

    const message = createMessage({
      roomId,
      senderId: socket.user.id,
      senderName: socket.user.username,
      text,
    });

    if (!message) {
      callback?.({ ok: false, error: 'Message cannot be empty.' });
      return;
    }

    io.to(roomId).emit('new-message', message);
    callback?.({ ok: true, message });
  });
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Private communication system running on http://localhost:${PORT}`);
});

module.exports = {
  buildPrivateRoomId,
};
