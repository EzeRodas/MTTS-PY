// Initialize QWebChannel bridge globally and dispatch event when ready
var api = null;
new QWebChannel(qt.webChannelTransport, function(channel) {
    api = channel.objects.bridge;
    window.api = api;
    const event = new CustomEvent('bridgeReady', { detail: api });
    window.dispatchEvent(event);
});
