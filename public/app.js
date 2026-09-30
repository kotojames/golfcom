const state = {
  currentUser: null,
  token: localStorage.getItem('comm-token') || '',
  socket: null,
  contacts: [],
  currentRoomId: null,
};

const authForm = document.getElementById('auth-form');
const authButton = document.getElementById('auth-button');
const authStatus = document.getElementById('auth-status');
const userCodeForm = document.getElementById('user-code-form');
const userCodeInput = document.getElementById('user-code');
const authViews = document.querySelectorAll('.auth-view');

function switchAuthView(nextView) {
  const nextPath = nextView === 'user' ? '/user' : '/admin';
  if (window.location.pathname !== nextPath) {
    window.history.pushState({}, '', nextPath);
  }
  syncAuthView();
}
const inviteForm = document.getElementById('invite-form');
const inviteUsernameInput = document.getElementById('invite-username');
const inviteCodeOutput = document.getElementById('invite-code-output');
const authPanel = document.getElementById('auth-panel');
const chatPanel = document.getElementById('chat-panel');
const contactsList = document.getElementById('contacts');
const adminPanel = document.getElementById('admin-panel');
const adminUserList = document.getElementById('admin-user-list');
const adminInviteList = document.getElementById('admin-invite-list');
const adminMessageList = document.getElementById('admin-message-list');
const messagesEl = document.getElementById('messages');
const chatHeaderEl = document.getElementById('chat-header');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const logoutButton = document.getElementById('logout-button');

function setAuthStatus(message, type = '') {
  authStatus.textContent = message;
  authStatus.className = 'status-text';

  if (type) {
    authStatus.classList.add(type);
  }
}

function syncAuthView() {
  const route = window.location.pathname;
  const activeView = route === '/user' ? 'user' : route === '/admin' ? 'admin' : null;

  authViews.forEach((view) => {
    const shouldShow = activeView ? view.dataset.view === activeView : true;
    view.classList.toggle('active', shouldShow);
  });

  document.querySelectorAll('.auth-toggle').forEach((button) => {
    const isActive = activeView ? button.dataset.authTarget === activeView : button.dataset.authTarget === 'admin';
    button.classList.toggle('active', isActive);
  });
}

function buildRoomId(userA, userB) {
  const members = [userA, userB].sort();
  return `private:${members[0]}::${members[1]}`;
}

function renderContacts() {
  contactsList.innerHTML = '';

  if (!state.contacts.length) {
    const emptyItem = document.createElement('li');
    emptyItem.textContent = 'No contacts yet.';
    contactsList.appendChild(emptyItem);
    return;
  }

  state.contacts.forEach((contact) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'contact-item';
    item.textContent = contact.username;
    item.addEventListener('click', () => selectContact(contact.username));
    contactsList.appendChild(item);
  });
}

function renderMessages(messages) {
  messagesEl.innerHTML = '';

  if (!messages.length) {
    const emptyState = document.createElement('div');
    emptyState.className = 'message';
    emptyState.textContent = 'No messages yet. Start the conversation privately.';
    messagesEl.appendChild(emptyState);
    return;
  }

  messages.forEach((message) => {
    const messageBox = document.createElement('div');
    const isSelf = message.senderId === state.currentUser.id;
    messageBox.className = `message ${isSelf ? 'self' : 'other'}`;

    const meta = document.createElement('span');
    meta.className = 'message-meta';
    meta.textContent = `${message.senderName} • ${new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    const body = document.createElement('div');
    body.textContent = message.text;

    messageBox.append(meta, body);
    messagesEl.appendChild(messageBox);
  });

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error((data && data.error) || 'Request failed.');
  }

  if (data === null || typeof data === 'undefined') {
    throw new Error('Invalid server response.');
  }

  return data;
}

function connectSocket() {
  if (state.socket) {
    state.socket.disconnect();
  }

  state.socket = io({ auth: { token: state.token } });

  state.socket.on('connect', () => {
    if (state.currentRoomId) {
      state.socket.emit('join-room', { roomId: state.currentRoomId });
    }
  });

  state.socket.on('new-message', (message) => {
    if (!state.currentRoomId || message.roomId !== state.currentRoomId) {
      return;
    }

    fetch(`/api/messages/${state.currentRoomId}`, {
      headers: {
        Authorization: `Bearer ${state.token}`,
      },
    })
      .then((res) => res.json())
      .then((messages) => renderMessages(messages));
  });

  state.socket.on('connect_error', (error) => {
    console.error('Socket connection error', error);
    setAuthStatus('Unable to connect to secure chat service.', 'error');
  });
}

async function loadContacts() {
  try {
    const users = await request('/api/users');
    state.contacts = users;
    renderContacts();

    if (!state.currentUser || state.currentUser.admin) {
      return;
    }

    if (!state.currentRoomId && users.length) {
      const defaultContact = users[0];
      selectContact(defaultContact.username);
    }
  } catch (error) {
    console.error(error);
  }
}

function renderAdminInvites(invites) {
  adminInviteList.innerHTML = '';

  if (!invites.length) {
    const item = document.createElement('li');
    item.textContent = 'No invite codes yet.';
    adminInviteList.appendChild(item);
    return;
  }

  invites.slice(0, 20).forEach((invite) => {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${invite.username}: ${invite.code}`;

    const status = document.createElement('small');
    status.textContent = invite.used ? 'used' : 'active';
    status.className = invite.used ? 'status-text error' : 'status-text success';

    item.append(label, status);
    adminInviteList.appendChild(item);
  });
}

