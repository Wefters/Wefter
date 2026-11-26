import chalk from "chalk";
import { writeLine } from "../ui/terminal.js";

export interface ColoredSegment {
  text: string;
  color?: keyof typeof chalk;
  bgColor?: keyof typeof chalk;
  bold?: boolean;
  underline?: boolean;
}

type LogArgs = unknown[];

const logger = {
  info: (...args: LogArgs) => {
    writeLine(`${chalk.blue(chalk.bold("[INFO]"))} → ${chalk.cyan(...args)}`);
  },

  success: (...args: LogArgs) => {
    writeLine(`${chalk.green(chalk.bold("[SUCCESS]"))} → ${chalk.white(...args)}`);
  },

  warn: (...args: LogArgs) => {
    writeLine(`${chalk.yellow(chalk.bold("[WARN]"))} → ${chalk.green(...args)}`, "err");
  },

  error: (...args: LogArgs) => {
    writeLine(`${chalk.red(chalk.bold("[ERROR]"))} → ${chalk.redBright(...args)}`, "err");
  },

  debug: (...args: LogArgs) => {
    writeLine(`${chalk.magenta(chalk.bold("[DEBUG]"))} → ${chalk.gray(...args)}`);
  },

  bold: (...args: LogArgs) => {
    writeLine(chalk.bold(...args));
  },

  underline: (...args: LogArgs) => {
    writeLine(chalk.underline(...args));
  },

  color: (color: keyof typeof chalk, ...args: LogArgs) => {
    const fn = chalk[color] as unknown as ((...a: LogArgs) => string) | undefined;
    if (typeof fn === "function") writeLine(fn(...args));
    else writeLine(args.map(String).join(" "));
  },

  bg: (bgColor: keyof typeof chalk, ...args: LogArgs) => {
    const fn = chalk[bgColor] as unknown as ((...a: LogArgs) => string) | undefined;
    if (typeof fn === "function") writeLine(fn(...args));
    else writeLine(args.map(String).join(" "));
  },

  segmentColor: (segments: ColoredSegment[]) => {
    const formatted = segments.map((seg) => {
      let styled = seg.text;

      if (seg.color !== undefined && seg.color in chalk) {
        const fn = chalk[seg.color] as (txt: string) => string;
        styled = fn(styled);
      }

      if (seg.bgColor !== undefined && seg.bgColor in chalk) {
        const fn = chalk[seg.bgColor] as (txt: string) => string;
        styled = fn(styled);
      }

      if (seg.bold === true) styled = chalk.bold(styled);
      if (seg.underline === true) styled = chalk.underline(styled);

      return styled;
    });

    writeLine(formatted.join(""));
  },

  table: (obj: unknown) => {
    console.table(obj);
  },
};

export default logger;
