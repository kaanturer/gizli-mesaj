const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const activeRooms = new Map();

// 1. KAMUFLAJLI ANA SAYFA (GİZLİ GEÇİT)
app.get('/', (req, res) => {
    if (req.query.kod === 'kartal') {
        const roomId = uuidv4();
        
        const timeout = setTimeout(() => {
            activeRooms.delete(roomId);
            io.to(roomId).emit('imha-edildi', 'Oda süresi doldu. Link imha edildi.');
            io.in(roomId).socketsLeave(roomId);
        }, 30 * 60 * 1000); // 30 Dakika tolerans

        activeRooms.set(roomId, timeout);
        res.redirect(`/sohbet/${roomId}`);
    } else {
        // Şifreyi bilmeyenlere gösterilecek sahte hata sayfası
        res.status(404).send(`
            <html>
            <body style="background-color: white; color: black; font-family: sans-serif; text-align: center; padding-top: 10%;">
                <h1>404 - Not Found</h1>
                <p>The requested URL was not found on this server.</p>
                <hr style="width: 50%;">
                <p style="font-size: 12px; color: gray;">nginx/1.18.0 (Ubuntu)</p>
            </body>
            </html>
        `);
    }
});

// 2. STATİK DOSYALAR (Tasarımı klasörden oku ama ana sayfaya koyma)
app.use(express.static('public', { index: false }));

// 3. SOHBET ODASI YÖNLENDİRMESİ
app.get('/sohbet/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 4. SOCKET.IO SOHBET BAĞLANTILARI
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

    socket.on('yaziyor', (durum) => {
        if(socket.roomId) socket.to(socket.roomId).emit('karsi-yaziyor', durum);
    });

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

// 5. SUNUCUYU AYAĞA KALDIR
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('Bulut sunucu çalışıyor...');
});
