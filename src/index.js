// garmin-coach-mcp : serveur MCP distant (Cloudflare Workers) pour l'API personnelle Garmin Connect.
// Secrets requis (Settings > Variables and secrets, type Secret) :
//   GARMIN_API_KEY   : clé API personnelle Garmin Connect
//   MCP_SECRET       : chaîne aléatoire longue, incluse dans l'URL du connecteur
// Lecture seule. Aucune donnée n'est stockée.

const GARMIN = "https://personal.connectapi.garmin.com";
const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";
const ACTIVITY_LIST_PATH = "/activitylist-service/activities/search/activities";
const ACTIVITY_DETAIL_PATH = "/activity-service/activity/";

let cachedToken = null;
let cachedAt = 0;

async function getAccessToken(env) {
  // Jeton valable ~24 h ; on le renouvelle après 20 h.
  if (cachedToken && Date.now() - cachedAt < 20 * 3600 * 1000) return cachedToken;
  const res = await fetch(GARMIN + TOKEN_PATH, {
    method: "POST",
    headers: { Authorization: "ApiKey " + env.GARMIN_API_KEY },
  });
  if (!res.ok) throw new Error("Échec de l'obtention du jeton Garmin (HTTP " + res.status + ")");
  const data = await res.json();
  const token = data.access_token || data.token;
  if (!token) throw new Error("Réponse de jeton Garmin inattendue");
  cachedToken = token;
  cachedAt = Date.now();
  return token;
}

async function garminGet(env, path) {
  const token = await getAccessToken(env);
  const res = await fetch(GARMIN + path, {
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
  });
  if (res.status === 401) {
    cachedToken = null; // jeton expiré : on le renouvellera au prochain appel
    throw new Error("Garmin a refusé le jeton (401)");
  }
  if (!res.ok) throw new Error("Erreur Garmin (HTTP " + res.status + ")");
  return res.json();
}

const TOOLS = [
  {
    name: "list_activities",
    description: "Liste les activités Garmin récentes (vélo, course, etc.). Filtre optionnel par dates.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Nombre d'activités (1-100)", default: 10 },
        start_date: { type: "string", description: "Date de début YYYY-MM-DD" },
        end_date: { type: "string", description: "Date de fin YYYY-MM-DD" },
        activity_type: { type: "string", description: "Type d'activité Garmin, ex. cycling, running" },
      },
    },
  },
  {
    name: "get_activity",
    description: "Détail d'une activité Garmin (durée, distance, puissance, FC, cadence, etc.).",
    inputSchema: {
      type: "object",
      properties: { activity_id: { type: "string", description: "Identifiant de l'activité" } },
      required: ["activity_id"],
    },
  },
];

async function callTool(env, name, args) {
  if (name === "list_activities") {
    const limit = Math.min(Math.max(parseInt(args.limit || 10, 10), 1), 100);
    const q = new URLSearchParams({ start: "0", limit: String(limit) });
    if (args.start_date) q.set("startDate", args.start_date);
    if (args.end_date) q.set("endDate", args.end_date);
    if (args.activity_type) q.set("activityType", args.activity_type);
    return garminGet(env, ACTIVITY_LIST_PATH + "?" + q.toString());
  }
  if (name === "get_activity") {
    const id = String(args.activity_id || "").replace(/[^0-9]/g, "");
    if (!id) throw new Error("activity_id invalide");
    return garminGet(env, ACTIVITY_DETAIL_PATH + id);
  }
  throw new Error("Outil inconnu : " + name);
}

function rpc(id, result) {
  return Response.json({ jsonrpc: "2.0", id, result });
}
function rpcError(id, code, message) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Chemin attendu : /mcp/<MCP_SECRET>
    if (url.pathname !== "/mcp/" + env.MCP_SECRET) {
      return new Response("Not found", { status: 404 });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    let msg;
    try {
      msg = await request.json();
    } catch {
      return rpcError(null, -32700, "JSON invalide");
    }
    const id = msg.id ?? null;

    switch (msg.method) {
      case "initialize":
        return rpc(id, {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "garmin-coach-mcp", version: "0.1.0" },
        });
      case "notifications/initialized":
        return new Response(null, { status: 202 });
      case "tools/list":
        return rpc(id, { tools: TOOLS });
      case "tools/call": {
        try {
          const data = await callTool(env, msg.params?.name, msg.params?.arguments || {});
          return rpc(id, {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          });
        } catch (e) {
          return rpc(id, {
            content: [{ type: "text", text: "Erreur : " + e.message }],
            isError: true,
          });
        }
      }
      default:
        return rpcError(id, -32601, "Méthode non prise en charge");
    }
  },
};
