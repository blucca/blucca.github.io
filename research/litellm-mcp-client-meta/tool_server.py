"""Real local tool provider; all fixture labels are synthetic."""
import json
from mcp.server.mcpserver import Context, MCPServer

server = MCPServer("meta-echo")

@server.tool()
async def capture_meta(record: str, ctx: Context) -> str:
    """Return the record and the metadata received by this tool."""
    await ctx.report_progress(progress=0.5, total=1.0, message="metadata received")
    return json.dumps({"record": record, "meta": ctx.request_context.meta or {}}, ensure_ascii=False)

if __name__ == "__main__":
    server.run(transport="streamable-http", host="127.0.0.1", port=8765, streamable_http_path="/mcp")
