import chalk from "chalk";

export interface ColoredSegment {
  text: string;
  color?: keyof typeof chalk;
  bgColor?: keyof typeof chalk;
  bold?: boolean;
  underline?: boolean;
}

const timestamp = (): string => {
  const now = new Date();
  return chalk.gray(
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`
  );
};

type LogArgs = unknown[];

const logger = {
  info: (...args: LogArgs) => {
    console.log(`${chalk.blue(chalk.bold("[INFO]"))} ${timestamp()} →`, chalk.cyan(...args));
  },

  success: (...args: LogArgs) => {
    console.log(`${chalk.green(chalk.bold("[SUCCESS]"))} ${timestamp()} →`, chalk.white(...args));
  },

  warn: (...args: LogArgs) => {
    console.warn(`${chalk.yellow(chalk.bold("[WARN]"))} ${timestamp()} →`, chalk.green(...args));
  },

  error: (...args: LogArgs) => {
    console.error(`${chalk.red(chalk.bold("[ERROR]"))} ${timestamp()} →`, chalk.redBright(...args));
  },

  debug: (...args: LogArgs) => {
    console.log(`${chalk.magenta(chalk.bold("[DEBUG]"))} ${timestamp()} →`, chalk.gray(...args));
  },

  bold: (...args: LogArgs) => {
    console.log(chalk.bold(...args));
  },

  underline: (...args: LogArgs) => {
    console.log(chalk.underline(...args));
  },

  color: (color: keyof typeof chalk, ...args: LogArgs) => {
    const fn = chalk[color] as unknown as ((...a: LogArgs) => string) | undefined;
    if (typeof fn === "function") console.log(fn(...args));
    else console.log(...args);
  },

  bg: (bgColor: keyof typeof chalk, ...args: LogArgs) => {
    const fn = chalk[bgColor] as unknown as ((...a: LogArgs) => string) | undefined;
    if (typeof fn === "function") console.log(fn(...args));
    else console.log(...args);
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

    console.log(formatted.join(""));
  },

  table: (obj: unknown) => {
    console.table(obj);
  },
};

export default logger;