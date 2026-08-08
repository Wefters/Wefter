import { defineDocs } from "fumadocs-mdx/macro";
import { loader } from "fumadocs-core/source";

const docs = defineDocs({ dir: "content/docs" });
const pluginDocs = defineDocs({ dir: "content/plugin" });
const cliDocs = defineDocs({ dir: "content/cli" });

export const docsSource = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});

export const pluginSource = loader({
  baseUrl: "/plugin",
  source: pluginDocs.toFumadocsSource(),
});

export const cliSource = loader({
  baseUrl: "/cli",
  source: cliDocs.toFumadocsSource(),
});
