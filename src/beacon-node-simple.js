import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { create } from 'ipfs-http-client';

class SimpleBeaconNode {
    constructor(config = {}) {
        this.config = {
            port: config.port || 3000,
            ipfsEndpoint: config.ipfsEndpoint || 'http://localhost:5001',
            ...config
        };
        
        this.agents = new Map(); // agentId -> agentData
        this.app = express();
        this.wss = null;
        this.ipfs = null;
        this.nodeId = uuidv4();
    }

    async start() {
        console.log('🚀 Starting Simple Beacon Node...');
        console.log(`Node ID: ${this.nodeId}`);
        
        try {
            // Initialize IPFS client
            await this.initIPFS();
            
            // Setup HTTP API
            this.setupAPI();
            
            // Start the server
            this.server = this.app.listen(this.config.port, () => {
                console.log(`📡 Beacon Node running on port ${this.config.port}`);
                console.log(`🔗 IPFS connected to ${this.config.ipfsEndpoint}`);
                console.log(`🌐 Web Dashboard: http://localhost:${this.config.port}`);
                
                // Setup WebSocket for real-time updates after server is created
                this.setupWebSocket();
            });
            
            console.log('✅ Beacon Node started successfully!');
            
        } catch (error) {
            console.error('❌ Failed to start Beacon Node:', error);
            throw error;
        }
    }

    async initIPFS() {
        try {
            this.ipfs = create({ url: this.config.ipfsEndpoint });
            const version = await this.ipfs.version();
            console.log(`📦 IPFS version: ${version.version}`);
        } catch (error) {
            console.warn('⚠️  Could not connect to IPFS, running in local mode');
            console.warn('   To enable IPFS storage, start an IPFS daemon and set --ipfs-endpoint');
            this.ipfs = null;
        }
    }

    setupAPI() {
        this.app.use(cors());
        this.app.use(express.json());
        // Serve home.html as the root
        this.app.get('/', (req, res) => {
            res.sendFile(process.cwd() + '/public/home.html');
        });
        // Serve dashboard at /dashboard
        this.app.get('/dashboard', (req, res) => {
            res.sendFile(process.cwd() + '/public/index.html');
        });
        this.app.use(express.static('public'));

        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                nodeId: this.nodeId,
                agentCount: this.agents.size,
                uptime: process.uptime()
            });
        });

        // Register an agent
        this.app.post('/register', async (req, res) => {
            try {
                const agentData = req.body;
                const agentId = await this.registerAgent(agentData);
                res.json({ success: true, agentId, message: 'Agent registered successfully' });
            } catch (error) {
                res.status(400).json({ success: false, error: error.message });
            }
        });

        // Unregister an agent
        this.app.post('/unregister', async (req, res) => {
            try {
                const { agentId } = req.body;
                await this.unregisterAgent(agentId);
                res.json({ success: true, message: 'Agent unregistered successfully' });
            } catch (error) {
                res.status(400).json({ success: false, error: error.message });
            }
        });

        // Get all agents
        this.app.get('/agents', (req, res) => {
            const agents = Array.from(this.agents.values());
            res.json({ agents, count: agents.length });
        });

        // Get specific agent
        this.app.get('/agents/:agentId', (req, res) => {
            const agent = this.agents.get(req.params.agentId);
            if (agent) {
                res.json(agent);
            } else {
                res.status(404).json({ error: 'Agent not found' });
            }
        });

        // Update agent status
        this.app.put('/agents/:agentId/status', (req, res) => {
            const agent = this.agents.get(req.params.agentId);
            if (agent) {
                Object.assign(agent, req.body);
                agent.lastSeen = new Date().toISOString();
                this.agents.set(req.params.agentId, agent);
                
                // Notify WebSocket clients
                this.broadcastToClients({
                    type: 'agent_status_updated',
                    agent: agent
                });
                
                res.json({ success: true, message: 'Agent status updated' });
            } else {
                res.status(404).json({ error: 'Agent not found' });
            }
        });

        // Get node info
        this.app.get('/info', (req, res) => {
            res.json({
                nodeId: this.nodeId,
                agentCount: this.agents.size,
                version: '1.0.0'
            });
        });
    }

    setupWebSocket() {
        this.wss = new WebSocketServer({ server: this.server });
        
        this.wss.on('connection', (ws) => {
            console.log('🔌 WebSocket client connected');
            
            ws.on('close', () => {
                console.log('🔌 WebSocket client disconnected');
            });
        });
    }

    async registerAgent(agentData) {
        // Validate agent data
        if (!agentData.name || !agentData.capabilities) {
            throw new Error('Agent must have name and capabilities');
        }

        // Generate unique agent ID
        const agentId = crypto.randomBytes(16).toString('hex');
        
        // Add metadata
        const fullAgentData = {
            id: agentId,
            name: agentData.name,
            description: agentData.description || '',
            capabilities: agentData.capabilities,
            version: agentData.version || '1.0.0',
            endpoint: agentData.endpoint || null,
            metadata: agentData.metadata || {},
            tags: agentData.tags || [],
            registeredAt: new Date().toISOString(),
            registeredBy: this.nodeId,
            lastSeen: new Date().toISOString(),
            status: 'online'
        };

        // Store locally
        this.agents.set(agentId, fullAgentData);

        // Store on IPFS if available
        if (this.ipfs) {
            try {
                const agentCard = JSON.stringify(fullAgentData, null, 2);
                const result = await this.ipfs.add(agentCard);
                fullAgentData.ipfsHash = result.cid.toString();
                console.log(`📄 Agent card stored on IPFS: ${fullAgentData.ipfsHash}`);
            } catch (error) {
                console.warn('⚠️  Failed to store agent card on IPFS:', error.message);
            }
        }

        // Notify WebSocket clients
        this.broadcastToClients({
            type: 'agent_registered',
            agent: fullAgentData
        });

        console.log(`✅ Agent registered: ${agentData.name} (${agentId})`);
        return agentId;
    }

    async unregisterAgent(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new Error('Agent not found');
        }

        this.agents.delete(agentId);

        // Notify WebSocket clients
        this.broadcastToClients({
            type: 'agent_unregistered',
            agent: agent
        });

        console.log(`📤 Agent unregistered: ${agent.name} (${agentId})`);
    }

    broadcastToClients(data) {
        if (this.wss) {
            this.wss.clients.forEach(client => {
                if (client.readyState === 1) { // WebSocket.OPEN
                    client.send(JSON.stringify(data));
                }
            });
        }
    }

    async stop() {
        console.log('🛑 Stopping Beacon Node...');
        
        if (this.wss) {
            this.wss.close();
        }
        
        if (this.server) {
            this.server.close();
        }
        
        console.log('✅ Beacon Node stopped');
    }
}

// CLI support
if (import.meta.url === `file://${process.argv[1]}`) {
    const { Command } = await import('commander');
    const program = new Command();

    program
        .name('beacon-node')
        .description('Decentralized agent beacon network')
        .version('1.0.0');

    program
        .option('-p, --port <port>', 'HTTP port', '3000')
        .option('--ipfs-endpoint <url>', 'IPFS endpoint', 'http://localhost:5001');

    program.parse();

    const options = program.opts();
    
    const config = {
        port: parseInt(options.port),
        ipfsEndpoint: options.ipfsEndpoint
    };

    const beaconNode = new SimpleBeaconNode(config);
    
    process.on('SIGINT', async () => {
        await beaconNode.stop();
        process.exit(0);
    });

    beaconNode.start().catch(console.error);
}

export default SimpleBeaconNode; 