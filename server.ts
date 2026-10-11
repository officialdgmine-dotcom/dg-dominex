/**
 * DG Domain Core - Server Entry Point
 * Copyright (c) 2026 Deep Group
 *
 * Full-stack Express server integrating DG Domain Core API,
 * SQLite persistence, and Vite middleware.
 */

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './src/api/routes.ts';
import { getDatabase } from './src/db/database.ts';
import { getRegistryService } from './src/registry/registryService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // Initialize DB and Seed default prototype records if empty
  const db = getDatabase();
  const registry = getRegistryService(db);

  // Seed baseline prototype domains if not already registered
  const seedDomains = [
    {
      name: 'deepgroup.dg',
      registrantId: 'deep-group-core-registry',
      records: [
        { name: '@', type: 'A' as const, value: '10.0.0.1', ttl: 300 },
        { name: 'www', type: 'CNAME' as const, value: 'deepgroup.dg', ttl: 300 },
        { name: 'api', type: 'A' as const, value: '10.0.0.2', ttl: 300 },
        { name: '@', type: 'TXT' as const, value: 'heritage=deep-group; namespace=dg; v=spf1 ~all', ttl: 300 },
        { name: '@', type: 'MX' as const, value: 'mail.deepgroup.dg', priority: 10, ttl: 300 },
      ],
    },
    {
      name: 'ai.dg',
      registrantId: 'deep-group-ai-research',
      records: [
        { name: '@', type: 'A' as const, value: '10.0.1.50', ttl: 300 },
        { name: 'inference', type: 'A' as const, value: '10.0.1.51', ttl: 300 },
      ],
    },
    {
      name: 'mail.dg',
      registrantId: 'deep-group-communications',
      records: [
        { name: '@', type: 'A' as const, value: '10.0.2.25', ttl: 300 },
        { name: '@', type: 'MX' as const, value: 'mx1.mail.dg', priority: 10, ttl: 300 },
      ],
    },
  ];

  for (const item of seedDomains) {
    if (!registry.getDomain(item.name)) {
      try {
        registry.registerDomain(item);
      } catch (e) {
        console.warn(`Seeding ${item.name} error:`, e);
      }
    }
  }

  app.use(express.json());

  // Mount API router
  app.use('/api/v1', apiRouter);

  // Development vs Production Vite handling
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[DG Domain Core] Server running on http://0.0.0.0:${PORT}`);
    console.log(`[DG Domain Core] Namespace: .dg (Prototype Private Overlay)`);
  });
}

startServer();
