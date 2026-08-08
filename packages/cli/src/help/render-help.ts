import type { Command } from "commander";
import type { ColoredSegment } from "../utils/logger.js";

export function buildHelpLines(program: Command): ColoredSegment[][] {
  const rows = program.commands.map((cmd) => ({
    left: `${cmd.name()} ${cmd.usage()}`.trim(),
    desc: cmd.description(),
  }));
  const width = rows.reduce((max, row) => Math.max(max, row.left.length), 0);

  const lines: ColoredSegment[][] = [];
  lines.push([]);
  lines.push([
    { text: program.name(), color: "cyan", bold: true },
    { text: ` — ${program.description()}`, color: "gray" },
  ]);
  lines.push([]);
  lines.push([{ text: "Usage:", bold: true }, { text: `  ${program.name()} <command> [options]` }]);
  lines.push([]);
  lines.push([{ text: "Commands:", bold: true }]);
  for (const row of rows) {
    lines.push([
      { text: `  • ${row.left.padEnd(width)}`, color: "cyan" },
      { text: `  ${row.desc}`, color: "white" },
    ]);
  }
  lines.push([]);
  lines.push([{ text: `Run ${program.name()} <command> --help for details on a specific command.`, color: "gray" }]);
  lines.push([]);

  return lines;
}
