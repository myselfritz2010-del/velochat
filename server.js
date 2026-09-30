const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Enable CORS for cross-origin Netlify requests
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE']
}));

app.use(express.json());

// Serve static upload directory
const uploadDir = path.join(__dirname, 'public', 'upload');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/upload', express.static(uploadDir));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// In-Memory Data Stores (or read/write from local json)
let users = [];
let messages = [];
let onlineUsers = {};

// REST API Endpoints
app.post('/api/signup', (req, res) => {
    const { username, password, avatarUrl } = req.body;
    if (!username || !password) {
        return res.json({ success: false, message: 'Username and password required.' });
    }
    const exists = users.find(u => u.username === username);
    if (exists) {
        return res.json({ success: false, message: 'Username already taken.' });
    }
    const newUser = {
        username,
        password,
        avatar: avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`,
        online: false
    };
    users.push(newUser);
    return res.json({ success: true, user: newUser });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) {
        return res.json({ success: false, message: 'Invalid credentials.' });
    }
    return res.json({ success: true, user });
});

app.get('/api/users', (req, res) => {
    const sanitizedUsers = users.map(u => ({
        username: u.username,
        avatar: u.avatar,
        online: !!onlineUsers[u.username]
    }));
    res.json(sanitizedUsers);
});

app.get('/api/messages/:user1/:user2', (req, res) => {
    const { user1, user2 } = req.params;
    const conversation = messages.filter(
        m => (m.sender === user1 && m.receiver === user2) || (m.sender === user2 && m.receiver === user1)
    );
    res.json(conversation);
});

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const fileUrl = `/upload/${req.file.filename}`;
    res.json({ url: fileUrl });
});

app.delete('/api/user/:username', (req, res) => {
    const { username } = req.params;
    users = users.filter(u => u.username !== username);
    messages = messages.filter(m => m.sender !== username && m.receiver !== username);
    delete onlineUsers[username];
    res.json({ success: true });
});

// Real-time Socket.io signaling
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

io.on('connection', (socket) => {
    socket.on('register-user', (username) => {
        onlineUsers[username] = socket.id;
        socket.username = username;
        io.emit('update-user-status');
    });

    socket.on('private-message', (data) => {
        messages.push(data);
        const recipientSocketId = onlineUsers[data.receiver];
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('private-message', data);
        }
    });

    socket.on('unsend-message', ({ messageId, receiver, sender }) => {
        messages = messages.filter(m => m.id !== messageId);
        const recipientSocketId = onlineUsers[receiver];
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('message-unsent', { messageId });
        }
    });

    // WebRTC Signaling
    socket.on('call-user', ({ to, from, offer }) => {
        const recipientSocketId = onlineUsers[to];
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('incoming-call', { from, offer });
        }
    });

    socket.on('make-answer', ({ to, answer }) => {
        const recipientSocketId = onlineUsers[to];
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('call-answered', { answer });
        }
    });

    socket.on('ice-candidate', ({ to, candidate }) => {
        const recipientSocketId = onlineUsers[to];
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('ice-candidate', { candidate });
        }
    });

    socket.on('reject-call', ({ to, from }) => {
        const recipientSocketId = onlineUsers[to];
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('call-rejected');
        }
    });

    socket.on('end-call', ({ to }) => {
        const recipientSocketId = onlineUsers[to];
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('end-call');
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            delete onlineUsers[socket.username];
            io.emit('update-user-status');
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});