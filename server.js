import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const PORT = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";
const WIDGET_URI = "ui://creative-coatings/project-intake-v2.html";
const widgetHtml = readFileSync("public/intake-widget.html", "utf8");

function createAppServer() {
  const server = new McpServer({
    name: "creative-coatings-project-intake",
    version: "0.2.0",
  });

  registerAppResource(
    server,
    "creative-coatings-intake-widget",
    WIDGET_URI,
    {},
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml,
          _meta: {
            ui: { prefersBorder: true },
            "openai/widgetDescription":
              "Interactive Creative Coatings employee intake form with clickable choices that produces a Printavo-ready project summary.",
          },
        },
      ],
    })
  );

  registerAppTool(
    server,
    "open_project_intake",
    {
      title: "Open Creative Coatings project intake",
      description:
        "Use this whenever the user asks to start, create, open, or fill out a Creative Coatings new project intake. Opens the interactive employee intake form with clickable choices.",
      inputSchema: {},
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "Opening project intake...",
        "openai/toolInvocation/invoked": "Project intake opened.",
      },
    },
    async () => ({
      content: [
        {
          type: "text",
          text: "The Creative Coatings Project Intake is open. Complete the guided intake in the interactive panel.",
        },
      ],
      structuredContent: {
        mode: "new_project_intake",
        version: "0.2.0",
      },
    })
  );

  return server;
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  console.log(`${req.method ?? "?"} ${url.pathname}`);

  if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res
      .writeHead(200, { "content-type": "text/plain; charset=utf-8" })
      .end("Creative Coatings Project Intake MCP server v0.2.0");
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    res
      .writeHead(200, { "content-type": "application/json; charset=utf-8" })
      .end(
        JSON.stringify({
          ok: true,
          service: "creative-coatings-project-intake",
          version: "0.2.0",
        })
      );
    return;
  }

  const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname === MCP_PATH && req.method && MCP_METHODS.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createAppServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.writeHead(500).end("Internal server error");
      }
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Creative Coatings intake MCP listening on http://0.0.0.0:${PORT}${MCP_PATH}`
  );
});
