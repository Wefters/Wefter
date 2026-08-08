import { pluginSource } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";

export default function Layout({ children }: LayoutProps<"/plugin">) {
  return (
    <DocsLayout tree={pluginSource.getPageTree()} {...baseOptions()}>
      {children}
    </DocsLayout>
  );
}
