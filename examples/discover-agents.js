import AgentSDK from '../src/agent-sdk.js';

// Example agent discovery
async function discoverAgents() {
    const agentSDK = new AgentSDK({
        beaconUrl: 'http://localhost:3000'
    });

    try {
        console.log('🔍 Discovering agents in the network...\n');

        // Discover all agents
        const allAgents = await agentSDK.discoverAgents();
        console.log(`📊 Found ${allAgents.length} agents in the network:`);
        
        allAgents.forEach((agent, index) => {
            console.log(`\n${index + 1}. ${agent.name}`);
            console.log(`   ID: ${agent.id}`);
            console.log(`   Description: ${agent.description}`);
            console.log(`   Capabilities: ${agent.capabilities.join(', ')}`);
            console.log(`   Version: ${agent.version}`);
            console.log(`   Registered: ${new Date(agent.registeredAt).toLocaleString()}`);
            if (agent.tags && agent.tags.length > 0) {
                console.log(`   Tags: ${agent.tags.join(', ')}`);
            }
        });

        // Example: Discover agents with specific capabilities
        console.log('\n🔍 Searching for agents with text-generation capability...');
        const textGenAgents = await agentSDK.discoverAgents({ capability: 'text-generation' });
        console.log(`Found ${textGenAgents.length} text generation agents:`);
        textGenAgents.forEach(agent => {
            console.log(`  - ${agent.name}`);
        });

        // Example: Get details of a specific agent
        if (allAgents.length > 0) {
            const firstAgent = allAgents[0];
            console.log(`\n📋 Getting detailed info for: ${firstAgent.name}`);
            const detailedAgent = await agentSDK.getAgent(firstAgent.id);
            if (detailedAgent) {
                console.log('Detailed agent info:', JSON.stringify(detailedAgent, null, 2));
            }
        }

        // Listen for real-time agent events
        console.log('\n👂 Listening for real-time agent events...');
        agentSDK.on('agentRegistered', (agent) => {
            console.log(`🎉 New agent registered: ${agent.name} (${agent.id})`);
        });

        agentSDK.on('agentDiscovered', (agent) => {
            console.log(`🔍 Agent discovered: ${agent.name} (${agent.id})`);
        });

        agentSDK.on('agentUnregistered', (agent) => {
            console.log(`📤 Agent unregistered: ${agent.name} (${agent.id})`);
        });

        // Keep running to listen for events
        console.log('Press Ctrl+C to stop listening...');
        
        process.on('SIGINT', () => {
            console.log('\n🛑 Stopping agent discovery...');
            process.exit(0);
        });

    } catch (error) {
        console.error('❌ Failed to discover agents:', error.message);
        process.exit(1);
    }
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
    discoverAgents();
}

export default discoverAgents; 