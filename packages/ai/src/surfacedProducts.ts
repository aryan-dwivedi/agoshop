import type { AiProductCard, ProductDto } from '@shop/shared';

import { MAX_AI_PRODUCT_CARDS, toAiProductCard } from '@shop/shared';

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
                const tokens = `${card.brand} ${card.title}`
                    .toLowerCase()
                    .split(/[^a-z0-9]+/)
                    .filter((token) => token.length >= 4);
                const hits = tokens.filter((token) => spoken.includes(token)).length;
                return {
                    card,
                    order,
                    score: tokens.length === 0 ? 0 : hits / tokens.length,
                };
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
