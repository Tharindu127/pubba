import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPubba } from "../src/index.ts";
import { fromPortfolio, portfolioConfig, type PortfolioInput, type PortfolioOptions } from "../src/presets/portfolio.ts";

export const portfolio: PortfolioInput = JSON.parse(readFileSync(fileURLToPath(new URL("../examples/portfolio/portfolio.json", import.meta.url)), "utf8"));

export const examplePubba = (options: PortfolioOptions = { pronoun: "she", owner: "Nimali" }, input: PortfolioInput = portfolio) =>
  createPubba(fromPortfolio(input), portfolioConfig(options));
