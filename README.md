# garmin-coach-mcp

Serveur MCP distant (Cloudflare Workers) pour l'API personnelle Garmin Connect. Lecture seule.

## Secrets (Cloudflare → Settings → Variables and secrets, type Secret)
- `GARMIN_API_KEY` : clé API personnelle Garmin Connect
- `MCP_SECRET` : chaîne aléatoire longue, incluse dans l'URL du connecteur : `/mcp/<MCP_SECRET>`

## Outils
- `list_activities` : liste des activités récentes (filtres de dates, type)
- `get_activity` : détail d'une activité

Ne jamais committer les clés. Ne pas stocker de données personnelles dans le dépôt.
