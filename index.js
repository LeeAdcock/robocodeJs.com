const httpProxy = require('http-proxy');
const http = require('http');
const proxy = httpProxy.createServer();

const port = 5000;

http.createServer(function(req, res) {
    let target;
    if (req.url.startsWith("/api") || req.url.startsWith("/health")) {
      target = 'http://localhost:8080'; //api
    } else {
      target = 'http://localhost:3000' // ui
    }
    try {
        proxy.web(req, res, { target })
        console.log(req.url, "->", target)
    } catch (e) {
        console.log(">>", e)
    }
}).listen(port);

proxy.on('error', function (error, req, res) {
  console.log('proxy error', error);
});