import chalk from "chalk";

/** The Wefter ASCII-art banner. */
export function renderBanner(): string {
  const lines = [
    chalk.cyan.bold("   _       __ _____ _____ _____ _____ ____  "),
    chalk.cyan.bold("  | |     / /| ____|  ___|_   _| ____|  _ \\ "),
    chalk.blue.bold("  | | /| / / |  _| | |_    | | |  _| | |_) |"),
    chalk.blue.bold("  | |/ |/ /  | |___|  _|   | | | |___|  _ < "),
    chalk.magenta.bold("  |__/|__/   |_____|_|     |_| |_____|_| \\_\\"),
  ];
  return lines.join("\n");
}

/** What {@link printInitSuccessSummary} reports. */
export interface InitSuccessInfo {
  appId: string;
  webDir: string;
  packageManager: string;
  /** The entries `init` added to `.gitignore`. */
  gitignoreEntries: string[];
  coreVersion: string;
  cliVersion: string;
}

/** Prints the banner, what `wefter init` changed and the next steps. */
export function printInitSuccessSummary(info: InitSuccessInfo): void {
  console.log("\n" + renderBanner() + "\n");
  console.log(chalk.green.bold("  🚀 Project successfully initialized with Wefter!\n"));

  console.log(chalk.bold("  Config & Files:"));
  console.log(
    `    ${chalk.green("✓")} Wrote ${chalk.cyan("wefter.config.json")} (appId: ${chalk.bold(info.appId)}, webDir: ${chalk.bold(info.webDir)})`,
  );
  console.log(
    `    ${chalk.green("✓")} Added ${chalk.cyan(`@wefterjs/core@${info.coreVersion}`)} and ${chalk.cyan(`@wefterjs/cli@${info.cliVersion}`)} to package.json`,
  );
  console.log(`    ${chalk.green("✓")} Wrote ${chalk.cyan("WEFTER_*")} variables to ${chalk.cyan(".env")}`);
  if (info.gitignoreEntries.length > 0) {
    const entries = info.gitignoreEntries.map((entry) => chalk.cyan(entry)).join(" and ");
    console.log(`    ${chalk.green("✓")} Added ${entries} to ${chalk.cyan(".gitignore")}`);
  }
  console.log("");

  console.log(chalk.bold("  Next Steps:"));
  console.log(`    1. Run ${chalk.cyan.bold(`${info.packageManager} install`)} to install dependencies`);
  console.log(`    2. Run ${chalk.cyan.bold("wefter add <plugin>")} to declare native capabilities`);
  console.log(`    3. Run ${chalk.cyan.bold("wefter sync")} to build the native shell\n`);

  console.log(chalk.bold("  Community & Resources:"));
  console.log(`    📖 ${chalk.bold("Docs:")}    ${chalk.underline.cyan("https://wefter.dev")}`);
  console.log(`    💬 ${chalk.bold("Discord:")} ${chalk.underline.cyan("https://discord.gg/wefter")}`);
  console.log(
    `    ⭐ ${chalk.bold("GitHub:")}  ${chalk.underline.cyan("https://github.com/Wefters/Wefter")} ${chalk.yellow("(Star us on GitHub!)")}\n`,
  );
}
