import { MAX_AI_PRODUCT_CARDS, toAiProductCard } from '@shop/shared';
import type { AiProductCard, ProductDto } from '@shop/shared';

/**
 * What the read-only catalog tools looked at during a turn, grouped by the call that
 * returned it. The transports render these as cards beside the answer, so a
 * recommendation is a tappable product rather than a sentence to go and search.
 *
 * Model order is the wrong order to show them in. Three searches can touch a dozen
 * products across unrelated queries while the answer names one, so a turn shows
 * exactly two things: every product the answer actually named, ranked by how much of
 * its title was used, then the rest of the LAST result set as alternatives. Products
 * from an abandoned earlier query are not "alternatives" — they are noise.
 */
export class SurfacedProducts {
  private readonly groups: AiProductCard[][] = [];

  add(products: readonly ProductDto[]): void {
    if (products.length > 0) this.groups.push(products.map(toAiProductCard));
  }

  cards(answer: string): AiProductCard[] {
    const spoken = answer.toLowerCase();
    const named = this.groups
      .flat()
      .map((card, order) => {
        // Short tokens ("20k", "pro", "w") match half the catalog; four characters is
        // the point where a title word identifies the product it came from.
        const tokens = `${card.brand} ${card.title}`
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((token) => token.length >= 4);
        const hits = tokens.filter((token) => spoken.includes(token)).length;
        return { card, order, score: tokens.length === 0 ? 0 : hits / tokens.length };
      })
      .filter((ranked) => ranked.score > 0)
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .map((ranked) => ranked.card);

    const chosen: AiProductCard[] = [];
    const seen = new Set<string>();
    for (const card of [...named, ...(this.groups.at(-1) ?? [])]) {
      if (seen.has(card.productId)) continue;
      seen.add(card.productId);
      chosen.push(card);
      if (chosen.length === MAX_AI_PRODUCT_CARDS) break;
    }
    return chosen;
  }
}
