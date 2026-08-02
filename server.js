const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const activeRooms = new Map();

app.get('/yeni-sohbet', (req, res) => {
    const roomId = uuidv4();
    
    const timeout = setTimeout(() => {
        activeRooms.delete(roomId);
        io.to(roomId).emit('imha-edildi', '3 dakika içinde katılım olmadı. Link imha edildi.');
        io.in(roomId).socketsLeave(roomId);
    }, 3 * 60 * 1000); 

    activeRooms.set(roomId, timeout);
    res.redirect(`/sohbet/${roomId}`);
});

app.get('/sohbet/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
    
    socket.on('odaya-katil', (roomId) => {
        const room = io.sockets.adapter.rooms.get(roomId);
        const userCount = room ? room.size : 0;

        if (userCount === 0 && !activeRooms.has(roomId)) {
             socket.emit('imha-edildi', 'Bu linkin süresi dolmuş veya imha edilmiş.');
             return;
        }

        if (userCount === 0) {
            socket.join(roomId);
            socket.roomId = roomId;
            socket.emit('katilim-durumu', { basarili: true, mesaj: 'Bekleniyor...' });
        } else if (userCount === 1) {
            socket.join(roomId);
            socket.roomId = roomId;
            
            clearTimeout(activeRooms.get(roomId));
            activeRooms.delete(roomId);

            io.to(roomId).emit('sohbet-basladi');
        } else {
            socket.emit('imha-edildi', 'Oda dolu veya kilitli.');
        }
    });

    socket.on('mesaj-gonder', (mesaj) => {
        if(socket.roomId) socket.to(socket.roomId).emit('mesaj-al', mesaj);
    });

    // YENİ: Yazıyor... Bildirimi
    socket.on('yaziyor', (durum) => {
        if(socket.roomId) socket.to(socket.roomId).emit('karsi-yaziyor', durum);
    });

    // YENİ: Durum Bildirimi (Sekmede mi değil mi?)
    socket.on('durum-degisti', (durum) => {
        if(socket.roomId) socket.to(socket.roomId).emit('karsi-durum', durum);
    });

    socket.on('disconnect', () => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('imha-edildi', 'Karşı taraf ayrıldı. Güvenlik gereği sohbet imha edildi.');
            io.in(socket.roomId).socketsLeave(socket.roomId);
            activeRooms.delete(socket.roomId);
        }
    });
});

server.listen(3000, () => {
    console.log('Güvenli sunucu 3000 portunda çalışıyor...');
});