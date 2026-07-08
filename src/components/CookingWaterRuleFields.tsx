import { useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import type { CookingWaterRule, CookingWaterRuleDraft } from '../lib/cookingWater';

type CookingWaterRuleFieldsProps = {
	idPrefix: string;
	enabled: boolean;
	draft: CookingWaterRuleDraft;
	error?: string;
	onEnabledChange: (enabled: boolean) => void;
	onDraftChange: (draft: CookingWaterRuleDraft) => void;
};

type FieldKey = keyof CookingWaterRule;

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
		<label className="space-y-1 text-xs text-muted-foreground">
			<span>{label}</span>
			<div className="flex items-center gap-2">
				<Input
					type="text"
					inputMode="decimal"
					value={value}
					onChange={(event) => onChange(event.target.value)}
					className="h-8"
				/>
				<span className="w-8 text-foreground">{suffix}</span>
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
				<label htmlFor={`${idPrefix}-enabled`} className="text-sm font-medium">
					Cooking water
				</label>
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
				<div className="mt-3 space-y-3">
					<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
						<NumberField
							label="Minimum water"
							value={draft.minimumWaterLiters}
							suffix="L"
							onChange={(value) => setField('minimumWaterLiters', value)}
						/>
						<NumberField
							label="Salt"
							value={draft.saltGramsPerLiter}
							suffix="g/L"
							onChange={(value) => setField('saltGramsPerLiter', value)}
						/>
					</div>
					<div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
						<NumberField
							label="Amount per serving"
							value={draft.amountGramsPerServing}
							suffix="g"
							onChange={(value) => setField('amountGramsPerServing', value)}
						/>
						<div className="space-y-1">
							<div className="text-xs text-muted-foreground">Extra water</div>
							<div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
								<div className="flex items-center gap-2">
									<Input
										aria-label="Extra water"
										type="text"
										inputMode="decimal"
										value={draft.extraWaterLiters}
										onChange={(event) => setField('extraWaterLiters', event.target.value)}
										className="h-8"
									/>
									<span className="text-sm text-foreground">L</span>
								</div>
								<span className="text-xs text-muted-foreground">per</span>
								<div className="flex items-center gap-2">
									<Input
										aria-label="Extra water per amount"
										type="text"
										inputMode="decimal"
										value={draft.extraWaterPerGrams}
										onChange={(event) => setField('extraWaterPerGrams', event.target.value)}
										className="h-8"
									/>
									<span className="text-sm text-foreground">g</span>
								</div>
							</div>
						</div>
					</div>
					{error && <div className="text-xs text-destructive">{error}</div>}
				</div>
			)}
		</div>
	);
}
