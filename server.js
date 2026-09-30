import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";
const WIDGET_URI = "ui://creative-coatings/project-intake-v3.html";
const widgetHtml = readFileSync("public/intake-widget.html", "utf8");

function createAppServer() {
  const server = new McpServer({
    name: "creative-coatings-project-intake",
    version: "0.3.0",
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

  server.registerTool(
    "search_printavo_contacts",
    {
      title: "Search Printavo customers",
      description:
        "Search Creative Coatings Printavo contacts by customer name and return matching contact details for the intake form.",
      inputSchema: z.object({
        query: z.string().min(2),
      }),
    },
    async ({ query }) => {
      const email = process.env.PRINTAVO_EMAIL;
      const token = process.env.PRINTAVO_API_TOKEN;

      if (!email || !token) {
        return {
          content: [{ type: "text", text: "Printavo credentials are not configured." }],
          structuredContent: { contacts: [], error: "PRINTAVO_NOT_CONFIGURED" },
          isError: true,
        };
      }

      const graphQuery = `
        query SearchContacts($query: String!) {
          contacts(query: $query, first: 10, primaryOnly: true) {
            nodes {
              id
              firstName
              lastName
              fullName
              email
              phone
              orderCount
              customer {
                id
                companyName
              }
            }
          }
        }
      `;

      try {
        const response = await fetch("https://www.printavo.com/api/v2", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            email,
            token,
          },
          body: JSON.stringify({
            query: graphQuery,
            variables: { query: query.trim() },
          }),
        });

        const payload = await response.json();

        if (!response.ok || payload.errors) {
          console.error("Printavo search error:", payload.errors || payload);
          return {
            content: [{ type: "text", text: "Printavo customer search failed." }],
            structuredContent: { contacts: [], error: "PRINTAVO_SEARCH_FAILED" },
            isError: true,
          };
        }

        const contacts = payload?.data?.contacts?.nodes ?? [];
        return {
          content: [
            {
              type: "text",
              text: contacts.length
                ? `Found ${contacts.length} matching Printavo contact(s).`
                : "No matching Printavo contacts found.",
            },
          ],
          structuredContent: { contacts },
        };
      } catch (error) {
        console.error("Printavo request failed:", error);
        return {
          content: [{ type: "text", text: "Unable to reach Printavo." }],
          structuredContent: { contacts: [], error: "PRINTAVO_UNAVAILABLE" },
          isError: true,
        };
      }
    }
  );

  registerAppTool(
    server,
    "open_project_intake",
    {
      title: "Open Creative Coatings project intake",
      description:
        "Use this whenever the user asks to start, create, open, or fill out a Creative Coatings new project intake. Opens the interactive employee intake form with clickable choices.",
      inputSchema: z.object({}),
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
        version: "0.3.0",
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
      .end("Creative Coatings Project Intake MCP server v0.3.0");
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    res
      .writeHead(200, { "content-type": "application/json; charset=utf-8" })
      .end(
        JSON.stringify({
          ok: true,
          service: "creative-coatings-project-intake",
          version: "0.3.0",
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
