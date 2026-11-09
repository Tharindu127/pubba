import { createPubba, mergeConfig, type Pubba } from "./index.ts";
import { fromPortfolio, portfolioConfig, type PortfolioInput, type PortfolioOptions } from "./presets/portfolio.ts";
import type { Dataset, Entity, Link, PubbaConfig } from "./types.ts";

/**
 * A whole site setup as one JSON file (`pubba.json`): a preset, the content,
 * and config layered over the preset. The CLI and the Claude skill read this.
 */
export interface PubbaDocument {
  preset?: "portfolio" | "none";
  presetOptions?: PortfolioOptions;
  /** Portfolio content for the portfolio preset, converted with `fromPortfolio`. */
  portfolio?: PortfolioInput;
  entities?: Entity[];
  links?: Link[];
  config?: PubbaConfig;
}

export function documentConfig(doc: PubbaDocument): PubbaConfig {
  const preset = (doc.preset ?? (doc.portfolio ? "portfolio" : "none")) === "portfolio" ? portfolioConfig(doc.presetOptions) : {};
  return mergeConfig(preset, doc.config);
}

export function documentDataset(doc: PubbaDocument): Dataset {
  const base: Dataset = doc.portfolio ? fromPortfolio(doc.portfolio) : { entities: [], links: [] };
  return { entities: [...base.entities, ...(doc.entities ?? [])], links: [...(base.links ?? []), ...(doc.links ?? [])] };
}

export function fromDocument(doc: PubbaDocument): Pubba {
  return createPubba(documentDataset(doc), documentConfig(doc));
}
