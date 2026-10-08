/** Content-Length framed JSON-RPC peer with bounded UTF-8 buffers and cancellable requests. */
export class JsonRpcPeer {
  constructor(input,output,{onRequest=async()=>null,onNotification=()=>{},maxBytes=12*1024*1024}={}){
    this.input=input;this.output=output;this.onRequest=onRequest;this.onNotification=onNotification;this.maxBytes=maxBytes;
    this.buffer=Buffer.alloc(0);this.expected=null;this.pending=new Map();this.sequence=0;this.closed=false;
    this.read=chunk=>{try{this.feed(Buffer.from(chunk));}catch(error){this.close(error);}};
    this.end=()=>this.close(Error('Language server closed its output'));
    this.writeError=error=>this.close(error);output.on('error',this.writeError);
    input.on('data',this.read);input.on('end',this.end);input.on('error',this.end);
  }
  send(message){
    if(this.closed)throw Error('Language server transport is closed');
    const body=Buffer.from(JSON.stringify({jsonrpc:'2.0',...message}));if(body.length>this.maxBytes)throw Error('Language message exceeds byte limit');
    if((this.output.writableLength??0)>2*this.maxBytes)throw Error('Language server output backpressure limit exceeded');
    this.output.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`),body]));
  }
  notify(method,params){this.send({method,params});}
  request(method,params,{signal,timeoutMs=30000}={}){
    if(signal?.aborted)return Promise.reject(new DOMException('Request cancelled','AbortError'));
    if(this.pending.size>=128)return Promise.reject(Error('Too many pending language requests'));
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const finish=(error,value)=>{const item=this.pending.get(id);if(!item)return;this.pending.delete(id);clearTimeout(item.timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
      const abort=()=>{try{this.notify('$/cancelRequest',{id});}catch{}finish(new DOMException('Request cancelled','AbortError'));};
      const timer=setTimeout(()=>{try{this.notify('$/cancelRequest',{id});}catch{}finish(Error(`Language request timed out: ${method}`));},timeoutMs);
      this.pending.set(id,{finish,timer});signal?.addEventListener('abort',abort,{once:true});
      try{this.send({id,method,params});}catch(error){finish(error);}
    });
  }
  feed(chunk){
    if(this.closed)return;
    if(this.buffer.length+chunk.length>2*this.maxBytes+16384)throw Error('Language input buffer exceeds limit');
    this.buffer=Buffer.concat([this.buffer,chunk]);
    for(;;){
      if(this.expected===null){
        const end=this.buffer.indexOf('\r\n\r\n');if(end<0){if(this.buffer.length>8192)throw Error('Oversized language header');return;}
        if(end>8192)throw Error('Oversized language header');
        const headers=this.buffer.subarray(0,end).toString('ascii').split('\r\n'),lengths=headers.filter(line=>/^content-length:/i.test(line));
        if(lengths.length!==1||!/^content-length:\s*\d+\s*$/i.test(lengths[0]))throw Error('Invalid Content-Length');
        this.expected=Number(lengths[0].split(':')[1]);if(!Number.isSafeInteger(this.expected)||this.expected<1||this.expected>this.maxBytes)throw Error('Invalid language message size');
        this.buffer=this.buffer.subarray(end+4);
      }
      if(this.buffer.length<this.expected)return;
      const bytes=this.buffer.subarray(0,this.expected);this.buffer=this.buffer.subarray(this.expected);this.expected=null;
      this.deliver(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
    }
  }
  deliver(message){
    if(!message||message.jsonrpc!=='2.0'||Array.isArray(message))throw Error('Invalid JSON-RPC envelope');
    if(typeof message.method==='string'){
      if(Object.hasOwn(message,'id'))Promise.resolve().then(()=>this.onRequest(message.method,message.params)).then(
        result=>{if(!this.closed)this.send({id:message.id,result:result??null});},
        error=>{if(!this.closed)this.send({id:message.id,error:{code:-32603,message:error.message}});}).catch(error=>this.close(error));
      else this.onNotification(message.method,message.params);
    }else{
      const item=this.pending.get(message.id);if(!item)return;
      if(message.error){const error=new Error(message.error.message??'Language server error');error.code=message.error.code;item.finish(error);}
      else if(Object.hasOwn(message,'result'))item.finish(null,message.result);else throw Error('Invalid language response');
    }
  }
  close(error=Error('Language transport closed')){
    if(this.closed)return;this.closed=true;this.input.off('data',this.read);this.input.off('end',this.end);this.input.off('error',this.end);
    for(const item of [...this.pending.values()])item.finish(error);this.buffer=Buffer.alloc(0);
  }
}
