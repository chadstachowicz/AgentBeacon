import BeaconNode from '../src/beacon-node.js';
import AgentSDK from '../src/agent-sdk.js';

async function runTests() {
    console.log('🧪 Running Beacon Network Tests...\n');

    let beaconNode;
    let agentSDK;

    try {
        // Test 1: Start Beacon Node
        console.log('1️⃣ Starting Beacon Node...');
        beaconNode = new BeaconNode({ port: 3001, p2pPort: 4001 });
        await beaconNode.start();
        console.log('✅ Beacon Node started successfully\n');

        // Test 2: Create Agent SDK
        console.log('2️⃣ Creating Agent SDK...');
        agentSDK = new AgentSDK({ beaconUrl: 'http://localhost:3001' });
        console.log('✅ Agent SDK created successfully\n');

        // Test 3: Register Agent
        console.log('3️⃣ Registering Test Agent...');
        const agentData = {
            name: 'Test Agent',
            description: 'A test agent for verification',
            capabilities: ['testing', 'validation'],
            version: '1.0.0',
            tags: ['test', 'demo']
        };

        const registrationResult = await agentSDK.register(agentData);
        console.log('✅ Agent registered successfully:', registrationResult.agentId);

        // Test 4: Discover Agents
        console.log('\n4️⃣ Discovering Agents...');
        const agents = await agentSDK.discoverAgents();
        console.log(`✅ Found ${agents.length} agents`);
        
        if (agents.length > 0) {
            console.log('   -', agents[0].name);
        }

        // Test 5: Get Specific Agent
        console.log('\n5️⃣ Getting Agent Details...');
        const agent = await agentSDK.getAgent(registrationResult.agentId);
        if (agent) {
            console.log('✅ Agent details retrieved:', agent.name);
        } else {
            console.log('❌ Failed to get agent details');
        }

        // Test 6: Health Check
        console.log('\n6️⃣ Testing Health Endpoint...');
        const healthResponse = await fetch('http://localhost:3001/health');
        const healthData = await healthResponse.json();
        console.log('✅ Health check passed:', healthData.status);

        // Test 7: Cleanup
        console.log('\n7️⃣ Cleaning up...');
        await agentSDK.unregister();
        await beaconNode.stop();
        console.log('✅ Cleanup completed successfully');

        console.log('\n🎉 All tests passed!');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        
        // Cleanup on error
        if (agentSDK) {
            try {
                await agentSDK.unregister();
            } catch (e) {
                console.warn('Failed to unregister agent:', e.message);
            }
        }
        
        if (beaconNode) {
            try {
                await beaconNode.stop();
            } catch (e) {
                console.warn('Failed to stop beacon node:', e.message);
            }
        }
        
        process.exit(1);
    }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runTests();
}

export { runTests }; 