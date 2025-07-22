import { WebRTCTransport } from './peer_transport/transport.js';
import { WebRTCDirectTransport } from './transport.js';
function webRTCDirect() {
    return (components) => new WebRTCDirectTransport(components);
}
function webRTC(init) {
    return (components) => new WebRTCTransport(components, init ?? {});
}
export { webRTC, webRTCDirect };
//# sourceMappingURL=index.js.map