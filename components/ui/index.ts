/**
 * Kit de componentes base do app (tema claro/escuro, accent #E86A24).
 * Uso: import { Button, Modal, StatCard } from '@/components/ui';
 */

export { default as Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { Field, Input, Select, Textarea, SearchInput, fieldControlClasses } from './Field';

export { default as Modal, ConfirmDialog } from './Modal';
export type { ModalProps, ModalSize, ConfirmDialogProps } from './Modal';

export { default as Badge } from './Badge';
export type { BadgeProps, BadgeColor } from './Badge';

export { default as StatCard, KpiHero } from './StatCard';
export type { StatCardProps, KpiHeroProps, KpiHeroItem } from './StatCard';

export { default as EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { default as Skeleton, TableSkeletonRows, StatCardSkeleton, CardSkeleton } from './Skeleton';

export { default as Banner } from './Banner';
export type { BannerProps, BannerVariant } from './Banner';

export { default as PageHeader } from './PageHeader';
export type { PageHeaderProps } from './PageHeader';

export { default as DateRangeFilter } from './DateRangeFilter';
export type { DateRangeFilterProps } from './DateRangeFilter';

export { ToastProvider, useToast } from './ToastProvider';

export { default as ZapCard } from './ZapCard';
