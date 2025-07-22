import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

class AgentSDK {
    constructor(config = {}) {
        this.config = {
            beaconUrl: config.beaconUrl || 'http://localhost:3000',
            agentId: config.agentId || crypto.randomBytes(16).toString('hex'),
            heartbeatInterval: config.heartbeatInterval || 30000, // 30 seconds
            ...config
        };
        
        this.agentData = null;
        this.heartbeatTimer = null;
        this.ws = null;
        this.isRegistered = false;
    }

    async register(agentData) {
        // Validate required fields
        if (!agentData.name || !agentData.capabilities) {
            throw new Error('Agent must have name and capabilities');
        }

        // Prepare agent data
        this.agentData = {
            id: this.config.agentId,
            name: agentData.name,
            description: agentData.description || '',
            capabilities: agentData.capabilities,
            version: agentData.version || '1.0.0',
            endpoint: agentData.endpoint || null,
            metadata: agentData.metadata || {},
            tags: agentData.tags || []
        };

        try {
            const response = await fetch(`${this.config.beaconUrl}/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(this.agentData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Registration failed');
            }

            const result = await response.json();
            this.isRegistered = true;
            
            console.log(`✅ Agent registered successfully: ${this.agentData.name}`);
            console.log(`🆔 Agent ID: ${result.agentId}`);
            
            // Start heartbeat
            this.startHeartbeat();
            
            // Connect to WebSocket for real-time updates
            this.connectWebSocket();
            
            return result;
            
        } catch (error) {
            console.error('❌ Failed to register agent:', error.message);
            throw error;
        }
    }

    async unregister() {
        if (!this.isRegistered) {
            return;
        }

        try {
            const response = await fetch(`${this.config.beaconUrl}/unregister`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ agentId: this.config.agentId })
            });

            if (response.ok) {
                console.log('✅ Agent unregistered successfully');
            }
        } catch (error) {
            console.warn('⚠️  Failed to unregister agent:', error.message);
        } finally {
            this.isRegistered = false;
            this.stopHeartbeat();
            this.disconnectWebSocket();
        }
    }

    async discoverAgents(filters = {}) {
        try {
            const queryParams = new URLSearchParams();
            if (filters.capability) queryParams.append('capability', filters.capability);
            if (filters.tag) queryParams.append('tag', filters.tag);
            if (filters.name) queryParams.append('name', filters.name);

            const url = `${this.config.beaconUrl}/agents${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error('Failed to discover agents');
            }

            const result = await response.json();
            return result.agents;
            
        } catch (error) {
            console.error('❌ Failed to discover agents:', error.message);
            return [];
        }
    }

    async getAgent(agentId) {
        try {
            const response = await fetch(`${this.config.beaconUrl}/agents/${agentId}`);
            
            if (!response.ok) {
                throw new Error('Agent not found');
            }

            return await response.json();
            
        } catch (error) {
            console.error('❌ Failed to get agent:', error.message);
            return null;
        }
    }

    async updateStatus(status) {
        if (!this.isRegistered) {
            throw new Error('Agent not registered');
        }

        try {
            const response = await fetch(`${this.config.beaconUrl}/agents/${this.config.agentId}/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status })
            });

            if (response.ok) {
                console.log('✅ Agent status updated');
            }
        } catch (error) {
            console.warn('⚠️  Failed to update status:', error.message);
        }
    }

    startHeartbeat() {
        this.heartbeatTimer = setInterval(async () => {
            try {
                await this.updateStatus({ 
                    lastSeen: new Date().toISOString(),
                    status: 'online'
                });
            } catch (error) {
                console.warn('⚠️  Heartbeat failed:', error.message);
            }
        }, this.config.heartbeatInterval);
    }

    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    connectWebSocket() {
        try {
            const wsUrl = this.config.beaconUrl.replace('http', 'ws');
            // Note: WebSocket is a global in browsers, but not in Node.js
            // For now, we'll skip WebSocket connection in Node.js environment
            if (typeof window !== 'undefined') {
                this.ws = new WebSocket(`${wsUrl}`);
            } else {
                console.log('🔌 WebSocket connection skipped (Node.js environment)');
                return;
            }
            
            this.ws.onopen = () => {
                console.log('🔌 Connected to beacon WebSocket');
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleWebSocketMessage(data);
                } catch (error) {
                    console.warn('⚠️  Failed to parse WebSocket message:', error.message);
                }
            };
            
            this.ws.onclose = () => {
                console.log('🔌 Disconnected from beacon WebSocket');
                // Try to reconnect after a delay
                setTimeout(() => {
                    if (this.isRegistered) {
                        this.connectWebSocket();
                    }
                }, 5000);
            };
            
            this.ws.onerror = (error) => {
                console.warn('⚠️  WebSocket error:', error.message);
            };
            
        } catch (error) {
            console.warn('⚠️  Failed to connect WebSocket:', error.message);
        }
    }

    disconnectWebSocket() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'agent_registered':
                console.log(`📡 New agent registered: ${data.agent.name}`);
                this.emit('agentRegistered', data.agent);
                break;
                
            case 'agent_discovered':
                console.log(`🔍 Agent discovered: ${data.agent.name}`);
                this.emit('agentDiscovered', data.agent);
                break;
                
            case 'agent_unregistered':
                console.log(`📡 Agent unregistered: ${data.agent.name}`);
                this.emit('agentUnregistered', data.agent);
                break;
                
            default:
                console.log('📡 Received message:', data);
        }
    }

    // Event emitter functionality
    emit(event, data) {
        if (this.eventListeners && this.eventListeners[event]) {
            this.eventListeners[event].forEach(callback => callback(data));
        }
    }

    on(event, callback) {
        if (!this.eventListeners) {
            this.eventListeners = {};
        }
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        this.eventListeners[event].push(callback);
    }

    off(event, callback) {
        if (this.eventListeners && this.eventListeners[event]) {
            this.eventListeners[event] = this.eventListeners[event].filter(cb => cb !== callback);
        }
    }

    // Utility methods
    getAgentId() {
        return this.config.agentId;
    }

    getAgentData() {
        return this.agentData;
    }

    isAgentRegistered() {
        return this.isRegistered;
    }
}

export default AgentSDK; 