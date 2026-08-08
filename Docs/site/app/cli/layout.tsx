import { cliSource } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";

export default function Layout({ children }: LayoutProps<"/cli">) {
  return (
    <DocsLayout tree={cliSource.getPageTree()} {...baseOptions()}>
      {children}
    </DocsLayout>
  );
}
