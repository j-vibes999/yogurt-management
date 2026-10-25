const http = require('http');
const fs = require('fs');
const path = require('path');
const htmlPath = path.join(__dirname, 'preview.html');
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/preview.html') {
    fs.readFile(htmlPath, (err, data) => {
      if (err) { res.writeHead(500, {'Content-Type':'text/plain; charset=utf-8'}); res.end('Preview unavailable'); return; }
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}); res.end(data);
    });
    return;
  }
  res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); res.end('Not found');
});
server.listen(3000, '127.0.0.1', () => console.log('Yogurt preview running at http://127.0.0.1:3000'));
