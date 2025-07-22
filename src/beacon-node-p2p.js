

import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { webSockets } from '@libp2p/websockets'
import { yamux } from '@chainsafe/libp2p-yamux'
import { noise } from '@chainsafe/libp2p-noise'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { bootstrap } from '@libp2p/bootstrap'
import { mdns } from '@libp2p/mdns'
import { identify } from '@libp2p/identify';
import { create } from 'ipfs-http-client';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

class P2PBeaconNode {
    constructor(config = {}) {
        this.config = {
            port: config.port || 3000,
            p2pPort: config.p2pPort || 4000,
            ipfsEndpoint: config.ipfsEndpoint || 'http://localhost:5001',
            bootstrapPeers: config.bootstrapPeers || [],
            ...config
        };
        
        this.agents = new Map(); // agentId -> agentData
        this.peers = new Set();
        this.app = express();
        this.wss = null;
        this.libp2p = null;
        this.ipfs = null;
        this.nodeId = uuidv4();
    }

    async start() {
        console.log('🚀 Starting P2P Beacon Node...');
        console.log(`Node ID: ${this.nodeId}`);
        
        try {
            // Initialize IPFS client
            await this.initIPFS();
            
            // Initialize libp2p
            await this.initLibp2p();
            
            // Setup HTTP API
            this.setupAPI();
            
            // Start the server
            this.server = this.app.listen(this.config.port, () => {
                console.log(`📡 Beacon Node running on port ${this.config.port}`);
                console.log(`🌐 P2P Node running on port ${this.config.p2pPort}`);
                console.log(`🔗 IPFS connected to ${this.config.ipfsEndpoint}`);
                console.log(`🌐 Web Dashboard: http://localhost:${this.config.port}`);
                
                // Setup WebSocket for real-time updates after server is created
                this.setupWebSocket();
            });
            
            // Setup pub/sub handlers
            this.setupPubSub();
            
            console.log('✅ P2P Beacon Node started successfully!');
            
        } catch (error) {
            console.error('❌ Failed to start P2P Beacon Node:', error);
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

    async initLibp2p() {
        this.libp2p = await createLibp2p({
            addresses: {
                listen: [
                    `/ip4/0.0.0.0/tcp/${this.config.p2pPort}`,
                    `/ip4/0.0.0.0/tcp/${this.config.p2pPort + 1}/ws`
                ]
            },
            transports: [tcp(), webSockets()],
            connectionEncryption: [noise()],
            streamMuxers: [yamux()],
            peerDiscovery: [

                mdns()
            ],
            services: {
                pubsub: gossipsub(),
                identify: identify()
            }
        });

        this.libp2p.addEventListener('peer:discovery', (evt) => {
            const peer = evt.detail;
            console.log(`🔍 Discovered peer: ${peer.id}`);
            this.peers.add(peer.id.toString());
        });

        this.libp2p.addEventListener('peer:connect', (evt) => {
            const peer = evt.detail;
            console.log(`🤝 Connected to peer: ${peer.id}`);
            console.log(`📊 Total connected peers: ${this.libp2p.getConnections().length}`);
        });

        this.libp2p.addEventListener('peer:disconnect', (evt) => {
            const peer = evt.detail;
            console.log(`❌ Disconnected from peer: ${peer.id}`);
            this.peers.delete(peer.id.toString());
        });

        await this.libp2p.start();
        console.log(`🔑 P2P Node ID: ${this.libp2p.peerId.toString()}`);
        console.log(`📍 P2P Addresses:`);
        this.libp2p.getMultiaddrs().forEach(addr => {
            console.log(`   ${addr.toString()}`);
        });
    }

    setupAPI() {
        this.app.use(cors());
        this.app.use(express.json());
        this.app.use(express.static('public'));

        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                nodeId: this.nodeId,
                peerId: this.libp2p.peerId.toString(),
                agentCount: this.agents.size,
                peerCount: this.peers.size,
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

        // Get all agents (local + discovered)
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
                peerId: this.libp2p.peerId.toString(),
                addresses: this.libp2p.getMultiaddrs().map(addr => addr.toString()),
                agentCount: this.agents.size,
                peerCount: this.peers.size,
                version: '1.0.0-p2p'
            });
        });

        // Get network peers
        this.app.get('/peers', (req, res) => {
            res.json({
                peers: Array.from(this.peers),
                count: this.peers.size
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

    setupPubSub() {
        const pubsub = this.libp2p.services.pubsub;
        
        // Subscribe to agent registration events
        pubsub.addEventListener('message', (evt) => {
            console.log(`📨 Received pubsub message on topic: ${evt.detail.topic}`);
            if (evt.detail.topic === 'agent-registration') {
                this.handleAgentRegistration(evt.detail.data);
            }
        });

        // Subscribe to the topic
        pubsub.subscribe('agent-registration');
        console.log('📡 Subscribed to agent-registration topic');
        
        // Debug: Log when peers are added/removed from pubsub
        pubsub.addEventListener('subscription-change', (evt) => {
            console.log(`📊 Subscription change: ${evt.detail.topic}, peers: ${evt.detail.peersSubscribed.length}`);
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
            url: agentData.url || agentData.endpoint || null,
            endpoint: agentData.url || agentData.endpoint || null, // Keep both for compatibility
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

        // Broadcast to network
        await this.broadcastAgentRegistration(fullAgentData);

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

    async broadcastAgentRegistration(agentData) {
        try {
            const pubsub = this.libp2p.services.pubsub;
            const message = JSON.stringify({
                type: 'agent_registration',
                agent: agentData,
                timestamp: Date.now(),
                nodeId: this.nodeId
            });
            
            console.log(`📢 Broadcasting agent registration: ${agentData.name}`);
            console.log(`📊 Current pubsub peers: ${pubsub.getSubscribers('agent-registration').length}`);
            
            await pubsub.publish('agent-registration', new TextEncoder().encode(message));
            console.log('✅ Agent registration broadcast sent');
        } catch (error) {
            console.warn('⚠️  Failed to broadcast agent registration:', error.message);
        }
    }

    handleAgentRegistration(data) {
        try {
            const message = JSON.parse(new TextDecoder().decode(data));
            console.log(`📥 Processing agent registration message from node: ${message.nodeId}`);
            
            if (message.type === 'agent_registration' && message.nodeId !== this.nodeId) {
                const agent = message.agent;
                this.agents.set(agent.id, agent);
                console.log(`📡 Received agent registration from network: ${agent.name}`);
                
                // Notify WebSocket clients
                this.broadcastToClients({
                    type: 'agent_discovered',
                    agent: agent
                });
            } else if (message.nodeId === this.nodeId) {
                console.log(`🔄 Ignoring own message from node: ${message.nodeId}`);
            }
        } catch (error) {
            console.warn('⚠️  Failed to handle agent registration:', error.message);
        }
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
        console.log('🛑 Stopping P2P Beacon Node...');
        
        if (this.wss) {
            this.wss.close();
        }
        
        if (this.server) {
            this.server.close();
        }
        
        if (this.libp2p) {
            await this.libp2p.stop();
        }
        
        console.log('✅ P2P Beacon Node stopped');
    }
}

// CLI support
if (import.meta.url === `file://${process.argv[1]}`) {
    const { Command } = await import('commander');
    const program = new Command();

    program
        .name('beacon-node-p2p')
        .description('Decentralized agent beacon network with P2P networking')
        .version('1.0.0');

    program
        .option('-p, --port <port>', 'HTTP port', '3000')
        .option('--p2p-port <port>', 'P2P port', '4000')
        .option('--ipfs-endpoint <url>', 'IPFS endpoint', 'http://localhost:5001')
        .option('--bootstrap-peers <peers>', 'Bootstrap peers (comma-separated)');

    program.parse();

    const options = program.opts();
    
    const config = {
        port: parseInt(options.port),
        p2pPort: parseInt(options.p2pPort),
        ipfsEndpoint: options.ipfsEndpoint,
        bootstrapPeers: options.bootstrapPeers ? options.bootstrapPeers.split(',') : []
    };

    const beaconNode = new P2PBeaconNode(config);
    
    process.on('SIGINT', async () => {
        await beaconNode.stop();
        process.exit(0);
    });

    beaconNode.start().catch(console.error);
}

export default P2PBeaconNode; 