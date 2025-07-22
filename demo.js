import SimpleBeaconNode from './src/beacon-node-simple.js';
import AgentSDK from './src/agent-sdk.js';

async function runDemo() {
    console.log('🎬 Beacon Network Demo\n');
    
    let beaconNode;
    const agents = [];

    try {
        // Start beacon node
        console.log('🚀 Starting Beacon Node...');
        beaconNode = new SimpleBeaconNode({ port: 3000 });
        await beaconNode.start();
        console.log('✅ Beacon Node ready!\n');

        // Register multiple agents
        const agentConfigs = [
            {
                name: 'GPT-4 Assistant',
                description: 'Advanced language model for text generation and analysis',
                capabilities: ['text-generation', 'code-analysis', 'translation'],
                version: '4.0.0',
                tags: ['ai', 'nlp', 'gpt']
            },
            {
                name: 'Data Processing Agent',
                description: 'Specialized in data cleaning and analysis',
                capabilities: ['data-processing', 'statistics', 'visualization'],
                version: '2.1.0',
                tags: ['data', 'analytics', 'ml']
            },
            {
                name: 'Code Review Bot',
                description: 'Automated code review and quality assessment',
                capabilities: ['code-review', 'static-analysis', 'security-scan'],
                version: '1.5.0',
                tags: ['development', 'security', 'quality']
            }
        ];

        console.log('🤖 Registering Agents...');
        for (const config of agentConfigs) {
            const agentSDK = new AgentSDK({ beaconUrl: 'http://localhost:3000' });
            const result = await agentSDK.register(config);
            agents.push({ sdk: agentSDK, id: result.agentId, name: config.name });
            console.log(`   ✅ ${config.name} registered (${result.agentId})`);
        }

        console.log('\n📊 Network Status:');
        const healthResponse = await fetch('http://localhost:3000/health');
        const healthData = await healthResponse.json();
        console.log(`   - Node ID: ${healthData.nodeId}`);
        console.log(`   - Agents: ${healthData.agentCount}`);
        console.log(`   - Uptime: ${Math.floor(healthData.uptime)}s`);

        console.log('\n🔍 Agent Discovery Demo:');
        const agentsResponse = await fetch('http://localhost:3000/agents');
        const agentsData = await agentsResponse.json();
        
        agentsData.agents.forEach((agent, index) => {
            console.log(`\n${index + 1}. ${agent.name}`);
            console.log(`   ID: ${agent.id}`);
            console.log(`   Capabilities: ${agent.capabilities.join(', ')}`);
            console.log(`   Tags: ${agent.tags.join(', ')}`);
            console.log(`   Status: ${agent.status}`);
        });

        console.log('\n🌐 Web Dashboard: http://localhost:3000');
        console.log('📡 API Endpoints:');
        console.log('   - GET /health - Health check');
        console.log('   - GET /agents - List all agents');
        console.log('   - POST /register - Register agent');
        console.log('   - GET /agents/:id - Get specific agent');

        console.log('\n⏰ Demo will run for 30 seconds...');
        console.log('Press Ctrl+C to stop early\n');

        // Keep running for demo
        await new Promise(resolve => setTimeout(resolve, 30000));

    } catch (error) {
        console.error('❌ Demo failed:', error.message);
    } finally {
        // Cleanup
        console.log('\n🧹 Cleaning up...');
        
        for (const agent of agents) {
            try {
                await agent.sdk.unregister();
                console.log(`   📤 Unregistered ${agent.name}`);
            } catch (e) {
                console.warn(`   ⚠️  Failed to unregister ${agent.name}:`, e.message);
            }
        }
        
        if (beaconNode) {
            await beaconNode.stop();
            console.log('   🛑 Beacon node stopped');
        }
        
        console.log('✅ Demo completed!');
    }
}

// Run demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runDemo();
}

export { runDemo }; 