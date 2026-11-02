import type { Request } from "express";

/** True when the request is a trusted MCP server loopback call. */
export function isMcpLoopbackRequest(req: Request): boolean {
  const secret = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";
  if (!secret) return false;
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  return bearerToken === secret;
}
