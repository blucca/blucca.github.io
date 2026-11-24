import json, sys, pathlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
root=pathlib.Path(sys.argv[1]); root.mkdir(parents=True,exist_ok=True)
answer='Windows fixture: café · 中文 · ✓'
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        data=json.dumps({'data':[{'id':'fixture-model','object':'model'}]}).encode()
        self.send_response(200); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_POST(self):
        data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        with (root/'requests.jsonl').open('a',encoding='utf-8') as f: f.write(json.dumps({'path':self.path,'request':data},ensure_ascii=False)+'\n')
        msg={'id':'msg_fixture','type':'message','role':'assistant','status':'completed','content':[{'type':'output_text','text':answer,'annotations':[]}]}
        response={'id':'resp_fixture','object':'response','created_at':1795485600,'status':'completed','model':'fixture-model','output':[msg],'usage':{'input_tokens':42,'output_tokens':7,'total_tokens':49,'input_tokens_details':{'cached_tokens':10},'output_tokens_details':{'reasoning_tokens':2}}}
        events=[
          {'type':'response.created','response':{**response,'status':'in_progress','output':[]}},
          {'type':'response.output_item.added','output_index':0,'item':{**msg,'status':'in_progress','content':[]}},
          {'type':'response.content_part.added','item_id':msg['id'],'output_index':0,'content_index':0,'part':{'type':'output_text','text':'','annotations':[]}},
          {'type':'response.output_text.delta','item_id':msg['id'],'output_index':0,'content_index':0,'delta':answer},
          {'type':'response.output_text.done','item_id':msg['id'],'output_index':0,'content_index':0,'text':answer},
          {'type':'response.content_part.done','item_id':msg['id'],'output_index':0,'content_index':0,'part':msg['content'][0]},
          {'type':'response.output_item.done','output_index':0,'item':msg},
          {'type':'response.completed','response':response}]
        body=''.join('event: '+e['type']+'\ndata: '+json.dumps(e,ensure_ascii=False)+'\n\n' for e in events).encode('utf-8')
        self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
ThreadingHTTPServer(('127.0.0.1',18743),Handler).serve_forever()
