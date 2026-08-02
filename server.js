const express = require('express');
const http = require('http'); 
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.set('trust proxy', true);

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e6 });

const activeRooms = new Map();

// 🚨 YENİ: ORTAK TEHDİT RAPORLAMA MERKEZİ (Hem URL hem Socket için)
function tehditRaporla(istek, ioInstance, isSocket = false) {
    let ip, userAgent;

    if (isSocket) {
        // Arka kapıdan (sahte/ölü link ile) girmeye çalışanlar
        ip = istek.handshake.headers['x-forwarded-for'] || istek.handshake.address || 'Bilinmiyor';
        userAgent = istek.handshake.headers['user-agent'] || 'Bilinmeyen Cihaz';
    } else {
        // Ana kapıdan (şifresiz ana link ile) girmeye çalışanlar
        ip = istek.ip || istek.headers['x-forwarded-for'] || istek.socket.remoteAddress || 'Bilinmiyor';
        userAgent = istek.headers['user-agent'] || 'Bilinmeyen Cihaz';
    }

    const temizIp = ip.split(',')[0].trim();

    // Arka planda sessizce konumu çöz
    http.get(`http://ip-api.com/json/${temizIp}`, (apiRes) => {
        let data = '';
        apiRes.on('data', (chunk) => data += chunk);
        apiRes.on('end', () => {
            try {
                const veri = JSON.parse(data);
                const konum = veri.status === 'success' ? `${veri.city}, ${veri.country}` : 'Tespit Edilemedi';
                const isp = veri.status === 'success' ? veri.isp : 'Bilinmiyor';
                // Sen içerideyken ekranına kırmızı şeritle bu bilgiyi fırlat
                ioInstance.emit('tehdit-algilandi', { ip: temizIp, konum: konum, isp: isp, cihaz: userAgent });
            } catch (e) {
                ioInstance.emit('tehdit-algilandi', { ip: temizIp, konum: 'Hata', isp: 'Hata', cihaz: userAgent });
            }
        });
    }).on('error', () => {
        ioInstance.emit('tehdit-algilandi', { ip: temizIp, konum: 'Bağlantı Hatası', isp: 'Hata', cihaz: userAgent });
    });
}

// 1. ANA KAPI (Şifresiz girenleri avla)
app.get('/', (req, res) => {
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
        // RADAR TETİKLENSİN
        tehditRaporla(req, io, false);
        
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

// 2. ARKA KAPI (Odalara sızmaya çalışanları avla)
io.on('connection', (socket) => {
    socket.on('odaya-katil', (roomId) => {
        const room = io.sockets.adapter.rooms.get(roomId);
        const userCount = room ? room.size : 0;

        if (userCount === 0 && !activeRooms.has(roomId)) {
             socket.emit('imha-edildi', 'Bu linkin süresi dolmuş veya imha edilmiş.');
             // RADAR TETİKLENSİN (Ölü/Sahte Link İhlali)
             tehditRaporla(socket, io, true);
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
            // RADAR TETİKLENSİN (Dolu Odaya Sızma İhlali)
            tehditRaporla(socket, io, true);
        }
    });

    socket.on('mesaj-gonder', (mesaj) => { if(socket.roomId) socket.to(socket.roomId).emit('mesaj-al', mesaj); });
    socket.on('medya-gonder', (medya) => { if(socket.roomId) socket.to(socket.roomId).emit('medya-al', medya); });
    socket.on('yaziyor', (durum) => { if(socket.roomId) socket.to(socket.roomId).emit('karsi-yaziyor', durum); });
    socket.on('durum-degisti', (durum) => { if(socket.roomId) socket.to(socket.roomId).emit('karsi-durum', durum); });

    socket.on('disconnect', () => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('imha-edildi', 'Karşı taraf ayrıldı. Güvenlik gereği sohbet imha edildi.');
            io.in(socket.roomId).socketsLeave(socket.roomId);
            activeRooms.delete(socket.roomId);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Bulut sunucu çalışıyor...'));
