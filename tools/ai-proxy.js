#!/usr/bin/env node
'use strict';

const http=require('http');
const https=require('https');
const crypto=require('crypto');

const DEFAULT_PORT=7842;
const DEFAULT_MODEL='deepseek-v4-flash';
const ALLOWED_MODELS=new Set(['deepseek-v4-flash','deepseek-v4-pro']);
const MAX_BODY_BYTES=120000;
const MAX_MESSAGES=10;
const MAX_TOKENS=2048;
const REQUEST_TIMEOUT_MS=120000;
const portArg=process.argv.find(arg=>arg.startsWith('--port='));
const port=portArg?Number(portArg.slice(7)):DEFAULT_PORT;
const apiKey=process.env.DEEPSEEK_API_KEY||'';
const sessionToken=process.env.AI_SESSION_TOKEN||crypto.randomBytes(24).toString('base64url');

if(!Number.isInteger(port)||port<1024||port>65535){
  process.stderr.write('AI 代理端口必须是 1024-65535 之间的整数。\n');
  process.exit(1);
}

function setCors(res){
  res.setHeader('Access-Control-Allow-Origin','null');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, X-AI-Session');
  res.setHeader('Vary','Origin');
}
function sendJson(res,status,payload){
  setCors(res);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(payload));
}
function validMessages(messages){
  return Array.isArray(messages)&&messages.length>0&&messages.length<=MAX_MESSAGES&&messages.every(message=>
    message&&typeof message==='object'&&['system','user','assistant'].includes(message.role)&&typeof message.content==='string'&&message.content.length<=30000
  );
}
function proxyChat(req,res,body){
  if(req.headers['x-ai-session']!==sessionToken){sendJson(res,403,{error:'会话访问码无效'});return;}
  if(!apiKey){sendJson(res,503,{error:'代理未设置 DEEPSEEK_API_KEY'});return;}
  if(!validMessages(body.messages)||!ALLOWED_MODELS.has(body.model||DEFAULT_MODEL)){sendJson(res,400,{error:'请求格式或模型不符合限制'});return;}
  const upstreamBody=JSON.stringify({
    model:body.model||DEFAULT_MODEL,
    messages:body.messages,
    stream:body.stream!==false,
    temperature:typeof body.temperature==='number'?Math.min(Math.max(body.temperature,0),1):0.3,
    max_tokens:Math.min(Math.max(Number(body.max_tokens)||1200,1),MAX_TOKENS)
  });
  const upstream=https.request({hostname:'api.deepseek.com',path:'/chat/completions',method:'POST',headers:{
    'Content-Type':'application/json','Content-Length':Buffer.byteLength(upstreamBody),'Authorization':'Bearer '+apiKey,'Accept':'text/event-stream'
  }},upstreamRes=>{
    setCors(res);
    res.writeHead(upstreamRes.statusCode||502,{'Content-Type':upstreamRes.headers['content-type']||'application/json; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
    upstreamRes.pipe(res);
  });
  const stop=()=>upstream.destroy();
  req.on('aborted',stop);res.on('close',stop);
  upstream.setTimeout(REQUEST_TIMEOUT_MS,()=>upstream.destroy(new Error('upstream timeout')));
  upstream.on('error',()=>{if(!res.headersSent)sendJson(res,502,{error:'无法连接 DeepSeek 服务'});else res.end();});
  upstream.write(upstreamBody);upstream.end();
}

const server=http.createServer((req,res)=>{
  if(req.method==='OPTIONS'){setCors(res);res.writeHead(204);res.end();return;}
  if(req.method==='GET'&&req.url==='/health'){sendJson(res,200,{ok:true,hasKey:!!apiKey,model:DEFAULT_MODEL});return;}
  if(req.method!=='POST'||req.url!=='/chat'){sendJson(res,404,{error:'未找到接口'});return;}
  let size=0;let raw='';
  req.on('data',chunk=>{size+=chunk.length;if(size>MAX_BODY_BYTES){req.destroy();return;}raw+=chunk;});
  req.on('end',()=>{try{proxyChat(req,res,JSON.parse(raw));}catch(_){sendJson(res,400,{error:'请求 JSON 无效'});}});
});
server.on('error',error=>{process.stderr.write('AI 代理启动失败：'+error.message+'\n');process.exit(1);});
server.listen(port,'127.0.0.1',()=>{
  process.stdout.write('DeepSeek AI 代理已启动：http://127.0.0.1:'+port+'\n');
  process.stdout.write('请在工作台 AI 设置中输入本次会话访问码（仅存当前页面内存）：'+sessionToken+'\n');
  if(!apiKey)process.stdout.write('提示：未检测到 DEEPSEEK_API_KEY，代理仅可健康检查。\n');
});
