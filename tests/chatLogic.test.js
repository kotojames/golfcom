const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const testDataDir = path.join(__dirname, 'tmp-data');
fs.rmSync(testDataDir, { recursive: true, force: true });
fs.mkdirSync(testDataDir, { recursive: true });
process.env.COMM_DATA_DIR = testDataDir;

const {
  buildPrivateRoomId,
  registerUser,
  loginUser,
  validateAdminCode,
  toggleUserBan,
  createMessage,
  deleteMessage,
  getAllMessages,
  generateUserInvite,
  redeemUserInvite,
  getUserInvites,
  getVisibleUsersForUser,
  getUsers,
  removeUser,
} = require('../src/chatStore');

test('buildPrivateRoomId creates a stable room for two users', () => {
  const roomA = buildPrivateRoomId('alice', 'bob');
  const roomB = buildPrivateRoomId('bob', 'alice');

  assert.equal(roomA, roomB);
  assert.match(roomA, /^private:/);
});

test('registerUser stores a user with a hashed password and login works', async () => {
  const uniqueUsername = `alice-${Date.now()}`;
  const user = await registerUser({ username: uniqueUsername, password: 'secret123' });
  const authenticated = await loginUser({ username: uniqueUsername, password: 'secret123' });

  assert.equal(user.username, uniqueUsername);
  assert.notEqual(user.password, 'secret123');
  assert.equal(authenticated.username, uniqueUsername);
});

test('validateAdminCode accepts the configured admin invite code and rejects invalid ones', () => {
  assert.equal(validateAdminCode('jazz'), true);
  assert.equal(validateAdminCode('wrong-code'), false);
});

test('admin moderation can ban a user and delete a message', async () => {
  const uniqueUsername = `moderator-${Date.now()}`;
  const user = await registerUser({ username: uniqueUsername, password: 'secret123' });
  const banned = toggleUserBan(user.id);

  assert.equal(banned.banned, true);
  await assert.rejects(
    () => loginUser({ username: uniqueUsername, password: 'secret123' }),
    /banned/i,
  );

  const message = createMessage({
    roomId: 'private:test-room',
    senderId: user.id,
    senderName: user.username,
    text: 'Hello from admin test',
  });

  const deleted = deleteMessage(message.id);
  assert.equal(deleted.text, 'Hello from admin test');
  assert.equal(getAllMessages().some((entry) => entry.id === message.id), false);
});

test('admin can generate a user invite code and a user can redeem it', () => {
  const invite = generateUserInvite('new-user');
  const redeemed = redeemUserInvite({ username: 'new-user', code: invite.code });

  assert.equal(invite.username, 'new-user');
  assert.equal(redeemed.username, 'new-user');
  assert.equal(redeemed.code, invite.code);
  assert.equal(redeemed.valid, true);
});

test('a user can join with code only after an admin generates the invite', () => {
  const invite = generateUserInvite('code-only-user');
  const redeemed = redeemUserInvite({ code: invite.code });

  assert.equal(redeemed.valid, true);
  assert.equal(redeemed.username, 'code-only-user');
  assert.equal(redeemed.code, invite.code);
});

test('non-admin users can only see the admin contact', () => {
  const users = getVisibleUsersForUser({ username: 'code-only-user', admin: false });

  assert.deepEqual(users.map((user) => user.username), ['admin']);
});

test('admin-created invite adds the user to the admin chat list', () => {
  const username = `chat-user-${Date.now()}`;
  const invite = generateUserInvite(username);
  const users = getUsers();
  const adminVisible = getVisibleUsersForUser({ username: 'admin', admin: true });

  assert.equal(invite.username, username);
  assert.ok(users.some((user) => user.username === username));
  assert.ok(adminVisible.some((user) => user.username === username));
  assert.equal(redeemUserInvite({ username, code: invite.code }).valid, true);
});

test('a user invite code remains valid across repeated logins until the admin refreshes it', () => {
  const username = `repeat-user-${Date.now()}`;
  const invite = generateUserInvite(username);

  const first = redeemUserInvite({ username, code: invite.code });
  const second = redeemUserInvite({ username, code: invite.code });

  assert.equal(first.valid, true);
  assert.equal(second.valid, true);
  assert.equal(second.username, username);
});

test('admin can still see generated invite codes after the user redeems them', () => {
  const username = `visible-user-${Date.now()}`;
  const invite = generateUserInvite(username);
  const redeemed = redeemUserInvite({ username, code: invite.code });
  const invites = getUserInvites();

  assert.equal(redeemed.valid, true);
  assert.ok(invites.some((entry) => entry.username === username && entry.code === invite.code));
});

test('admin ban prevents a user from redeeming a code', () => {
  const username = `banned-user-${Date.now()}`;
  const invite = generateUserInvite(username);

  const user = getUsers().find((entry) => entry.username === username);
  const banned = toggleUserBan(user.id);
  const redeemed = redeemUserInvite({ username, code: invite.code });

  assert.equal(banned.banned, true);
  assert.equal(redeemed.valid, false);
});

test('admin can remove a user from the system', async () => {
  const username = `remove-user-${Date.now()}`;
  const created = await registerUser({ username, password: 'password123' });

  const removed = removeUser(created.id);

  assert.equal(removed.username, username);
  assert.equal(getUsers().some((user) => user.id === created.id), false);
});
