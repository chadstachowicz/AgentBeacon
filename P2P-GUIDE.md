# 🌐 P2P Beacon Network Guide

This guide shows how to run multiple beacon nodes that can discover each other and share agent information across the network using libp2p.

## 🚀 Quick Start

### Step 1: Start the First Beacon Node

```bash
# Terminal 1
npm run start:p2p -- --port 3000 --p2p-port 4000
```

You'll see output like:
```
🚀 Starting P2P Beacon Node...
Node ID: abc123...
🔑 P2P Node ID: 12D3KooW...
📍 P2P Addresses:
   /ip4/127.0.0.1/tcp/4000/p2p/12D3KooW...
   /ip4/127.0.0.1/tcp/4001/ws/p2p/12D3KooW...
```

**Copy the P2P address** (the one starting with `/ip4/127.0.0.1/tcp/4000/p2p/...`)

### Step 2: Start a Second Beacon Node

```bash
# Terminal 2
npm run start:p2p -- --port 3001 --p2p-port 4002 --bootstrap-peers "/ip4/127.0.0.1/tcp/4000/p2p/12D3KooW..."
```

Replace the bootstrap peer address with the one from Step 1.

### Step 3: Test the Network

1. **Register an agent on Node 1:**
   ```bash
   curl -X POST http://localhost:3000/register \
     -H "Content-Type: application/json" \
     -d '{"name":"Test Agent","capabilities":["test"]}'
   ```

2. **Check agents on Node 2:**
   ```bash
   curl http://localhost:3001/agents
   ```

The agent should appear on both nodes!

## 🌍 Running Nodes on Different Machines

### Machine A (Public IP: 203.0.113.1)
```bash
npm run start:p2p -- --port 3000 --p2p-port 4000
```

### Machine B (Public IP: 203.0.113.2)
```bash
npm run start:p2p -- --port 3000 --p2p-port 4000 \
  --bootstrap-peers "/ip4/203.0.113.1/tcp/4000/p2p/12D3KooW..."
```

## 🔧 Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `--port` | HTTP API port | 3000 |
| `--p2p-port` | P2P networking port | 4000 |
| `--ipfs-endpoint` | IPFS daemon URL | http://localhost:5001 |
| `--bootstrap-peers` | Comma-separated list of peer addresses | [] |

## 📡 Network Discovery

Beacon nodes use multiple discovery methods:

1. **Bootstrap Peers**: Manually specified peer addresses
2. **mDNS**: Automatic local network discovery
3. **Pub/Sub**: Real-time agent registration broadcasts

## 🔍 Monitoring the Network

### Check Node Info
```bash
curl http://localhost:3000/info
```

### Check Connected Peers
```bash
curl http://localhost:3000/peers
```

### Health Check
```bash
curl http://localhost:3000/health
```

## 🌐 Web Dashboard

Each node has its own web dashboard:
- Node 1: http://localhost:3000
- Node 2: http://localhost:3001

The dashboard shows:
- Local and discovered agents
- Network peers
- Real-time agent events

## 🔄 Agent Synchronization

When an agent registers with any node:

1. **Local Storage**: Agent is stored locally
2. **IPFS Storage**: Agent card is stored on IPFS (if available)
3. **Network Broadcast**: Agent registration is broadcast to all peers
4. **Peer Storage**: Other nodes receive and store the agent

## 🛠️ Troubleshooting

### Nodes Not Connecting
- Check firewall settings (open P2P port)
- Verify bootstrap peer address is correct
- Ensure both nodes are running

### Agents Not Syncing
- Check network connectivity
- Verify pub/sub is working
- Check browser console for errors

### Port Conflicts
- Use different ports for each node
- Check if ports are already in use

## 🔒 Security Considerations

- P2P communication is not encrypted by default
- Consider using VPN or private networks for sensitive deployments
- Implement authentication for production use

## 📈 Scaling

For large networks:

1. **Use multiple bootstrap peers** for redundancy
2. **Deploy nodes in different regions** for global coverage
3. **Use load balancers** for HTTP API access
4. **Monitor network health** with the `/health` endpoint

## 🎯 Example: 3-Node Network

```bash
# Node 1 (Bootstrap)
npm run start:p2p -- --port 3000 --p2p-port 4000

# Node 2 (connects to Node 1)
npm run start:p2p -- --port 3001 --p2p-port 4002 \
  --bootstrap-peers "/ip4/127.0.0.1/tcp/4000/p2p/12D3KooW..."

# Node 3 (connects to Node 1)
npm run start:p2p -- --port 3002 --p2p-port 4004 \
  --bootstrap-peers "/ip4/127.0.0.1/tcp/4000/p2p/12D3KooW..."
```

All nodes will discover each other and share agent information! 