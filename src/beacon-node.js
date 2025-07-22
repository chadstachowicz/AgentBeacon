import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { webRTC } from '@libp2p/webrtc';
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery';
import { Bootstrap } from '@libp2p/bootstrap';
import { MulticastDNS } from '@libp2p/mdns';
import { identify } from '@libp2p/identify';
import { create } from 'ipfs-http-client';
import express from 'express';
import cors from 'cors';
import WebSocket from 'ws';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { promises as fs } from 'fs';

class BeaconNode {
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
        console.log('🚀 Starting Beacon Node...');
        console.log(`Node ID: ${this.nodeId}`);
        
        try {
            // Initialize IPFS client
            await this.initIPFS();
            
            // Initialize libp2p
            await this.initLibp2p();
            
            // Setup HTTP API
            this.setupAPI();
            
            // Setup WebSocket for real-time updates
            this.setupWebSocket();
            
            // Start the server
            this.server = this.app.listen(this.config.port, () => {
                console.log(`📡 Beacon Node running on port ${this.config.port}`);
                console.log(`🌐 P2P Node running on port ${this.config.p2pPort}`);
                console.log(`🔗 IPFS connected to ${this.config.ipfsEndpoint}`);
            });
            
            // Setup pub/sub handlers
            this.setupPubSub();
            
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

    async initLibp2p() {
        this.libp2p = await createLibp2p({
            addresses: {
                listen: [
                    `/ip4/0.0.0.0/tcp/${this.config.p2pPort}`,
                    `/ip4/0.0.0.0/tcp/${this.config.p2pPort + 1}/ws`
                ]
            },
            transports: [tcp(), webRTC()],
            connectionEncryption: [],
            streamMuxers: [],
            peerDiscovery: [
                new Bootstrap({ list: this.config.bootstrapPeers }),
                new MulticastDNS()
            ],
            services: {
                pubsub: pubsubPeerDiscovery(),
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
        });

        await this.libp2p.start();
        console.log(`🔑 P2P Node ID: ${this.libp2p.peerId.toString()}`);
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

        // Discover agents from network
        this.app.get('/discover', async (req, res) => {
            try {
                const discoveredAgents = await this.discoverAgents();
                res.json({ agents: discoveredAgents, count: discoveredAgents.length });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Get node info
        this.app.get('/info', (req, res) => {
            res.json({
                nodeId: this.nodeId,
                peerId: this.libp2p.peerId.toString(),
                addresses: this.libp2p.getMultiaddrs().map(addr => addr.toString()),
                agentCount: this.agents.size,
                peerCount: this.peers.size
            });
        });
    }

    setupWebSocket() {
        this.wss = new WebSocket.Server({ server: this.server });
        
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
            if (evt.detail.topic === 'agent-registration') {
                this.handleAgentRegistration(evt.detail.data);
            }
        });

        // Subscribe to the topic
        pubsub.subscribe('agent-registration');
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

    async broadcastAgentRegistration(agentData) {
        try {
            const pubsub = this.libp2p.services.pubsub;
            const message = JSON.stringify({
                type: 'agent_registration',
                agent: agentData,
                timestamp: Date.now(),
                nodeId: this.nodeId
            });
            
            await pubsub.publish('agent-registration', new TextEncoder().encode(message));
        } catch (error) {
            console.warn('⚠️  Failed to broadcast agent registration:', error.message);
        }
    }

    handleAgentRegistration(data) {
        try {
            const message = JSON.parse(new TextDecoder().decode(data));
            if (message.type === 'agent_registration' && message.nodeId !== this.nodeId) {
                const agent = message.agent;
                this.agents.set(agent.id, agent);
                console.log(`📡 Received agent registration from network: ${agent.name}`);
                
                // Notify WebSocket clients
                this.broadcastToClients({
                    type: 'agent_discovered',
                    agent: agent
                });
            }
        } catch (error) {
            console.warn('⚠️  Failed to handle agent registration:', error.message);
        }
    }

    async discoverAgents() {
        // For now, return local agents
        // In a full implementation, this would query other beacon nodes
        return Array.from(this.agents.values());
    }

    broadcastToClients(data) {
        if (this.wss) {
            this.wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
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
        
        if (this.libp2p) {
            await this.libp2p.stop();
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

    const beaconNode = new BeaconNode(config);
    
    process.on('SIGINT', async () => {
        await beaconNode.stop();
        process.exit(0);
    });

    beaconNode.start().catch(console.error);
}

export default BeaconNode; 