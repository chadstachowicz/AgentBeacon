import AgentSDK from '../src/agent-sdk.js';

// Example agent registration
async function registerExampleAgent() {
    const agentSDK = new AgentSDK({
        beaconUrl: 'http://localhost:3000'
    });

    // Define the agent's capabilities and information
    const agentData = {
        name: 'Example AI Agent',
        description: 'A sample AI agent that demonstrates the beacon network',
        capabilities: [
            'text-generation',
            'code-analysis',
            'data-processing'
        ],
        version: '1.0.0',
        endpoint: 'http://localhost:8080/api',
        metadata: {
            model: 'gpt-4',
            maxTokens: 4096,
            temperature: 0.7
        },
        tags: ['ai', 'nlp', 'development']
    };

    try {
        // Register the agent
        const result = await agentSDK.register(agentData);
        console.log('Registration result:', result);

        // Listen for other agent events
        agentSDK.on('agentRegistered', (agent) => {
            console.log('🎉 New agent joined the network:', agent.name);
        });

        agentSDK.on('agentDiscovered', (agent) => {
            console.log('🔍 Discovered agent:', agent.name);
        });

        // Keep the agent running
        console.log('🤖 Agent is now running. Press Ctrl+C to stop.');
        
        // Graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\n🛑 Shutting down agent...');
            await agentSDK.unregister();
            process.exit(0);
        });

    } catch (error) {
        console.error('❌ Failed to register agent:', error.message);
        process.exit(1);
    }
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
    registerExampleAgent();
}

export default registerExampleAgent; 