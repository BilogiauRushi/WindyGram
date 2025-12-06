document.addEventListener('DOMContentLoaded', () => {
    console.log("Client JS Loaded");

    // --- ПЕРЕМЕННЫЕ ---
    const socket = io();
    let currentUser = null;
    let currentChatUser = null;
    let isRegistering = false;
    
    // Переменные для звонков и записи
    let mediaRecorder;
    let audioChunks = [];
    let localStream;
    let peerConnection;
    const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

    // --- ЭЛЕМЕНТЫ DOM ---
    const authScreen = document.getElementById('auth-screen');
    const appContainer = document.getElementById('app-container');
    const authTitle = document.getElementById('auth-title');
    const authBtn = document.getElementById('auth-btn');
    const toggleAuthLink = document.getElementById('toggle-auth');
    const emailInput = document.getElementById('email-input');
    const usernameInput = document.getElementById('username-input');
    const passwordInput = document.getElementById('password-input');
    
    // --- ИНИЦИАЛИЗАЦИЯ ---
    
    // Проверка сохраненной сессии
    const savedUser = localStorage.getItem('windy_user');
    if (savedUser) {
        // Если сервер перезагрузился, пользователи стерлись из памяти.
        // Поэтому просто "верим" локальному хранилищу, но сервер может не найти юзера.
        // Для прототипа: просто заходим.
        currentUser = savedUser;
        initApp();
    }

    // --- СОБЫТИЯ UI (КНОПКИ) ---

    // 1. Кнопка Войти / Регистрация
    authBtn.addEventListener('click', async () => {
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        const email = emailInput.value.trim();

        if (!username || !password) return alert("Введите логин и пароль");
        if (isRegistering && !email) return alert("Введите email");

        const endpoint = isRegistering ? '/api/register' : '/api/login';
        const body = isRegistering ? { username, password, email } : { username, password };

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();

            if (res.ok) {
                if (isRegistering) {
                    alert('Регистрация успешна! Теперь войдите.');
                    toggleAuthMode();
                } else {
                    currentUser = data.username;
                    localStorage.setItem('windy_user', currentUser);
                    initApp();
                }
            } else {
                alert(data.error || "Ошибка");
            }
        } catch (e) {
            console.error(e);
            alert("Ошибка соединения с сервером");
        }
    });

    // 2. Переключатель "Регистрация / Вход"
    toggleAuthLink.addEventListener('click', toggleAuthMode);

    function toggleAuthMode() {
        isRegistering = !isRegistering;
        authTitle.innerText = isRegistering ? "Регистрация" : "Вход";
        authBtn.innerText = isRegistering ? "Зарегистрироваться" : "Войти";
        toggleAuthLink.innerText = isRegistering ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Зарегистрироваться";
        emailInput.style.display = isRegistering ? 'block' : 'none';
    }

    // 3. Выход из аккаунта
    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('windy_user');
        location.reload();
    });

    // 4. Отправка сообщения
    document.getElementById('send-btn').addEventListener('click', sendTextMessage);
    
    // 5. Поиск
    document.getElementById('search-input').addEventListener('input', (e) => loadUsers(e.target.value));

    // 6. Микрофон (Запись голоса)
    const micBtn = document.getElementById('mic-btn');
    micBtn.addEventListener('mousedown', startRecording);
    micBtn.addEventListener('mouseup', stopRecording);
    // Для мобильных
    micBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); });
    micBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopRecording(); });

    // 7. Кнопки звонка
    document.getElementById('call-audio-btn').addEventListener('click', () => startCall(false));
    document.getElementById('call-video-btn').addEventListener('click', () => startCall(true));
    document.getElementById('hangup-btn').addEventListener('click', endCall);


    // --- ЛОГИКА ПРИЛОЖЕНИЯ ---

    function initApp() {
        authScreen.style.display = 'none';
        appContainer.style.display = 'flex';
        document.getElementById('current-username-display').innerText = currentUser;
        
        socket.emit('join', currentUser);
        loadUsers();
        setInterval(() => loadUsers(document.getElementById('search-input').value), 3000);
    }

    async function loadUsers(query = '') {
        try {
            const res = await fetch('/api/users');
            let users = await res.json();
            
            // Фильтрация на клиенте (просто для прототипа)
            if (query) {
                users = users.filter(u => u.username.toLowerCase().includes(query.toLowerCase()));
            }

            const list = document.getElementById('chat-list');
            list.innerHTML = '';
            
            users.forEach(user => {
                if (user.username === currentUser) return;
                const div = document.createElement('div');
                div.className = 'chat-item';
                div.innerHTML = `<div class="avatar"></div><div class="chat-name">${user.username}</div>`;
                div.addEventListener('click', () => openChat(user.username));
                list.appendChild(div);
            });
        } catch(e) { console.log("Ошибка загрузки пользователей"); }
    }

    async function openChat(username) {
        currentChatUser = username;
        document.getElementById('chat-header').style.display = 'flex';
        document.getElementById('input-area').style.display = 'flex';
        document.getElementById('chat-with-name').innerText = username;
        document.getElementById('messages-area').innerHTML = '';

        try {
            const res = await fetch(`/api/messages/${currentUser}/${currentChatUser}`);
            const messages = await res.json();
            messages.forEach(appendMessage);
        } catch(e) {}
    }

    function appendMessage(msg) {
        const area = document.getElementById('messages-area');
        const div = document.createElement('div');
        const isMine = msg.sender === currentUser;
        div.className = `message ${isMine ? 'sent' : 'received'}`;

        if (msg.type === 'audio') {
            const audio = document.createElement('audio');
            audio.controls = true;
            audio.src = msg.content;
            div.appendChild(audio);
        } else {
            div.innerText = msg.content;
        }
        area.appendChild(div);
        area.scrollTop = area.scrollHeight;
    }

    function sendTextMessage() {
        const input = document.getElementById('message-input');
        const text = input.value;
        if (!text) return;

        socket.emit('private_message', {
            sender: currentUser,
            receiver: currentChatUser,
            content: text,
            type: 'text'
        });
        input.value = '';
    }

    // --- SOCKET IO HANDLERS ---
    socket.on('connect', () => {
        if (currentUser) socket.emit('join', currentUser);
    });

    socket.on('receive_message', (msg) => {
        if (msg.sender === currentChatUser || msg.sender === currentUser) {
            appendMessage(msg);
        }
    });

    socket.on('message_sent', (msg) => {
        if (msg.sender === currentUser && msg.receiver === currentChatUser) {
            appendMessage(msg);
        }
    });

    // --- ГОЛОСОВЫЕ ---
    async function startRecording() {
        if (!navigator.mediaDevices) return alert("Нет доступа к микрофону");
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            
            mediaRecorder.ondataavailable = e => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };
            
            mediaRecorder.onstop = () => {
                const blob = new Blob(audioChunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                reader.onloadend = () => {
                    socket.emit('private_message', {
                        sender: currentUser,
                        receiver: currentChatUser,
                        content: reader.result,
                        type: 'audio'
                    });
                };
                stream.getTracks().forEach(t => t.stop());
            };
            
            mediaRecorder.start();
            micBtn.style.color = 'red';
        } catch (e) {
            console.error(e);
            alert("Ошибка микрофона");
        }
    }

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            document.getElementById('mic-btn').style.color = 'white';
        }
    }

    // --- ЗВОНКИ ---
    async function startCall(videoEnabled) {
        if (!currentChatUser) return;
        document.getElementById('call-modal').classList.remove('hidden');

        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: videoEnabled, audio: true });
            document.getElementById('local-video').srcObject = localStream;

            peerConnection = createPeerConnection(currentChatUser);
            localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            socket.emit('call_user', { 
                userToCall: currentChatUser, 
                signalData: offer, 
                from: currentUser 
            });
        } catch(e) {
            console.error(e);
            alert("Ошибка доступа к устройствам");
            endCall();
        }
    }

    function createPeerConnection(targetUser) {
        const pc = new RTCPeerConnection(rtcConfig);
        
        pc.onicecandidate = e => {
            if (e.candidate) socket.emit('ice_candidate', { to: targetUser, candidate: e.candidate });
        };
        
        pc.ontrack = e => {
            document.getElementById('remote-video').srcObject = e.streams[0];
        };
        return pc;
    }

    socket.on('call_incoming', async (data) => {
        const accept = confirm(`Звонок от ${data.from}. Ответить?`);
        if (accept) {
            document.getElementById('call-modal').classList.remove('hidden');
            currentChatUser = data.from; // Переключаемся на звонящего
            
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                document.getElementById('local-video').srcObject = localStream;

                peerConnection = createPeerConnection(data.from);
                localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

                await peerConnection.setRemoteDescription(data.signal);
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);

                socket.emit('answer_call', { signal: answer, to: data.from });
            } catch(e) { console.error(e); }
        }
    });

    socket.on('call_accepted', async (signal) => {
        if(peerConnection) await peerConnection.setRemoteDescription(signal);
    });

    socket.on('ice_candidate_received', async (candidate) => {
        if(peerConnection) await peerConnection.addIceCandidate(candidate);
    });

    function endCall() {
        document.getElementById('call-modal').classList.add('hidden');
        if (localStream) localStream.getTracks().forEach(t => t.stop());
        if (peerConnection) peerConnection.close();
    }
});