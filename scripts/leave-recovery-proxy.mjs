// Fixed-target loopback gateway; the recovered API stays on an internal network.
import http from 'node:http';
import assert from 'node:assert/strict';
assert.match(process.env.RECOVERY_API_HOST||'',/^ron-leave-recovery-[a-f0-9]+-api$/);
http.createServer((request,response)=>{
 const upstream=http.request({hostname:process.env.RECOVERY_API_HOST,port:4000,path:request.url,method:request.method,headers:request.headers},incoming=>{response.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(response);});
 upstream.on('error',()=>{response.writeHead(502);response.end('Recovered API is starting.');});request.pipe(upstream);
}).listen(4000,'0.0.0.0');
