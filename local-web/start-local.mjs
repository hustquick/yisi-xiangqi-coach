import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

const root=import.meta.dirname;
const resources=new Map([
  ['index.html','text/html; charset=utf-8'],['app.js','application/javascript'],
  ['style.css','text/css; charset=utf-8'],['engine-data.js','application/javascript'],
  ['pikafish.js','application/javascript'],['PIKAFISH-LICENSE.txt','text/plain; charset=utf-8'],
  ['PIKAFISH-SOURCE.txt','text/plain; charset=utf-8'],
]);
export function createLocalWebServer(){
  return createServer(async(req,res)=>{
    try{
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
      const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const file=path==='/'?'index.html':path.slice(1);
      if(!resources.has(file)){res.writeHead(404);res.end('Not found');return;}
      const location=resolve(root,file),info=await stat(location);
      res.writeHead(200,{'Content-Type':resources.get(file),'Content-Length':info.size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
      if(req.method==='HEAD'){res.end();return;}
      const stream=createReadStream(location);stream.on('error',()=>res.destroy());stream.pipe(res);
    }catch{if(!res.headersSent){res.writeHead(404);res.end('Not found');}else res.destroy();}
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const port=Number(process.env.PORT??8080);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('端口设置错误');
  const server=createLocalWebServer();
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'8080 端口已被占用，请关闭原本地服务后重试。':error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>{
    const url=`http://localhost:${port}/`;
    console.log(`弈思本地运行版：${url}\n计算引擎从本机加载，账号和网络对战接入云端。\n关闭此窗口即可停止本地服务。`);
    if(process.argv.includes('--open')){
      const command=process.platform==='darwin'?'open':process.platform==='win32'?'cmd':'xdg-open';
      const args=process.platform==='win32'?['/c','start','',url]:[url];
      const child=spawn(command,args,{stdio:'ignore'});child.on('error',()=>console.log(`请手动打开 ${url}`));child.unref();
    }
  });
}
