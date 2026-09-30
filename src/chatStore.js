const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = process.env.COMM_DATA_DIR || path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const INVITES_FILE = path.join(DATA_DIR, 'invites.json');

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, '[]', 'utf8');
  }

  if (!fs.existsSync(MESSAGES_FILE)) {
    fs.writeFileSync(MESSAGES_FILE, '[]', 'utf8');
  }

  if (!fs.existsSync(INVITES_FILE)) {
    fs.writeFileSync(INVITES_FILE, '[]', 'utf8');
  }

  try {
    const rawUsers = fs.readFileSync(USERS_FILE, 'utf8');
    const users = Array.isArray(JSON.parse(rawUsers)) ? JSON.parse(rawUsers) : [];
    const adminExists = users.some((user) => String(user.username || '').toLowerCase() === 'admin');

    if (!adminExists) {
      users.push({
        id: uuidv4(),
        username: 'admin',
        password: bcrypt.hashSync('jazz', 10),
        createdAt: new Date().toISOString(),
        admin: true,
      });
      writeJson(USERS_FILE, users);
    }
  } catch (error) {
    const fallbackAdmin = {
      id: 'admin-placeholder-id',
      username: 'admin',
      password: bcrypt.hashSync('jazz', 10),
      createdAt: new Date().toISOString(),
      admin: true,
    };

    fs.writeFileSync(USERS_FILE, JSON.stringify([fallbackAdmin], null, 2), 'utf8');
  }
}

