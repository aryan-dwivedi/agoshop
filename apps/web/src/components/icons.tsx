import type { LucideIcon } from 'lucide-react';

import {
    AudioLines,
    Captions,
    Heart,
    History,
    LayoutGrid,
    ListFilter,
    LockKeyhole,
    ChevronDown as LucideChevronDown,
    ChevronLeft as LucideChevronLeft,
    ChevronRight as LucideChevronRight,
    ChevronUp as LucideChevronUp,
    MapPin,
    Menu,
    MessageCircle,
    MessageCircleQuestion,
    Mic,
    Play,
    Quote,
    Search,
    Send,
    ShieldCheck,
    ShoppingBag,
    Sparkles,
    Square,
    Tag,
    Truck,
    UserRound,
    Volume2,
    VolumeX,
    X,
} from 'lucide-react';

type IconProps = {
    className?: string;
};
const iconClass = (className?: string): string => `shrink-0 ${className ?? 'h-5 w-5'}`;
const makeIcon =
    (Glyph: LucideIcon) =>
    ({ className }: IconProps): JSX.Element => (
        <Glyph
            aria-hidden="true"
            className={iconClass(className)}
            strokeWidth={1.8}
        />
    );
export const AudioLinesIcon = makeIcon(AudioLines);
export const SearchIcon = makeIcon(Search);
export const CartIcon = makeIcon(ShoppingBag);
export const AskIcon = makeIcon(MessageCircleQuestion);
export const HistoryIcon = makeIcon(History);
export const UserIcon = makeIcon(UserRound);
export const ChevronDown = makeIcon(LucideChevronDown);
export const ChevronRight = makeIcon(LucideChevronRight);
export const ChevronLeft = makeIcon(LucideChevronLeft);
export const ChevronUp = makeIcon(LucideChevronUp);
export const CloseIcon = makeIcon(X);
export const MicIcon = makeIcon(Mic);
export const SparklesIcon = makeIcon(Sparkles);
export const SendIcon = makeIcon(Send);
export const PlayIcon = makeIcon(Play);
export const SoundOnIcon = makeIcon(Volume2);
export const SoundOffIcon = makeIcon(VolumeX);
export const TruckIcon = makeIcon(Truck);
export const TagIcon = makeIcon(Tag);
export const ShieldIcon = makeIcon(ShieldCheck);
export const ChatIcon = makeIcon(MessageCircle);
export const GridIcon = makeIcon(LayoutGrid);
export const MenuIcon = makeIcon(Menu);
export const PinIcon = makeIcon(MapPin);
export const CaptionIcon = makeIcon(Captions);
export const LockIcon = makeIcon(LockKeyhole);
export const QuoteIcon = makeIcon(Quote);
export const StopIcon = makeIcon(Square);
export const HeartIcon = ({
    className,
    filled = false,
}: IconProps & {
    filled?: boolean;
}): JSX.Element => (
    <Heart
        aria-hidden="true"
        className={iconClass(className)}
        fill={filled ? 'currentColor' : 'none'}
        strokeWidth={1.8}
    />
);
export const BrowseIcon = makeIcon(ListFilter);
