# MCP store

Read [README.md](./README.md) first — it is the canonical doc for this product.

**This product's UI exists twice.**
PostHog Desktop ships a parallel, independently written implementation of the MCP store and gateway UI under `products/desktop/packages/ui/src/features/` (`mcp-servers/`, `mcp-gateway/`, `mcp-server-manager/`), consuming the same backend API and feature flags.
The MCP store feature set always changes for both apps together:

- Any frontend change here needs an equivalent change in the desktop features, in the same PR or an explicitly linked follow-up.
- Any change to a serializer the gateway UI consumes needs the desktop's hand-written API mirrors (`products/desktop/packages/api-client/src/mcp-gateway.ts`) updated too.

See "Keep the desktop UI in sync" in the README for the exact directory mapping.
