"""Bound JSON ingress before parsing, without reflecting request contents."""
from fastapi.responses import JSONResponse


class BodyLimit:
    def __init__(self,app,limit):
        self.app,self.limit=app,limit

    async def reject(self,scope,receive,send,code,status):
        response=JSONResponse(status_code=status,content={"error":{"code":code,"message":code,
            "retryable":False,"details":{}}})
        await response(scope,receive,send)

    async def __call__(self,scope,receive,send):
        if scope["type"]!="http":
            return await self.app(scope,receive,send)
        lengths=[value for name,value in scope.get("headers",[]) if name==b"content-length"]
        try:
            if len(lengths)>1:raise ValueError()
            length=int(lengths[0]) if lengths else None
            if length is not None and length<0:raise ValueError()
        except ValueError:
            return await self.reject(scope,receive,send,"invalid_request",400)
        if length is not None and length>self.limit:
            return await self.reject(scope,receive,send,"payload_too_large",413)
        parts=[]
        size=0
        while True:
            message=await receive()
            if message["type"]=="http.disconnect":return
            if message["type"]!="http.request":continue
            chunk=message.get("body",b"")
            size+=len(chunk)
            if size>self.limit:
                return await self.reject(scope,receive,send,"payload_too_large",413)
            parts.append(chunk)
            if not message.get("more_body",False):break
        body=b"".join(parts)
        replayed=False
        async def replay():
            nonlocal replayed
            if not replayed:
                replayed=True
                return {"type":"http.request","body":body,"more_body":False}
            return await receive()
        return await self.app(scope,replay,send)
