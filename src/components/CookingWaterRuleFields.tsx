import { useState } from 'react';
import { ChevronDownIcon, Info } from 'lucide-react';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import type { CookingWaterRuleDraft } from '../lib/cookingWater';

type CookingWaterRuleFieldsProps = {
	idPrefix: string;
	enabled: boolean;
	draft: CookingWaterRuleDraft;
	error?: string;
	onEnabledChange: (enabled: boolean) => void;
	onDraftChange: (draft: CookingWaterRuleDraft) => void;
};

type FieldKey = keyof CookingWaterRuleDraft;

function updateDraft(draft: CookingWaterRuleDraft, key: FieldKey, value: string) {
	return { ...draft, [key]: value };
}

type NumberFieldProps = {
	label: string;
	value: string;
	suffix: string;
	onChange: (value: string) => void;
};

function NumberField({ label, value, suffix, onChange }: NumberFieldProps) {
	return (
		<label className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-xs text-muted-foreground">
			<span className="truncate">{label}</span>
			<div className="flex items-center gap-2">
				<Input
					type="text"
					inputMode="decimal"
					value={value}
					onChange={(event) => onChange(event.target.value)}
					className="h-8 w-20"
				/>
				<span className="w-8 text-sm text-foreground">{suffix}</span>
			</div>
		</label>
	);
}

export function CookingWaterRuleFields({
	idPrefix,
	enabled,
	draft,
	error,
	onEnabledChange,
	onDraftChange
}: CookingWaterRuleFieldsProps) {
	const [expanded, setExpanded] = useState(true);
	const setField = (key: FieldKey, value: string) => {
		onDraftChange(updateDraft(draft, key, value));
	};
	const showFields = enabled && expanded;
	const toggleLabel = expanded ? 'Collapse cooking water fields' : 'Expand cooking water fields';

	const handleEnabledChange = (nextEnabled: boolean) => {
		if (nextEnabled) setExpanded(true);
		onEnabledChange(nextEnabled);
	};

	return (
		<div className="rounded-md border border-border/70 bg-muted/30 p-3.5">
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-1.5">
					<label htmlFor={`${idPrefix}-enabled`} className="text-sm font-medium">
						Cooking water
					</label>
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								type="button"
								aria-label="Cooking water help"
								className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
							>
								<Info className="h-3.5 w-3.5" />
							</button>
						</TooltipTrigger>
						<TooltipContent side="top" sideOffset={6} className="max-w-64 text-left leading-5">
							Minimum water is the starting amount. Extra water is added once for each selected serving. Salt is calculated from the final water amount.
						</TooltipContent>
					</Tooltip>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						aria-label={toggleLabel}
						aria-expanded={showFields}
						title={toggleLabel}
						disabled={!enabled}
						onClick={() => setExpanded((current) => !current)}
						className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
					>
						<ChevronDownIcon className={`h-4 w-4 transition-transform ${expanded ? '' : '-rotate-90'}`} />
					</button>
					<Switch id={`${idPrefix}-enabled`} checked={enabled} onCheckedChange={handleEnabledChange} aria-label="Cooking water" />
				</div>
			</div>
			{showFields && (
				<div className="mt-3 space-y-2.5">
					<NumberField
						label="Minimum water"
						value={draft.minimumWaterLiters}
						suffix="L"
						onChange={(value) => setField('minimumWaterLiters', value)}
					/>
					<NumberField
						label="Extra water per serving"
						value={draft.extraWaterLitersPerServing}
						suffix="L"
						onChange={(value) => setField('extraWaterLitersPerServing', value)}
					/>
					<NumberField
						label="Salt"
						value={draft.saltGramsPerLiter}
						suffix="g/L"
						onChange={(value) => setField('saltGramsPerLiter', value)}
					/>
					{error && <div className="text-xs text-destructive">{error}</div>}
				</div>
			)}
		</div>
	);
}