function readJson(filePath, fallback) {
  ensureStorage();

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function buildPrivateRoomId(userA, userB) {
  if (!userA || !userB) {
    throw new Error('Both user names are required to build a private room');
  }

  const members = [String(userA).trim(), String(userB).trim()].filter(Boolean).sort();
  return `private:${members[0]}::${members[1]}`;
}

function validateAdminCode(code) {
  const adminCode = (process.env.ADMIN_ACCESS_CODE || 'jazz').trim().toLowerCase();
  return String(code || '').trim().toLowerCase() === adminCode;
}

function ensureInvitedUser(username) {
  const cleanUsername = String(username || '').trim();

  if (!cleanUsername || cleanUsername.toLowerCase() === 'admin') {
    return null;
  }

  const users = readJson(USERS_FILE, []);
  let user = users.find((entry) => entry.username.toLowerCase() === cleanUsername.toLowerCase());

  if (!user) {
    user = {
      id: uuidv4(),
      username: cleanUsername,
      password: bcrypt.hashSync(`${cleanUsername}-${uuidv4()}`, 10),
      createdAt: new Date().toISOString(),
      invited: true,
    };
    users.push(user);
    writeJson(USERS_FILE, users);
    return user;
  }

  user.invited = true;
  user.updatedAt = new Date().toISOString();
  writeJson(USERS_FILE, users);
  return user;
}

function generateUserInvite(username) {
  const cleanUsername = String(username || '').trim();

  if (cleanUsername.length < 3) {
    throw new Error('Username must be at least 3 characters long.');
  }

  const users = readJson(USERS_FILE, []);
  const existingUser = users.find((user) => user.username.toLowerCase() === cleanUsername.toLowerCase());

  if (existingUser && existingUser.banned) {
    throw new Error('This user is currently banned and cannot receive a new invite code.');
  }

  ensureInvitedUser(cleanUsername);

  const invites = readJson(INVITES_FILE, []);
  const existingInvite = invites.find(
    (entry) => entry.username.toLowerCase() === cleanUsername.toLowerCase(),
  );

  if (existingInvite) {
    existingInvite.code = Math.random().toString(36).slice(2, 8).toUpperCase();
    existingInvite.createdAt = new Date().toISOString();
    existingInvite.used = false;
    existingInvite.usedAt = null;
    writeJson(INVITES_FILE, invites);
    return existingInvite;
  }

  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const invite = {
    id: uuidv4(),
    username: cleanUsername,
    code,
    createdAt: new Date().toISOString(),
    used: false,
  };

  invites.push(invite);
  writeJson(INVITES_FILE, invites);
  return invite;
}

function getUserInvites() {
  ensureStorage();
  return readJson(INVITES_FILE, []).sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

function redeemUserInvite({ username, code }) {
  const cleanUsername = String(username || '').trim();
  const cleanCode = String(code || '').trim().toUpperCase();
  const invites = readJson(INVITES_FILE, []);
  const invite = invites.find((entry) => {
    if (entry.code.toUpperCase() !== cleanCode) {
      return false;
    }

    if (cleanUsername) {
      return entry.username.toLowerCase() === cleanUsername.toLowerCase();
    }

    return true;
  });

  if (!invite) {
    return { valid: false, username: cleanUsername, code: cleanCode };
  }

  const users = readJson(USERS_FILE, []);
  const matchingUser = users.find((user) => user.username.toLowerCase() === invite.username.toLowerCase());

  if (matchingUser && matchingUser.banned) {
    return {
      valid: false,
      username: invite.username,
      code: cleanCode,
      error: 'This account has been banned.',
    };
  }

  const activeUser = ensureInvitedUser(invite.username);
  invite.lastUsedAt = new Date().toISOString();
  invite.used = false;
  writeJson(INVITES_FILE, invites);

  return {
    valid: true,
    id: activeUser ? activeUser.id : invite.id,
    username: invite.username,
    code: invite.code,
    usedAt: invite.usedAt,
  };
}

function createAdminSession({ username, password, code }) {
  if (!validateAdminCode(code)) {
    throw new Error('Invalid admin access code.');
  }

  const cleanUsername = String(username || '').trim();
  const adminUser = readJson(USERS_FILE, []).find((entry) => entry.username.toLowerCase() === 'admin');

  if (!adminUser || cleanUsername.toLowerCase() !== 'admin') {
    throw new Error('Invalid admin username or password.');
  }

  const validPassword = bcrypt.compareSync(String(password || ''), adminUser.password || '');
  if (!validPassword) {
    throw new Error('Invalid admin username or password.');
  }

  return {
    id: adminUser.id,
    username: adminUser.username,
    createdAt: adminUser.createdAt || new Date().toISOString(),
    admin: true,
  };
}

async function registerUser({ username, password }) {
  ensureStorage();

  const cleanUsername = String(username || '').trim();
  if (cleanUsername.length < 3) {
    throw new Error('Username must be at least 3 characters long.');
  }

  if (!password || String(password).length < 6) {
    throw new Error('Password must be at least 6 characters long.');
  }

  const users = readJson(USERS_FILE, []);
  const existing = users.find((user) => user.username.toLowerCase() === cleanUsername.toLowerCase());

  if (existing) {
    throw new Error('Username is already taken.');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: uuidv4(),
    username: cleanUsername,
    password: passwordHash,
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  writeJson(USERS_FILE, users);

  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
  };
}

async function loginUser({ username, password }) {
  ensureStorage();

  const cleanUsername = String(username || '').trim();
  const users = readJson(USERS_FILE, []);
  const user = users.find((entry) => entry.username.toLowerCase() === cleanUsername.toLowerCase());

  if (!user) {
    throw new Error('Invalid username or password.');
  }

  if (user.banned) {
    throw new Error('This account has been banned.');
  }

  const validPassword = await bcrypt.compare(String(password), user.password);
  if (!validPassword) {
    throw new Error('Invalid username or password.');
  }

  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
    banned: false,
  };
}

function getUsers() {
  ensureStorage();

  return readJson(USERS_FILE, []).map(({ id, username, createdAt, banned = false, admin = false }) => ({
    id,
    username,
    createdAt,
    banned,
    admin,
  }));
}

function getVisibleUsersForUser(currentUser) {
  const users = getUsers();
  const currentUsername = String((currentUser && currentUser.username) || '').trim().toLowerCase();

  if (!currentUser || currentUser.admin === true) {
    return users.filter((user) => user.username.toLowerCase() !== currentUsername);
  }

  const adminUser = users.find((user) => user.username.toLowerCase() === 'admin');
  if (!adminUser || adminUser.username.toLowerCase() === currentUsername) {
    return [];
  }

  return [adminUser];
}

function toggleUserBan(userId) {
  ensureStorage();

  const users = readJson(USERS_FILE, []);
  const user = users.find((entry) => entry.id === userId);

  if (!user) {
    return null;
  }

  user.banned = !Boolean(user.banned);
  user.bannedAt = new Date().toISOString();
  writeJson(USERS_FILE, users);

  return {
    id: user.id,
    username: user.username,
    banned: user.banned,
    bannedAt: user.bannedAt,
  };
}

function removeUser(userId) {
  ensureStorage();

  const users = readJson(USERS_FILE, []);
  const target = users.find((entry) => entry.id === userId);

  if (!target || target.admin === true) {
    return null;
  }

  const index = users.findIndex((entry) => entry.id === userId && !entry.admin);
  if (index === -1) {
    return null;
  }

  const [removed] = users.splice(index, 1);
  writeJson(USERS_FILE, users);

  const invites = readJson(INVITES_FILE, []);
  const filteredInvites = invites.filter((invite) => invite.username.toLowerCase() !== removed.username.toLowerCase());
  if (filteredInvites.length !== invites.length) {
    writeJson(INVITES_FILE, filteredInvites);
  }

  return {
    id: removed.id,
    username: removed.username,
    removed: true,
  };
}

function createMessage({ roomId, senderId, senderName, text }) {
  ensureStorage();

  const messageText = String(text || '').trim();
  if (!roomId || !senderId || !messageText) {
    return null;
  }

  const message = {
    id: uuidv4(),
    roomId,
    senderId,
    senderName,
    text: messageText,
    createdAt: new Date().toISOString(),
  };

  const messages = readJson(MESSAGES_FILE, []);
  messages.push(message);
  writeJson(MESSAGES_FILE, messages);

  return message;
}

function getMessages(roomId) {
  ensureStorage();

  const messages = readJson(MESSAGES_FILE, []);
  return messages
    .filter((message) => message.roomId === roomId)
    .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
}

function getAllMessages() {
  ensureStorage();

  return readJson(MESSAGES_FILE, []).sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

function deleteMessage(messageId) {
  ensureStorage();

  const messages = readJson(MESSAGES_FILE, []);
  const index = messages.findIndex((message) => message.id === messageId);

  if (index === -1) {
    return null;
  }

  const [removed] = messages.splice(index, 1);
  writeJson(MESSAGES_FILE, messages);
  return removed;
}

module.exports = {
  buildPrivateRoomId,
  validateAdminCode,
  generateUserInvite,
  getUserInvites,
  redeemUserInvite,
  createAdminSession,
  registerUser,
  loginUser,
  getUsers,
  getVisibleUsersForUser,
  toggleUserBan,
  removeUser,
  createMessage,
  getMessages,
  getAllMessages,
  deleteMessage,
};
