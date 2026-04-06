import asyncio
from pathlib import Path

from langchain_mcp_adapters.client import MultiServerMCPClient


REPO_ROOT = Path(__file__).resolve().parents[2]

async def test_mcp_return():
    # Attempt to connect to the running server on 8002
    servers_config = {
        "mcp-chest-xray-sse": {
            "transport": "sse",
            "url": "http://localhost:8002/sse",
        }
    }
    
    try:
        client = MultiServerMCPClient(servers_config, tool_name_prefix=False)
        tools = await client.get_tools()
        
        analyze_tool = next(t for t in tools if t.name == "analyze_xray")
        
        # We need a valid path that exists
        test_path = REPO_ROOT / "1_core_orchestrator" / "backend" / ".deer-flow" / "threads" / "9d5fc279-93b5-49e6-8eb8-3f86503eede1" / "user-data" / "uploads" / "屏幕截图 2026-03-24 165352.png"
        
        print(f"Calling tool with path: {test_path}")
        # Note: We call the original underlying coroutine directly to see its raw return
        # result = await analyze_tool.coroutine(image_path=test_path)
        # Actually, let's use the tool object directly
        result = await analyze_tool.ainvoke({"image_path": str(test_path)})
        
        print(f"Result Type: {type(result)}")
        print(f"Result Content: {result}")
        
        # If it's a list (LangChain tool output)
        if isinstance(result, list):
             print(f"First element type: {type(result[0])}")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_mcp_return())
