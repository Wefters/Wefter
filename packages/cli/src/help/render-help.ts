import type { Command, Help } from "commander";
import type { ColoredSegment } from "../utils/logger.js";

function qualifiedName(cmd: Command): string {
  const parts: string[] = [];
  for (let c: Command | null = cmd; c; c = c.parent) parts.unshift(c.name());
  return parts.join(" ");
}

function widthOf(rows: { left: string }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.left.length), 0);
}

function pushRows(
  lines: ColoredSegment[][],
  heading: string,
  rows: { left: string; desc: string }[],
  leftColor: ColoredSegment["color"],
): void {
  if (rows.length === 0) return;
  const width = widthOf(rows);
  lines.push([{ text: heading, bold: true }]);
  for (const row of rows) {
    lines.push([
      { text: `  ${row.left.padEnd(width)}`, color: leftColor },
      { text: row.desc ? `  ${row.desc}` : "", color: "white" },
    ]);
  }
  lines.push([]);
}

export function renderHelp(cmd: Command, helper: Help): ColoredSegment[][] {
  const lines: ColoredSegment[][] = [];

  lines.push([]);
  lines.push([
    { text: qualifiedName(cmd), color: "cyan", bold: true },
    { text: ` — ${helper.commandDescription(cmd)}`, color: "gray" },
  ]);
  lines.push([]);

  lines.push([{ text: "Usage:", bold: true }, { text: `  ${helper.commandUsage(cmd)}` }]);
  lines.push([]);

  pushRows(
    lines,
    "Arguments:",
    helper.visibleArguments(cmd).map((arg) => ({
      left: helper.argumentTerm(arg),
      desc: helper.argumentDescription(arg),
    })),
    "cyan",
  );

  pushRows(
    lines,
    "Options:",
    helper.visibleOptions(cmd).map((opt) => ({
      left: helper.optionTerm(opt),
      desc: helper.optionDescription(opt),
    })),
    "green",
  );

  const subcommands = helper.visibleCommands(cmd).filter((c) => c.name() !== "help");
  pushRows(
    lines,
    "Commands:",
    subcommands.map((sub) => ({
      left: helper.subcommandTerm(sub),
      desc: helper.subcommandDescription(sub),
    })),
    "cyan",
  );

  if (subcommands.length > 0) {
    lines.push([
      { text: `Run ${qualifiedName(cmd)} <command> --help for details on a specific command.`, color: "gray" },
    ]);
    lines.push([]);
  }

  return lines;
}
