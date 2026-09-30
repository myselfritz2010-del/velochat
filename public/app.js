// Replace with your actual Render backend URL
const BACKEND_URL = "https://velochat-backend.onrender.com"; 
const socket = io(BACKEND_URL);

// State
let currentUser = null;
let selectedChatUser = null;
let allUsers = [];
let unreadCounts = {};

// Media & Calls
let localStream = null;
let peerConnection = null;
let pendingCall = null;
let mediaRecorder = null;
let audioChunks = [];

const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// DOM Elements
const authScreen = document.getElementById('auth-screen');
const chatDashboard = document.getElementById('chat-dashboard');
const tabLogin = document.getElementById('tab-login');
const tabSignup = document.getElementById('tab-signup');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const authError = document.getElementById('auth-error');

const userList = document.getElementById('user-list');
const searchUserInput = document.getElementById('search-user-input');
const myAvatar = document.getElementById('my-avatar');
const myUsername = document.getElementById('my-username');
const chatWithStatus = document.getElementById('chat-with-status');
const messagesBox = document.getElementById('messages-box');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const fileInput = document.getElementById('file-input');
const micBtn = document.getElementById('mic-btn');
const backToUsersBtn = document.getElementById('back-to-users-btn');

const videoCallBtn = document.getElementById('video-call-btn');
const videoModal = document.getElementById('video-modal');
const remoteVideo = document.getElementById('remote-video');
const localVideo = document.getElementById('local-video');
const endCallBtn = document.getElementById('end-call-btn');

const incomingCallModal = document.getElementById('incoming-call-modal');
const callerName = document.getElementById('caller-name');
const acceptCallBtn = document.getElementById('accept-call-btn');
const rejectCallBtn = document.getElementById('reject-call-btn');

const logoutBtn = document.getElementById('logout-btn');
const deleteAccBtn = document.getElementById('delete-acc-btn');

// --- Helper Functions ---
function generateUniqueId() {
    return 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

function formatTime(dateString) {
    const date = dateString ? new Date(dateString) : new Date();
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Initial View Setup
authScreen.classList.remove('hidden');
chatDashboard.classList.add('hidden');

// --- Auth Tabs Toggle ---
tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabSignup.classList.remove('active');
    loginForm.classList.remove('hidden');
    signupForm.classList.add('hidden');
    authError.textContent = '';
});

tabSignup.addEventListener('click', () => {
    tabSignup.classList.add('active');
    tabLogin.classList.remove('active');
    signupForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    authError.textContent = '';
});

// --- Authentication Actions ---
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    try {
        const res = await fetch(`${BACKEND_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.success) {
            currentUser = data.user;
            showChatView();
        } else {
            authError.textContent = data.message;
        }
    } catch (err) {
        authError.textContent = 'Connection error. Please try again.';
    }
});

signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('signup-username').value.trim();
    const password = document.getElementById('signup-password').value;
    const avatarUrl = document.getElementById('signup-avatar').value.trim();

    try {
        const res = await fetch(`${BACKEND_URL}/api/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, avatarUrl })
        });
        const data = await res.json();
        if (data.success) {
            currentUser = data.user;
            showChatView();
        } else {
            authError.textContent = data.message;
        }
    } catch (err) {
        authError.textContent = 'Connection error. Please try again.';
    }
});

function showChatView() {
    authScreen.classList.add('hidden');
    chatDashboard.classList.remove('hidden');
    myAvatar.src = currentUser.avatar;
    myUsername.textContent = currentUser.username;

    socket.emit('register-user', currentUser.username);
    fetchUsers();
}

logoutBtn.addEventListener('click', () => {
    window.location.reload();
});

deleteAccBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to permanently delete your account?')) {
        try {
            await fetch(`${BACKEND_URL}/api/user/${currentUser.username}`, { method: 'DELETE' });
            window.location.reload();
        } catch (err) {
            alert('Failed to delete account.');
        }
    }
});

backToUsersBtn.addEventListener('click', () => {
    chatDashboard.classList.remove('mobile-chat-active');
});

