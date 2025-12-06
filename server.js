const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" }
});

// ВАЖНО ДЛЯ RENDER: Используем порт от хостинга или 3000 локально
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' })); // Лимит для голосовых
app.use(express.static(path.join(__dirname, 'public')));

// --- ХРАНИЛИЩЕ ДАННЫХ (В ПАМЯТИ) ---
// Внимание: При перезагрузке сервера (Deploy) данные стираются
const users = [];
const messages = [];

// --- API ROUTES ---

// Регистрация
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) return res.status(400).json({ error: 'Заполните все поля' });
        
        // Проверка на дубликаты
        const existing = users.find(u => u.username === username);
        if (existing) return res.status(400).json({ error: 'Пользователь уже существует' });

        const hashedPassword = await bcrypt.hash(password, 10);
        
        users.push({ 
            id: Date.now().toString(), 
            username, 
            email, 
            password: hashedPassword 
        });
        
        console.log(`✅ Новый пользователь: ${username}`);
        res.status(201).json({ message: 'OK' });
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: 'Ошибка сервера' }); 
    }
});

// Вход
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = users.find(u => u.username === username);
        
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ error: 'Неверный логин или пароль' });
        }
        res.json({ username: user.username });
    } catch (e) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

// Поиск пользователей (ОБНОВЛЕНО)
app.get('/api/users', (req, res) => {
    const query = req.query.q ? req.query.q.toLowerCase() : '';
    
    // Если поиск пустой — возвращаем пустой список (чтобы скрыть всех пользователей)
    if (!query) {
        return res.json([]); 
    }

    // Ищем совпадения по имени
    const filteredUsers = users
        .filter(u => u.username.toLowerCase().includes(query))
        .map(u => ({ username: u.username })); // Отправляем только имена, без паролей
        
    res.json(filteredUsers);
});

// История сообщений
app.get('/api/messages/:user1/:user2', (req, res) => {
    const { user1, user2 } = req.params;
    const history = messages.filter(msg => 
        (msg.sender === user1 && msg.receiver === user2) ||
        (msg.sender === user2 && msg.receiver === user1)
    );
    res.json(history);
});

// --- SOCKET.IO (REAL-TIME) ---
let onlineUsers = {}; // { username: socketId }

io.on('connection', (socket) => {
    // 1. Вход в сеть
    socket.on('join', (username) => {
        onlineUsers[username] = socket.id;
        socket.username = username;
        console.log(`🟢 Online: ${username}`);
    });

    // 2. Личные сообщения
    socket.on('private_message', (data) => {
        const { sender, receiver, content, type } = data;
        const msg = { sender, receiver, content, type, timestamp: new Date() };
        
        // Сохраняем в память
        messages.push(msg);

        // Отправляем получателю
        const receiverSocketId = onlineUsers[receiver];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('receive_message', msg);
        }
        
        // Отправляем подтверждение отправителю
        socket.emit('message_sent', msg);
    });

    // 3. Звонки (WebRTC Signaling)
    socket.on('call_user', (data) => {
        const receiverSocketId = onlineUsers[data.userToCall];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('call_incoming', { 
                signal: data.signalData, 
                from: data.from 
            });
        }
    });

    socket.on('answer_call', (data) => {
        const callerSocketId = onlineUsers[data.to];
        if (callerSocketId) {
            io.to(callerSocketId).emit('call_accepted', data.signal);
        }
    });

    socket.on('ice_candidate', (data) => {
        const targetSocketId = onlineUsers[data.to];
        if (targetSocketId) {
            io.to(targetSocketId).emit('ice_candidate_received', data.candidate);
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            delete onlineUsers[socket.username];
        }
    });
});

server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
