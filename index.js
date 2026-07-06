const httpProxy = require('http-proxy');
const http = require('node:http');
const proxy = httpProxy.createServer();

const port = 5000;

http
  .createServer(function (req, res) {
    let target;
    // The OAuth 2.1 authorization-server endpoints (/authorize, /token,
    // /register, /revoke) and the .well-known metadata live at the app root, so
    // route them to the server alongside /api and /health. /mcp/authorize is NOT
    // matched here (it starts with /mcp) — it's the SPA approval page on the UI.
    if (
      req.url.startsWith('/api') ||
      req.url.startsWith('/health') ||
      req.url.startsWith('/.well-known') ||
      req.url.startsWith('/authorize') ||
      req.url.startsWith('/token') ||
      req.url.startsWith('/register') ||
      req.url.startsWith('/revoke')
    ) {
      target = 'http://localhost:8080'; //api
    } else {
      target = 'http://localhost:3000'; // ui
    }
    try {
      proxy.web(req, res, { target });
      console.log(req.url, '->', target);
    } catch (e) {
      console.log('>>', e);
    }
  })
  .listen(port);

proxy.on('error', function (error, req, res) {
  console.log('proxy error', error);
});