// --- Sidebar & User List ---
async function fetchUsers() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/users`);
        allUsers = await res.json();
        renderUserList(allUsers);
    } catch (err) {
        console.error('Error fetching users:', err);
    }
}

function renderUserList(users) {
    userList.innerHTML = '';
    users.filter(u => u.username !== currentUser.username).forEach(user => {
        const li = document.createElement('li');
        if (user.username === selectedChatUser) li.classList.add('active-chat');

        const unreadCount = unreadCounts[user.username] || 0;

        li.innerHTML = `
            <div class="user-info">
                <img src="${user.avatar}" class="avatar" alt="${user.username}">
                <span>${user.username}</span>
                <span class="status-dot ${user.online ? 'online' : 'offline'}"></span>
            </div>
            ${unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : ''}
        `;

        li.addEventListener('click', () => {
            selectedChatUser = user.username;
            unreadCounts[user.username] = 0;
            renderUserList(allUsers);

            chatWithStatus.textContent = `Chatting with: ${user.username}`;
            videoCallBtn.classList.remove('hidden');

            chatDashboard.classList.add('mobile-chat-active');
            renderCurrentConversation();
        });

        userList.appendChild(li);
    });
}

searchUserInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allUsers.filter(u => u.username.toLowerCase().includes(term));
    renderUserList(filtered);
});

socket.on('update-user-status', () => {
    fetchUsers();
});

// --- Chat & Messaging ---
async function renderCurrentConversation() {
    if (!selectedChatUser) return;
    messagesBox.innerHTML = '';

    try {
        const res = await fetch(`${BACKEND_URL}/api/messages/${currentUser.username}/${selectedChatUser}`);
        const messages = await res.json();
        messages.forEach(msg => appendMessage(msg));
        messagesBox.scrollTop = messagesBox.scrollHeight;
    } catch (err) {
        console.error('Failed to load messages', err);
    }
}

function resolveMediaUrl(pathUrl) {
    if (pathUrl.startsWith('http')) return pathUrl;
    return `${BACKEND_URL}${pathUrl}`;
}

function appendMessage(msg) {
    const isSelf = msg.sender === currentUser.username;
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('msg', isSelf ? 'right' : 'left');
    msgDiv.setAttribute('data-id', msg.id);

    let contentHTML = `<strong>${msg.sender}</strong>`;
    const fullUrl = resolveMediaUrl(msg.content);

    if (msg.type === 'text') {
        contentHTML += `<span>${msg.content}</span>`;
    } else if (msg.type === 'image') {
        contentHTML += `<img src="${fullUrl}" class="msg-img" alt="Attachment" />`;
    } else if (msg.type === 'audio') {
        contentHTML += `<audio controls src="${fullUrl}"></audio>`;
    } else if (msg.type === 'file') {
        contentHTML += `<a href="${fullUrl}" target="_blank" download class="file-download">📄 Download Attached File</a>`;
    }

    if (isSelf) {
        contentHTML += `<button class="unsend-btn" title="Unsend Message">✕</button>`;
    }

    const timeFormatted = formatTime(msg.timestamp);
    contentHTML += `<span class="msg-time">${timeFormatted}</span>`;

    msgDiv.innerHTML = `<div class="msg-content">${contentHTML}</div>`;

    if (isSelf) {
        const unsendBtn = msgDiv.querySelector('.unsend-btn');
        unsendBtn.addEventListener('click', () => {
            if (confirm('Unsend this message?')) {
                socket.emit('unsend-message', {
                    messageId: msg.id,
                    receiver: msg.receiver,
                    sender: currentUser.username
                });
            }
        });
    }

    messagesBox.appendChild(msgDiv);
    messagesBox.scrollTop = messagesBox.scrollHeight;
}

sendBtn.addEventListener('click', sendTextMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendTextMessage();
});

function sendTextMessage() {
    const text = messageInput.value.trim();
    if (!text || !selectedChatUser) return;

    const messageData = {
        id: generateUniqueId(),
        sender: currentUser.username,
        receiver: selectedChatUser,
        type: 'text',
        content: text,
        timestamp: new Date().toISOString()
    };

    socket.emit('private-message', messageData);
    appendMessage(messageData);
    messageInput.value = '';
}

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !selectedChatUser) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch(`${BACKEND_URL}/api/upload`, { method: 'POST', body: formData });
        const data = await res.json();

        if (data.url) {
            const isImg = file.type.startsWith('image/');
            const messageData = {
                id: generateUniqueId(),
                sender: currentUser.username,
                receiver: selectedChatUser,
                type: isImg ? 'image' : 'file',
                content: data.url,
                timestamp: new Date().toISOString()
            };

            socket.emit('private-message', messageData);
            appendMessage(messageData);
            fileInput.value = '';
        }
    } catch (err) {
        alert('File upload failed.');
    }
});

micBtn.addEventListener('click', async () => {
    if (!selectedChatUser) return;

    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        micBtn.classList.remove('recording');
    } else {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const formData = new FormData();
                formData.append('file', audioBlob, 'voice-note.webm');

                const res = await fetch(`${BACKEND_URL}/api/upload`, { method: 'POST', body: formData });
                const data = await res.json();

                if (data.url) {
                    const messageData = {
                        id: generateUniqueId(),
                        sender: currentUser.username,
                        receiver: selectedChatUser,
                        type: 'audio',
                        content: data.url,
                        timestamp: new Date().toISOString()
                    };

                    socket.emit('private-message', messageData);
                    appendMessage(messageData);
                }
            };

            mediaRecorder.start();
            micBtn.classList.add('recording');
        } catch (err) {
            alert('Could not access microphone.');
        }
    }
});

socket.on('private-message', (msg) => {
    if (selectedChatUser && (msg.sender === selectedChatUser || msg.sender === currentUser.username)) {
        appendMessage(msg);
    } else if (msg.sender !== currentUser.username) {
        unreadCounts[msg.sender] = (unreadCounts[msg.sender] || 0) + 1;
        renderUserList(allUsers);
    }
});

socket.on('message-unsent', ({ messageId }) => {
    const el = document.querySelector(`.msg[data-id="${messageId}"]`);
    if (el) {
        el.remove();
    }
});

// --- WebRTC Video Calling ---
videoCallBtn.addEventListener('click', async () => {
    if (!selectedChatUser) return;
    initiateVideoCall(selectedChatUser);
});

async function initiateVideoCall(targetUser) {
    videoModal.classList.remove('hidden');
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;

    peerConnection = new RTCPeerConnection(rtcConfig);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (e) => {
        remoteVideo.srcObject = e.streams[0];
    };

    peerConnection.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('ice-candidate', { to: targetUser, candidate: e.candidate });
        }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit('call-user', { to: targetUser, from: currentUser.username, offer });
}

socket.on('incoming-call', ({ from, offer }) => {
    pendingCall = { from, offer };
    callerName.textContent = `${from} is calling...`;
    incomingCallModal.classList.remove('hidden');
});

acceptCallBtn.addEventListener('click', async () => {
    incomingCallModal.classList.add('hidden');
    videoModal.classList.remove('hidden');

    const { from, offer } = pendingCall;
    selectedChatUser = from;

    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;

    peerConnection = new RTCPeerConnection(rtcConfig);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (e) => {
        remoteVideo.srcObject = e.streams[0];
    };

    peerConnection.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('ice-candidate', { to: from, candidate: e.candidate });
        }
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('make-answer', { to: from, answer });
});

rejectCallBtn.addEventListener('click', () => {
    incomingCallModal.classList.add('hidden');
    socket.emit('reject-call', { to: pendingCall.from, from: currentUser.username });
    pendingCall = null;
});

socket.on('call-answered', async ({ answer }) => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('ice-candidate', async ({ candidate }) => {
    if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

socket.on('call-rejected', () => {
    alert('Call was rejected.');
    endCall();
});

socket.on('end-call', () => {
    endCall();
});

endCallBtn.addEventListener('click', () => {
    if (selectedChatUser) {
        socket.emit('end-call', { to: selectedChatUser, from: currentUser.username });
    }
    endCall();
});

function endCall() {
    videoModal.classList.add('hidden');
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
}