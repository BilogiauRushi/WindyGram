const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" } // Разрешаем доступ с любых источников для теста
});

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- ХРАНИЛИЩЕ ДАННЫХ (В ПАМЯТИ) ---
// При перезапуске сервера данные сбрасываются!
const users = [];
const messages = [];

// --- API ROUTES ---
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) return res.status(400).json({ error: 'Заполните все поля' });
        
        const existing = users.find(u => u.username === username);
        if (existing) return res.status(400).json({ error: 'Пользователь занят' });

        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ id: Date.now().toString(), username, email, password: hashedPassword });
        
        console.log(`✅ Пользователь зарегистрирован: ${username}`);
        res.status(201).json({ message: 'OK' });
    } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = users.find(u => u.username === username);
        
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ error: 'Неверный логин или пароль' });
        }
        res.json({ username: user.username });
    } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/users', (req, res) => {
    // Возвращаем всех кроме себя (фильтрация будет на клиенте для простоты)
    res.json(users.map(u => ({ username: u.username })));
});

app.get('/api/messages/:user1/:user2', (req, res) => {
    const { user1, user2 } = req.params;
    const history = messages.filter(msg => 
        (msg.sender === user1 && msg.receiver === user2) ||
        (msg.sender === user2 && msg.receiver === user1)
    );
    res.json(history);
});

// --- SOCKET.IO ---
let onlineUsers = {}; // { username: socketId }

io.on('connection', (socket) => {
    // 1. Обработка входа пользователя в сеть
    socket.on('join', (username) => {
        onlineUsers[username] = socket.id;
        socket.username = username;
        console.log(`🟢 ${username} подключился (ID: ${socket.id})`);
        io.emit('user_status', { username, status: 'online' });
    });

    // 2. Личные сообщения
    socket.on('private_message', (data) => {
        const { sender, receiver, content, type } = data;
        const msg = { sender, receiver, content, type, timestamp: new Date() };
        messages.push(msg);

        // Отправляем получателю
        const receiverSocketId = onlineUsers[receiver];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('receive_message', msg);
        }
        // Отправляем себе обратно (чтобы убедиться, что сервер принял)
        socket.emit('message_sent', msg);
    });

    // 3. Звонки (WebRTC Signaling)
    socket.on('call_user', (data) => {
        const receiverSocketId = onlineUsers[data.userToCall];
        if (receiverSocketId) {
            console.log(`📞 Звонок от ${data.from} к ${data.userToCall}`);
            io.to(receiverSocketId).emit('call_incoming', { 
                signal: data.signalData, 
                from: data.from 
            });
        } else {
            console.log(`🚫 Не удалось дозвониться: ${data.userToCall} не в сети`);
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
            console.log(`🔴 ${socket.username} отключился`);
        }
    });
});

server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));