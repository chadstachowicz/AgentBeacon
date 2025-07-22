# 🚀 Beacon Network

A decentralized agent discovery and registration system built with Node.js, libp2p, and IPFS. Agents can "phone home" to beacon nodes to share their capabilities with the rest of the network.

## 🌟 Features

- **Decentralized Architecture**: Built on libp2p for peer-to-peer communication
- **IPFS Integration**: Agent cards stored on IPFS for decentralized storage
- **Real-time Updates**: WebSocket support for live agent discovery
- **Web Dashboard**: Beautiful UI for monitoring the network
- **Agent SDK**: Easy-to-use library for agent registration
- **Open Source**: Anyone can run a beacon node

## 🏗️ Architecture

```
Agent → libp2p pub/sub → Beacon Nodes → IPFS Storage
                ↓
        Agent Card Discovery
```

### Components

1. **Beacon Node**: The main server that agents connect to
2. **Agent SDK**: Client library for easy agent registration
3. **Web Dashboard**: Visual interface for network monitoring
4. **IPFS Storage**: Decentralized storage for agent cards

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- IPFS daemon (optional, for decentralized storage)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd beacon-network
```

2. Install dependencies:
```bash
npm install
```

3. Start a beacon node:
```bash
npm start
```

The beacon node will start on `http://localhost:3000` with a web dashboard available at the same URL.

**Note**: This is a simplified version that focuses on core functionality. For full P2P networking, see the advanced implementation in `src/beacon-node.js`.

### Running with IPFS

If you have IPFS running locally:
```bash
npm start -- --ipfs-endpoint http://localhost:5001
```

## 🤖 Registering an Agent

### Using the Agent SDK

```javascript
const AgentSDK = require('./src/agent-sdk');

const agentSDK = new AgentSDK({
    beaconUrl: 'http://localhost:3000'
});

const agentData = {
    name: 'My AI Agent',
    description: 'A helpful AI assistant',
    capabilities: ['text-generation', 'code-analysis'],
    version: '1.0.0',
    endpoint: 'http://localhost:8080/api',
    tags: ['ai', 'nlp']
};

// Register the agent
await agentSDK.register(agentData);

// Listen for other agents
agentSDK.on('agentRegistered', (agent) => {
    console.log('New agent:', agent.name);
});
```

### Using the Example Script

```bash
npm run agent
```

**Note**: The example scripts use the simplified beacon node by default.

## 🔍 Discovering Agents

### Using the SDK

```javascript
// Get all agents
const agents = await agentSDK.discoverAgents();

// Filter by capability
const textAgents = await agentSDK.discoverAgents({ 
    capability: 'text-generation' 
});

// Get specific agent
const agent = await agentSDK.getAgent('agent-id');
```

### Using the Example Script

```bash
npm run discover
```

## 🌐 Running Multiple Beacon Nodes

You can run multiple beacon nodes that will discover each other:

```bash
# Node 1
npm start -- --port 3000 --p2p-port 4000

# Node 2 (in another terminal)
npm start -- --port 3001 --p2p-port 4001 --bootstrap-peers /ip4/127.0.0.1/tcp/4000/p2p/QmNode1PeerId
```

## 📊 Web Dashboard

The web dashboard provides:

- Real-time agent discovery
- Network statistics
- Live event feed
- Agent capability filtering
- Connection status monitoring

Access it at `http://localhost:3000` when running a beacon node.

## 🔧 Configuration

### Beacon Node Options

- `--port`: HTTP server port (default: 3000)
- `--p2p-port`: P2P networking port (default: 4000)
- `--ipfs-endpoint`: IPFS daemon endpoint (default: http://localhost:5001)
- `--bootstrap-peers`: Comma-separated list of bootstrap peers

### Agent SDK Options

- `beaconUrl`: URL of the beacon node
- `agentId`: Custom agent ID (auto-generated if not provided)
- `heartbeatInterval`: Heartbeat interval in milliseconds (default: 30000)

## 📡 API Endpoints

### Beacon Node API

- `GET /health` - Health check and statistics
- `POST /register` - Register an agent
- `GET /agents` - List all agents
- `GET /agents/:id` - Get specific agent
- `GET /discover` - Discover agents from network
- `GET /info` - Node information

### WebSocket Events

- `agent_registered` - New agent registered
- `agent_discovered` - Agent discovered from network
- `agent_unregistered` - Agent unregistered

## 🏗️ Project Structure

```
beacon-network/
├── src/
│   ├── beacon-node.js      # Main beacon node implementation
│   └── agent-sdk.js        # Agent SDK for easy registration
├── examples/
│   ├── register-agent.js   # Example agent registration
│   └── discover-agents.js  # Example agent discovery
├── public/
│   └── index.html          # Web dashboard
├── package.json
└── README.md
```

## 🔒 Security Considerations

- Agent registration is currently open (no authentication)
- Consider implementing API keys or JWT tokens for production
- IPFS content is publicly accessible
- P2P communication is not encrypted by default

## 🚀 Production Deployment

For production deployment:

1. **Add Authentication**: Implement API key or JWT authentication
2. **Enable HTTPS**: Use SSL certificates for secure communication
3. **Configure Firewall**: Open necessary ports for P2P communication
4. **Set up IPFS**: Use a production IPFS node or cluster
5. **Add Monitoring**: Implement logging and monitoring
6. **Load Balancing**: Use multiple beacon nodes behind a load balancer

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- Built with [libp2p](https://libp2p.io/) for decentralized networking
- Uses [IPFS](https://ipfs.io/) for decentralized storage
- Inspired by the A2A Protocol from Google

## 📞 Support

For questions or support:
- Open an issue on GitHub
- Check the examples directory for usage patterns
- Review the API documentation above 