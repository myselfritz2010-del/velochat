const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure 'uploads' directory exists
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Persistent Users File Storage (JSON DB)
const USERS_FILE = path.join(__dirname, 'users.json');

function loadUsers() {
    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify({}));
        return {};
    }
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return {};
    }
}

function saveUsers(usersData) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersData, null, 2));
}

const users = loadUsers();
let messages = [];
const socketUserMap = {};

// Multer storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// --- REST API ENDPOINTS ---

// 1. Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password required.' });
    }
    const user = users[username];
    if (user && user.password === password) {
        return res.json({
            success: true,
            user: { username, avatar: user.avatar }
        });
    }
    return res.status(401).json({ success: false, message: 'Invalid username or password.' });
});

// 2. Sign Up (Persists to users.json)
app.post('/api/signup', (req, res) => {
    const { username, password, avatarUrl } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password required.' });
    }
    if (users[username]) {
        return res.status(400).json({ success: false, message: 'Username already taken.' });
    }
    const avatar = avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(username)}`;
    users[username] = { password, avatar, online: false };
    saveUsers(users);

    return res.json({
        success: true,
        user: { username, avatar }
    });
});

// 3. Get Registered Users
app.get('/api/users', (req, res) => {
    const userList = Object.keys(users).map(username => ({
        username,
        avatar: users[username].avatar,
        online: users[username].online || false
    }));
    res.json(userList);
});

// 4. Get Conversation
app.get('/api/messages/:user1/:user2', (req, res) => {
    const { user1, user2 } = req.params;
    const conversation = messages.filter(
        m => (m.sender === user1 && m.receiver === user2) ||
             (m.sender === user2 && m.receiver === user1)
    );
    res.json(conversation);
});

// 5. Upload File
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }
    res.json({ success: true, url: `/uploads/${req.file.filename}` });
});

// 6. Delete Account
app.delete('/api/user/:username', (req, res) => {
    const { username } = req.params;
    if (users[username]) {
        delete users[username];
        saveUsers(users);
        io.emit('update-user-status');
        return res.json({ success: true });
    }
    res.status(404).json({ success: false, message: 'User not found.' });
});

// --- SOCKET.IO REAL-TIME ---

io.on('connection', (socket) => {
    socket.on('register-user', (username) => {
        if (users[username]) {
            users[username].online = true;
            socketUserMap[socket.id] = username;
            socket.join(username);
            io.emit('update-user-status');
        }
    });

    socket.on('private-message', (msg) => {
        messages.push(msg);
        io.to(msg.receiver).emit('private-message', msg);
    });

    socket.on('unsend-message', ({ messageId, receiver, sender }) => {
        messages = messages.filter(m => m.id !== messageId);
        io.to(receiver).emit('message-unsent', { messageId });
        io.to(sender).emit('message-unsent', { messageId });
    });

    socket.on('call-user', ({ to, from, offer }) => {
        io.to(to).emit('incoming-call', { from, offer });
    });

    socket.on('make-answer', ({ to, answer }) => {
        io.to(to).emit('call-answered', { answer });
    });

    socket.on('ice-candidate', ({ to, candidate }) => {
        io.to(to).emit('ice-candidate', { candidate });
    });

    socket.on('reject-call', ({ to, from }) => {
        const logMsg = {
            id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            sender: from,
            receiver: to,
            type: 'text',
            content: '📞 Missed video call',
            timestamp: new Date().toISOString()
        };
        messages.push(logMsg);
        io.to(to).emit('private-message', logMsg);
        io.to(from).emit('private-message', logMsg);
        io.to(to).emit('call-rejected');
    });

    socket.on('end-call', ({ to, from }) => {
        const logMsg = {
            id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            sender: from,
            receiver: to,
            type: 'text',
            content: '📞 Video call ended',
            timestamp: new Date().toISOString()
        };
        messages.push(logMsg);
        io.to(to).emit('private-message', logMsg);
        io.to(from).emit('private-message', logMsg);
        io.to(to).emit('end-call');
    });

    socket.on('disconnect', () => {
        const username = socketUserMap[socket.id];
        if (username && users[username]) {
            users[username].online = false;
            delete socketUserMap[socket.id];
            io.emit('update-user-status');
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});