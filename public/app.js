// REPLACE WITH YOUR EXACT RENDER BACKEND URL
const BACKEND_URL = "https://velochat-backend.onrender.com"; 

const socket = io(BACKEND_URL);

// State Management
let currentUser = null;
let selectedChatUser = null;
let allUsers = [];
let unreadCounts = {};

// Media & Call Variables
let localStream = null;
let peerConnection = null;
let pendingCall = null;
let mediaRecorder = null;
let audioChunks = [];

const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// DOM Elements Initialization
let authScreen, chatDashboard, tabLogin, tabSignup, loginForm, signupForm, authError;
let userList, searchUserInput, myAvatar, myUsername, chatWithStatus, messagesBox;
let messageInput, sendBtn, fileInput, micBtn, backToUsersBtn;
let videoCallBtn, videoModal, remoteVideo, localVideo, endCallBtn;
let incomingCallModal, callerName, acceptCallBtn, rejectCallBtn, logoutBtn, deleteAccBtn;

document.addEventListener('DOMContentLoaded', () => {
    authScreen = document.getElementById('auth-screen');
    chatDashboard = document.getElementById('chat-dashboard');
    tabLogin = document.getElementById('tab-login');
    tabSignup = document.getElementById('tab-signup');
    loginForm = document.getElementById('login-form');
    signupForm = document.getElementById('signup-form');
    authError = document.getElementById('auth-error');

    userList = document.getElementById('user-list');
    searchUserInput = document.getElementById('search-user-input');
    myAvatar = document.getElementById('my-avatar');
    myUsername = document.getElementById('my-username');
    chatWithStatus = document.getElementById('chat-with-status');
    messagesBox = document.getElementById('messages-box');
    messageInput = document.getElementById('message-input');
    sendBtn = document.getElementById('send-btn');
    fileInput = document.getElementById('file-input');
    micBtn = document.getElementById('mic-btn');
    backToUsersBtn = document.getElementById('back-to-users-btn');

    videoCallBtn = document.getElementById('video-call-btn');
    videoModal = document.getElementById('video-modal');
    remoteVideo = document.getElementById('remote-video');
    localVideo = document.getElementById('local-video');
    endCallBtn = document.getElementById('end-call-btn');

    incomingCallModal = document.getElementById('incoming-call-modal');
    callerName = document.getElementById('caller-name');
    acceptCallBtn = document.getElementById('accept-call-btn');
    rejectCallBtn = document.getElementById('reject-call-btn');

    logoutBtn = document.getElementById('logout-btn');
    deleteAccBtn = document.getElementById('delete-acc-btn');

    // Tab Toggle Events
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

    // Form Event Listeners
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
            authError.textContent = 'Connection error. Please check Render status.';
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
            authError.textContent = 'Connection error. Please check Render status.';
        }
    });

    logoutBtn.addEventListener('click', () => window.location.reload());

    deleteAccBtn.addEventListener('click', async () => {
        if (confirm('Permanently delete your account?')) {
            try {
                await fetch(`${BACKEND_URL}/api/user/${currentUser.username}`, { method: 'DELETE' });
                window.location.reload();
            } catch (err) {
                alert('Deletion failed.');
            }
        }
    });

    backToUsersBtn.addEventListener('click', () => {
        chatDashboard.classList.remove('mobile-chat-active');
    });

    sendBtn.addEventListener('click', sendTextMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendTextMessage();
    });

    searchUserInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allUsers.filter(u => u.username.toLowerCase().includes(term));
        renderUserList(filtered);
    });

    fileInput.addEventListener('change', handleFileUpload);
    micBtn.addEventListener('click', toggleAudioRecording);

    videoCallBtn.addEventListener('click', () => {
        if (selectedChatUser) initiateVideoCall(selectedChatUser);
    });

    acceptCallBtn.addEventListener('click', acceptCall);
    rejectCallBtn.addEventListener('click', rejectCall);
    endCallBtn.addEventListener('click', triggerEndCall);
});

// Helpers
function generateUniqueId() {
    return 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

function formatTime(dateString) {
    const date = dateString ? new Date(dateString) : new Date();
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function resolveMediaUrl(pathUrl) {
    if (pathUrl.startsWith('http')) return pathUrl;
    return `${BACKEND_URL}${pathUrl}`;
}

function showChatView() {
    authScreen.classList.add('hidden');
    chatDashboard.classList.remove('hidden');
    myAvatar.src = currentUser.avatar;
    myUsername.textContent = currentUser.username;

    socket.emit('register-user', currentUser.username);
    fetchUsers();
}

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
        contentHTML += `<a href="${fullUrl}" target="_blank" download class="file-download">📄 Attached File</a>`;
    }

    if (isSelf) {
        contentHTML += `<button class="unsend-btn" title="Unsend">✕</button>`;
    }

    contentHTML += `<span class="msg-time">${formatTime(msg.timestamp)}</span>`;
    msgDiv.innerHTML = `<div class="msg-content">${contentHTML}</div>`;

    if (isSelf) {
        const unsendBtn = msgDiv.querySelector('.unsend-btn');
        unsendBtn.addEventListener('click', () => {
            if (confirm('Unsend message?')) {
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

async function handleFileUpload(e) {
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
}

async function toggleAudioRecording() {
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
}

// Socket Listeners
socket.on('update-user-status', fetchUsers);

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
    if (el) el.remove();
});

// WebRTC Handlers
async function initiateVideoCall(targetUser) {
    videoModal.classList.remove('hidden');
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;

    peerConnection = new RTCPeerConnection(rtcConfig);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = e => { remoteVideo.srcObject = e.streams[0]; };
    peerConnection.onicecandidate = e => {
        if (e.candidate) socket.emit('ice-candidate', { to: targetUser, candidate: e.candidate });
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

async function acceptCall() {
    incomingCallModal.classList.add('hidden');
    videoModal.classList.remove('hidden');

    const { from, offer } = pendingCall;
    selectedChatUser = from;

    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;

    peerConnection = new RTCPeerConnection(rtcConfig);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = e => { remoteVideo.srcObject = e.streams[0]; };
    peerConnection.onicecandidate = e => {
        if (e.candidate) socket.emit('ice-candidate', { to: from, candidate: e.candidate });
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('make-answer', { to: from, answer });
}

function rejectCall() {
    incomingCallModal.classList.add('hidden');
    socket.emit('reject-call', { to: pendingCall.from });
    pendingCall = null;
}

function triggerEndCall() {
    if (selectedChatUser) socket.emit('end-call', { to: selectedChatUser });
    endCall();
}

socket.on('call-answered', async ({ answer }) => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('ice-candidate', async ({ candidate }) => {
    if (peerConnection) await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
});

socket.on('call-rejected', () => {
    alert('Call rejected.');
    endCall();
});

socket.on('end-call', endCall);

function endCall() {
    videoModal.classList.add('hidden');
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
}