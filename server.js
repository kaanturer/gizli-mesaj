const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    maxHttpBufferSize: 5e6 
});

const activeRooms = new Map();

app.get('/', async (req, res) => {
    if (req.query.kod === 'kartal') {
        const roomId = uuidv4();
        
        const timeout = setTimeout(() => {
            activeRooms.delete(roomId);
            io.to(roomId).emit('imha-edildi', 'Oda süresi doldu. Link imha edildi.');
            io.in(roomId).socketsLeave(roomId);
        }, 30 * 60 * 1000); 

        activeRooms.set(roomId, timeout);
        res.redirect(`/sohbet/${roomId}`);
    } else {
        // YENİ: SESSİZ KONUM VE IP TESPİTİ
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Bilinmiyor';
        const temizIp = ip.split(',')[0].trim();
        const userAgent = req.headers['user-agent'] || 'Bilinmeyen Cihaz';
        
        try {
            // Şüpheliye hiçbir şey belli etmeden IP adresini küresel haritada tara
            const apiYanit = await fetch(`http://ip-api.com/json/${temizIp}`);
            const veri = await apiYanit.json();
            
            const konumBilgisi = veri.status === 'success' ? `${veri.city}, ${veri.country}` : 'Tespit Edilemedi';
            const saglayici = veri.status === 'success' ? veri.isp : 'Bilinmiyor';

            // Sonuçları içerideki gizli odaya raporla
            io.emit('tehdit-algilandi', { 
                ip: temizIp, 
                konum: konumBilgisi,
                isp: saglayici,
                cihaz: userAgent 
            });
        } catch (error) {
            // Eğer harita servisi yanıt vermezse sadece IP'yi yolla
            io.emit('tehdit-algilandi', { ip: temizIp, konum: 'Bilinmiyor', isp: 'Bilinmiyor', cihaz: userAgent });
        }

        // Şüpheliye sahte 404 hatasını gösterip uyutmaya devam et
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

app.use(express.static('public', { index: false }));

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

    socket.on('medya-gonder', (medya) => {
        if(socket.roomId) socket.to(socket.roomId).emit('medya-al', medya);
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('Bulut sunucu çalışıyor...');
});