function renderAdminUsers(users) {
  adminUserList.innerHTML = '';

  if (!users.length) {
    const item = document.createElement('li');
    item.textContent = 'No users';
    adminUserList.appendChild(item);
    return;
  }

  users.forEach((user) => {
    const item = document.createElement('li');
    item.className = 'admin-user-item';
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'link-button';
    label.textContent = user.username + (user.banned ? ' (banned)' : '');
    label.addEventListener('click', () => {
      selectContact(user.username);
    });

    const banButton = document.createElement('button');
    banButton.type = 'button';
    banButton.textContent = user.banned ? 'Unban' : 'Ban';
    banButton.addEventListener('click', async (event) => {
      event.stopPropagation();
      try {
        await request(`/api/admin/users/${user.id}/ban`, { method: 'POST' });
        await loadAdminData();
      } catch (error) {
        setAuthStatus(error.message, 'error');
      }
    });

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = 'Remove';
    removeButton.disabled = Boolean(user.admin);
    removeButton.title = user.admin ? 'Admin account cannot be removed.' : 'Remove this user';
    removeButton.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (user.admin) {
        return;
      }
      try {
        await request(`/api/admin/users/${user.id}`, { method: 'DELETE' });
        await loadAdminData();
      } catch (error) {
        setAuthStatus(error.message, 'error');
      }
    });

    item.append(label, banButton, removeButton);
    adminUserList.appendChild(item);
  });
}

function renderAdminMessages(messages) {
  adminMessageList.innerHTML = '';

  if (!messages.length) {
    const item = document.createElement('li');
    item.textContent = 'No messages';
    adminMessageList.appendChild(item);
    return;
  }

  const grouped = new Map();

  messages.forEach((message) => {
    const key = message.senderName;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(message);
  });

  Array.from(grouped.entries())
    .slice(0, 10)
    .forEach(([senderName, senderMessages]) => {
      const item = document.createElement('li');
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'link-button';
      label.textContent = `${senderName} (${senderMessages.length})`;
      label.addEventListener('click', () => {
        selectContact(senderName);
      });

      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Delete';
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        try {
          const messageIds = senderMessages.map((message) => message.id);
          await Promise.all(messageIds.map((id) => request(`/api/admin/messages/${id}`, { method: 'DELETE' })));
          await loadAdminData();
        } catch (error) {
          setAuthStatus(error.message, 'error');
        }
      });

      item.append(label, button);
      adminMessageList.appendChild(item);
    });
}

async function loadAdminData() {
  if (!state.currentUser || !state.currentUser.admin) {
    adminPanel.classList.add('hidden');
    return;
  }

  try {
    const [users, messages, invites] = await Promise.all([
      request('/api/admin/users'),
      request('/api/admin/messages'),
      request('/api/admin/invites'),
    ]);

    renderAdminInvites(invites);
    renderAdminUsers(users);
    renderAdminMessages(messages);
    adminPanel.classList.remove('hidden');
  } catch (error) {
    console.error(error);
    adminPanel.classList.add('hidden');
  }
}

