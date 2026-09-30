# Private Communication System

A lightweight private messaging app with:

- User registration and authentication
- Secure token-based sessions
- Direct private chat rooms between two users
- Real-time updates through Socket.IO
- Local JSON persistence for users and messages

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000 in a browser.

## Default behavior

- Register or log in with a username and password.
- Select a contact from the list to open a private room.
- Messages are grouped by a stable room ID generated from the two users in the chat.
- The app stores users and message history in the `data` folder.

## Test suite

```bash
npm test
```
