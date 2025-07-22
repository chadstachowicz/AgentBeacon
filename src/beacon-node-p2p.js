

import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { webSockets } from '@libp2p/websockets'
import { ping } from '@libp2p/ping'
import { yamux } from '@chainsafe/libp2p-yamux'
import { noise } from '@chainsafe/libp2p-noise'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { kadDHT } from '@libp2p/kad-dht'
import { bootstrap } from '@libp2p/bootstrap'
import { mdns } from '@libp2p/mdns'
import { identify } from '@libp2p/identify';
import { multiaddr } from '@multiformats/multiaddr';
import { create } from 'ipfs-http-client';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';
import path from 'path';

class P2PBeaconNode {
    constructor(config = {}) {
        this.config = {
            port: config.port || 3000,
            p2pPort: config.p2pPort || 4000,
            ipfsEndpoint: config.ipfsEndpoint || 'http://localhost:5001',
            bootstrapPeers: config.bootstrapPeers || [],
            dataDir: config.dataDir || './data',
            ...config
        };
        
        this.agents = new Map(); // agentId -> agentData
        this.peers = new Set();
        this.app = express();
        this.wss = null;
        this.libp2p = null;
        this.ipfs = null;
        this.nodeId = uuidv4();
        this.agentsFilePath = path.join(this.config.dataDir, 'agents.json');
    }

    // ===== Local Persistence Methods =====

    async ensureDataDirectory() {
        try {
            await fs.mkdir(this.config.dataDir, { recursive: true });
            console.log(`📁 Data directory ensured: ${this.config.dataDir}`);
        } catch (error) {
            console.warn(`⚠️  Failed to create data directory: ${error.message}`);
        }
    }

    async saveAgentsToFile() {
        try {
            await this.ensureDataDirectory();
            
            const agentsArray = Array.from(this.agents.entries()).map(([id, agent]) => ({
                id,
                ...agent,
                lastSaved: new Date().toISOString()
            }));
            
            const agentsData = {
                nodeId: this.nodeId,
                lastSaved: new Date().toISOString(),
                totalAgents: agentsArray.length,
                agents: agentsArray
            };
            
            await fs.writeFile(this.agentsFilePath, JSON.stringify(agentsData, null, 2));
            console.log(`💾 Saved ${agentsArray.length} agents to ${this.agentsFilePath}`);
        } catch (error) {
            console.warn(`⚠️  Failed to save agents to file: ${error.message}`);
        }
    }

