import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';

import { env } from '@shop/platform/env.js';
import { closeRedis, keys, redis } from '@shop/platform/lib/redis.js';

import { loadMarketplaceCatalog } from './marketplace-catalog.js';
import * as t from './schema.js';

// Bulk catalog loads run far longer than the request-path statement timeout. Set before
// ./client.js is loaded, since the pool reads it once at construction.
process.env.PG_STATEMENT_TIMEOUT_MS = process.env.PG_SEED_STATEMENT_TIMEOUT_MS ?? '0';
const { db, pool } = await import('./client.js');

const PASSWORD = 'demo1234';
const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const now = Date.now();
const at = (offsetMs: number): Date => new Date(now + offsetMs);
type SeedVariant = {
    sku: string;
    label: string;
    attrs: Record<string, string>;
    priceMinorUnits: number;
    mrpMinorUnits: number;
    stock: number;
};
type SeedProduct = {
    slug: string;
    category: string;
    seller: string;
    title: string;
    brand: string;
    description: string;
    highlights: string[];
    specs: Record<string, string>;
    images: string[];
    rating: number;
    ratingCount: number;
    variants: SeedVariant[];
};
const CATEGORIES: {
    slug: string;
    name: string;
    imageUrl: string;
}[] = [
    {
        slug: 'electronics',
        name: 'Electronics',
        imageUrl: 'https://m.media-amazon.com/images/I/51YKwVXBhIL._SL900_.jpg',
    },
    {
        slug: 'apparel',
        name: 'Activewear',
        imageUrl: 'https://m.media-amazon.com/images/I/51SpOiouDYL._SL900_.jpg',
    },
    {
        slug: 'cosmetics',
        name: 'Beauty & Skincare',
        imageUrl: 'https://m.media-amazon.com/images/I/71gZ4LezPnL._SL900_.jpg',
    },
    {
        slug: 'home',
        name: 'Home & Decor',
        imageUrl: 'https://m.media-amazon.com/images/I/61Mofwc5SkL._SL900_.jpg',
    },
    {
        slug: 'lifestyle',
        name: 'Fitness & Gear',
        imageUrl: 'https://m.media-amazon.com/images/I/81-O5h3Y1GL._SL900_.jpg',
    },
    {
        slug: 'jewellery',
        name: 'Jewellery',
        imageUrl:
            'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=900&q=80',
    },
];
const SELLERS: {
    slug: string;
    displayName: string;
    ownerEmail: string;
    ownerName: string;
    rating: number;
    logoUrl: string;
}[] = [
    {
        slug: 'pulse-audio',
        displayName: 'Pulse Audio',
        ownerEmail: 'seller@demo.test',
        ownerName: 'Rohan Mehta',
        rating: 4.5,
        logoUrl: 'https://m.media-amazon.com/images/I/71R9LjXf-8L._SL900_.jpg',
    },
    {
        slug: 'cellverse',
        displayName: 'Cellverse',
        ownerEmail: 'cellverse@demo.test',
        ownerName: 'Ananya Iyer',
        rating: 4.3,
        logoUrl: 'https://m.media-amazon.com/images/I/71MJioULjzL._SL900_.jpg',
    },
    {
        slug: 'casa-nido',
        displayName: 'Casa Nido',
        ownerEmail: 'casanido@demo.test',
        ownerName: 'Kabir Sethi',
        rating: 4.2,
        logoUrl: 'https://m.media-amazon.com/images/I/713l-VaKMrL._SL900_.jpg',
    },
    {
        slug: 'flexfit',
        displayName: 'FlexFit Athletics',
        ownerEmail: 'flexfit@demo.test',
        ownerName: 'Ishaan Rao',
        rating: 4.4,
        logoUrl: 'https://m.media-amazon.com/images/I/515XY-iNDhL._SL900_.jpg',
    },
    {
        slug: 'glow-atelier',
        displayName: 'Glow Atelier',
        ownerEmail: 'glow@demo.test',
        ownerName: 'Diya Nair',
        rating: 4.6,
        logoUrl: 'https://m.media-amazon.com/images/I/51Oae1kPWGL._SL900_.jpg',
    },
];
const MARKETPLACE_SELLERS: {
    slug: string;
    displayName: string;
    rating: number;
    logoUrl: string;
}[] = [
    {
        slug: 'northstar-retail',
        displayName: 'Northstar Retail',
        rating: 4.6,
        logoUrl: 'https://m.media-amazon.com/images/I/71R9LjXf-8L._SL900_.jpg',
    },
    {
        slug: 'urban-cart',
        displayName: 'Urban Cart',
        rating: 4.3,
        logoUrl: 'https://m.media-amazon.com/images/I/71MJioULjzL._SL900_.jpg',
    },
    {
        slug: 'home-harbor',
        displayName: 'Home Harbor',
        rating: 4.4,
        logoUrl: 'https://m.media-amazon.com/images/I/713l-VaKMrL._SL900_.jpg',
    },
    {
        slug: 'nova-electronics',
        displayName: 'Nova Electronics',
        rating: 4.5,
        logoUrl: 'https://m.media-amazon.com/images/I/61C66qTqnwL._SL900_.jpg',
    },
    {
        slug: 'mint-market',
        displayName: 'Mint Market',
        rating: 4.2,
        logoUrl: 'https://m.media-amazon.com/images/I/51Oae1kPWGL._SL900_.jpg',
    },
    {
        slug: 'blue-basket',
        displayName: 'Blue Basket',
        rating: 4.4,
        logoUrl: 'https://m.media-amazon.com/images/I/51YKwVXBhIL._SL900_.jpg',
    },
    {
        slug: 'riverstone-goods',
        displayName: 'Riverstone Goods',
        rating: 4.1,
        logoUrl: 'https://m.media-amazon.com/images/I/61Mofwc5SkL._SL900_.jpg',
    },
    {
        slug: 'cedar-lane',
        displayName: 'Cedar Lane',
        rating: 4.5,
        logoUrl: 'https://m.media-amazon.com/images/I/81-O5h3Y1GL._SL900_.jpg',
    },
    {
        slug: 'brightbuy',
        displayName: 'BrightBuy',
        rating: 4.3,
        logoUrl: 'https://m.media-amazon.com/images/I/61YaEO8qY6L._SL900_.jpg',
    },
    {
        slug: 'metromart',
        displayName: 'MetroMart',
        rating: 4.2,
        logoUrl: 'https://m.media-amazon.com/images/I/61NEUWb5A4L._SL900_.jpg',
    },
    {
        slug: 'sunbeam-store',
        displayName: 'Sunbeam Store',
        rating: 4.6,
        logoUrl: 'https://m.media-amazon.com/images/I/51liYV8g2DL._SL900_.jpg',
    },
    {
        slug: 'peak-supply',
        displayName: 'Peak Supply',
        rating: 4.4,
        logoUrl: 'https://m.media-amazon.com/images/I/618Nlj8pN3L._SL900_.jpg',
    },
    {
        slug: 'coastline-commerce',
        displayName: 'Coastline Commerce',
        rating: 4.3,
        logoUrl: 'https://m.media-amazon.com/images/I/61n4uCw3ZZL._SL900_.jpg',
    },
    {
        slug: 'orchard-and-oak',
        displayName: 'Orchard & Oak',
        rating: 4.5,
        logoUrl: 'https://m.media-amazon.com/images/I/61vc8xowYUL._SL900_.jpg',
    },
    {
        slug: 'everyday-bazaar',
        displayName: 'Everyday Bazaar',
        rating: 4.2,
        logoUrl: 'https://m.media-amazon.com/images/I/515XY-iNDhL._SL900_.jpg',
    },
];
const PRODUCTS: SeedProduct[] = [
    {
        slug: 'boat-rockerz-plus-550',
        category: 'electronics',
        seller: 'pulse-audio',
        title: 'boAt Rockerz Plus 550',
        brand: 'boAt',
        description:
            'boAt Rockerz Plus 550 from boAt — finished in blue psyche. 50mm Drivers: Feel every beat with powerful 50mm drivers that pump out punchy audio. boAt Signature Sound brings rich bass and vibrant clarity to elevate music, movies, and more.',
        highlights: [
            '50mm Drivers: Feel every beat with powerful 50mm drivers that pump out punchy audio. boAt Signature Sound brings rich bass and vibrant clarity to.',
            'Up to 100 Hours of Playback: Power through long playlists or back-to-back calls with up to 100 hours of battery life. Rockerz Plus 550 is built to.',
            'Bluetooth v5.4 & AUX Compatibility: Whether you are going wireless with Bluetooth v5.4 or plugging in with AUX, these headphones give you flexible.',
            'Dual Pairing: Stay effortlessly connected to two devices at once with your Rockerz. Take calls from your phone and seamlessly return to streaming on.',
        ],
        specs: {
            Colour: 'Blue Psyche',
            'Headphone Jack': '3.5 mm Jack, Bluetooth',
            'Water Resistance Level': 'Water Resistant',
            'Compatible Devices':
                'Tablets, Desktops, Cellphones, Laptops, Smart Speaker, Television',
            'Ear Placement': 'Over Ear',
            'Form Factor': 'Over Ear',
            'Noise Control': 'Passive Noise Cancellation',
        },
        images: [
            'https://m.media-amazon.com/images/I/81lYNV0dX3L._SL900_.jpg',
            'https://m.media-amazon.com/images/I/917kTSXnJJL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/81LAnho9rRL._SL900_.jpg',
        ],
        rating: 4.1,
        ratingCount: 66500,
        variants: [
            {
                sku: 'BOAROCPLU550-STD',
                label: 'Blue Psyche',
                attrs: { colour: 'Blue Psyche' },
                priceMinorUnits: 199900,
                mrpMinorUnits: 499000,
                stock: 31,
            },
        ],
    },
    {
        slug: 'sony-wh-ch520',
        category: 'electronics',
        seller: 'pulse-audio',
        title: 'Sony WH-CH520 Wireless On-Ear',
        brand: 'Sony',
        description:
            'Sony WH-CH520 Wireless On-Ear from Sony — finished in taupe. With up to 50-hour battery life and quick charging, you’ll have enough power for multi-day road trips and long festival weekends.',
        highlights: [
            'With up to 50-hour battery life and quick charging, you’ll have enough power for multi-day road trips and long festival weekends.',
            'Great sound quality customizable to your music preference with EQ Custom on the Sony | Headphones Connect App.',
            'Boost the quality of compressed music files and enjoy streaming music with high quality sound through DSEE.',
            'Designed to be lightweight and comfortable for all-day use.',
        ],
        specs: {
            Colour: 'Taupe',
            'Headphone Jack': 'USB',
            'Water Resistance Level': 'Not Water Resistant',
            Theme: 'Fantasy',
            'Ear Placement': 'On Ear',
            'Form Factor': 'On Ear',
            Impedance: '100 Ohms',
        },
        images: [
            'https://m.media-amazon.com/images/I/61C66qTqnwL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71VcB+fcnKL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61uKxbE4JiL._SL900_.jpg',
        ],
        rating: 4.2,
        ratingCount: 31137,
        variants: [
            {
                sku: 'SONWHCH5-STD',
                label: 'Taupe',
                attrs: { colour: 'Taupe' },
                priceMinorUnits: 449000,
                mrpMinorUnits: 599000,
                stock: 62,
            },
        ],
    },
    {
        slug: 'boat-rockerz-512-anc',
        category: 'electronics',
        seller: 'pulse-audio',
        title: 'boAt Rockerz 512 ANC',
        brand: 'boAt',
        description:
            'boAt Rockerz 512 ANC from boAt — finished in cosmic black. 40mm Drivers: Experience dynamic sound with powerful 40mm drivers. From cinematic soundtracks to high-energy beats, the bass-heavy boAt Signature Sound ensures every moment hits hard.',
        highlights: [
            '40dB Hybrid ANC: Dive into sound with the boAt Rockerz 512 ANC Bluetooth Headphones. Advanced hybrid Active Noise Cancellation technology effectively.',
            '80 Hours of Playback: Keep the music flowing with an incredible 80-hour battery life. Whether you are jamming to your playlist or catching up with.',
            '40mm Drivers: Experience dynamic sound with powerful 40mm drivers. From cinematic soundtracks to high-energy beats, the bass-heavy boAt Signature.',
            'BEAST Mode: Dominate your game sessions with the ultra-low 40ms latency of BEAST Mode. Perfect for gamers, it delivers quick sound responses for a.',
        ],
        specs: {
            Colour: 'Cosmic Black',
            'Headphone Jack': 'No Jack',
            'Water Resistance Level': 'Water Resistant',
            'Compatible Devices': 'Cellphones, Laptops, Tablets',
            'Ear Placement': 'Over Ear',
            'Form Factor': 'Over Ear',
            'Noise Control': 'Active Noise Cancellation',
        },
        images: [
            'https://m.media-amazon.com/images/I/61YaEO8qY6L._SL900_.jpg',
            'https://m.media-amazon.com/images/I/81ud8cBcpML._SL900_.jpg',
        ],
        rating: 4.2,
        ratingCount: 31537,
        variants: [
            {
                sku: 'BOAROC512ANC-STD',
                label: 'Cosmic Black',
                attrs: { colour: 'Cosmic Black' },
                priceMinorUnits: 279900,
                mrpMinorUnits: 799000,
                stock: 57,
            },
        ],
    },
    {
        slug: 'philips-tah6550',
        category: 'electronics',
        seller: 'pulse-audio',
        title: 'Philips TAH6550 Over-Ear',
        brand: 'PHILIPS',
        description: 'Philips TAH6550 Over-Ear from PHILIPS — finished in black.',
        highlights: [
            'ULTRA-LONG 60 HOURS PLAYTIME – Enjoy extended listening with up to 60 hours of battery life on a single charge. Perfect for travel, work, online.',
            'POWERFUL 40MM DYNAMIC DRIVERS – Experience immersive sound with deep bass, detailed mids, and clear highs. The 20Hz–20kHz frequency response delivers.',
            'ENHANCED CALL CLARITY WITH 3 MICROPHONES – Equipped with 3 built-in microphones for clearer voice pickup during calls, virtual meetings, and video.',
        ],
        specs: {
            Colour: 'Black',
            'Headphone Jack': '3.5 mm Jack',
            'Water Resistance Level': 'Not Water Resistant',
            'Compatible Devices': 'Cellphones',
            'Ear Placement': 'Over Ear',
            'Form Factor': 'Over Ear',
            Impedance: '32 Ohms',
        },
        images: [
            'https://m.media-amazon.com/images/I/61TIoF48PeL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/715wGxxIeAL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71fbmy3-UOL._SL900_.jpg',
        ],
        rating: 4.3,
        ratingCount: 7,
        variants: [
            {
                sku: 'PHITAH-STD',
                label: 'Black',
                attrs: { colour: 'Black' },
                priceMinorUnits: 249900,
                mrpMinorUnits: 699900,
                stock: 65,
            },
        ],
    },
    {
        slug: 'noise-airwave-max-5',
        category: 'electronics',
        seller: 'pulse-audio',
        title: 'Noise Airwave Max 5 ANC',
        brand: 'Noise',
        description:
            'Noise Airwave Max 5 ANC from Noise — finished in calm beige. Premium Sound Quality: High Fidelity Acoustics powered by a 40mm driver, delivering crisp, well-balanced, and immersive audio.',
        highlights: [
            'Premium Sound Quality: High Fidelity Acoustics powered by a 40mm driver, delivering crisp, well-balanced, and immersive audio.',
            'Adaptive Hybrid ANC: Intelligent noise cancellation up to 50dB, ensuring a truly distraction-free experience wherever you go.',
            'Premium Design: Ergonomically crafted for comfort, featuring a sleek and stunning premium finish.',
            'Extended Playtime: Up to 80 hours of continuous playtime, so you can keep the music going without interruption.',
        ],
        specs: {
            Colour: 'Calm Beige',
            'Headphone Jack': '‎Type-C Fast Charging Jack',
            'Water Resistance Level': 'Water Resistant',
            'Compatible Devices': 'Cellphones, Desktops, Gaming Consoles, Laptops, Tablets',
            'Ear Placement': 'Over Ear',
            'Form Factor': 'Over Ear',
            Impedance: '32 Ohms',
        },
        images: [
            'https://m.media-amazon.com/images/I/51YKwVXBhIL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71R9LjXf-8L._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71gNds5KLmL._SL900_.jpg',
        ],
        rating: 4.1,
        ratingCount: 755,
        variants: [
            {
                sku: 'NOIAIRMAX5-STD',
                label: 'Calm Beige',
                attrs: { colour: 'Calm Beige' },
                priceMinorUnits: 499900,
                mrpMinorUnits: 599900,
                stock: 32,
            },
        ],
    },
    {
        slug: 'realme-buds-t310',
        category: 'electronics',
        seller: 'pulse-audio',
        title: 'realme Buds T310 ANC Earbuds',
        brand: 'realme',
        description:
            'realme Buds T310 ANC Earbuds from realme — finished in vibrant black. 360° Spatial Audio Effect | 12.4mm Dynamic Bass Driver.',
        highlights: [
            '360° Spatial Audio Effect | 12.4mm Dynamic Bass Driver',
            '46dB Hybrid Noise Cancellation | 45ms Ultra Low Latency 12.4mm Dynamic Bass Driver 40 Hours Total Playback| Fast Charge :10 Min of Charge =5Hrs Play.',
            '40 Hours Total Playback| Fast Charge :10 Min of Charge =5Hrs Play Back',
        ],
        specs: {
            Colour: 'Vibrant Black',
            'Headphone Jack': 'No Jack',
            'Water Resistance Level': 'Water Resistant',
            'Compatible Devices': 'Cellphones, Laptops, Tablets, Television',
            'Ear Placement': 'In Ear',
            'Form Factor': 'True Wireless',
            Impedance: '32 Ohms',
        },
        images: [
            'https://m.media-amazon.com/images/I/61dj32WdrxL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61Ri6rbWJcL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/51w0MfA2wyL._SL900_.jpg',
        ],
        rating: 4.2,
        ratingCount: 9504,
        variants: [
            {
                sku: 'REABUDT31-STD',
                label: 'Vibrant Black',
                attrs: { colour: 'Vibrant Black' },
                priceMinorUnits: 239900,
                mrpMinorUnits: 399900,
                stock: 83,
            },
        ],
    },
    {
        slug: 'boult-z40',
        category: 'electronics',
        seller: 'pulse-audio',
        title: 'Boult Z40 Wireless Earbuds',
        brand: 'GOBOULT',
        description:
            'Boult Z40 Wireless Earbuds from GOBOULT — finished in blue. ✅ Sweat and Water Resistant: Built for an active lifestyle, the Z40 earbuds are sweat and water-resistant, making them durable enough for workouts, runs, and outdoor adventures.',
        highlights: [
            '✅ Zen ENC Mic for Clear Calls: Communicate with ease using the advanced Zen Environmental Noise Cancellation (ENC) mic. This technology reduces.',
            '✅ Low Latency Gaming Mode: The Z40 earbuds feature a low latency mode, designed to minimize audio delay, enhancing your gaming experience with.',
            '✅ Powerful 10mm Drivers: Experience deep, rich bass with the Z40’s 10mm drivers. Whether you enjoy bass-heavy tracks or dynamic soundscapes, these.',
            '✅ Type-C Fast Charging: Enjoy quick and efficient power-ups with Type-C fast charging. A brief charge provides hours of playback, making these.',
        ],
        specs: {
            Colour: 'Blue',
            'Headphone Jack': 'Type-C',
            'Water Resistance Level': 'Water Resistant',
            'Compatible Devices': 'Android, Cellphones, Desktops, Laptops, Tablets, iphone',
            Theme: 'Fantasy',
            'Ear Placement': 'In Ear',
            'Form Factor': 'In Ear',
        },
        images: [
            'https://m.media-amazon.com/images/I/71rlmEZ6cjL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/81Gzhzs4XML._SL900_.jpg',
            'https://m.media-amazon.com/images/I/719-V+IhU+L._SL900_.jpg',
        ],
        rating: 3.8,
        ratingCount: 37458,
        variants: [
            {
                sku: 'BOUZ40-STD',
                label: 'Blue',
                attrs: { colour: 'Blue' },
                priceMinorUnits: 109900,
                mrpMinorUnits: 499900,
                stock: 79,
            },
        ],
    },
    {
        slug: 'jbl-quantum-100m2',
        category: 'electronics',
        seller: 'pulse-audio',
        title: 'JBL Quantum 100M2 Gaming Headset',
        brand: 'JBL',
        description:
            'JBL Quantum 100M2 Gaming Headset from JBL — finished in black. JBL QuantumSOUND Signature: Tuned by JBL’s world-class audiologists, the 40mm drivers deliver immersive, precision audio—from subtle in-game cues to explosive action.',
        highlights: [
            'JBL QuantumSOUND Signature: Tuned by JBL’s world-class audiologists, the 40mm drivers deliver immersive, precision audio—from subtle in-game cues to.',
            'Voice-Focus Boom Microphone: Detachable, Omnidirectional mic with mute functionality ensures crystal-clear communication during multiplayer sessions.',
            'Enhanced Comfort for Long Sessions: Lightweight design with breathable, fabric-wrapped “Premium Memory Foam” ear cushions and a flexible headband for.',
            'Cross-Platform Compatibility: Seamlessly works with PC, Mac, Xbox, PlayStation, Nintendo Switch, mobile devices, and VR systems.',
        ],
        specs: {
            Colour: 'Black',
            'Headphone Jack': '3.5 mm Jack',
            'Water Resistance Level': 'Not Water Resistant',
            'Compatible Devices': 'PC, Mac, Xbox, PS4/PS5, Nintendo Switch, Mobile Phones, VR',
            Theme: 'Video Game',
            'Ear Placement': 'Over Ear',
            'Form Factor': 'Over Ear',
        },
        images: [
            'https://m.media-amazon.com/images/I/61KmVBD4ZfL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61z3xyRr6RL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61JI6lL4kVL._SL900_.jpg',
        ],
        rating: 3.9,
        ratingCount: 6412,
        variants: [
            {
                sku: 'JBLQUA100-STD',
                label: 'Black',
                attrs: { colour: 'Black' },
                priceMinorUnits: 299900,
                mrpMinorUnits: 449900,
                stock: 69,
            },
        ],
    },
    {
        slug: 'hyperx-cloud-stinger-2-core',
        category: 'electronics',
        seller: 'pulse-audio',
        title: 'HyperX Cloud Stinger 2 Core',
        brand: 'HyperX',
        description:
            'HyperX Cloud Stinger 2 Core from HyperX — finished in black. Crisp, clear in-game sound: Cloud Stinger 2 Core’s 40mm directional drivers are tuned to provide enhanced bass for impactful, immersive game audio.',
        highlights: [
            'DTS Headphone:X Spatial Audio*: Unlock accurate 3D audio spatialization and localization! The included activation code provides 2 years of DTS.',
            'Crisp, clear in-game sound: Cloud Stinger 2 Core’s 40mm directional drivers are tuned to provide enhanced bass for impactful, immersive game audio.',
            'Improved in-game chat experience: HyperX quality-of-life features like the swivel-to-mute microphone are built to enhance your gaming experience.',
            'Easy-Access audio controls: With audio controls right on the headset itself, you won’t have to navigate a maze of menus to adjust the volume.',
        ],
        specs: {
            Colour: 'Black',
            'Headphone Jack': '3.5 mm Jack',
            'Water Resistance Level': 'Waterproof',
            Theme: 'sport',
            'Ear Placement': 'Over Ear',
            'Form Factor': 'Over Ear',
            Impedance: '32.5 Ohms',
        },
        images: [
            'https://m.media-amazon.com/images/I/71WXVepOnFL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/81zWGWPeuuL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71cn9iLhAyL._SL900_.jpg',
        ],
        rating: 4,
        ratingCount: 4621,
        variants: [
            {
                sku: 'HYPCLOSTI2CO-STD',
                label: 'Black',
                attrs: { colour: 'Black' },
                priceMinorUnits: 279900,
                mrpMinorUnits: 479700,
                stock: 55,
            },
        ],
    },
    {
        slug: 'oneplus-bullets-wireless-z3',
        category: 'electronics',
        seller: 'pulse-audio',
        title: 'OnePlus Bullets Wireless Z3',
        brand: 'OnePlus',
        description:
            'OnePlus Bullets Wireless Z3 from OnePlus — finished in mambo midnight. [Ultra-fasting 10 minutes charging gives 27 hours of music] Hassle free quick charging without worrying of the low battery. A full charge BWZ3 gives upto 36 hours of music playback.',
        highlights: [
            '[Ultra-fasting 10 minutes charging gives 27 hours of music] Hassle free quick charging without worrying of the low battery. A full charge BWZ3 gives.',
            '[Meet the ace of bass with 12.4mm large drivers] Experience deep, punchy bass and incredibly rich audio detail at every frequency with larger driver.',
            'Water Resistant',
        ],
        specs: {
            Colour: 'Mambo Midnight',
            'Headphone Jack': 'No Jack',
            'Water Resistance Level': 'Water Resistant',
            'Compatible Devices': 'Smartphones, Tablets, Laptops, Desktops',
            'Ear Placement': 'In Ear',
            'Form Factor': 'In Ear',
            Impedance: '32 Ohms',
        },
        images: [
            'https://m.media-amazon.com/images/I/51vT4GzBObL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71i7h-tVrRL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61C6WsppHAL._SL900_.jpg',
        ],
        rating: 4.1,
        ratingCount: 233582,
        variants: [
            {
                sku: 'ONEBULWIRZ3-STD',
                label: 'Mambo Midnight',
                attrs: { colour: 'Mambo Midnight' },
                priceMinorUnits: 168800,
                mrpMinorUnits: 199900,
                stock: 84,
            },
        ],
    },
    {
        slug: 'samsung-galaxy-a56-5g',
        category: 'electronics',
        seller: 'cellverse',
        title: 'Samsung Galaxy A56 5G',
        brand: 'Samsung',
        description:
            'Samsung Galaxy A56 5G from Samsung — 256 GB storage, finished in awesome olive. Samsung Experience - Get defense grade security with Samsung Knox, hassle free payments with Tap and Pay on Samsung Wallet and seamless experience with the latest One UI.',
        highlights: [
            '2 Days Battery Life - Stay connected longer with a battery designed to last up to 2 days, all packed in 7.4mm slim design. Paired with high-speed.',
            'Samsung Experience - Get defense grade security with Samsung Knox, hassle free payments with Tap and Pay on Samsung Wallet and seamless experience.',
            '8 GB RAM with 256 GB storage',
            'Exynos 1580 S5E8855 platform at 2.9 GHz',
        ],
        specs: {
            Colour: 'Awesome Olive',
            'Memory Storage Capacity': '256 GB',
            'Display Type': 'AMOLED',
            'Refresh Rate': '120',
            'Operating System': 'Android 15.0',
            'Cellular Technology': '5G',
            Resolution: '2340 x 1080',
        },
        images: [
            'https://m.media-amazon.com/images/I/71MJioULjzL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/81IdWxTc+YL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71aic+C4heL._SL900_.jpg',
        ],
        rating: 4.3,
        ratingCount: 526,
        variants: [
            {
                sku: 'SAMGALA565G-STD',
                label: 'Awesome Olive · 256 GB',
                attrs: { colour: 'Awesome Olive', storage: '256 GB' },
                priceMinorUnits: 3899900,
                mrpMinorUnits: 5299900,
                stock: 15,
            },
        ],
    },
    {
        slug: 'samsung-galaxy-s24-fe',
        category: 'electronics',
        seller: 'cellverse',
        title: 'Samsung Galaxy S24 FE 5G',
        brand: 'Samsung',
        description:
            "Samsung Galaxy S24 FE 5G from Samsung — 128 GB storage, finished in graphite. Experience life boosting AI with Galaxy AI's quick and clever assistance.",
        highlights: [
            "Experience life boosting AI with Galaxy AI's quick and clever assistance",
            'FHD+ Dynamic AMOLED 2X display for an immersive viewing experience',
            'Capture stunning low-light portraits with powerful 50MP camera with ProVisual Engine',
            "With Galaxy AI's Photo Assist, transform images into stunning works of art",
        ],
        specs: {
            Colour: 'Graphite',
            'Memory Storage Capacity': '128 GB',
            'Display Type': 'AMOLED',
            'Refresh Rate': '120 Hz',
            'Operating System': 'Android 14',
            'Cellular Technology': '5G',
            Resolution: '2340 x 1080',
        },
        images: [
            'https://m.media-amazon.com/images/I/71eUNTW+nJL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/81UgKui6ucL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61GI15auUPL._SL900_.jpg',
        ],
        rating: 4.4,
        ratingCount: 1942,
        variants: [
            {
                sku: 'SAMGALS24FE-STD',
                label: 'Graphite · 128 GB',
                attrs: { colour: 'Graphite', storage: '128 GB' },
                priceMinorUnits: 3999900,
                mrpMinorUnits: 4799900,
                stock: 29,
            },
        ],
    },
    {
        slug: 'oppo-f33-pro-5g',
        category: 'electronics',
        seller: 'cellverse',
        title: 'OPPO F33 Pro 5G',
        brand: 'OPPO',
        description:
            'OPPO F33 Pro 5G from OPPO — 256 GB storage, finished in misty forest. 50MP + 50MP Cameras – Flagship-Level Imaging:Capture like a pro with a 50MP rear camera + 50MP front camera, delivering exceptional clarity for both photos and selfies.',
        highlights: [
            '50MP + 50MP Cameras – Flagship-Level Imaging:Capture like a pro with a 50MP rear camera + 50MP front camera, delivering exceptional clarity for both.',
            '80W SUPERVOOC Fast Charging – Lightning Fast Power: Get back to full power quickly with 80W SUPERVOOC charging, minimizing downtime and maximizing.',
            'Refined Design – Premium Look & Feel:A 6.57-inch compact flat screen and a lightweight 194g body ensure pressure-free holding and easy pocketability.',
            'Reverse Charging – Power Bank on the Go :Turn your phone into a power bank instantly with reverse wired charging. Use an OTG cable to charge other.',
        ],
        specs: {
            Colour: 'Misty Forest',
            'Memory Storage Capacity': '256 GB',
            'Display Type': 'AMOLED',
            'Operating System': 'Android 15',
            'Cellular Technology': '5G',
            'RAM Memory Installed Size': '8 GB',
            'CPU Model': 'Mediatek Dimensity 6300',
        },
        images: [
            'https://m.media-amazon.com/images/I/61920B-xsvL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71sNdItdnhL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71sSajWL-aL._SL900_.jpg',
        ],
        rating: 4.2,
        ratingCount: 31,
        variants: [
            {
                sku: 'OPPF33PRO5G-STD',
                label: 'Misty Forest · 256 GB',
                attrs: { colour: 'Misty Forest', storage: '256 GB' },
                priceMinorUnits: 4399900,
                mrpMinorUnits: 5899900,
                stock: 46,
            },
        ],
    },
    {
        slug: 'samsung-galaxy-a35-5g',
        category: 'electronics',
        seller: 'cellverse',
        title: 'Samsung Galaxy A35 5G',
        brand: 'Samsung',
        description:
            'Samsung Galaxy A35 5G from Samsung — 128 GB storage, finished in awesome lilac. Inch) Super AMOLED Display with 19.5:9 Aspect Ratio, FHD+ Resolution with 2340 x 1080 Pixels , 389 PPI with 16M Colors and 120Hz Refresh Rate, Corning Gorilla Glass Victus+.',
        highlights: [
            'DISPLAY - 16.83 Centimeters (6.6&#34',
            'Inch) Super AMOLED Display with 19.5:9 Aspect Ratio, FHD+ Resolution with 2340 x 1080 Pixels , 389 PPI with 16M Colors and 120Hz Refresh Rate.',
            'CAMERA - Nightography | Super HDR Video | 50MP (F1.8) Main Wide Angle Camera + 8MP (F2.2) Ultra Wide Camera + 5MP (F2.4) Macro Camera | 13MP (F2.2).',
            'INTERFACE & PROCESSOR - Latest Android 14 Operating System having One UI 6.1 platform with Samsung Exynos 1380 Processor | 2.4GHz, 2GHz 5nm Octa-Core.',
        ],
        specs: {
            Colour: 'Awesome Lilac',
            'Memory Storage Capacity': '128 GB',
            'Display Type': 'AMOLED',
            'Refresh Rate': '120 Hz',
            'Operating System': 'Android 14',
            'Cellular Technology': '5G',
            Resolution: 'FHD+ 2340 x 1080',
        },
        images: [
            'https://m.media-amazon.com/images/I/71w0ku3JQbL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/812G9En3bDL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/81Ctq-kwF2L._SL900_.jpg',
        ],
        rating: 4.3,
        ratingCount: 776,
        variants: [
            {
                sku: 'SAMGALA355G-STD',
                label: 'Awesome Lilac · 128 GB',
                attrs: { colour: 'Awesome Lilac', storage: '128 GB' },
                priceMinorUnits: 3199900,
                mrpMinorUnits: 3399900,
                stock: 85,
            },
        ],
    },
    {
        slug: 'redmi-15-5g',
        category: 'electronics',
        seller: 'cellverse',
        title: 'Redmi 15 5G',
        brand: 'Redmi',
        description:
            'Redmi 15 5G from Redmi — 256 GB storage, finished in midnight black. Powerful Qualcomm Snapdragon 6s Gen 3 Processor.',
        highlights: [
            '33W Charging, 18W Reverse Charging',
            'Powerful Qualcomm Snapdragon 6s Gen 3 Processor',
            '17.53cm(6.9) FHD+(1080x2400) Display with up to 144Hz Refresh Rate',
            'Aerospace-grade metal camera deco with 50MP AI Dual Camera',
        ],
        specs: {
            Colour: 'Midnight Black',
            'Memory Storage Capacity': '256 GB',
            'Display Type': 'LCD',
            'Refresh Rate': 'Up to 144 Hz',
            'Operating System': 'Android 15, Xiaomi HyperOS',
            'Cellular Technology': '5G',
            Resolution: '1080 x 2340 pixels',
        },
        images: [
            'https://m.media-amazon.com/images/I/81dblfYZOYL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/819Zin05rLL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71TWHLiHe3L._SL900_.jpg',
        ],
        rating: 4,
        ratingCount: 1695,
        variants: [
            {
                sku: 'RED155G-STD',
                label: 'Midnight Black · 256 GB',
                attrs: { colour: 'Midnight Black', storage: '256 GB' },
                priceMinorUnits: 2549900,
                mrpMinorUnits: 3699900,
                stock: 16,
            },
        ],
    },
    {
        slug: 'oneplus-n6-5g',
        category: 'electronics',
        seller: 'cellverse',
        title: 'OnePlus N6 5G',
        brand: 'OnePlus',
        description: 'OnePlus N6 5G from OnePlus — 128 GB storage, finished in midnight green.',
        highlights: [
            'Always Smooth - The OnePlus N6 brings flagship software to your hands with Oxygen OS 16 right out of the box. Backed by 48 months Fast and Smooth.',
            '4 GB RAM with 128 GB storage',
            '50 MP rear camera and 8 MP selfie camera',
            '120Hz display',
        ],
        specs: {
            Colour: 'Midnight Green',
            'Memory Storage Capacity': '128 GB',
            'Display Type': 'LCD',
            'Refresh Rate': '120',
            'Operating System': 'OxygenOS 16',
            'Cellular Technology': '5G',
            Resolution: '1570 x 720',
        },
        images: [
            'https://m.media-amazon.com/images/I/61f5ZCuSD6L._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61X0fVg7s-L._SL900_.jpg',
            'https://m.media-amazon.com/images/I/41Wk8WajW-L._SL900_.jpg',
        ],
        rating: 3.5,
        ratingCount: 368,
        variants: [
            {
                sku: 'ONEN65G-STD',
                label: 'Midnight Green · 128 GB',
                attrs: { colour: 'Midnight Green', storage: '128 GB' },
                priceMinorUnits: 2499900,
                mrpMinorUnits: 3099900,
                stock: 59,
            },
        ],
    },
    {
        slug: 'samsung-galaxy-m36-5g',
        category: 'electronics',
        seller: 'cellverse',
        title: 'Samsung Galaxy M36 5G',
        brand: 'Samsung',
        description:
            'Samsung Galaxy M36 5G from Samsung — 128 GB storage, finished in serene green. Monster design and durability - 7.7mm Sleek mobile with Upgraded Camera Deco and Plastic Back, Gorilla Glass Victus+ Protection on front, 4x Better Scratch Resistance, 2.0 m Fall Endurance.',
        highlights: [
            'Monster design and durability - 7.7mm Sleek mobile with Upgraded Camera Deco and Plastic Back, Gorilla Glass Victus+ Protection on front, 4x Better.',
            'Monster display - 6.7” Bigger Display, Super AMOLED Display with Vision Booster, Slimmer Bezels. Enjoy an immersive viewing experience even in bright.',
            '8 GB RAM with 128 GB storage',
            'Exynos 1380 S5E8835 platform at 2.4 GHz',
        ],
        specs: {
            Colour: 'Serene Green',
            'Memory Storage Capacity': '128 GB',
            'Display Type': 'AMOLED',
            'Refresh Rate': '120',
            'Operating System': 'Android 15',
            'Cellular Technology': '5G',
            Resolution: '2340 x 1080',
        },
        images: [
            'https://m.media-amazon.com/images/I/71UzHCLBm1L._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71DFYSVSFbL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/81ZnEHqMoWL._SL900_.jpg',
        ],
        rating: 4.1,
        ratingCount: 2109,
        variants: [
            {
                sku: 'SAMGALM365G-STD',
                label: 'Serene Green · 128 GB',
                attrs: { colour: 'Serene Green', storage: '128 GB' },
                priceMinorUnits: 2299900,
                mrpMinorUnits: 2699900,
                stock: 55,
            },
        ],
    },
    {
        slug: 'realme-p4r-5g',
        category: 'electronics',
        seller: 'cellverse',
        title: 'realme P4R 5G',
        brand: 'realme',
        description:
            'realme P4R 5G from realme — 128 GB storage, finished in silver glare. MASSIVE 8000mAh BATTERY: The realme P4R 5G is equipped with a huge 8000mAh battery, offering up to 12 hours of stable gaming and 7 years of long battery life.',
        highlights: [
            'MASSIVE 8000mAh BATTERY: The realme P4R 5G is equipped with a huge 8000mAh battery, offering up to 12 hours of stable gaming and 7 years of long.',
            '6 GB RAM with 128 GB storage',
            'Mediatek Dimensity 6300 platform at 2.4 GHz',
            '144Hz display',
        ],
        specs: {
            Colour: 'Silver Glare',
            'Memory Storage Capacity': '128 GB',
            'Display Type': '144Hz',
            'Refresh Rate': '144',
            'Operating System': 'Android 15',
            'Cellular Technology': '5G',
            'RAM Memory Installed Size': '6 GB',
        },
        images: [
            'https://m.media-amazon.com/images/I/71QGhyW-lWL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/51+QBb6dSvL.jpg',
            'https://m.media-amazon.com/images/I/411dJXqhQWL.jpg',
        ],
        rating: 4.2,
        ratingCount: 42,
        variants: [
            {
                sku: 'REAP4R5G-STD',
                label: 'Silver Glare · 128 GB',
                attrs: { colour: 'Silver Glare', storage: '128 GB' },
                priceMinorUnits: 2374000,
                mrpMinorUnits: 3999900,
                stock: 22,
            },
        ],
    },
    {
        slug: 'motorola-g67-power-5g',
        category: 'electronics',
        seller: 'cellverse',
        title: 'Motorola G67 Power 5G',
        brand: 'Motorola',
        description:
            'Motorola G67 Power 5G from Motorola — 128 GB storage, finished in pantone cilantro. Unique Design: Eye-catching Pantone Cilantro color with a sleek, modern finish that adds a fresh and stylish touch.',
        highlights: [
            'Unique Design: Eye-catching Pantone Cilantro color with a sleek, modern finish that adds a fresh and stylish touch.',
            '8 GB RAM with 128 GB storage',
            'Snapdragon platform at 2.4 GHz',
            '50 MP rear camera',
        ],
        specs: {
            Colour: 'Pantone Cilantro',
            'Memory Storage Capacity': '128 GB',
            'Display Type': 'LCD',
            'Refresh Rate': '120',
            'Operating System': 'Android',
            'Cellular Technology': '5G',
            Resolution: '4500 Nits Peak Brightness',
        },
        images: [
            'https://m.media-amazon.com/images/I/712eFKWtHCL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/7138FWIfO6L._SL900_.jpg',
            'https://m.media-amazon.com/images/I/6161uCh-tiL._SL900_.jpg',
        ],
        rating: 4.2,
        ratingCount: 920,
        variants: [
            {
                sku: 'MOTG67POW5G-STD',
                label: 'Pantone Cilantro · 128 GB',
                attrs: { colour: 'Pantone Cilantro', storage: '128 GB' },
                priceMinorUnits: 2414500,
                mrpMinorUnits: 2699900,
                stock: 79,
            },
        ],
    },
    {
        slug: 'redmi-note-15-se-5g',
        category: 'electronics',
        seller: 'cellverse',
        title: 'Redmi Note 15 SE 5G',
        brand: 'Redmi',
        description:
            'Redmi Note 15 SE 5G from Redmi — 128 GB storage, finished in crimson reserve. 5G CONNECTIVITY: The Redmi Note 15 SE 5G supports next-generation 5G networks, ensuring fast and reliable connectivity for seamless browsing, streaming, and communication.',
        highlights: [
            '5G CONNECTIVITY: The Redmi Note 15 SE 5G supports next-generation 5G networks, ensuring fast and reliable connectivity for seamless browsing.',
            'POWERFUL PERFORMANCE: Equipped with 6GB RAM and 128GB internal storage, this smartphone handles multitasking, gaming, and everyday tasks with ease.',
            'MASSIVE BATTERY: Featuring a 5800mAh battery, the Redmi Note 15 SE 5G delivers long-lasting power to keep you connected throughout the day without.',
            'QUAD CAMERA SYSTEM: The rear panel houses a sophisticated quad-camera array set within a premium gold-toned module, enabling versatile photography.',
        ],
        specs: {
            Colour: 'Crimson Reserve',
            'Memory Storage Capacity': '128 GB',
            'Display Type': 'LCD',
            'Refresh Rate': '90 Hz',
            'Operating System': 'Android',
            'Cellular Technology': '5G',
            Resolution: '2392 X 1080 Pixels',
        },
        images: [
            'https://m.media-amazon.com/images/I/51k4LnHqXeL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/51XR92bj82L.jpg',
            'https://m.media-amazon.com/images/I/41AwwQukuoL.jpg',
        ],
        rating: 3.9,
        ratingCount: 73,
        variants: [
            {
                sku: 'REDNOT15SE5G-STD',
                label: 'Crimson Reserve · 128 GB',
                attrs: { colour: 'Crimson Reserve', storage: '128 GB' },
                priceMinorUnits: 2485500,
                mrpMinorUnits: 3499900,
                stock: 77,
            },
        ],
    },
    {
        slug: 'purezento-ceramic-bud-vases',
        category: 'home',
        seller: 'casa-nido',
        title: 'Purezento Rustic Ceramic Bud Vases (Set of 3)',
        brand: 'PUREZENTO',
        description:
            'Purezento Rustic Ceramic Bud Vases (Set of 3) from PUREZENTO — finished in bud.',
        highlights: [
            'Bottle silhouette',
            'Flowers theme',
            "For graduation, mother's day, wedding, women",
            'Floral pattern',
        ],
        specs: {
            Colour: 'Bud',
            Pattern: 'Floral',
            'Item Weight': '300 Grams',
            Occasion: "Graduation, Mother's Day, Wedding, Women",
            Shape: 'Bottle',
            Theme: 'Flowers',
            'Room Type': 'Bedroom, Di, Home Office, Living Room',
        },
        images: [
            'https://m.media-amazon.com/images/I/61jsnuWSutL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61NnlFD2wjL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/51oyuZ4w96L._SL900_.jpg',
        ],
        rating: 4,
        ratingCount: 344,
        variants: [
            {
                sku: 'PURCERBUDVAS-STD',
                label: 'Bud',
                attrs: { colour: 'Bud' },
                priceMinorUnits: 87600,
                mrpMinorUnits: 249900,
                stock: 36,
            },
        ],
    },
    {
        slug: 'exclusivelane-dainty-flowers-lamp',
        category: 'home',
        seller: 'casa-nido',
        title: 'ExclusiveLane Dainty Flowers Mango Wood LED Lamp',
        brand: 'ExclusiveLane',
        description:
            'ExclusiveLane Dainty Flowers Mango Wood LED Lamp from ExclusiveLane — finished in shade: off-white with green hand-painting, base: dark brown & green. Handcrafted, Handcarved & Hand-Painted By Indian Artisans.',
        highlights: [
            'Handcrafted, Handcarved & Hand-Painted By Indian Artisans.',
            'Inspired from the small flowering weeds that usually grow on their own in small gardens, fields, lawns or roadsides.Depicts a table lamp with small.',
            'The dimensions of the Table Lamp is: TOTAL: (L * W * H) = (7.2 * 7.2 * 12.7), SHADE: (L * W * H) = (7.2 * 7.2 * 6.6), BASE: (L * W * H) = (4.6 * 4.6.',
            'PACKAGE CONTENT : 1 Table Lamp, COLOR : SHADE: Off-White With Green Hand-Painting, BASE: Dark Brown & Green, MATERIAL : SHADE: Cotton Cloth Wrapped.',
        ],
        specs: {
            Colour: 'SHADE: Off-White With Green Hand-Painting, BASE: Dark Brown & Green',
            Style: 'Dainty Flowers',
            'Item Weight': '724 Grams',
            'Finish Type': 'Distressed',
            'Room Type': 'Bedroom, Hall, Kids Room, Living Room',
            'Mounting Type': 'Tabletop',
            'Light Source Type': 'Incandescent, LED',
        },
        images: [
            'https://m.media-amazon.com/images/I/61Mofwc5SkL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71aslFSYZrL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71TVV21GIIL._SL900_.jpg',
        ],
        rating: 4,
        ratingCount: 148,
        variants: [
            {
                sku: 'EXCDAIFLOLAM-STD',
                label: 'SHADE: Off-White With Green Hand-Painting, BASE: Dark Brown & Green',
                attrs: {
                    colour: 'SHADE: Off-White With Green Hand-Painting, BASE: Dark Brown & Green',
                },
                priceMinorUnits: 169900,
                mrpMinorUnits: 324900,
                stock: 51,
            },
        ],
    },
    {
        slug: 'homesake-luxe-cone-gold-lamp',
        category: 'home',
        seller: 'casa-nido',
        title: 'Homesake Luxe Cone Gold Table Lamp',
        brand: 'Homesake',
        description:
            'Homesake Luxe Cone Gold Table Lamp from Homesake — finished in jute cylinder.',
        highlights: [
            '𝗖𝗢𝗡𝗘 𝗚𝗢𝗟𝗗 𝗧𝗔𝗕𝗟𝗘 𝗟𝗔𝗠𝗣: Features a polished metal gold finish cone-shaped base paired with a soft beige fabric drum shade for a.',
            '𝗗𝗜𝗠𝗘𝗡𝗦𝗜𝗢𝗡𝗦: Total height 41.9 cm, base width 7.6 cm, base height 21.5 cm, shade diameter 17.7 cm, and shade height 19 cm. Perfect for daily.',
            '𝗛𝗢𝗠𝗘 𝗗𝗘𝗖𝗢𝗥 𝗟𝗔𝗠𝗣: Modern bedside table lamp for bedroom, decorative night lamp for living room, study table & home décor, warm ambient.',
        ],
        specs: {
            Colour: 'Jute Cylinder',
            Style: 'Modern',
            'Item Weight': '388 Grams',
            'Water Resistance Level': 'Water Resistant',
            Shape: 'Cone',
            'Finish Type': 'Polished',
            'Room Type': 'Bedroom, Dining Room, Living Room, Office, Study Room',
        },
        images: [
            'https://m.media-amazon.com/images/I/713l-VaKMrL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61eG3qK+voL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61z+S9LWtAL._SL900_.jpg',
        ],
        rating: 3.9,
        ratingCount: 183,
        variants: [
            {
                sku: 'HOMLUXCONGOL-STD',
                label: 'Jute Cylinder',
                attrs: { colour: 'Jute Cylinder' },
                priceMinorUnits: 109900,
                mrpMinorUnits: 300000,
                stock: 18,
            },
        ],
    },
    {
        slug: 'textured-ceramic-plant-pots',
        category: 'home',
        seller: 'casa-nido',
        title: 'Textured Ceramic Plant Pots with Saucers (Set of 3)',
        brand: 'GardenZeek',
        description:
            "Textured Ceramic Plant Pots with Saucers (Set of 3) from GardenZeek — finished in grey. Size - Large：6.7''D X 5. 5''H , Medium ：5.5''D X 4.2''H , Small ：4.2''D X 3.3''H.",
        highlights: [
            'Material - Sturdy ceramic flower pots',
            "Size - Large：6.7''D X 5. 5''H , Medium ：5.5''D X 4.2''H , Small ：4.2''D X 3.3''H",
            'Set of 3 Ceramic Flower Pots with Drain Hole',
            'Beautiful Minimalistic Design. Goes with all types of home décor',
        ],
        specs: {
            Colour: 'Grey',
            Size: 'Large 6.7X5.5 Medium 5.5X4.2 Small 4.2X3.3(Inches)',
            Style: 'Antique',
            'Item Weight': '1.7 Kilograms',
            Shape: 'Round',
            'Mounting Type': 'Tabletop',
            Material: 'Ceramic',
        },
        images: [
            'https://m.media-amazon.com/images/I/71kSyNTeLWL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61fA9fs9vCL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/7196G8ZptuL._SL900_.jpg',
        ],
        rating: 4.4,
        ratingCount: 93,
        variants: [
            {
                sku: 'TEXCERPLAPOT-STD',
                label: 'Grey',
                attrs: { colour: 'Grey' },
                priceMinorUnits: 169900,
                mrpMinorUnits: 299900,
                stock: 19,
            },
        ],
    },
    {
        slug: 'exclusivelane-indigo-vines-planters',
        category: 'home',
        seller: 'casa-nido',
        title: 'ExclusiveLane Indigo Vines Table Planters (Set of 2)',
        brand: 'ExclusiveLane',
        description:
            'ExclusiveLane Indigo Vines Table Planters (Set of 2) from ExclusiveLane — finished in white, indigo and orange, size Set Of 2. Ideal to be used for planting your favourite plants.',
        highlights: [
            'Handmade in India by artisans.',
            'Ideal to be used for planting your favourite plants.',
            'The dimensions of each planter is: (L x W x H) = (5.6 x 5.6 x 4) Inch',
            'Package Content: 2 Planters, Colour: White, Indigo and Orange, Material: Ceramic',
        ],
        specs: {
            Colour: 'White, Indigo and Orange',
            Size: 'Set Of 2',
            Pattern: 'Solid',
            Style: 'Garden',
            'Item Weight': '1500 Grams',
            Shape: 'Cylindrical',
            Theme: 'Floral',
        },
        images: [
            'https://m.media-amazon.com/images/I/81TeaDAhemL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/51Glibl9deL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71YgTTnEjzL._SL900_.jpg',
        ],
        rating: 4,
        ratingCount: 158,
        variants: [
            {
                sku: 'EXCINDVINPLA-STD',
                label: 'White, Indigo and Orange',
                attrs: { colour: 'White, Indigo and Orange' },
                priceMinorUnits: 87600,
                mrpMinorUnits: 166000,
                stock: 80,
            },
        ],
    },
    {
        slug: 'artsense-golden-wishtree-painting',
        category: 'home',
        seller: 'casa-nido',
        title: 'Artsense Golden Wishtree Wall Painting',
        brand: 'Artsense',
        description:
            'Artsense Golden Wishtree Wall Painting from Artsense — finished in multicolor, size 30 inches.',
        highlights: ['Polished finish', 'Rectangular silhouette', 'Nature theme', 'Size 30 inches'],
        specs: {
            Colour: 'Multicolor',
            Size: '30 inches',
            Pattern: 'Lucky-Tree',
            'Item Weight': '2 Kilograms',
            Shape: 'Rectangular',
            Theme: 'Nature',
            'Finish Type': 'Polished',
        },
        images: [
            'https://m.media-amazon.com/images/I/71HhGucTssL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71IfXPhtlkL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61kYxg5v1HL._SL900_.jpg',
        ],
        rating: 4,
        ratingCount: 156,
        variants: [
            {
                sku: 'ARTGOLWISPAI-STD',
                label: 'Multicolor',
                attrs: { colour: 'Multicolor' },
                priceMinorUnits: 189900,
                mrpMinorUnits: 499900,
                stock: 65,
            },
        ],
    },
    {
        slug: 'hothouse-framed-flower-wall-art',
        category: 'home',
        seller: 'casa-nido',
        title: 'Hothouse Framed Flower Wall Art',
        brand: 'HOTHOUSE',
        description:
            'Hothouse Framed Flower Wall Art from HOTHOUSE — finished in art 2, size 13X17 INCH. QUALITY : The artwork is printed on 300 GSM thick paper with high quality printer and vibrant colors, to give it rich look.',
        highlights: [
            'QUALITY : The artwork is printed on 300 GSM thick paper with high quality printer and vibrant colors, to give it rich look.',
            'Frame Material Type: Engineered Wood',
            'REUSABLE FRAMES - If you want to change the Artwork with another poster or photo after some time, you can do so. You required to remove MDF Wood.',
        ],
        specs: {
            Colour: 'Art 2',
            Size: '13X17 INCH',
            Pattern: 'Car Travel',
            'Item Weight': '800 Grams',
            Shape: 'Rectangular',
            Theme: 'TRADITIONAL',
            'Finish Type': 'Engineered Wood',
        },
        images: [
            'https://m.media-amazon.com/images/I/71asRst-nsL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71aLMtm5+eL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71L2hdyxV4L._SL900_.jpg',
        ],
        rating: 4.6,
        ratingCount: 3,
        variants: [
            {
                sku: 'HOTFRAFLOWAL-STD',
                label: 'Art 2',
                attrs: { colour: 'Art 2' },
                priceMinorUnits: 139900,
                mrpMinorUnits: 699900,
                stock: 68,
            },
        ],
    },
    {
        slug: 'vintage-metal-wall-clock',
        category: 'home',
        seller: 'casa-nido',
        title: 'Vintage Metal Wall Clock',
        brand: 'MACODECO',
        description:
            'Vintage Metal Wall Clock from MACODECO — finished in golden, size Small. This decorative wall clock for the bedroom is crafted with precision, serving as both a functional clock and a beautiful piece of metal wall art for the living room.',
        highlights: [
            'This decorative wall clock for the bedroom is crafted with precision, serving as both a functional clock and a beautiful piece of metal wall art for.',
            'Perfect as a wall clock for the bedroom, this vintage clock combines traditional aesthetics with contemporary design, making it a versatile addition.',
            'The big wall clock for the living room is not just a timepiece but a statement piece, offering a stylish and modern touch to your home decoration.',
            'Enhance your living room decor with this antique wall clock, a designer piece that adds a touch of sophistication and charm to any interior design.',
        ],
        specs: {
            Colour: 'golden',
            Size: 'Small',
            Style: 'floral',
            'Item Weight': '1 Kilograms',
            'Display Type': 'Analog',
            'Display Size': '78.74 Centimetres',
            Shape: 'Round',
        },
        images: [
            'https://m.media-amazon.com/images/I/61ol8dQ4OML._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61wiBj03zIL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/613ckr8JIAL._SL900_.jpg',
        ],
        rating: 3.2,
        ratingCount: 129,
        variants: [
            {
                sku: 'VINMETWALCLO-STD',
                label: 'golden',
                attrs: { colour: 'golden' },
                priceMinorUnits: 49900,
                mrpMinorUnits: 124900,
                stock: 45,
            },
        ],
    },
    {
        slug: 'funterest-gold-leaf-wall-decor',
        category: 'home',
        seller: 'casa-nido',
        title: 'Funterest Gold Leaf Metal Wall Decor (Set of 3)',
        brand: 'FUNTEREST',
        description:
            'Funterest Gold Leaf Metal Wall Decor (Set of 3) from FUNTEREST — finished in gold wall art set of 3, size 11.8 X 17.7 In. BEAUTIFUL METAL ART WALL DECOR: This wall art for living room size 45 x 30 cm / 17.7 high&#34.',
        highlights: [
            'BEAUTIFUL METAL ART WALL DECOR: This wall art for living room size 45 x 30 cm / 17.7 high&#34',
            'EXCELLENT QUANLITY: Gold metal wall decor is beautiful in appearance, bright colors and luster, handmade from durable iron metal materials, high.',
            'Glossy finish',
            'Rectangular silhouette',
        ],
        specs: {
            Colour: 'Gold Wall Art Set of 3',
            Size: '11.8 X 17.7 In',
            Pattern: 'Leaf',
            'Item Weight': '748 g',
            Shape: 'Rectangular',
            Theme: 'Leaf',
            'Finish Type': 'Glossy',
        },
        images: [
            'https://m.media-amazon.com/images/I/718Hub5DjgL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/81YTgsvu4AL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/816xrVq9foL._SL900_.jpg',
        ],
        rating: 3.9,
        ratingCount: 1677,
        variants: [
            {
                sku: 'FUNGOLLEAWAL-STD',
                label: 'Gold Wall Art Set of 3',
                attrs: { colour: 'Gold Wall Art Set of 3' },
                priceMinorUnits: 43500,
                mrpMinorUnits: 199900,
                stock: 71,
            },
        ],
    },
    {
        slug: 'livinluxe-tree-of-life-canvas',
        category: 'home',
        seller: 'casa-nido',
        title: "Livin'luxe Tree of Life Framed Canvas",
        brand: "Livin'luxe",
        description:
            "Livin'luxe Tree of Life Framed Canvas from Livin'luxe — finished in color22, size 60L x 60W cm. WITH FRAME: Our Canvas Paintings Are Wooden Framed which will give Elegant Look to your Room.",
        highlights: [
            'WITH FRAME: Our Canvas Paintings Are Wooden Framed which will give Elegant Look to your Room.',
            'LUXURIOUS & ELEGANT: Give a spectacular new look to your home with this digitally printed framed Canvas Painting',
            'The texture & weight of the canvas brings art reproductions one step closer to the originals.',
            'USAGE:perfect choice for for living room and bed room wall painting. It can be used as wall paper and tapestry.A great gift idea for your relatives.',
        ],
        specs: {
            Colour: 'Color22',
            Size: '60L x 60W cm',
            Pattern: 'Leaf',
            'Item Weight': '800 Grams',
            Shape: 'Square',
            Theme: 'Modern art',
            'Finish Type': 'Matte',
        },
        images: [
            'https://m.media-amazon.com/images/I/81-kFusWXzL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/91dRLmZmySL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/91JWv9lnBsL._SL900_.jpg',
        ],
        rating: 4,
        ratingCount: 142,
        variants: [
            {
                sku: 'LIVTREOFLIFC-STD',
                label: 'Color22',
                attrs: { colour: 'Color22' },
                priceMinorUnits: 94800,
                mrpMinorUnits: 399900,
                stock: 42,
            },
        ],
    },
    {
        slug: 'puma-graphics-training-tee',
        category: 'apparel',
        seller: 'flexfit',
        title: 'PUMA Graphics Training Tee',
        brand: 'PUMA',
        description: 'PUMA Graphics Training Tee from PUMA — finished in black.',
        highlights: ['Polyester build', 'Jacquard fabric', 'Straight fit', 'Crew Neck neckline'],
        specs: {
            Colour: 'Black',
            'Material type': 'Polyester',
            'Fabric Type': 'Jacquard',
            'Fitting type': 'Straight',
            'Neck Style': 'Crew Neck',
            'Sleeve Type': 'Short Sleeve',
            Pattern: 'Solid',
        },
        images: [
            'https://m.media-amazon.com/images/I/51SpOiouDYL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/51ufIpy3XDL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61nNEAnfdFL._SL900_.jpg',
        ],
        rating: 3.7,
        ratingCount: 279,
        variants: [
            {
                sku: 'PUMGRATRATEE-S',
                label: 'S · Black',
                attrs: { size: 'S', colour: 'Black' },
                priceMinorUnits: 79900,
                mrpMinorUnits: 199900,
                stock: 46,
            },
            {
                sku: 'PUMGRATRATEE-M',
                label: 'M · Black',
                attrs: { size: 'M', colour: 'Black' },
                priceMinorUnits: 79900,
                mrpMinorUnits: 199900,
                stock: 40,
            },
            {
                sku: 'PUMGRATRATEE-L',
                label: 'L · Black',
                attrs: { size: 'L', colour: 'Black' },
                priceMinorUnits: 79900,
                mrpMinorUnits: 199900,
                stock: 39,
            },
            {
                sku: 'PUMGRATRATEE-XL',
                label: 'XL · Black',
                attrs: { size: 'XL', colour: 'Black' },
                priceMinorUnits: 79900,
                mrpMinorUnits: 199900,
                stock: 44,
            },
        ],
    },
    {
        slug: 'puma-active-mesh-tee',
        category: 'apparel',
        seller: 'flexfit',
        title: 'PUMA Active Mesh Tee',
        brand: 'PUMA',
        description: 'PUMA Active Mesh Tee from PUMA — finished in royal sapphire.',
        highlights: ['Polyester build', 'Regular Fit fit', 'Crew Neck neckline', 'Short Sleeve'],
        specs: {
            Colour: 'Royal Sapphire',
            'Material type': 'Polyester',
            'Fitting type': 'Regular Fit',
            'Neck Style': 'Crew Neck',
            'Sleeve Type': 'Short Sleeve',
            Pattern: 'Solid',
            'Item Weight': '200 Grams',
        },
        images: [
            'https://m.media-amazon.com/images/I/51gzhJvLiBL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/51TI6h8rPtL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71xVMbvy89L._SL900_.jpg',
        ],
        rating: 4.2,
        ratingCount: 25,
        variants: [
            {
                sku: 'PUMACTMESTEE-S',
                label: 'S · Royal Sapphire',
                attrs: { size: 'S', colour: 'Royal Sapphire' },
                priceMinorUnits: 74900,
                mrpMinorUnits: 149900,
                stock: 13,
            },
            {
                sku: 'PUMACTMESTEE-M',
                label: 'M · Royal Sapphire',
                attrs: { size: 'M', colour: 'Royal Sapphire' },
                priceMinorUnits: 74900,
                mrpMinorUnits: 149900,
                stock: 7,
            },
            {
                sku: 'PUMACTMESTEE-L',
                label: 'L · Royal Sapphire',
                attrs: { size: 'L', colour: 'Royal Sapphire' },
                priceMinorUnits: 74900,
                mrpMinorUnits: 149900,
                stock: 6,
            },
            {
                sku: 'PUMACTMESTEE-XL',
                label: 'XL · Royal Sapphire',
                attrs: { size: 'XL', colour: 'Royal Sapphire' },
                priceMinorUnits: 74900,
                mrpMinorUnits: 149900,
                stock: 40,
            },
        ],
    },
    {
        slug: 'adidas-train-essentials-tee',
        category: 'apparel',
        seller: 'flexfit',
        title: 'adidas Train Essentials Comfort Tee',
        brand: 'adidas',
        description: 'adidas Train Essentials Comfort Tee from adidas — finished in black/white.',
        highlights: [
            'Polyester build',
            '76% Polyester fabric',
            'Regular Fit fit',
            'Crew Neck neckline',
        ],
        specs: {
            Colour: 'BLACK/WHITE',
            'Material type': 'Polyester',
            'Fabric Type': '76% Polyester',
            'Fitting type': 'Regular Fit',
            'Neck Style': 'Crew Neck',
            'Sleeve Type': 'Short Sleeve',
            Pattern: 'Geometric',
        },
        images: [
            'https://m.media-amazon.com/images/I/61K7+r5+oOL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61ICeIYDvGL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/81GWl98DdyL._SL900_.jpg',
        ],
        rating: 3.8,
        ratingCount: 8,
        variants: [
            {
                sku: 'ADITRAESSTEE-S',
                label: 'S · BLACK/WHITE',
                attrs: { size: 'S', colour: 'BLACK/WHITE' },
                priceMinorUnits: 80900,
                mrpMinorUnits: 179900,
                stock: 9,
            },
            {
                sku: 'ADITRAESSTEE-M',
                label: 'M · BLACK/WHITE',
                attrs: { size: 'M', colour: 'BLACK/WHITE' },
                priceMinorUnits: 80900,
                mrpMinorUnits: 179900,
                stock: 46,
            },
            {
                sku: 'ADITRAESSTEE-L',
                label: 'L · BLACK/WHITE',
                attrs: { size: 'L', colour: 'BLACK/WHITE' },
                priceMinorUnits: 80900,
                mrpMinorUnits: 179900,
                stock: 45,
            },
            {
                sku: 'ADITRAESSTEE-XL',
                label: 'XL · BLACK/WHITE',
                attrs: { size: 'XL', colour: 'BLACK/WHITE' },
                priceMinorUnits: 80900,
                mrpMinorUnits: 179900,
                stock: 16,
            },
        ],
    },
    {
        slug: 'super-mesh-dry-fit-tee',
        category: 'apparel',
        seller: 'flexfit',
        title: 'Super Mesh Dry-Fit Sports T-Shirt',
        brand: 'AAVEXA',
        description: 'Super Mesh Dry-Fit Sports T-Shirt from AAVEXA — finished in orange.',
        highlights: [
            'Super Mesh Drifit build',
            'Super Mesh Drifit Fabric fabric',
            'Regular Fit fit',
            'Collared Neck neckline',
        ],
        specs: {
            Colour: 'Orange',
            'Material type': 'Super Mesh Drifit',
            'Fabric Type': 'Super Mesh Drifit Fabric',
            'Fitting type': 'Regular Fit',
            'Neck Style': 'Collared Neck',
            'Sleeve Type': 'Raglan Sleeve',
            Pattern: 'Printed',
        },
        images: [
            'https://m.media-amazon.com/images/I/71Y9AbJ1yCL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61AI+WQlvSL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71KF2Tr5-dL._SL900_.jpg',
        ],
        rating: 4,
        ratingCount: 4627,
        variants: [
            {
                sku: 'SUPMESDRYFIT-S',
                label: 'S · Orange',
                attrs: { size: 'S', colour: 'Orange' },
                priceMinorUnits: 44900,
                mrpMinorUnits: 119900,
                stock: 32,
            },
            {
                sku: 'SUPMESDRYFIT-M',
                label: 'M · Orange',
                attrs: { size: 'M', colour: 'Orange' },
                priceMinorUnits: 44900,
                mrpMinorUnits: 119900,
                stock: 26,
            },
            {
                sku: 'SUPMESDRYFIT-L',
                label: 'L · Orange',
                attrs: { size: 'L', colour: 'Orange' },
                priceMinorUnits: 44900,
                mrpMinorUnits: 119900,
                stock: 25,
            },
            {
                sku: 'SUPMESDRYFIT-XL',
                label: 'XL · Orange',
                attrs: { size: 'XL', colour: 'Orange' },
                priceMinorUnits: 44900,
                mrpMinorUnits: 119900,
                stock: 14,
            },
        ],
    },
    {
        slug: 'puma-teamrise-training-shorts',
        category: 'apparel',
        seller: 'flexfit',
        title: 'PUMA teamRISE Training Shorts',
        brand: 'PUMA',
        description: 'PUMA teamRISE Training Shorts from PUMA — finished in peacoat-white.',
        highlights: ['Polyester build', 'Drawstring closure', 'Solid pattern', 'Made for winter'],
        specs: {
            Colour: 'Peacoat-White',
            'Material type': 'Polyester',
            Pattern: 'Solid',
            'Item Weight': '120 Grams',
            'Product Care Instructions': 'Machine Wash',
            Season: 'Winter',
            'Closure Type': 'Drawstring',
        },
        images: [
            'https://m.media-amazon.com/images/I/51aK8kEvMhL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61hkqDfgkUL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/51SNCUudwPL._SL900_.jpg',
        ],
        rating: 4.3,
        ratingCount: 99,
        variants: [
            {
                sku: 'PUMTEATRASHO-M',
                label: 'M · Peacoat-White',
                attrs: { size: 'M', colour: 'Peacoat-White' },
                priceMinorUnits: 108300,
                mrpMinorUnits: 179900,
                stock: 13,
            },
            {
                sku: 'PUMTEATRASHO-L',
                label: 'L · Peacoat-White',
                attrs: { size: 'L', colour: 'Peacoat-White' },
                priceMinorUnits: 108300,
                mrpMinorUnits: 179900,
                stock: 12,
            },
            {
                sku: 'PUMTEATRASHO-XL',
                label: 'XL · Peacoat-White',
                attrs: { size: 'XL', colour: 'Peacoat-White' },
                priceMinorUnits: 108300,
                mrpMinorUnits: 179900,
                stock: 25,
            },
        ],
    },
    {
        slug: 'puma-essentials-high-waist-tights',
        category: 'apparel',
        seller: 'flexfit',
        title: 'PUMA Essentials High-Waist Tights',
        brand: 'PUMA',
        description: 'PUMA Essentials High-Waist Tights from PUMA — finished in black.',
        highlights: [
            'Knitted fabric',
            'Drawstring closure',
            'Solid pattern',
            'Made for spring, summer',
        ],
        specs: {
            Colour: 'Black',
            'Fabric Type': 'Knitted',
            Pattern: 'Solid',
            'Product Care Instructions': 'Machine Wash',
            Season: 'Spring, Summer',
            'Closure Type': 'Drawstring',
            'Sport Type': 'General Athletic Wear',
        },
        images: [
            'https://m.media-amazon.com/images/I/51NKHUqaRJL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/51Xg8GxBdvL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61W+8fwcV7L._SL900_.jpg',
        ],
        rating: 4.1,
        ratingCount: 6,
        variants: [
            {
                sku: 'PUMESSHIGWAI-S',
                label: 'S · Black',
                attrs: { size: 'S', colour: 'Black' },
                priceMinorUnits: 109900,
                mrpMinorUnits: 199900,
                stock: 43,
            },
            {
                sku: 'PUMESSHIGWAI-M',
                label: 'M · Black',
                attrs: { size: 'M', colour: 'Black' },
                priceMinorUnits: 109900,
                mrpMinorUnits: 199900,
                stock: 37,
            },
            {
                sku: 'PUMESSHIGWAI-L',
                label: 'L · Black',
                attrs: { size: 'L', colour: 'Black' },
                priceMinorUnits: 109900,
                mrpMinorUnits: 199900,
                stock: 36,
            },
            {
                sku: 'PUMESSHIGWAI-XL',
                label: 'XL · Black',
                attrs: { size: 'XL', colour: 'Black' },
                priceMinorUnits: 109900,
                mrpMinorUnits: 199900,
                stock: 12,
            },
        ],
    },
    {
        slug: 'clovia-high-rise-gym-tights',
        category: 'apparel',
        seller: 'flexfit',
        title: 'Clovia High-Rise Gym Tights with Pocket',
        brand: 'Clovia',
        description: 'Clovia High-Rise Gym Tights with Pocket from Clovia — finished in black.',
        highlights: ['Polyamide fabric', 'Pull On closure', 'Solid pattern', 'Made for winter'],
        specs: {
            Colour: 'Black',
            'Fabric Type': 'Polyamide',
            Pattern: 'Solid',
            'Item Weight': '300 Grams',
            'Product Care Instructions': 'Hand Wash Only',
            Season: 'Winter',
            'Closure Type': 'Pull On',
        },
        images: [
            'https://m.media-amazon.com/images/I/51Aj3I4jY7L._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61Y1aa8k1aL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61x3ujpuoeL._SL900_.jpg',
        ],
        rating: 3.9,
        ratingCount: 54,
        variants: [
            {
                sku: 'CLOHIGRISGYM-S',
                label: 'S · Black',
                attrs: { size: 'S', colour: 'Black' },
                priceMinorUnits: 55100,
                mrpMinorUnits: 119900,
                stock: 36,
            },
            {
                sku: 'CLOHIGRISGYM-M',
                label: 'M · Black',
                attrs: { size: 'M', colour: 'Black' },
                priceMinorUnits: 55100,
                mrpMinorUnits: 119900,
                stock: 30,
            },
            {
                sku: 'CLOHIGRISGYM-L',
                label: 'L · Black',
                attrs: { size: 'L', colour: 'Black' },
                priceMinorUnits: 55100,
                mrpMinorUnits: 119900,
                stock: 29,
            },
            {
                sku: 'CLOHIGRISGYM-XL',
                label: 'XL · Black',
                attrs: { size: 'XL', colour: 'Black' },
                priceMinorUnits: 55100,
                mrpMinorUnits: 119900,
                stock: 22,
            },
        ],
    },
    {
        slug: 'clovia-medium-impact-sports-bra',
        category: 'apparel',
        seller: 'flexfit',
        title: 'Clovia Medium-Impact Padded Sports Bra',
        brand: 'Clovia',
        description: 'Clovia Medium-Impact Padded Sports Bra from Clovia — finished in black.',
        highlights: ['Polyester fabric', 'U-Neck neckline', 'Pull-On closure', 'Solid pattern'],
        specs: {
            Colour: 'Black',
            'Fabric Type': 'Polyester',
            'Neck Style': 'U-Neck',
            Pattern: 'Solid',
            'Item Weight': '300 Grams',
            'Product Care Instructions': 'Hand Wash Only',
            Season: 'Spring-Summer',
        },
        images: [
            'https://m.media-amazon.com/images/I/61CIlqWdcUL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71ktigj6A8L._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61+pPEVf9tL._SL900_.jpg',
        ],
        rating: 3.8,
        ratingCount: 156,
        variants: [
            {
                sku: 'CLOMEDIMPSPO-S',
                label: 'S · Black',
                attrs: { size: 'S', colour: 'Black' },
                priceMinorUnits: 45200,
                mrpMinorUnits: 129900,
                stock: 40,
            },
            {
                sku: 'CLOMEDIMPSPO-M',
                label: 'M · Black',
                attrs: { size: 'M', colour: 'Black' },
                priceMinorUnits: 45200,
                mrpMinorUnits: 129900,
                stock: 34,
            },
            {
                sku: 'CLOMEDIMPSPO-L',
                label: 'L · Black',
                attrs: { size: 'L', colour: 'Black' },
                priceMinorUnits: 45200,
                mrpMinorUnits: 129900,
                stock: 33,
            },
        ],
    },
    {
        slug: 'adidas-vacfast-running-shoes',
        category: 'apparel',
        seller: 'flexfit',
        title: 'adidas Vacfast Running Shoes',
        brand: 'adidas',
        description:
            'adidas Vacfast Running Shoes from adidas — finished in cblack/ftwwht/lgsogr/lingrn.',
        highlights: ['Rubber sole', 'Lace-Up closure', 'Not Water Resistant', 'Sport theme'],
        specs: {
            Colour: 'CBLACK/FTWWHT/LGSOGR/LINGRN',
            Pattern: 'Geometric',
            'Item Weight': '1 Grams',
            'Water Resistance Level': 'Not Water Resistant',
            Season: 'All, Winter',
            'Closure Type': 'Lace-Up',
            'Sole Material': 'Rubber',
        },
        images: [
            'https://m.media-amazon.com/images/I/61GxUxLI6ZL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61i1x6vQMtL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61sQnpsYwWL._SL900_.jpg',
        ],
        rating: 4,
        ratingCount: 133,
        variants: [
            {
                sku: 'ADIVACRUNSHO-UK7',
                label: 'UK 7 · CBLACK/FTWWHT/LGSOGR/LINGRN',
                attrs: { size: 'UK 7', colour: 'CBLACK/FTWWHT/LGSOGR/LINGRN' },
                priceMinorUnits: 261900,
                mrpMinorUnits: 499900,
                stock: 29,
            },
            {
                sku: 'ADIVACRUNSHO-UK8',
                label: 'UK 8 · CBLACK/FTWWHT/LGSOGR/LINGRN',
                attrs: { size: 'UK 8', colour: 'CBLACK/FTWWHT/LGSOGR/LINGRN' },
                priceMinorUnits: 261900,
                mrpMinorUnits: 499900,
                stock: 30,
            },
            {
                sku: 'ADIVACRUNSHO-UK9',
                label: 'UK 9 · CBLACK/FTWWHT/LGSOGR/LINGRN',
                attrs: { size: 'UK 9', colour: 'CBLACK/FTWWHT/LGSOGR/LINGRN' },
                priceMinorUnits: 261900,
                mrpMinorUnits: 499900,
                stock: 31,
            },
            {
                sku: 'ADIVACRUNSHO-UK10',
                label: 'UK 10 · CBLACK/FTWWHT/LGSOGR/LINGRN',
                attrs: { size: 'UK 10', colour: 'CBLACK/FTWWHT/LGSOGR/LINGRN' },
                priceMinorUnits: 261900,
                mrpMinorUnits: 499900,
                stock: 25,
            },
        ],
    },
    {
        slug: 'puma-softride-shoes',
        category: 'apparel',
        seller: 'flexfit',
        title: 'PUMA Softride Cushioned Shoes',
        brand: 'PUMA',
        description: 'PUMA Softride Cushioned Shoes from PUMA — finished in flat medium gray.',
        highlights: ['Rubber sole', 'Lace-Up closure', 'Not Water Resistant', 'Solid pattern'],
        specs: {
            Colour: 'Flat Medium Gray',
            Pattern: 'Solid',
            'Item Weight': '700 Grams',
            'Water Resistance Level': 'Not Water Resistant',
            Season: 'Spring, Summer',
            'Closure Type': 'Lace-Up',
            'Sole Material': 'Rubber',
        },
        images: [
            'https://m.media-amazon.com/images/I/51OKljQH8nL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/51tmVuuSqDL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/51cWR9jW3WL._SL900_.jpg',
        ],
        rating: 3.7,
        ratingCount: 34,
        variants: [
            {
                sku: 'PUMSOFSHO-UK7',
                label: 'UK 7 · Flat Medium Gray',
                attrs: { size: 'UK 7', colour: 'Flat Medium Gray' },
                priceMinorUnits: 261300,
                mrpMinorUnits: 699900,
                stock: 41,
            },
            {
                sku: 'PUMSOFSHO-UK8',
                label: 'UK 8 · Flat Medium Gray',
                attrs: { size: 'UK 8', colour: 'Flat Medium Gray' },
                priceMinorUnits: 261300,
                mrpMinorUnits: 699900,
                stock: 42,
            },
            {
                sku: 'PUMSOFSHO-UK9',
                label: 'UK 9 · Flat Medium Gray',
                attrs: { size: 'UK 9', colour: 'Flat Medium Gray' },
                priceMinorUnits: 261300,
                mrpMinorUnits: 699900,
                stock: 43,
            },
            {
                sku: 'PUMSOFSHO-UK10',
                label: 'UK 10 · Flat Medium Gray',
                attrs: { size: 'UK 10', colour: 'Flat Medium Gray' },
                priceMinorUnits: 261300,
                mrpMinorUnits: 699900,
                stock: 22,
            },
        ],
    },
    {
        slug: 'boldfit-slim-fit-joggers',
        category: 'apparel',
        seller: 'flexfit',
        title: 'Boldfit Slim-Fit Training Joggers',
        brand: 'Boldfit',
        description: 'Boldfit Slim-Fit Training Joggers from Boldfit — finished in black.',
        highlights: ['Polyester fabric', 'Drawstring closure', 'Solid pattern', 'Made for summer'],
        specs: {
            Colour: 'Black',
            'Fabric Type': 'Polyester',
            Pattern: 'Solid',
            'Item Weight': '350 Grams',
            'Product Care Instructions': 'Machine Wash',
            Season: 'Summer',
            'Closure Type': 'Drawstring',
        },
        images: [
            'https://m.media-amazon.com/images/I/519X02vsiPL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71A3nHJ6XpL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71LBnrsxeUL._SL900_.jpg',
        ],
        rating: 4.1,
        ratingCount: 1752,
        variants: [
            {
                sku: 'BOLSLIFITJOG-S',
                label: 'S · Black',
                attrs: { size: 'S', colour: 'Black' },
                priceMinorUnits: 84900,
                mrpMinorUnits: 199900,
                stock: 19,
            },
            {
                sku: 'BOLSLIFITJOG-M',
                label: 'M · Black',
                attrs: { size: 'M', colour: 'Black' },
                priceMinorUnits: 84900,
                mrpMinorUnits: 199900,
                stock: 13,
            },
            {
                sku: 'BOLSLIFITJOG-L',
                label: 'L · Black',
                attrs: { size: 'L', colour: 'Black' },
                priceMinorUnits: 84900,
                mrpMinorUnits: 199900,
                stock: 12,
            },
            {
                sku: 'BOLSLIFITJOG-XL',
                label: 'XL · Black',
                attrs: { size: 'XL', colour: 'Black' },
                priceMinorUnits: 84900,
                mrpMinorUnits: 199900,
                stock: 35,
            },
        ],
    },
    {
        slug: 'symactive-6mm-yoga-mat',
        category: 'lifestyle',
        seller: 'flexfit',
        title: 'Symactive 6 mm Anti-Skid Yoga Mat',
        brand: 'Amazon Brand - Symactive',
        description:
            'Symactive 6 mm Anti-Skid Yoga Mat from Amazon Brand - Symactive — finished in army green. All-Purpose: Use this mat for Yoga, pilates, stretching and strengthening exercises. It is suitable for both men and women.',
        highlights: [
            'All-Purpose: Use this mat for Yoga, pilates, stretching and strengthening exercises. It is suitable for both men and women.',
            'Skin-safe and eco-friendly: It is made from premium EVA and LDPE foam, and is free from PVC, silicone, latex, lead, phthalates, and other harmful.',
            'Hygienic: It is sweat- and dirt-proof.',
            'Lightweight and portable: Accompanied by a complementary mat strap, this lightweight mat is easy to carry from your home to the gym or fitness centre.',
        ],
        specs: {
            Colour: 'Army Green',
            'Item Weight': '540 Grams',
            'Product Care Instructions': 'Hand Wash Only',
            Material: 'Ethylene Vinyl Acetate',
            'Model Number': 'ESSENTIAL YOGA MAT',
            'Part Number': 'ESSENTIAL YOGA MAT',
            'Material Type': 'Ethylene Vinyl Acetate',
        },
        images: [
            'https://m.media-amazon.com/images/I/81-O5h3Y1GL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71JVWdj0VZL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71i0jjlUYZL._SL900_.jpg',
        ],
        rating: 3.6,
        ratingCount: 21,
        variants: [
            {
                sku: 'SYM6MMYOGMAT-STD',
                label: 'Army Green',
                attrs: { colour: 'Army Green' },
                priceMinorUnits: 41900,
                mrpMinorUnits: 130000,
                stock: 90,
            },
        ],
    },
    {
        slug: 'symactive-20kg-dumbbell-set',
        category: 'lifestyle',
        seller: 'flexfit',
        title: 'Symactive 20 kg Adjustable Dumbbell Set',
        brand: 'Amazon Brand - Symactive',
        description:
            'Symactive 20 kg Adjustable Dumbbell Set from Amazon Brand - Symactive — finished in red-black. In-box Contents: In-Box Contents: 20 kg of PVC weight (3 kg x 4 = 12 kg, 2 kg x 4 = 8 kg), 2 x 14 inch dumbbell rods with nuts.',
        highlights: [
            'In-box Contents: In-Box Contents: 20 kg of PVC weight (3 kg x 4 = 12 kg, 2 kg x 4 = 8 kg), 2 x 14 inch dumbbell rods with nuts',
            'Highly durable and long lasting.',
            "It's a combination of all gym equipments for the perfect weight home gym training and workout.The gym set is safe, highly stable, durable and long.",
            'This is suitable for all types of customers - beginner level to advanced workout enthusiasts and can be used by men & women alike.The entire set of.',
        ],
        specs: {
            Colour: 'Red-Black',
            'Item Weight': '20500 Grams',
            'Number of Pieces': '2',
            Material: 'Polyvinyl Chloride (PVC)',
            'Special Feature': 'Durable Finish, Secure Weight-Locking Mechanism',
            'Set Name': 'Amazon Brand - Symactive 20 Kg PVC Adjustable Dumbbells Fitness Kit',
            'Number of Packs': '2',
        },
        images: [
            'https://m.media-amazon.com/images/I/61NEUWb5A4L._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71eNbu+ZCQL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61d5ijwNEBL._SL900_.jpg',
        ],
        rating: 3.9,
        ratingCount: 1794,
        variants: [
            {
                sku: 'SYM20KDUMSET-STD',
                label: 'Red-Black',
                attrs: { colour: 'Red-Black' },
                priceMinorUnits: 92900,
                mrpMinorUnits: 139900,
                stock: 86,
            },
        ],
    },
    {
        slug: 'milton-thermosteel-1l-flask',
        category: 'lifestyle',
        seller: 'flexfit',
        title: 'Milton Thermosteel Flip Lid 1 L Flask',
        brand: 'MILTON',
        description:
            'Milton Thermosteel Flip Lid 1 L Flask from MILTON — finished in silver - flip lid, 1000 Milliliters. #1 WATER BOTTLES BRAND : Join the club, choose the premium brand and elevate your style with Milton.',
        highlights: [
            '#1 WATER BOTTLES BRAND : Join the club, choose the premium brand and elevate your style with Milton.',
            '50 YEARS OF INDIAN INNOVATION : Milton Water Bottle 1 litre has Double walled Vacuum Insulated technology that keeps beverages Hot or Cold for 24.',
            'PREMIUM SS304 STAINLESS STEEL: Inner Outer high-quality SS304 stainless steel with copper coating for better temperature retention.',
            "MOMENTS : Our steel water bottle 1 ltr has leak proof design that keeps your bag dry, whether you're on the move.",
        ],
        specs: {
            Colour: 'Silver - Flip Lid',
            Capacity: '1000 Milliliters',
            Pattern: 'Bottle',
            'Item Weight': '530 Grams',
            'Product Care Instructions': 'Hand Wash Only',
            'Special Feature': 'airtight',
            'Age Range Description': 'Adult',
        },
        images: [
            'https://m.media-amazon.com/images/I/71SiLRp050L._SL900_.jpg',
            'https://m.media-amazon.com/images/I/711b5eCKrWL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/81cPo7O9DKL._SL900_.jpg',
        ],
        rating: 4.2,
        ratingCount: 152420,
        variants: [
            {
                sku: 'MILTHE1LFLA-STD',
                label: 'Silver - Flip Lid · 1000 Milliliters',
                attrs: { colour: 'Silver - Flip Lid', capacity: '1000 Milliliters' },
                priceMinorUnits: 97000,
                mrpMinorUnits: 107900,
                stock: 64,
            },
        ],
    },
    {
        slug: 'puma-convertible-gym-bag-v4',
        category: 'lifestyle',
        seller: 'flexfit',
        title: 'PUMA Convertible Gym Bag V4',
        brand: 'PUMA',
        description:
            'PUMA Convertible Gym Bag V4 from PUMA — finished in black, 10 Liters, size M.',
        highlights: ['Zipper closure', '10 Liters capacity', 'Size M', 'Weighs 200 Grams'],
        specs: {
            Colour: 'Black',
            Capacity: '10 Liters',
            Size: 'M',
            Style: 'Western',
            'Item Weight': '200 Grams',
            'Closure Type': 'Zipper',
            'Model Name': 'PUMA CONVERTIBLE Gym Bag V4',
        },
        images: [
            'https://m.media-amazon.com/images/I/515XY-iNDhL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61THYeELMlL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/51KJQO5tvxL._SL900_.jpg',
        ],
        rating: 4.2,
        ratingCount: 47,
        variants: [
            {
                sku: 'PUMCONGYMBAG-STD',
                label: 'Black · 10 Liters',
                attrs: { colour: 'Black', capacity: '10 Liters' },
                priceMinorUnits: 291900,
                mrpMinorUnits: 449900,
                stock: 34,
            },
        ],
    },
    {
        slug: 'burnlab-6-in-1-training-kit',
        category: 'lifestyle',
        seller: 'flexfit',
        title: 'Burnlab 6-in-1 Weight Training Kit',
        brand: 'BURNLAB',
        description:
            'Burnlab 6-in-1 Weight Training Kit from BURNLAB — finished in black. Long-lasting: The new and adjustable weight design from burnlab allows you to increase the weight over time without having to buy new weights.',
        highlights: [
            'Long-lasting: The new and adjustable weight design from burnlab allows you to increase the weight over time without having to buy new weights.',
            'New safety measures: Diamond knurled grip allows for a secure and non-slip grip, thickened nuts ensure that no weights fall and the anti-slip design.',
            '20MM foam barbell: Thickened foam in the barbell rod fits more comfortably on the neck and also helps in preventing any injuries.',
            'Burnlab weights allow you to enjoy the benefits of a fully equipped gym without having to go to the gym! Rewrite the rules of fitness with Burnlab.',
        ],
        specs: {
            Colour: 'Black',
            'Item Weight': '12 Kilograms',
            'Number of Pieces': '1',
            Material: 'PE+Iron Sand',
            'Special Feature': 'Adjustable Weight',
            'Set Name': 'Burnlab Dumbbell, Kettlebell And Barbell Bar Convertible Kit',
            'Model Number': 'BRNFBA0000W',
        },
        images: [
            'https://m.media-amazon.com/images/I/618Nlj8pN3L._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61Ni3zFYTDL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61f4Yrz-fDL._SL900_.jpg',
        ],
        rating: 4.2,
        ratingCount: 543,
        variants: [
            {
                sku: 'BUR6IN1TRAKI-STD',
                label: 'Black',
                attrs: { colour: 'Black' },
                priceMinorUnits: 419900,
                mrpMinorUnits: 900000,
                stock: 32,
            },
        ],
    },
    {
        slug: 'aristocrat-power-gym-duffle',
        category: 'lifestyle',
        seller: 'flexfit',
        title: 'Aristocrat Power 52 cm Gym Duffle',
        brand: 'Aristrocrat',
        description:
            'Aristocrat Power 52 cm Gym Duffle from Aristrocrat — finished in black, size 28 X 27.5 X 52 CM.',
        highlights: ['Zipper closure', 'Size 28 X 27.5 X 52 CM', 'Weighs 760 Grams'],
        specs: {
            Colour: 'Black',
            Size: '28 X 27.5 X 52 CM',
            'Item Weight': '760 Grams',
            'Closure Type': 'Zipper',
            'Model Name': 'POWER DF 50 BLACK',
            'Number of Packs': '1',
            'Model Number': 'DFPOW50BLK',
        },
        images: [
            'https://m.media-amazon.com/images/I/61n4uCw3ZZL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61AKVXYQpgL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61BsMr+NFeL._SL900_.jpg',
        ],
        rating: 4.4,
        ratingCount: 521,
        variants: [
            {
                sku: 'ARIPOWGYMDUF-STD',
                label: 'Black',
                attrs: { colour: 'Black' },
                priceMinorUnits: 72800,
                mrpMinorUnits: 250000,
                stock: 43,
            },
        ],
    },
    {
        slug: 'minimalist-16-vitamin-c-serum',
        category: 'cosmetics',
        seller: 'glow-atelier',
        title: 'Minimalist 16% Vitamin C Face Serum',
        brand: 'Minimalist',
        description:
            'Minimalist 16% Vitamin C Face Serum from Minimalist — 20 Millilitres bottle. 1️⃣ High-Potency 16% Vitamin C Serum Featuring a stable Vitamin C derivative (Ethyl Ascorbic Acid) formulated for maximum brightness and radiance without losing potency.',
        highlights: [
            '1️⃣ High-Potency 16% Vitamin C Serum Featuring a stable Vitamin C derivative (Ethyl Ascorbic Acid) formulated for maximum brightness and radiance.',
            '2️⃣ Enhanced with Vitamin E & Ferulic Acid Antioxidant superblend boosts protection from environmental stress and enhances skin glow.',
            '3️⃣ Fullerenes for Advanced Radiance & Protection Next-gen antioxidant (C-60) helps strengthen defenses, fight oxidative stress and support even skin.',
            '4️⃣ Lightweight & Fast-Absorbing Daily Serum Non-sticky, easily absorbed formula suited for all skin types, including sensitive skin.',
        ],
        specs: {
            'Item Volume': '20 Millilitres',
            'Item Weight': '20 Milligrams',
            'Skin Type': 'All',
            'Item Form': 'Drop',
            'Use for': 'Face',
            'Special Ingredients': 'Vitamin C, Vitamin E',
            Scent: 'Fragrance Free',
        },
        images: [
            'https://m.media-amazon.com/images/I/71gZ4LezPnL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/615iGIuhiJL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61nHa2DwuSL._SL900_.jpg',
        ],
        rating: 4.1,
        ratingCount: 9072,
        variants: [
            {
                sku: 'MIN16VITCSER-STD',
                label: '20 Millilitres',
                attrs: { capacity: '20 Millilitres' },
                priceMinorUnits: 56800,
                mrpMinorUnits: 59900,
                stock: 31,
            },
        ],
    },
    {
        slug: 'derma-co-15-vitamin-c-serum',
        category: 'cosmetics',
        seller: 'glow-atelier',
        title: 'The Derma Co 15% Vitamin C Face Serum',
        brand: 'The Derma Co',
        description:
            'The Derma Co 15% Vitamin C Face Serum from The Derma Co. WHO IS IT SUITABLE FOR? Dark spots, pigmentation and dull skin? This serum is for you!',
        highlights: [
            'Brightens Skin & Enhances Glow Safe and effective, the 15% Vitamin C Serum brightens your complexion by fading dark spots and boosting radiance. With.',
            'WHO IS IT SUITABLE FOR? Dark spots, pigmentation and dull skin? This serum is for you!',
            'Who Is It Suitable For? Suitable for all skin types, this face serum is for anyone looking to treat acne and acne marks.',
        ],
        specs: {
            'Item Weight': '30 g',
            'Item Dimensions LxWxH': '50 x 50 x 108 Millimeters',
            'Net Quantity': '30.0 Milliliters',
            'Generic Name': 'Face Serum',
        },
        images: [
            'https://m.media-amazon.com/images/I/61mH33YfOsL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/51u19PpCR8L._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61swDbZeweL._SL900_.jpg',
        ],
        rating: 4.1,
        ratingCount: 730,
        variants: [
            {
                sku: 'DERCO15VITCS-STD',
                label: 'Standard',
                attrs: {},
                priceMinorUnits: 59900,
                mrpMinorUnits: 199600,
                stock: 14,
            },
        ],
    },
    {
        slug: 'minimalist-sunscreen-spf50',
        category: 'cosmetics',
        seller: 'glow-atelier',
        title: 'Minimalist Sunscreen SPF 50 PA++++',
        brand: 'Minimalist',
        description:
            'Minimalist Sunscreen SPF 50 PA++++ from Minimalist — finished in white, 50 Millilitres bottle. 1️⃣ Broad Spectrum SPF 50 Protection Formulated with 4 highly effective UV filters — Uvinul T150, Avobenzone, Octocrylene & Titanium Dioxide — to protect skin from harmful UVA & UVB rays.',
        highlights: [
            '1️⃣ Broad Spectrum SPF 50 Protection Formulated with 4 highly effective UV filters — Uvinul T150, Avobenzone, Octocrylene & Titanium Dioxide — to.',
            '2️⃣ Boosted with Skin-Repairing Multi-Vitamins Enriched with Vitamins A, B3, B5, E & F to help repair post-sun damage, soothe irritation, nourish.',
            '3️⃣ Clinically Tested & Verified SPF 50 Thoroughly tested by an independent lab to confirm SPF 50 protection, ensuring reliable daily sun defense.',
            '4️⃣ No White Cast, No Heavy Residue Blends seamlessly into all skin tones without leaving a white cast, pilling, or greasy finish.',
        ],
        specs: {
            Colour: 'White',
            'Item Volume': '50 Millilitres',
            'Item Weight': '50 Grams',
            'Skin Type': 'All',
            'Item Form': 'Cream',
            'Water Resistance Level': 'Not Water Resistant',
            Scent: 'Unscented',
        },
        images: [
            'https://m.media-amazon.com/images/I/51liYV8g2DL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/51CITICCosL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/51RCVlmBBDL._SL900_.jpg',
        ],
        rating: 4.1,
        ratingCount: 35413,
        variants: [
            {
                sku: 'MINSUNSPF-STD',
                label: 'White · 50 Millilitres',
                attrs: { colour: 'White', capacity: '50 Millilitres' },
                priceMinorUnits: 37800,
                mrpMinorUnits: 75600,
                stock: 50,
            },
        ],
    },
    {
        slug: 'dot-and-key-vitamin-c-sunscreen',
        category: 'cosmetics',
        seller: 'glow-atelier',
        title: 'Dot & Key Vitamin C + E Sunscreen SPF 50+',
        brand: 'DOT & KEY',
        description:
            'Dot & Key Vitamin C + E Sunscreen SPF 50+ from DOT & KEY — finished in white, 50 Millilitres bottle. 2-IN-1 PROTECTS SKIN + BOOSTS GLOW - Packed with SPF 50 PA+++, for even-toned & glowing which protects skin every day. This sunscreen SPF 50 Prevents tanning & gives skin glow.',
        highlights: [
            '2-IN-1 PROTECTS SKIN + BOOSTS GLOW - Packed with SPF 50 PA+++, for even-toned & glowing which protects skin every day. This sunscreen SPF 50 Prevents.',
            'DOT & KEY Vitamin C + E Super Bright Sun Screen SPF 50 , activates Vitamin D Receptors on skin, making it beneficial to be in the sun.',
            'SPF 50 Sun Screen ENHANCES SKIN GLOW & RADIANCE - Infused with Triple Vitamin C & Sicilian Blood Orange to fight dullness & pigmentation while.',
            'INDOOR & OUTDOOR PROTECTION - FIGHTS FREE RADICAL DAMAGE TO PREVENT EARLY AGE SIGNS - Powered by UV filters to protect skin against damaging UVA, UVB.',
        ],
        specs: {
            Colour: 'White',
            'Item Volume': '50 Millilitres',
            'Item Weight': '50 Grams',
            'Skin Type': 'All',
            'Item Form': 'Cream',
            'Water Resistance Level': 'Water Resistant',
            Scent: 'Unscented',
        },
        images: [
            'https://m.media-amazon.com/images/I/61ckTgN44WL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71I-DC+1YKL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/71FKo5f8FCL._SL900_.jpg',
        ],
        rating: 4.2,
        ratingCount: 14712,
        variants: [
            {
                sku: 'DOTANDKEYVIT-STD',
                label: 'White · 50 Millilitres',
                attrs: { colour: 'White', capacity: '50 Millilitres' },
                priceMinorUnits: 38600,
                mrpMinorUnits: 77200,
                stock: 42,
            },
        ],
    },
    {
        slug: 'plum-15-vitamin-c-serum',
        category: 'cosmetics',
        seller: 'glow-atelier',
        title: 'Plum 15% Vitamin C Serum',
        brand: 'Plum',
        description: 'Plum 15% Vitamin C Serum from Plum — 30 Microlitres bottle.',
        highlights: [
            '30 Microlitres pack size',
            'Suited to acne prone, all, combination, dry, oily, sensitive skin',
            'Key actives: Collagen, Japanese Mandarin, Kakadu Plum, Vitamin C',
            'Drop format',
        ],
        specs: {
            'Item Volume': '30 Microlitres',
            'Item Weight': '30 Grams',
            'Skin Type': 'Acne Prone, All, Combination, Dry, Oily, Sensitive',
            'Item Form': 'Drop',
            'Use for': 'Face',
            'Special Ingredients': 'Collagen, Japanese Mandarin, Kakadu Plum, Vitamin C',
            Scent: 'Fragrance Free, Unscented',
        },
        images: [
            'https://m.media-amazon.com/images/I/51Oae1kPWGL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/51cr0OB+k2L._SL900_.jpg',
            'https://m.media-amazon.com/images/I/51y7a3Q0LqL._SL900_.jpg',
        ],
        rating: 4,
        ratingCount: 14958,
        variants: [
            {
                sku: 'PLU15VITCSER-STD',
                label: '30 Microlitres',
                attrs: { capacity: '30 Microlitres' },
                priceMinorUnits: 71100,
                mrpMinorUnits: 79000,
                stock: 58,
            },
        ],
    },
    {
        slug: 'blue-heaven-matte-love-minis',
        category: 'cosmetics',
        seller: 'glow-atelier',
        title: 'Blue Heaven Matte Love Mini Lipsticks (Pack of 10)',
        brand: 'Blue Heaven',
        description:
            'Blue Heaven Matte Love Mini Lipsticks (Pack of 10) from Blue Heaven — finished in multicolor.',
        highlights: ['Stick format', 'Matte finish', 'Weighs 13 Grams'],
        specs: {
            Colour: 'Multicolor',
            'Item Weight': '13 Grams',
            'Item Form': 'Stick',
            'Finish Type': 'Matte',
            Speciality: 'Long Lasting',
            'Age Range (Description)': 'Adult',
            'Skin Tone': 'All',
        },
        images: [
            'https://m.media-amazon.com/images/I/61vc8xowYUL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61gI5jX6RyL._SL900_.jpg',
            'https://m.media-amazon.com/images/I/61Yc3QMcYuL._SL900_.jpg',
        ],
        rating: 4.1,
        ratingCount: 3444,
        variants: [
            {
                sku: 'BLUHEAMATLOV-STD',
                label: 'Multicolor',
                attrs: { colour: 'Multicolor' },
                priceMinorUnits: 22000,
                mrpMinorUnits: 39900,
                stock: 52,
            },
        ],
    },
    {
        slug: 'zaveri-pearls-kundan-necklace-set',
        category: 'jewellery',
        seller: 'mint-market',
        title: 'Zaveri Pearls Kundan Necklace & Earrings Set',
        brand: 'Zaveri Pearls',
        description:
            'A gold-tone kundan necklace with matching drop earrings, designed as a complete festive gift set.',
        highlights: [
            'Complete necklace and matching earrings gift set',
            'Gold-tone kundan-style stones',
            'Adjustable chain with secure clasp',
            'Presented in a reusable jewellery box',
        ],
        specs: {
            Material: 'Alloy',
            Finish: 'Gold tone',
            Occasion: 'Festive, Wedding, Gifting',
            'Set contents': '1 Necklace, 2 Earrings',
        },
        images: [
            'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=900&q=80',
        ],
        rating: 4.4,
        ratingCount: 2841,
        variants: [
            {
                sku: 'ZAV-KUNDAN-SET-GOLD',
                label: 'Gold tone',
                attrs: { colour: 'Gold', style: 'Kundan' },
                priceMinorUnits: 149900,
                mrpMinorUnits: 299900,
                stock: 34,
            },
        ],
    },
    {
        slug: 'giva-silver-zircon-heart-pendant',
        category: 'jewellery',
        seller: 'mint-market',
        title: 'GIVA Silver Zircon Heart Pendant',
        brand: 'GIVA',
        description:
            'A sterling-silver heart pendant with a fine chain and zircon detail, sized for everyday wear and gifting.',
        highlights: [
            '925 sterling silver',
            'Minimal heart pendant with zircon detail',
            'Includes an adjustable fine chain',
            'Gift-ready box included',
        ],
        specs: {
            Material: '925 Sterling Silver',
            Stone: 'Cubic Zirconia',
            'Chain length': '45 cm adjustable',
            Occasion: 'Everyday, Anniversary, Gifting',
        },
        images: [
            'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=900&q=80',
        ],
        rating: 4.6,
        ratingCount: 5176,
        variants: [
            {
                sku: 'GIVA-HEART-PENDANT-SILVER',
                label: 'Silver',
                attrs: { colour: 'Silver', material: '925 Sterling Silver' },
                priceMinorUnits: 199900,
                mrpMinorUnits: 349900,
                stock: 27,
            },
        ],
    },
    {
        slug: 'shining-diva-rose-gold-bracelet',
        category: 'jewellery',
        seller: 'mint-market',
        title: 'Shining Diva Rose Gold Crystal Bracelet',
        brand: 'Shining Diva',
        description:
            'A slim rose-gold-tone bracelet with crystal accents and an adjustable clasp for an easy gift fit.',
        highlights: [
            'Adjustable clasp fits most wrists',
            'Rose-gold-tone finish',
            'Lightweight crystal-accent design',
            'Gift pouch included',
        ],
        specs: {
            Material: 'Alloy',
            Finish: 'Rose gold tone',
            Closure: 'Adjustable lobster clasp',
            Occasion: 'Everyday, Birthday, Gifting',
        },
        images: [
            'https://images.unsplash.com/photo-1611591437281-460bfbe1220a?auto=format&fit=crop&w=900&q=80',
        ],
        rating: 4.3,
        ratingCount: 1964,
        variants: [
            {
                sku: 'SHD-CRYSTAL-BRACELET-ROSE',
                label: 'Rose gold',
                attrs: { colour: 'Rose Gold', style: 'Crystal' },
                priceMinorUnits: 89900,
                mrpMinorUnits: 179900,
                stock: 41,
            },
        ],
    },
];
const PINCODES: {
    pincode: string;
    city: string;
    state: string;
    serviceable: boolean;
    codAvailable: boolean;
    etaDays: number;
}[] = [
    {
        pincode: '560001',
        city: 'Bengaluru',
        state: 'Karnataka',
        serviceable: true,
        codAvailable: true,
        etaDays: 2,
    },
    {
        pincode: '560103',
        city: 'Bengaluru',
        state: 'Karnataka',
        serviceable: true,
        codAvailable: true,
        etaDays: 2,
    },
    {
        pincode: '400001',
        city: 'Mumbai',
        state: 'Maharashtra',
        serviceable: true,
        codAvailable: true,
        etaDays: 2,
    },
    {
        pincode: '400050',
        city: 'Mumbai',
        state: 'Maharashtra',
        serviceable: true,
        codAvailable: true,
        etaDays: 3,
    },
    {
        pincode: '110001',
        city: 'New Delhi',
        state: 'Delhi',
        serviceable: true,
        codAvailable: true,
        etaDays: 2,
    },
    {
        pincode: '110070',
        city: 'New Delhi',
        state: 'Delhi',
        serviceable: true,
        codAvailable: true,
        etaDays: 3,
    },
    {
        pincode: '500081',
        city: 'Hyderabad',
        state: 'Telangana',
        serviceable: true,
        codAvailable: true,
        etaDays: 3,
    },
    {
        pincode: '600001',
        city: 'Chennai',
        state: 'Tamil Nadu',
        serviceable: true,
        codAvailable: true,
        etaDays: 3,
    },
    {
        pincode: '700001',
        city: 'Kolkata',
        state: 'West Bengal',
        serviceable: true,
        codAvailable: true,
        etaDays: 4,
    },
    {
        pincode: '411001',
        city: 'Pune',
        state: 'Maharashtra',
        serviceable: true,
        codAvailable: true,
        etaDays: 3,
    },
    {
        pincode: '302001',
        city: 'Jaipur',
        state: 'Rajasthan',
        serviceable: true,
        codAvailable: true,
        etaDays: 4,
    },
    {
        pincode: '380001',
        city: 'Ahmedabad',
        state: 'Gujarat',
        serviceable: true,
        codAvailable: true,
        etaDays: 3,
    },
    {
        pincode: '682001',
        city: 'Kochi',
        state: 'Kerala',
        serviceable: true,
        codAvailable: false,
        etaDays: 5,
    },
    {
        pincode: '190001',
        city: 'Srinagar',
        state: 'Jammu & Kashmir',
        serviceable: true,
        codAvailable: false,
        etaDays: 7,
    },
    {
        pincode: '744101',
        city: 'Port Blair',
        state: 'Andaman & Nicobar Islands',
        serviceable: false,
        codAvailable: false,
        etaDays: 0,
    },
];
const PROMOTIONS = [
    {
        code: 'LIVE20',
        label: '20% live-session offer',
        description: 'Applies only while the relevant live session is running. Cannot be combined.',
        kind: 'percent' as const,
        value: 20,
        priority: 100,
        stackable: false,
        conditions: { requiresLiveSession: true },
    },
    {
        code: 'WELCOME10',
        label: '10% first order',
        description: 'For shoppers who have not placed a paid order yet.',
        kind: 'percent' as const,
        value: 10,
        priority: 50,
        stackable: false,
        conditions: { userSegments: ['first_order'] },
    },
    {
        code: 'WISHLIST5',
        label: '5% wishlist bonus',
        description: 'Stackable bonus on products the shopper has wishlisted.',
        kind: 'percent' as const,
        value: 5,
        priority: 20,
        stackable: true,
        conditions: { userSegments: ['has_wishlisted'] },
    },
    {
        code: 'BEAUTY15',
        label: '15% beauty edit',
        description: 'Beauty lines of Rs 500 and above.',
        kind: 'percent' as const,
        value: 15,
        priority: 60,
        stackable: false,
        conditions: { categorySlugs: ['cosmetics'], minLineMinorUnits: 50000 },
    },
    {
        code: 'AUDIO300',
        label: 'Rs 300 off audio',
        description: 'Flat Rs 300 off headphones and earbuds of Rs 2,000 and above.',
        kind: 'flat' as const,
        value: 30000,
        priority: 40,
        stackable: false,
        conditions: { sellerSlugs: ['pulse-audio'], minLineMinorUnits: 200000 },
    },
];
const clearRedisKeys = async (): Promise<number> => {
    const prefixes = [
        'sess:',
        'session:',
        'poll:',
        'idem:',
        'cat:v1',
        'prod:v1',
        'prodq:v1',
        'promo:v1',
        'policy:v1',
        'rec:v1',
    ];
    let removed = 0;
    for (const prefix of prefixes) {
        let cursor = '0';
        do {
            const [next, batch] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
            cursor = next;
            if (batch.length > 0) removed += await redis.del(...batch);
        } while (cursor !== '0');
    }
    removed += await redis.del(keys.aiAgents, keys.analyticsStream, keys.summaryStream);
    return removed;
};
const seed = async (): Promise<void> => {
    console.log('seed: truncating every table and clearing the app Redis keyspace');
    await db.execute(sql`
    TRUNCATE TABLE
      analytics_events, ai_tool_calls, ai_messages, ai_conversations,
      poll_votes, poll_options, polls, chat_moderation, chat_messages,
      session_transcripts, live_session_products, live_sessions,
      product_views, wishlist_items, promotion_redemptions,
      order_items, orders, cart_items, carts,
      checkout_policies, promotions, pincodes,
      product_variants, products, sellers, categories, users
    RESTART IDENTITY CASCADE
  `);
    const clearedKeys = await clearRedisKeys();
    const passwordHash = bcrypt.hashSync(PASSWORD, 10);
    const userRows = await db
        .insert(t.users)
        .values([
            {
                email: 'shopper@demo.test',
                passwordHash,
                displayName: 'Aarav Shopper',
                role: 'shopper',
                defaultPincode: '560001',
                preferredLanguage: 'en-US',
            },
            {
                email: 'admin@demo.test',
                passwordHash,
                displayName: 'Platform Admin',
                role: 'admin',
                defaultPincode: '110001',
                preferredLanguage: 'en-US',
            },
            {
                email: 'loyal@demo.test',
                passwordHash,
                displayName: 'Meera Loyal',
                role: 'shopper',
                defaultPincode: '400001',
                preferredLanguage: 'hi-IN',
            },
            {
                email: 'support@demo.test',
                passwordHash,
                displayName: 'Support Agent',
                role: 'support',
                defaultPincode: '560001',
                preferredLanguage: 'en-US',
            },
            {
                email: 'seller2@demo.test',
                passwordHash,
                displayName: 'Priya Sharma',
                role: 'seller',
                defaultPincode: '560103',
                preferredLanguage: 'en-US',
            },
            ...SELLERS.map((s) => ({
                email: s.ownerEmail,
                passwordHash,
                displayName: s.ownerName,
                role: 'seller' as const,
                defaultPincode: '560103',
                preferredLanguage: 'en-US',
            })),
        ])
        .returning({ id: t.users.id, email: t.users.email });
    const userId = (email: string): string => {
        const row = userRows.find((u) => u.email === email);
        if (!row) throw new Error(`seed: user ${email} missing`);
        return row.id;
    };
    const shopperId = userId('shopper@demo.test');
    const adminId = userId('admin@demo.test');
    const loyalId = userId('loyal@demo.test');
    console.log('seed: loading online marketplace catalogs');
    const marketplaceProducts = await loadMarketplaceCatalog(MARKETPLACE_SELLERS);
    const catalogProducts: SeedProduct[] = [...PRODUCTS, ...marketplaceProducts];
    const catalogImageUrls = catalogProducts.flatMap((product) => product.images);
    if (
        catalogProducts.some((product) => product.images.length === 0) ||
        new Set(catalogImageUrls).size !== catalogImageUrls.length
    ) {
        throw new Error('seed: every catalog product image URL must be present and unique');
    }
    console.log(
        `seed: ${PRODUCTS.length} curated products + ${marketplaceProducts.length} online marketplace listings`,
    );
    const categoryRows = await db
        .insert(t.categories)
        .values(
            CATEGORIES.map((c) => ({
                slug: c.slug,
                name: c.name,
                imageUrl: c.imageUrl,
            })),
        )
        .returning({ id: t.categories.id, slug: t.categories.slug });
    const categoryId = (slug: string): string => {
        const row = categoryRows.find((c) => c.slug === slug);
        if (!row) throw new Error(`seed: category ${slug} missing`);
        return row.id;
    };
    const sellerRows = await db
        .insert(t.sellers)
        .values([
            ...SELLERS.map((s) => ({
                slug: s.slug,
                displayName: s.displayName,
                logoUrl: s.logoUrl,
                ownerUserId: userId(s.ownerEmail),
                rating: s.rating,
            })),
            ...MARKETPLACE_SELLERS.map((s) => ({
                slug: s.slug,
                displayName: s.displayName,
                logoUrl: s.logoUrl,
                rating: s.rating,
            })),
        ])
        .returning({ id: t.sellers.id, slug: t.sellers.slug });
    const sellerId = (slug: string): string => {
        const row = sellerRows.find((s) => s.slug === slug);
        if (!row) throw new Error(`seed: seller ${slug} missing`);
        return row.id;
    };
    const productRows = await db
        .insert(t.products)
        .values(
            catalogProducts.map((p) => ({
                slug: p.slug,
                categoryId: categoryId(p.category),
                sellerId: sellerId(p.seller),
                title: p.title,
                brand: p.brand,
                description: p.description,
                highlights: p.highlights,
                specs: p.specs,
                images: p.images,
                rating: p.rating,
                ratingCount: p.ratingCount,
                basePriceMinorUnits: p.variants[0]!.priceMinorUnits,
            })),
        )
        .returning({ id: t.products.id, slug: t.products.slug });
    const productId = (slug: string): string => {
        const row = productRows.find((p) => p.slug === slug);
        if (!row) throw new Error(`seed: product ${slug} missing`);
        return row.id;
    };
    const variantRows = await db
        .insert(t.productVariants)
        .values(
            catalogProducts.flatMap((p) =>
                p.variants.map((v, index) => ({
                    productId: productId(p.slug),
                    sku: v.sku,
                    label: v.label,
                    attrs: v.attrs,
                    priceMinorUnits: v.priceMinorUnits,
                    mrpMinorUnits: v.mrpMinorUnits,
                    stock: v.stock,
                    isDefault: index === 0,
                })),
            ),
        )
        .returning({ id: t.productVariants.id, sku: t.productVariants.sku });
    const variantId = (sku: string): string => {
        const row = variantRows.find((v) => v.sku === sku);
        if (!row) throw new Error(`seed: variant ${sku} missing`);
        return row.id;
    };
    await db.insert(t.pincodes).values(PINCODES);
    const promotionRows = await db
        .insert(t.promotions)
        .values(
            PROMOTIONS.map((p) => ({
                code: p.code,
                label: p.label,
                description: p.description,
                kind: p.kind,
                value: p.value,
                priority: p.priority,
                stackable: p.stackable,
                conditions: {
                    ...Object.fromEntries(
                        Object.entries(p.conditions).filter(([k]) => k !== 'sellerSlugs'),
                    ),
                    ...('sellerSlugs' in p.conditions
                        ? {
                              sellerIds: (p.conditions.sellerSlugs as string[]).map(sellerId),
                          }
                        : {}),
                } as Record<string, unknown>,
                active: true,
            })),
        )
        .returning({ id: t.promotions.id, code: t.promotions.code });
    const promotionId = (code: string): string => {
        const row = promotionRows.find((p) => p.code === code);
        if (!row) throw new Error(`seed: promotion ${code} missing`);
        return row.id;
    };
    await db.insert(t.checkoutPolicies).values({
        name: 'default',
        minOrderMinorUnits: 9900,
        codMaxOrderMinorUnits: 500000,
        emiMinOrderMinorUnits: 300000,
        allowedMethods: ['card', 'upi', 'netbanking', 'cod', 'emi'],
        blockedPincodes: [],
        requireServiceablePincode: true,
        active: true,
    });
    const featuredReadyProduct = 'oneplus-bullets-wireless-z3';
    await db
        .insert(t.wishlistItems)
        .values([{ userId: shopperId, productId: productId(featuredReadyProduct) }]);
    await db.insert(t.productViews).values([
        {
            userId: shopperId,
            productId: productId('noise-airwave-max-5'),
            viewedAt: at(-3 * HOUR),
        },
        {
            userId: shopperId,
            productId: productId('sony-wh-ch520'),
            viewedAt: at(-2 * HOUR),
        },
        {
            userId: shopperId,
            productId: productId(featuredReadyProduct),
            viewedAt: at(-90 * MINUTE),
        },
        {
            userId: loyalId,
            productId: productId('samsung-galaxy-a56-5g'),
            viewedAt: at(-1 * DAY),
        },
        {
            userId: loyalId,
            productId: productId('puma-graphics-training-tee'),
            viewedAt: at(-1 * DAY + 20 * MINUTE),
        },
        {
            userId: loyalId,
            productId: productId('minimalist-16-vitamin-c-serum'),
            viewedAt: at(-6 * HOUR),
        },
    ]);
    const sessionSeeds: {
        slug: string;
        sellerSlug: string;
        title: string;
        description: string;
        status: 'scheduled' | 'live' | 'ended';
        scheduledFor: Date;
        startedAt: Date | null;
        endedAt: Date | null;
        coverImageUrl: string | null;
        expectedPeakViewers: number;
        chatShardCount: number;
        peakViewers: number;
        recordingStatus: 'none' | 'ready';
        recordingUrl: string | null;
        transcriptSummary: string | null;
        products: string[];
        featured: string | null;
        discountPercent: number | null;
    }[] = [];
    const sessionRows =
        sessionSeeds.length === 0
            ? []
            : await db
                  .insert(t.liveSessions)
                  .values(
                      sessionSeeds.map((s) => {
                          const seller = SELLERS.find((x) => x.slug === s.sellerSlug)!;
                          return {
                              slug: s.slug,
                              sellerId: sellerId(s.sellerSlug),
                              title: s.title,
                              description: s.description,
                              hostName: seller.ownerName,
                              hostUserId: userId(seller.ownerEmail),
                              status: s.status,
                              scheduledFor: s.scheduledFor,
                              startedAt: s.startedAt,
                              endedAt: s.endedAt,
                              rtcChannel: `live-${s.slug}`,
                              coverImageUrl: s.coverImageUrl,
                              language: 'en-US',
                              expectedPeakViewers: s.expectedPeakViewers,
                              chatShardCount: s.chatShardCount,
                              discountPercent: s.discountPercent,
                              deliveryTier: 'rtc' as const,
                              recordingConsentAt: s.startedAt,
                              recordingProvider: s.status === 'ended' ? 'browser' : null,
                              recordingStatus: s.recordingStatus,
                              recordingUrl: s.recordingUrl,
                              hlsUrl: null,
                              hlsOriginKind: null,
                              transcriptSummary: s.transcriptSummary,
                              peakViewers: s.peakViewers,
                          };
                      }),
                  )
                  .returning({ id: t.liveSessions.id, slug: t.liveSessions.slug });
    const sessionId = (slug: string): string => {
        const row = sessionRows.find((s) => s.slug === slug);
        if (!row) throw new Error(`seed: session ${slug} missing`);
        return row.id;
    };
    if (sessionSeeds.length > 0) {
        await db.insert(t.liveSessionProducts).values(
            sessionSeeds.flatMap((s) =>
                s.products.map((slug, index) => ({
                    sessionId: sessionId(s.slug),
                    productId: productId(slug),
                    sortOrder: index,
                    isFeatured: s.featured === slug,
                    pinnedAt:
                        s.featured === slug && s.startedAt
                            ? new Date(s.startedAt.getTime() + 4 * MINUTE)
                            : null,
                })),
            ),
        );
        for (const s of sessionSeeds) {
            await redis.set(keys.sessionStatus(sessionId(s.slug)), s.status);
        }
    }
    const orderRows = await db
        .insert(t.orders)
        .values([
            {
                userId: loyalId,
                status: 'paid' as const,
                subtotalMinorUnits: 261900,
                discountMinorUnits: 0,
                totalMinorUnits: 261900,
                appliedPromotions: [],
                paymentMethod: 'upi',
                paymentRef: 'mock_pre_auth_seed_1',
                pincode: '400001',
                idempotencyKey: 'seed-loyal-order-1',
                createdAt: at(-40 * DAY),
                fulfilmentStatus: 'delivered',
                trackingNumber: 'AWB7829103456',
                carrier: 'BlueDart',
                estimatedDeliveryAt: at(-35 * DAY),
            },
            {
                userId: loyalId,
                status: 'paid' as const,
                subtotalMinorUnits: 151400,
                discountMinorUnits: 0,
                totalMinorUnits: 151400,
                appliedPromotions: [],
                paymentMethod: 'card',
                paymentRef: 'mock_pre_auth_seed_2',
                pincode: '400001',
                idempotencyKey: 'seed-loyal-order-2',
                createdAt: at(-20 * DAY),
                fulfilmentStatus: 'out_for_delivery',
                trackingNumber: 'AWB8829109876',
                carrier: 'Delhivery',
                estimatedDeliveryAt: at(2 * DAY),
            },
            {
                userId: loyalId,
                status: 'paid' as const,
                subtotalMinorUnits: 779800,
                discountMinorUnits: 99980,
                totalMinorUnits: 679820,
                appliedPromotions: [
                    {
                        code: 'LIVE20',
                        label: '20% live-session offer',
                        minorUnits: 99980,
                    },
                ],
                paymentMethod: 'cod',
                paymentRef: 'mock_pre_auth_seed_3',
                pincode: '400001',
                idempotencyKey: 'seed-loyal-order-3',
                createdAt: at(-3 * DAY),
                fulfilmentStatus: 'shipped',
                trackingNumber: 'AWB9928101234',
                carrier: 'Ekart',
                estimatedDeliveryAt: at(4 * DAY),
            },
        ])
        .returning({ id: t.orders.id, idempotencyKey: t.orders.idempotencyKey });
    const orderId = (key: string): string => {
        const row = orderRows.find((o) => o.idempotencyKey === key);
        if (!row) throw new Error(`seed: order ${key} missing`);
        return row.id;
    };
    await db.insert(t.orderItems).values([
        {
            orderId: orderId('seed-loyal-order-1'),
            productId: productId('adidas-vacfast-running-shoes'),
            variantId: variantId('ADIVACRUNSHO-UK9'),
            quantity: 1,
            unitPriceMinorUnits: 261900,
            lineDiscountMinorUnits: 0,
            appliedPromotionCodes: [],
            liveSessionId: null,
        },
        {
            orderId: orderId('seed-loyal-order-2'),
            productId: productId('minimalist-16-vitamin-c-serum'),
            variantId: variantId('MIN16VITCSER-STD'),
            quantity: 2,
            unitPriceMinorUnits: 56800,
            lineDiscountMinorUnits: 0,
            appliedPromotionCodes: [],
            liveSessionId: null,
        },
        {
            orderId: orderId('seed-loyal-order-2'),
            productId: productId('minimalist-sunscreen-spf50'),
            variantId: variantId('MINSUNSPF-STD'),
            quantity: 1,
            unitPriceMinorUnits: 37800,
            lineDiscountMinorUnits: 0,
            appliedPromotionCodes: [],
            liveSessionId: null,
        },
        {
            orderId: orderId('seed-loyal-order-3'),
            productId: productId('noise-airwave-max-5'),
            variantId: variantId('NOIAIRMAX5-STD'),
            quantity: 1,
            unitPriceMinorUnits: 499900,
            lineDiscountMinorUnits: 99980,
            appliedPromotionCodes: ['LIVE20'],
            liveSessionId: null,
        },
        {
            orderId: orderId('seed-loyal-order-3'),
            productId: productId('boat-rockerz-512-anc'),
            variantId: variantId('BOAROC512ANC-STD'),
            quantity: 1,
            unitPriceMinorUnits: 279900,
            lineDiscountMinorUnits: 0,
            appliedPromotionCodes: [],
            liveSessionId: null,
        },
    ]);
    await db.insert(t.promotionRedemptions).values([
        {
            promotionId: promotionId('LIVE20'),
            userId: loyalId,
            orderId: orderId('seed-loyal-order-3'),
            minorUnits: 99980,
            createdAt: at(-3 * DAY),
        },
    ]);
    const counts = await pool.query<{
        table: string;
        rows: number;
    }>(`
    select 'users' as table, count(*)::int as rows from users
    union all select 'categories', count(*)::int from categories
    union all select 'sellers', count(*)::int from sellers
    union all select 'products', count(*)::int from products
    union all select 'product_variants', count(*)::int from product_variants
    union all select 'pincodes', count(*)::int from pincodes
    union all select 'promotions', count(*)::int from promotions
    union all select 'promotion_redemptions', count(*)::int from promotion_redemptions
    union all select 'checkout_policies', count(*)::int from checkout_policies
    union all select 'wishlist_items', count(*)::int from wishlist_items
    union all select 'product_views', count(*)::int from product_views
    union all select 'orders', count(*)::int from orders
    union all select 'order_items', count(*)::int from order_items
    union all select 'live_sessions', count(*)::int from live_sessions
    union all select 'live_session_products', count(*)::int from live_session_products
    union all select 'session_transcripts', count(*)::int from session_transcripts
    union all select 'chat_messages', count(*)::int from chat_messages
    union all select 'chat_moderation', count(*)::int from chat_moderation
    union all select 'polls', count(*)::int from polls
    union all select 'poll_options', count(*)::int from poll_options
    union all select 'poll_votes', count(*)::int from poll_votes
    union all select 'analytics_events', count(*)::int from analytics_events
    order by 1
  `);
    console.log(`\nseed: complete (cleared ${clearedKeys} Redis keys)\n`);
    const width = Math.max(...counts.rows.map((r) => r.table.length));
    for (const row of counts.rows)
        console.log(`  ${row.table.padEnd(width)}  ${String(row.rows).padStart(5)}`);
    const replaySeeds = sessionSeeds.filter(
        (s) => s.status === 'ended' && s.recordingStatus === 'ready' && s.recordingUrl !== null,
    );
    console.log(
        [
            '',
            `  shopper logins  shopper@demo.test / loyal@demo.test / admin@demo.test`,
            `  seller logins   ${SELLERS.map((s) => `${s.ownerEmail} (${s.displayName})`).join(', ')}`,
            `  co-host login   seller2@demo.test (Priya Sharma — invite from broadcast sidebar)`,
            `  password        ${PASSWORD}`,
            '  sessions        none — schedule a new show from the seller console',
            '  live now        0',
            `  replays         ${replaySeeds.length === 0 ? 'none' : replaySeeds.map((s) => s.slug).join(' | ')}`,
            '',
        ].join('\n'),
    );
};
seed()
    .then(async () => {
        await closeRedis();
        await pool.end();
    })
    .catch(async (err) => {
        console.error(err);
        await closeRedis();
        await pool.end();
        process.exit(1);
    });
