import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

// Build the SPA into Spring's static resources so the one jar serves it (BASE_CHECKLIST.md §B).
// emptyOutDir:false because outDir is outside the vite project root (avoids deleting sibling files).
export default defineConfig({
  plugins: [
    // Generates routeTree.gen.ts from routes/. The central route table is DERIVED OUTPUT: adding a
    // page is a new file under routes/, never an edit to a router (DESIGN.md §8). The generated
    // file is gitignored — it is a build artifact and must never appear in a checkpoint's diff.
    tanstackRouter({
      target: 'react',
      routesDirectory: './routes',
      generatedRouteTree: './routeTree.gen.ts',
    }),
    react(), // must come AFTER the router plugin
  ],
  build: {
    outDir: '../resources/static',
    emptyOutDir: false,
  },
});