    async loadAgentsFromFile() {
        try {
            const data = await fs.readFile(this.agentsFilePath, 'utf8');
            const agentsData = JSON.parse(data);
            
            console.log(`📂 Loading ${agentsData.totalAgents} agents from ${this.agentsFilePath}`);
            console.log(`📅 Last saved: ${agentsData.lastSaved}`);
            
            // Restore agents to memory
            for (const agent of agentsData.agents) {
                // Update lastSeen to indicate this was restored from file
                agent.lastSeen = new Date().toISOString();
                agent.restoredFromFile = true;
                
                this.agents.set(agent.id, agent);
            }
            
            console.log(`✅ Restored ${agentsData.totalAgents} agents from local storage`);
            return agentsData.totalAgents;
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`📂 No existing agents file found at ${this.agentsFilePath}`);
                return 0;
            }
            console.warn(`⚠️  Failed to load agents from file: ${error.message}`);
            return 0;
        }
    }

    async restoreAgentsToDHT() {
        if (this.agents.size === 0) {
            console.log(`📭 No agents to restore to DHT`);
            return;
        }
        
        console.log(`🔄 Restoring ${this.agents.size} agents to DHT...`);
        let restoredCount = 0;
        
        for (const agent of this.agents.values()) {
            try {
                await this.storeAgentInDHT(agent);
                restoredCount++;
            } catch (error) {
                console.warn(`⚠️  Failed to restore agent ${agent.name} to DHT: ${error.message}`);
            }
        }
        
        console.log(`✅ Restored ${restoredCount}/${this.agents.size} agents to DHT`);
    }

    async start() {
        console.log('🚀 Starting P2P Beacon Node...');
        console.log(`Node ID: ${this.nodeId}`);
        
        try {
            // Load agents from local storage first
            await this.loadAgentsFromFile();
            
            // Initialize IPFS client
            await this.initIPFS();
            
            // Initialize libp2p
            await this.initLibp2p();
            
            // Restore agents to DHT after libp2p is initialized
            await this.restoreAgentsToDHT();
            
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
            connectionEncrypters: [noise()],
            streamMuxers: [yamux()],
            peerDiscovery: [

                mdns()
            ],
            services: {
                pubsub: gossipsub(),
                dht: kadDHT({
                    validators: {},
                    selectors: {}
                }),
                identify: identify(),
                ping: ping()
            }
        });

        this.libp2p.addEventListener('peer:discovery', (evt) => {
            try {
                const peer = evt.detail;
                if (!peer || !peer.id) {
                    console.warn('⚠️  Received peer discovery event with invalid peer data');
                    return;
                }
                
                const peerId = peer.id.toString();
                console.log(`🔍 Discovered peer: ${peerId}`);
                this.peers.add(peerId);
                
                // Try to connect to discovered peer
                this.connectToPeer(peer.id, peer.multiaddrs);
            } catch (error) {
                console.warn('⚠️  Error in peer discovery handler:', error.message);
            }
        });

        this.libp2p.addEventListener('peer:connect', (evt) => {
            try {
                const peer = evt.detail;
                if (!peer || !peer.id) {
                    console.warn('⚠️  Received peer connect event with invalid peer data');
                    return;
                }
                
                const peerId = peer.id.toString();
                console.log(`🤝 Connected to peer: ${peerId}`);
                console.log(`📊 Total connected peers: ${this.libp2p.getConnections().length}`);
                
                // Log connection details
                const connections = this.libp2p.getConnections();
                connections.forEach(conn => {
                    try {
                        console.log(`   📍 Connection: ${conn.remoteAddr?.toString() || 'unknown address'}`);
                    } catch (connError) {
                        console.log(`   📍 Connection: [address error]`);
                    }
                });
            } catch (error) {
                console.warn('⚠️  Error in peer connect handler:', error.message);
            }
        });

        this.libp2p.addEventListener('peer:disconnect', (evt) => {
            try {
                const peer = evt.detail;
                const peerId = peer?.id?.toString() || 'unknown peer';
                
                console.log(`❌ Disconnected from peer: ${peerId}`);
                
                // Only try to delete if we have a valid peer ID
                if (peer?.id) {
                    this.peers.delete(peer.id.toString());
                }
                
                console.log(`📊 Remaining connected peers: ${this.libp2p.getConnections().length}`);
            } catch (error) {
                console.warn('⚠️  Error in peer disconnect handler:', error.message);
            }
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

        // Get pubsub mesh status
        this.app.get('/pubsub-status', (req, res) => {
            const pubsub = this.libp2p.services.pubsub;
            const subscribers = pubsub.getSubscribers('agent-registration');
            const connections = this.libp2p.getConnections();
            
            res.json({
                topic: 'agent-registration',
                subscribers: subscribers.length,
                subscriberPeers: subscribers.map(peer => peer.toString()),
                connections: connections.length,
                topics: Array.from(pubsub.getTopics()),
                status: subscribers.length > 0 ? 'ready' : 'waiting-for-peers'
            });
        });

        // Get DHT status
        this.app.get('/dht-status', (req, res) => {
            const dht = this.libp2p.services.dht;
            const connections = this.libp2p.getConnections();
            
            res.json({
                dhtEnabled: !!dht,
                connections: connections.length,
                connectedPeers: connections.map(conn => conn.remotePeer.toString()),
                routingTableSize: dht?.routingTable?.size || 0,
                status: connections.length > 0 ? 'connected' : 'isolated'
            });
        });

        // Manually trigger agent sync
        this.app.post('/sync', async (req, res) => {
            try {
                await this.syncAgentsFromNetwork();
                res.json({ success: true, message: 'Agent sync triggered' });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Manual connection endpoint for debugging
        this.app.post('/connect', async (req, res) => {
            try {
                const connections = this.libp2p.getConnections();
                const discovered = Array.from(this.peers);
                
                console.log(`🔧 Manual connection attempt - Discovered: ${discovered.length}, Connected: ${connections.length}`);
                
                let newConnections = 0;
                for (const peerId of discovered) {
                    try {
                        // Validate peer ID before attempting connection
                        if (!peerId || typeof peerId !== 'string') {
                            console.warn(`⚠️  Skipping invalid peer ID: ${peerId}`);
                            continue;
                        }
                        
                        await this.libp2p.dial(peerId);
                        newConnections++;
                        console.log(`✅ Connected to peer: ${peerId}`);
                    } catch (error) {
                        console.warn(`❌ Failed to connect to peer ${peerId}: ${error.message}`);
                    }
                }
                
                const finalConnections = this.libp2p.getConnections();
                res.json({ 
                    success: true, 
                    message: `Connected to ${newConnections} new peers`,
                    totalConnections: finalConnections.length,
                    discoveredPeers: discovered.length
                });
            } catch (error) {
                console.error(`❌ Error in manual connect endpoint: ${error.message}`);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Get agent from DHT by ID
        this.app.get('/dht/agents/:agentId', async (req, res) => {
            try {
                const agent = await this.getAgentFromDHT(req.params.agentId);
                if (agent) {
                    res.json(agent);
                } else {
                    res.status(404).json({ error: 'Agent not found in DHT' });
                }
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Manual backup endpoint
        this.app.post('/backup', async (req, res) => {
            try {
                await this.saveAgentsToFile();
                res.json({ 
                    success: true, 
                    message: `Backup completed - ${this.agents.size} agents saved`,
                    filePath: this.agentsFilePath,
                    agentCount: this.agents.size
                });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Manual restore endpoint (for testing)
        this.app.post('/restore', async (req, res) => {
            try {
                const loadedCount = await this.loadAgentsFromFile();
                await this.restoreAgentsToDHT();
                res.json({ 
                    success: true, 
                    message: `Restore completed - ${loadedCount} agents loaded`,
                    agentCount: this.agents.size
                });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Get backup status
        this.app.get('/backup-status', async (req, res) => {
            try {
                let fileExists = false;
                let fileSize = 0;
                let lastModified = null;
                
                try {
                    const stats = await fs.stat(this.agentsFilePath);
                    fileExists = true;
                    fileSize = stats.size;
                    lastModified = stats.mtime.toISOString();
                } catch (error) {
                    // File doesn't exist
                }
                
                res.json({
                    filePath: this.agentsFilePath,
                    fileExists,
                    fileSize,
                    lastModified,
                    currentAgentCount: this.agents.size
                });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
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
            } else if (evt.detail.topic === 'agent-sync') {
                this.handleAgentSyncMessage(evt.detail.data);
            }
        });

        // Subscribe to both topics
        pubsub.subscribe('agent-registration');
        pubsub.subscribe('agent-sync');
        console.log('📡 Subscribed to agent-registration and agent-sync topics');
        
        // Debug: Log when peers are added/removed from pubsub
        pubsub.addEventListener('subscription-change', (evt) => {
            const peersCount = evt.detail.peersSubscribed?.length || 0;
            console.log(`📊 Subscription change: ${evt.detail.topic}, peers: ${peersCount}`);
        });

        // Periodic network sync - query DHT and sync with peers
        setInterval(async () => {
            await this.syncAgentsFromNetwork();
        }, 120000); // Every 2 minutes

        // Periodic backup of agents to local file
        setInterval(async () => {
            await this.saveAgentsToFile();
        }, 300000); // Every 5 minutes

        // Send a heartbeat message every minute to keep mesh alive (only if peers are subscribed)
        setInterval(async () => {
            try {
                const subscribers = pubsub.getSubscribers('agent-registration');
                if (subscribers.length > 0) {
                    const heartbeat = JSON.stringify({
                        type: 'heartbeat',
                        nodeId: this.nodeId,
                        timestamp: Date.now()
                    });
                    await pubsub.publish('agent-registration', new TextEncoder().encode(heartbeat));
                    console.log('💓 Sent heartbeat to maintain mesh');
                } else {
                    console.log('💤 Skipping heartbeat - no peers subscribed to topic');
                }
            } catch (error) {
                console.log('💔 Heartbeat failed:', error.message);
            }
        }, 60000); // Every minute
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

        // Save to local file for persistence
        await this.saveAgentsToFile();

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

        // Store in DHT for distributed discovery
        await this.storeAgentInDHT(fullAgentData);

        // Also broadcast to network for immediate notification
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

        // Save to local file for persistence
        await this.saveAgentsToFile();

        // Store tombstone in DHT
        await this.removeAgentFromDHT(agentId);

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
            console.log(`🔗 Connected peers: ${this.libp2p.getConnections().length}`);
            console.log(`📡 Pubsub topics: ${Array.from(pubsub.getTopics())}`);
            
            // Wait for pubsub mesh to establish if no peers subscribed
            const subscribers = pubsub.getSubscribers('agent-registration');
            if (subscribers.length === 0) {
                console.log('⏳ No peers subscribed yet, waiting for mesh...');
                // Wait a bit for the mesh to establish
                await new Promise(resolve => setTimeout(resolve, 2000));
                const newSubscribers = pubsub.getSubscribers('agent-registration');
                console.log(`📊 After waiting, pubsub peers: ${newSubscribers.length}`);
                
                if (newSubscribers.length === 0) {
                    console.warn('⚠️  Still no peers subscribed to topic. Broadcasting anyway...');
                }
            }
            
            await pubsub.publish('agent-registration', new TextEncoder().encode(message));
            console.log('✅ Agent registration broadcast sent');
        } catch (error) {
            console.warn('⚠️  Failed to broadcast agent registration:', error.message);
            
            // Still store the agent locally even if broadcast fails
            console.log('💾 Agent stored locally despite broadcast failure');
        }
    }

    handleAgentRegistration(data) {
        try {
            const message = JSON.parse(new TextDecoder().decode(data));
            console.log(`📥 Processing message type: ${message.type} from node: ${message.nodeId}`);
            
            if (message.type === 'heartbeat') {
                // Ignore heartbeat messages - they're just for mesh maintenance
                return;
            }
            
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

    async handleAgentSyncMessage(data) {
        try {
            const message = JSON.parse(new TextDecoder().decode(data));
            console.log(`🔄 Processing sync message type: ${message.type} from node: ${message.nodeId}`);
            
            if (message.nodeId === this.nodeId) {
                return; // Ignore our own messages
            }
            
            if (message.type === 'agent_list_request') {
                // Someone is requesting our agent list
                console.log(`📤 Sending agent list to requesting node: ${message.nodeId}`);
                
                const agents = Array.from(this.agents.values()).map(agent => ({
                    id: agent.id,
                    name: agent.name,
                    capabilities: agent.capabilities,
                    registeredAt: agent.registeredAt,
                    registeredBy: agent.registeredBy
                }));
                
                const response = JSON.stringify({
                    type: 'agent_list_response',
                    nodeId: this.nodeId,
                    requestingNode: message.nodeId,
                    agents: agents,
                    timestamp: Date.now()
                });
                
                const pubsub = this.libp2p.services.pubsub;
                await pubsub.publish('agent-sync', new TextEncoder().encode(response));
                
            } else if (message.type === 'agent_list_response' && message.requestingNode === this.nodeId) {
                // We received a response to our agent list request
                console.log(`📥 Received agent list from node: ${message.nodeId} with ${message.agents.length} agents`);
                
                for (const agentData of message.agents) {
                    if (!this.agents.has(agentData.id)) {
                        // New agent discovered - fetch full details from DHT
                        const fullAgent = await this.getAgentFromDHT(agentData.id);
                        if (fullAgent && !fullAgent.deleted) {
                            this.agents.set(fullAgent.id, fullAgent);
                            console.log(`✨ Discovered new agent from DHT: ${fullAgent.name}`);
                            
                            // Save to local file for persistence
                            await this.saveAgentsToFile();
                            
                            // Notify WebSocket clients
                            this.broadcastToClients({
                                type: 'agent_discovered',
                                agent: fullAgent
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.warn('⚠️  Failed to handle agent sync message:', error.message);
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

    // ===== DHT-based Agent Storage and Discovery =====

    async storeAgentInDHT(agentData) {
        try {
            const dht = this.libp2p.services.dht;
            const key = `/agents/${agentData.id}`;
            const value = JSON.stringify(agentData);
            
            console.log(`🗃️  Storing agent in DHT: ${agentData.name} at key ${key}`);
            await dht.put(new TextEncoder().encode(key), new TextEncoder().encode(value));
            console.log(`✅ Agent stored in DHT successfully`);
        } catch (error) {
            console.warn(`⚠️  Failed to store agent in DHT: ${error.message}`);
        }
    }

    async getAgentFromDHT(agentId) {
        try {
            const dht = this.libp2p.services.dht;
            const key = `/agents/${agentId}`;
            
            console.log(`🔍 Looking up agent in DHT: ${agentId}`);
            const result = await dht.get(new TextEncoder().encode(key));
            
            if (result) {
                const agentData = JSON.parse(new TextDecoder().decode(result));
                console.log(`✅ Found agent in DHT: ${agentData.name}`);
                return agentData;
            }
            return null;
        } catch (error) {
            console.warn(`⚠️  Failed to get agent from DHT: ${error.message}`);
            return null;
        }
    }

    async discoverAgentsFromDHT() {
        try {
            const dht = this.libp2p.services.dht;
            const discoveredAgents = new Map();
            
            console.log(`🔍 Discovering agents from DHT...`);
            
            // Query for agents by searching for keys with prefix `/agents/`
            // Note: This is a simplified approach. In production, you might want
            // to maintain an index of agent IDs
            
            // For now, we'll use a different approach - periodically sync known agents
            // and let the network propagate agent discoveries
            
            return discoveredAgents;
        } catch (error) {
            console.warn(`⚠️  Failed to discover agents from DHT: ${error.message}`);
            return new Map();
        }
    }

    async removeAgentFromDHT(agentId) {
        try {
            const dht = this.libp2p.services.dht;
            const key = `/agents/${agentId}`;
            
            console.log(`🗑️  Removing agent from DHT: ${agentId}`);
            // Note: DHT doesn't have a direct delete, but we can store a tombstone
            const tombstone = JSON.stringify({
                id: agentId,
                deleted: true,
                deletedAt: new Date().toISOString(),
                deletedBy: this.nodeId
            });
            
            await dht.put(new TextEncoder().encode(key), new TextEncoder().encode(tombstone));
            console.log(`✅ Agent tombstone stored in DHT`);
        } catch (error) {
            console.warn(`⚠️  Failed to remove agent from DHT: ${error.message}`);
        }
    }

    async connectToPeer(peerId, multiaddrs) {
        try {
            if (!peerId) {
                console.warn('⚠️  Cannot connect to peer: invalid peer ID');
                return;
            }
            
            const peerIdStr = peerId.toString();
            console.log(`🔗 Attempting to connect to peer: ${peerIdStr}`);
            
            // Sort multiaddrs to prefer TCP connections
            const sortedMultiaddrs = (multiaddrs || []).sort((a, b) => {
                try {
                    const aStr = a.toString();
                    const bStr = b.toString();
                    // Prefer TCP over WebSocket, and local addresses over remote
                    if (aStr.includes('/tcp/') && !aStr.includes('/ws')) return -1;
                    if (bStr.includes('/tcp/') && !bStr.includes('/ws')) return 1;
                    if (aStr.includes('127.0.0.1')) return -1;
                    if (bStr.includes('127.0.0.1')) return 1;
                    return 0;
                } catch (sortError) {
                    return 0;
                }
            });
            
            // Try each multiaddr until one works
            for (const addr of sortedMultiaddrs) {
                try {
                    // Ensure the multiaddr includes the peer ID
                    let addrStr = addr.toString();
                    if (!addrStr.includes('/p2p/')) {
                        addrStr = `${addrStr}/p2p/${peerIdStr}`;
                    }
                    
                    // Create proper Multiaddr object
                    const fullMultiaddr = multiaddr(addrStr);
                    
                    console.log(`📞 Dialing: ${fullMultiaddr.toString()}`);
                    await this.libp2p.dial(fullMultiaddr);
                    console.log(`✅ Successfully connected to peer: ${peerIdStr} via ${fullMultiaddr.toString()}`);
                    return;
                } catch (dialError) {
                    console.log(`⚠️  Failed to dial ${addr?.toString() || 'invalid addr'}: ${dialError.message}`);
                }
            }
            
            // If multiaddrs didn't work, try dialing by peer ID directly
            console.log(`📞 Trying direct peer ID dial: ${peerIdStr}`);
            await this.libp2p.dial(peerId);
            console.log(`✅ Successfully connected to peer: ${peerIdStr} by peer ID`);
        } catch (error) {
            console.warn(`❌ Failed to connect to peer ${peerId?.toString() || 'unknown'}: ${error.message}`);
        }
    }

    async syncAgentsFromNetwork() {
        try {
            console.log(`🔄 Syncing agents from network...`);
            
            // Get list of connected peers
            const connections = this.libp2p.getConnections();
            console.log(`📡 Syncing with ${connections.length} peers`);
            console.log(`🔍 Discovered peers: ${this.peers.size}`);
            
            if (connections.length === 0 && this.peers.size > 0) {
                console.log(`⚠️  Have discovered peers but no connections. Attempting to connect...`);
                
                // Try to connect to discovered peers
                for (const peerId of this.peers) {
                    try {
                        if (peerId && typeof peerId === 'string') {
                            await this.libp2p.dial(peerId);
                            console.log(`🔗 Connected to peer: ${peerId}`);
                        }
                    } catch (error) {
                        console.warn(`❌ Failed to connect to peer ${peerId}: ${error.message}`);
                    }
                }
                
                // Update connections after dial attempts
                const newConnections = this.libp2p.getConnections();
                console.log(`📡 After connection attempts: ${newConnections.length} peers connected`);
            }
            
            // Send sync requests to connected peers
            const finalConnections = this.libp2p.getConnections();
            for (const connection of finalConnections) {
                try {
                    // Validate connection object
                    if (!connection || !connection.remotePeer) {
                        console.warn('⚠️  Invalid connection object, skipping sync request');
                        continue;
                    }
                    
                    // Use pubsub to request agent lists from peers
                    const request = JSON.stringify({
                        type: 'agent_list_request',
                        nodeId: this.nodeId,
                        timestamp: Date.now()
                    });
                    
                    const pubsub = this.libp2p.services.pubsub;
                    await pubsub.publish('agent-sync', new TextEncoder().encode(request));
                    console.log(`📤 Sent sync request to peer: ${connection.remotePeer.toString()}`);
                } catch (error) {
                    console.warn(`⚠️  Failed to request agent list from peer: ${error.message}`);
                }
            }
        } catch (error) {
            console.error(`❌ Error in syncAgentsFromNetwork: ${error.message}`);
        }
    }

    async stop() {
        console.log('🛑 Stopping P2P Beacon Node...');
        
        try {
            // Save agents before shutdown
            await this.saveAgentsToFile();
            console.log('💾 Final backup completed');
        } catch (error) {
            console.warn('⚠️  Failed to save agents during shutdown:', error.message);
        }
        
        try {
            if (this.wss) {
                this.wss.close();
                console.log('🔌 WebSocket server closed');
            }
        } catch (error) {
            console.warn('⚠️  Error closing WebSocket server:', error.message);
        }
        
        try {
            if (this.server) {
                this.server.close();
                console.log('🌐 HTTP server closed');
            }
        } catch (error) {
            console.warn('⚠️  Error closing HTTP server:', error.message);
        }
        
        try {
            if (this.libp2p) {
                await this.libp2p.stop();
                console.log('📡 LibP2P node stopped');
            }
        } catch (error) {
            console.warn('⚠️  Error stopping LibP2P node:', error.message);
        }
        
        console.log('✅ P2P Beacon Node stopped gracefully');
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
        .option('--bootstrap-peers <peers>', 'Bootstrap peers (comma-separated)')
        .option('--data-dir <path>', 'Data directory for local persistence', './data');

    program.parse();

    const options = program.opts();
    
    const config = {
        port: parseInt(options.port),
        p2pPort: parseInt(options.p2pPort),
        ipfsEndpoint: options.ipfsEndpoint,
        bootstrapPeers: options.bootstrapPeers ? options.bootstrapPeers.split(',') : [],
        dataDir: options.dataDir
    };

    const beaconNode = new P2PBeaconNode(config);
    
    // Graceful shutdown handlers
    const shutdown = async (signal) => {
        console.log(`\n📨 Received ${signal}, shutting down gracefully...`);
        try {
            await beaconNode.stop();
            console.log('✅ Shutdown completed successfully');
            process.exit(0);
        } catch (error) {
            console.error('❌ Error during shutdown:', error.message);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
    // Handle uncaught exceptions and rejections
    process.on('uncaughtException', (error) => {
        console.error('❌ Uncaught Exception:', error);
        shutdown('uncaughtException');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
        console.error('❌ Unhandled Promise Rejection at:', promise, 'reason:', reason);
        // Don't exit on unhandled rejection, just log it
    });

    beaconNode.start().catch((error) => {
        console.error('❌ Failed to start beacon node:', error);
        process.exit(1);
    });
}

export default P2PBeaconNode; 