async function selectContact(username) {
  state.currentRoomId = buildRoomId(state.currentUser.username, username);
  chatHeaderEl.textContent = `Chat with ${username}`;

  document.querySelectorAll('.contact-item').forEach((item) => {
    item.classList.toggle('active', item.textContent === username);
  });

  if (state.socket) {
    state.socket.emit('join-room', { roomId: state.currentRoomId });
  }

  try {
    const messages = await request(`/api/messages/${state.currentRoomId}`);
    renderMessages(messages);
  } catch (error) {
    console.error(error);
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const adminSecretCode = document.getElementById('admin-secret-code').value.trim();

  if (!username || !password || !adminSecretCode) {
    setAuthStatus('Enter admin username, password, and secret code.', 'error');
    return;
  }

  try {
    const { token, user } = await request('/api/admin/join', {
      method: 'POST',
      body: JSON.stringify({ username, password, code: adminSecretCode }),
    });

    state.currentUser = user;
    state.token = token;
    localStorage.setItem('comm-token', token);

    authPanel.classList.add('hidden');
    chatPanel.classList.remove('hidden');
    setAuthStatus('');
    connectSocket();
    await loadContacts();
    await loadAdminData();
  } catch (error) {
    setAuthStatus(error.message, 'error');
  }
}

async function handleUserCodeSubmit(event) {
  event.preventDefault();

  const code = userCodeInput.value.trim();
  if (!code) {
    setAuthStatus('Enter the access code sent by the admin.', 'error');
    return;
  }

  try {
    const { token, user } = await request('/api/user/join', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });

    state.currentUser = user;
    state.token = token;
    localStorage.setItem('comm-token', token);

    authPanel.classList.add('hidden');
    chatPanel.classList.remove('hidden');
    adminPanel.classList.add('hidden');
    setAuthStatus('');
    connectSocket();
    await loadContacts();
  } catch (error) {
    setAuthStatus(error.message, 'error');
  }
}

function logout() {
  state.token = '';
  state.currentUser = null;
  state.currentRoomId = null;
  state.contacts = [];
  localStorage.removeItem('comm-token');

  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }

  authPanel.classList.remove('hidden');
  chatPanel.classList.add('hidden');
  messagesEl.innerHTML = '';
  chatHeaderEl.textContent = 'Select a contact';
  contactsList.innerHTML = '';
  document.getElementById('username').value = '';
  document.getElementById('password').value = '';
  document.getElementById('admin-secret-code').value = '';
  userCodeInput.value = '';
  inviteCodeOutput.textContent = '';
}

function autoJoinWithInviteCode() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) {
    return;
  }

  userCodeInput.value = code;
  handleUserCodeSubmit({ preventDefault: () => {} });
}

inviteForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const username = inviteUsernameInput.value.trim();
  if (!username) {
    inviteCodeOutput.textContent = 'Enter a username for the invite.';
    inviteCodeOutput.className = 'status-text error';
    return;
  }

  try {
    const invite = await request('/api/admin/invite', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });

    if (!invite || !invite.code) {
      inviteCodeOutput.textContent = 'No code returned. Please try again.';
      inviteCodeOutput.className = 'status-text error';
      return;
    }

    inviteCodeOutput.textContent = `Code for ${invite.username || username}: ${invite.code}`;
    inviteCodeOutput.className = 'status-text success';
    await loadAdminData();
  } catch (error) {
    inviteCodeOutput.textContent = error.message;
    inviteCodeOutput.className = 'status-text error';
  }
});

messageForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!state.currentRoomId) {
    setAuthStatus('Select a contact before sending a message.', 'error');
    return;
  }

  const text = messageInput.value.trim();
  if (!text) {
    return;
  }

  try {
    state.socket.emit('send-message', { roomId: state.currentRoomId, text }, async (response) => {
      if (!response.ok) {
        setAuthStatus(response.error, 'error');
        return;
      }

      messageInput.value = '';
      const messages = await request(`/api/messages/${state.currentRoomId}`);
      renderMessages(messages);
    });
  } catch (error) {
    setAuthStatus(error.message, 'error');
  }
});

authForm.addEventListener('submit', handleAuthSubmit);
userCodeForm.addEventListener('submit', handleUserCodeSubmit);
document.querySelectorAll('.auth-toggle').forEach((button) => {
  button.addEventListener('click', () => switchAuthView(button.dataset.authTarget));
});
logoutButton.addEventListener('click', logout);
window.addEventListener('popstate', syncAuthView);
syncAuthView();

autoJoinWithInviteCode();

if (state.token) {
  request('/api/me')
    .then(async (user) => {
      state.currentUser = user;
      authPanel.classList.add('hidden');
      chatPanel.classList.remove('hidden');
      if (!user.admin) {
        adminPanel.classList.add('hidden');
      }
      connectSocket();
      await loadContacts();
      if (user.admin) {
        await loadAdminData();
      }
    })
    .catch(() => {
      localStorage.removeItem('comm-token');
      state.token = '';
    });
}
