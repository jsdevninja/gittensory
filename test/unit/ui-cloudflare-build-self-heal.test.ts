import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

// #6642: the Cloudflare Pages project for loopover-ui has its root directory set to apps/loopover-ui, so
// Cloudflare's own automatic `npm clean-install` step only installs THIS workspace's own declared
// dependencies -- it never reaches sibling workspace packages (proved live: it silently under-installed
// until packages/loopover-engine gained @anthropic-ai/claude-agent-sdk/web-tree-sitter, then every PR
// touching apps/loopover-ui/** started failing `Workers Builds: loopover-ui` with TS2307). #6624 fixed
// this by making build:cloudflare self-sufficient: it runs a full monorepo-root `npm ci` itself before
// building, so it no longer depends on what Cloudflare's own scoped install covered.
//
// A CI job cannot actually reproduce Cloudflare's scoped-install behavior to regression-test this end to
// end -- confirmed empirically that a plain `npm ci` run from apps/loopover-ui in a normal git checkout
// correctly finds and installs the FULL workspace tree (Cloudflare's specific build sandbox does
// something else, not reproducible via plain npm/git commands). The reliable, cheap guard is asserting
// the self-heal step itself is still present -- this is what actually prevents the regression from
// recurring, regardless of whether the original failure mode can be simulated in CI.
describe("apps/loopover-ui's Cloudflare build stays self-sufficient (#6642)", () => {
  it("build:cloudflare runs a full monorepo-root npm ci before building, not just the build script alone", () => {
    const pkg = read("apps/loopover-ui/package.json");
    const script = pkg.scripts["build:cloudflare"];
    expect(script).toBeTypeOf("string");
    // Order matters: the root install must happen BEFORE ui:build, so build:cloudflare is
    // self-sufficient regardless of what Cloudflare's own root-scoped install step already did.
    expect(script).toMatch(/^npm --prefix \.\.\/\.\. ci\s*&&\s*npm --prefix \.\.\/\.\. run ui:build$/);
  });
});
