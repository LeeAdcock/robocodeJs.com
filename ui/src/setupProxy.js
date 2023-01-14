const { createProxyMiddleware } = require('http-proxy-middleware')

module.exports = function (app) {
    app.use(
        '/api',
        createProxyMiddleware({
            target: 'https://leeadcock-stunning-space-umbrella-jq66qrwgw52pv99-8080.preview.app.github.dev/',
            changeOrigin: true,
        })
    )
}
