const { createProxyMiddleware } = require('http-proxy-middleware')

module.exports = function (app) {
    app.use(
        '/api',
        createProxyMiddleware({
            target: 'https://port-8080-battletank-io-lee508578.preview.codeanywhere.com/',
            changeOrigin: true,
        })
    )
}
